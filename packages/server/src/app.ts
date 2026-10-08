// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { openDb, ToolRegistry, newId } from "@we-do-care/agentvault-core";
import { SecretVault, AuditLedger } from "@we-do-care/agentvault-vault";
import { PolicyStore, evaluate, SlidingWindowCounter, can } from "@we-do-care/agentvault-governance";
import { Telemetry } from "@we-do-care/agentvault-telemetry";
import { AgentVaultError, BRAND, type Role, type Context, type TrustLevel, type PolicyRule } from "@we-do-care/agentvault-shared";
import { Registry, Counter, Histogram, collectDefaultMetrics } from "prom-client";

export interface ServerConfig {
  dbPath: string;
  masterPassphrase: string;
  tenant?: string;
  logger?: boolean;
}

const VALID_ROLES: Role[] = ["agent", "developer", "admin", "super_admin"];
const VALID_CONTEXTS: Context[] = ["production", "staging", "dev"];
const VALID_TRUST: TrustLevel[] = ["Untrusted", "Low", "Medium", "High", "System"];

/** Flat per-call cost used for budget accounting in v0.1.0. */
const COST_PER_CALL_USD = 0.0023;

// Prometheus metrics
const register = new Registry();
collectDefaultMetrics({ register });

const httpRequestsTotal = new Counter({
  name: "http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "endpoint", "status"],
  registers: [register],
});

const httpRequestDuration = new Histogram({
  name: "http_request_duration_seconds",
  help: "HTTP request latency in seconds",
  labelNames: ["method", "endpoint"],
  registers: [register],
});

const toolCallsTotal = new Counter({
  name: "tool_calls_total",
  help: "Total tool calls",
  labelNames: ["tool", "decision"],
  registers: [register],
});

const toolCallDuration = new Histogram({
  name: "tool_call_duration_seconds",
  help: "Tool call duration in seconds",
  labelNames: ["tool"],
  registers: [register],
});

export async function buildApp(cfg: ServerConfig): Promise<FastifyInstance> {
  const db = openDb(cfg.dbPath);
  const tenant = cfg.tenant ?? "default";
  const registry = new ToolRegistry(db, tenant);
  const vault = new SecretVault(db, tenant, cfg.masterPassphrase);
  const audit = new AuditLedger(db, tenant);
  const policies = new PolicyStore(db, tenant);
  const telemetry = new Telemetry(db, tenant);
  const limiter = new SlidingWindowCounter();

  const app = Fastify({ logger: cfg.logger === false ? false : { level: "info" } });
  await app.register(cors, { origin: true });

  // Metrics endpoint
  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", register.contentType);
    return register.metrics();
  });

  // Middleware for metrics
  app.addHook("onRequest", async (request, _reply) => {
    request.startTime = process.hrtime.bigint();
  });

  app.addHook("onResponse", async (request, reply) => {
    const duration = Number(process.hrtime.bigint() - (request.startTime as bigint)) / 1e9;
    httpRequestsTotal.inc({ method: request.method, endpoint: request.routeOptions?.url ?? "unknown", status: reply.statusCode.toString() });
    httpRequestDuration.observe({ method: request.method, endpoint: request.routeOptions?.url ?? "unknown" }, duration);
  });

  // ---- health ----
  app.get("/health", async () => ({ status: "ok", service: BRAND.product, version: BRAND.version }));
  app.get("/ready", async () => ({ status: "ready" }));
  app.get("/version", async () => ({ version: BRAND.version, brand: BRAND.org, orcid: BRAND.orcid }));

  // ---- tools ----
  app.get("/v1/tools", async () => ({ tools: registry.list() }));

  app.get<{ Params: { name: string; version: string } }>("/v1/tools/:name/:version", async (req, reply) => {
    const t = registry.get(decodeURIComponent(req.params.name), req.params.version);
    if (!t) return reply.code(404).send({ error: "not_found" });
    return t;
  });

  app.post<{ Body: { manifest: any; trust?: string; publisher?: string } }>("/v1/tools", async (req, reply) => {
    const trust = (req.body?.trust ?? "Medium") as TrustLevel;
    if (!VALID_TRUST.includes(trust)) {
      return reply.code(400).send({ error: "validation_error", message: `trust must be one of ${VALID_TRUST.join(", ")}` });
    }
    if (!req.body?.manifest?.name || !req.body?.manifest?.version) {
      return reply.code(400).send({ error: "validation_error", message: "manifest.name and manifest.version are required" });
    }
    const t = registry.register(req.body.manifest, trust, req.body.publisher);
    audit.append("api", "tool.register", `tool:${t.name}@${t.version}`, { id: t.id, trust });
    return reply.code(201).send(t);
  });

  app.delete<{ Params: { name: string; version: string } }>("/v1/tools/:name/:version", async (req, reply) => {
    const name = decodeURIComponent(req.params.name);
    const ok = registry.remove(name, req.params.version);
    if (!ok) return reply.code(404).send({ error: "not_found" });
    audit.append("api", "tool.remove", `tool:${name}@${req.params.version}`);
    return { status: "removed" };
  });

  // ---- secrets (metadata only; plaintext never leaves the vault) ----
  app.get("/v1/secrets", async () => ({ secrets: vault.list() }));

  app.post<{ Body: { namespace: string; key: string; value: string; scope?: string; ttlSeconds?: number } }>(
    "/v1/secrets",
    async (req, reply) => {
      const { namespace, key, value } = req.body ?? {};
      if (!namespace || !key || typeof value !== "string") {
        return reply.code(400).send({ error: "validation_error", message: "namespace, key and value are required" });
      }
      const meta = await vault.put(namespace, key, value, {
        scope: req.body.scope, ttlSeconds: req.body.ttlSeconds,
      });
      audit.append("api", "secret.create", `vault://${meta.namespace}/${meta.key}`, { key_version: meta.key_version });
      return reply.code(201).send(meta);
    },
  );

  app.post<{ Body: { namespace: string; key: string; value?: string } }>("/v1/secrets/rotate", async (req, reply) => {
    const { namespace, key, value } = req.body ?? {};
    if (!namespace || !key) {
      return reply.code(400).send({ error: "validation_error", message: "namespace and key are required" });
    }
    const meta = await vault.rotate(namespace, key, value);
    audit.append("api", "secret.rotate", `vault://${meta.namespace}/${meta.key}`, { key_version: meta.key_version });
    return meta;
  });

  app.delete<{ Body: { namespace: string; key: string } }>("/v1/secrets", async (req) => {
    const { namespace, key } = req.body ?? {};
    if (!namespace || !key) return { status: "bad_request", reason: "namespace_and_key_required" };
    const ok = vault.revoke(namespace, key);
    audit.append("api", "secret.revoke", `vault://${namespace}/${key}`, { removed: ok });
    return { status: ok ? "revoked" : "not_found" };
  });

  // ---- policies ----
  app.get("/v1/policies", async () => ({ policies: policies.list() }));
  app.post<{ Body: PolicyRule }>("/v1/policies", async (req, reply) => {
    if (!req.body?.id || !req.body?.action) {
      return reply.code(400).send({ error: "validation_error", message: "id and action are required" });
    }
    const rule = policies.put(req.body);
    audit.append("api", "policy.upsert", `policy:${rule.id}`, { priority: rule.priority ?? 100 });
    return reply.code(201).send(rule);
  });

  // ---- execute ----
  app.post<{ Body: {
    tool: string; arguments?: Record<string, unknown>;
    context?: Context; role?: Role; agentUri?: string; idempotency_key?: string;
  } }>("/v1/execute", async (req, reply) => {
    const started = Date.now();
    const {
      tool, arguments: args = {},
      context = "production", role = "agent", agentUri = "agent://anonymous",
    } = req.body ?? {};

    if (!tool) return reply.code(400).send({ error: "validation_error", message: "tool is required" });
    if (!VALID_ROLES.includes(role)) {
      return reply.code(400).send({ error: "validation_error", message: `role must be one of ${VALID_ROLES.join(", ")}` });
    }
    if (!VALID_CONTEXTS.includes(context)) {
      return reply.code(400).send({ error: "validation_error", message: `context must be one of ${VALID_CONTEXTS.join(", ")}` });
    }

    const [name, version] = tool.split("@");
    const registered = registry.get(name, version);
    if (!registered) return reply.code(404).send({ status: "denied", reason: "tool_not_found" });

    if (!can(role, "execute")) {
      audit.append(agentUri, "tool.denied", tool, { reason: "rbac", role });
      return reply.code(403).send({ status: "denied", reason: "rbac_denied" });
    }

    // Manifest-declared governance is enforced before the policy DSL.
    const gov = registered.manifest.governance;
    if (gov?.required_role && !gov.required_role.includes(role)) {
      audit.append(agentUri, "tool.denied", tool, { reason: "required_role", role });
      return reply.code(403).send({ status: "denied", reason: "role_not_permitted" });
    }
    if (gov?.allowed_contexts && !gov.allowed_contexts.includes(context)) {
      audit.append(agentUri, "tool.denied", tool, { reason: "context_not_allowed", context });
      return reply.code(403).send({ status: "denied", reason: "context_not_allowed" });
    }

    const key = `${agentUri}:${name}`;
    const callsLastMinute = limiter.count(key);
    const decision = evaluate(policies.list(), {
      tool: name, version: registered.version, role, context,
      callsLastMinute, callsToday: 0, costTodayUsd: 0, nowUtc: new Date(),
    });

    if (gov?.max_calls_per_minute !== undefined && callsLastMinute >= gov.max_calls_per_minute) {
      decision.decision = "deny";
      decision.reason = "manifest_rate_limit_exceeded";
    }

    if (decision.decision === "deny") {
      audit.append(agentUri, "tool.denied", tool, { reason: decision.reason, policyId: decision.policyId });
      telemetry.record({
        tool: name, version: registered.version, agentUri, provider: "internal",
        latencyMs: Date.now() - started, status: "denied", errorClass: decision.reason,
      });
      toolCallsTotal.inc({ tool: name, decision: "denied" });
      return reply.code(403).send({
        status: "denied", reason: decision.reason,
        policy_id: decision.policyId, retry_after_seconds: 30,
      });
    }

    limiter.hit(key);
    audit.append(agentUri, "tool.allowed", tool, { policyId: decision.policyId, context, role });

    // v0.1.0 executor: in-process echo. Container/gVisor sandbox lands in v0.2.0.
    const latency = Date.now() - started;
    const result = { ok: true, echo: args, tool, note: "v0.1.0 in-process executor" };

    telemetry.record({
      tool: name, version: registered.version, agentUri, provider: "internal",
      latencyMs: latency, status: "ok", costUsd: COST_PER_CALL_USD,
    });
    toolCallsTotal.inc({ tool: name, decision: "allowed" });
    toolCallDuration.observe({ tool: name }, latency / 1000);

    return {
      status: decision.decision === "approval" ? "approval_required" : "ok",
      call_id: newId(),
      result,
      latency_ms: latency,
      cost_usd: COST_PER_CALL_USD,
      governance: { policy_id: decision.policyId, decision: decision.decision, context, role },
    };
  });

  // ---- audit ----
  app.get<{ Querystring: { limit?: string; offset?: string } }>("/v1/audit", async (req) => ({
    entries: audit.query(
      Math.min(Number(req.query.limit ?? 100), 1000),
      Number(req.query.offset ?? 0),
    ),
    chain_ok: audit.verifyChain().ok,
  }));

  // ---- telemetry ----
  app.get<{ Querystring: { tool?: string; agent?: string; limit?: string } }>("/v1/telemetry/query", async (req) => ({
    calls: telemetry.query({
      tool: req.query.tool, agent: req.query.agent,
      limit: Math.min(Number(req.query.limit ?? 100), 1000),
    }),
  }));

  app.get<{ Querystring: { tool?: string } }>("/v1/telemetry/summary", async (req) => ({
    summary: telemetry.summary(req.query.tool),
  }));

  app.get("/v1/telemetry/live", (req, reply) => {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ brand: BRAND.product, version: BRAND.version })}\n\n`);
    const off = telemetry.on(span => {
      reply.raw.write(`event: call\ndata: ${JSON.stringify(span)}\n\n`);
    });
    const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 25_000);
    req.raw.on("close", () => { clearInterval(ping); off(); });
  });

  // ---- error handler ----
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AgentVaultError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, retryable: err.retryable });
    }
    app.log.error(err);
    return reply.code(500).send({ error: "internal_error", message: "unexpected server error" });
  });

  app.addHook("onClose", async () => {
    vault.lock();
    db.close();
  });

  return app;
}