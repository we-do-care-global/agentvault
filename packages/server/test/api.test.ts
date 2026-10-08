// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/index";
import type { FastifyInstance } from "fastify";
import type { PolicyRule, ToolManifest } from "@we-do-care/agentvault-shared";

const DB = join(tmpdir(), `agentvault-test-${process.pid}.db`);
const PASS = "test-master-passphrase";

const manifest = (over: Partial<ToolManifest> = {}): ToolManifest => ({
  enact: "2.0.0",
  vault: "1.0.0",
  name: "acme/tool",
  version: "1.0.0",
  description: "test tool",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  ...over,
});

const allowAll = (over: Partial<PolicyRule> = {}): PolicyRule => ({
  id: "p-allow",
  match: {},
  action: "allow",
  priority: 100,
  ...over,
});

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ dbPath: DB, masterPassphrase: PASS, tenant: "t1", logger: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  for (const suffix of ["", "-wal", "-shm"]) {
    try { rmSync(DB + suffix); } catch { /* not present */ }
  }
});

describe("health & version", () => {
  it("reports the brand on /health and /version", async () => {
    const h = await app.inject({ method: "GET", url: "/health" });
    expect(h.statusCode).toBe(200);
    expect(h.json()).toEqual({ status: "ok", service: "AgentVault", version: "0.1.3" });

    const v = await app.inject({ method: "GET", url: "/version" });
    expect(v.json()).toMatchObject({ brand: "We Do Care Global", orcid: "0009-0009-8515-2727" });
    expect((await app.inject({ url: "/ready" })).statusCode).toBe(200);
  });
});

describe("tools API", () => {
  it("registers, lists, fetches and removes a tool", async () => {
    const created = await app.inject({
      method: "POST", url: "/v1/tools",
      payload: { manifest: manifest(), trust: "High", publisher: "acme" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: "acme/tool", version: "1.0.0", trust_level: "High", publisher: "acme" });

    const list = await app.inject({ method: "GET", url: "/v1/tools" });
    expect(list.json().tools).toHaveLength(1);

    const one = await app.inject({ method: "GET", url: "/v1/tools/acme%2Ftool/1.0.0" });
    expect(one.statusCode).toBe(200);
    expect(one.json().manifest.description).toBe("test tool");

    const removed = await app.inject({ method: "DELETE", url: "/v1/tools/acme%2Ftool/1.0.0" });
    expect(removed.statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: "/v1/tools/acme%2Ftool/1.0.0" })).statusCode).toBe(404);
  });

  it("rejects an invalid trust level and an incomplete manifest", async () => {
    const bad = await app.inject({
      method: "POST", url: "/v1/tools", payload: { manifest: manifest({ name: "acme/bad" }), trust: "Godmode" },
    });
    expect(bad.statusCode).toBe(400);

    const incomplete = await app.inject({ method: "POST", url: "/v1/tools", payload: { manifest: { name: "acme/x" } } });
    expect(incomplete.statusCode).toBe(400);

    expect((await app.inject({ method: "GET", url: "/v1/tools/acme%2Ftool/9.9.9" })).statusCode).toBe(404);
  });
});

describe("secrets API", () => {
  it("stores, lists, rotates, reads and revokes without leaking plaintext", async () => {
    const created = await app.inject({
      method: "POST", url: "/v1/secrets",
      payload: { namespace: "slack", key: "webhook", value: "https://hooks.slack.com/secret" },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ namespace: "slack", key: "webhook", key_version: 1 });
    // plaintext must not appear in the response body
    expect(created.body).not.toContain("hooks.slack.com");

    const list = await app.inject({ method: "GET", url: "/v1/secrets" });
    expect(list.json().secrets).toHaveLength(1);
    expect(list.body).not.toContain("hooks.slack.com");

    const rotated = await app.inject({
      method: "POST", url: "/v1/secrets/rotate", payload: { namespace: "slack", key: "webhook" },
    });
    expect(rotated.json().key_version).toBe(2);

    const revoked = await app.inject({
      method: "DELETE", url: "/v1/secrets", payload: { namespace: "slack", key: "webhook" },
    });
    expect(revoked.json().status).toBe("revoked");
    expect((await app.inject({ method: "GET", url: "/v1/secrets" })).json().secrets).toHaveLength(0);
  });

  it("validates the request body", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/secrets", payload: { namespace: "a" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/secrets/rotate", payload: { key: "k" } })).statusCode).toBe(400);
  });
});

describe("execute: fail-closed governance", () => {
  it("404s an unregistered tool", async () => {
    const res = await app.inject({
      method: "POST", url: "/v1/execute", payload: { tool: "nope/nope@1.0.0", arguments: {} },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ status: "denied", reason: "tool_not_found" });
  });

  it("denies when no policy matches", async () => {
    await app.inject({ method: "POST", url: "/v1/tools", payload: { manifest: manifest() } });
    const res = await app.inject({
      method: "POST", url: "/v1/execute", payload: { tool: "acme/tool@1.0.0", arguments: { text: "hi" } },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ status: "denied", reason: "no_matching_policy" });
  });

  it("executes once a policy allows, and reports governance + cost", async () => {
    await app.inject({ method: "POST", url: "/v1/policies", payload: allowAll() });
    const res = await app.inject({
      method: "POST", url: "/v1/execute",
      payload: { tool: "acme/tool@1.0.0", arguments: { text: "hi" }, agentUri: "agent://t" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.result).toMatchObject({ ok: true, echo: { text: "hi" } });
    expect(body.governance).toMatchObject({ decision: "allow", policy_id: "p-allow" });
    expect(body.call_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.cost_usd).toBeGreaterThan(0);
    expect(typeof body.latency_ms).toBe("number");
  });

  it("enforces the manifest role gate before the policy DSL", async () => {
    await app.inject({
      method: "POST", url: "/v1/tools",
      payload: { manifest: manifest({ name: "acme/admin-only", governance: { required_role: ["admin"] } }) },
    });
    await app.inject({ method: "POST", url: "/v1/policies", payload: allowAll({ id: "p-admin-tool" }) });

    const asAgent = await app.inject({
      method: "POST", url: "/v1/execute", payload: { tool: "acme/admin-only@1.0.0", arguments: {}, role: "agent" },
    });
    expect(asAgent.statusCode).toBe(403);
    expect(asAgent.json().reason).toBe("role_not_permitted");

    const asAdmin = await app.inject({
      method: "POST", url: "/v1/execute", payload: { tool: "acme/admin-only@1.0.0", arguments: {}, role: "admin" },
    });
    expect(asAdmin.statusCode).toBe(200);
  });

  it("enforces the manifest context gate", async () => {
    await app.inject({
      method: "POST", url: "/v1/tools",
      payload: { manifest: manifest({ name: "acme/prod-only", governance: { allowed_contexts: ["production"] } }) },
    });
    const res = await app.inject({
      method: "POST", url: "/v1/execute", payload: { tool: "acme/prod-only@1.0.0", arguments: {}, context: "dev" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().reason).toBe("context_not_allowed");
  });

  it("enforces the manifest sliding-window rate limit", async () => {
    await app.inject({
      method: "POST", url: "/v1/tools",
      payload: { manifest: manifest({ name: "acme/limited", governance: { max_calls_per_minute: 2 } }) },
    });
    const call = () => app.inject({
      method: "POST", url: "/v1/execute",
      payload: { tool: "acme/limited@1.0.0", arguments: {}, agentUri: "agent://limited" },
    });
    expect((await call()).statusCode).toBe(200);
    expect((await call()).statusCode).toBe(200);
    const third = await call();
    expect(third.statusCode).toBe(403);
    expect(third.json().reason).toBe("manifest_rate_limit_exceeded");
  });

  it("validates role and context enums", async () => {
    const badRole = await app.inject({
      method: "POST", url: "/v1/execute", payload: { tool: "acme/tool@1.0.0", arguments: {}, role: "root" },
    });
    expect(badRole.statusCode).toBe(400);
    const badCtx = await app.inject({
      method: "POST", url: "/v1/execute", payload: { tool: "acme/tool@1.0.0", arguments: {}, context: "prod" },
    });
    expect(badCtx.statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/execute", payload: {} })).statusCode).toBe(400);
  });
});

describe("audit & telemetry", () => {
  it("keeps the audit chain verifiable across all the calls above", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/audit?limit=1000" });
    expect(res.statusCode).toBe(200);
    const { entries, chain_ok } = res.json();
    expect(chain_ok).toBe(true);
    const actions = new Set(entries.map((e: any) => e.action));
    for (const a of ["tool.register", "secret.create", "secret.rotate", "secret.revoke", "policy.upsert", "tool.allowed", "tool.denied"]) {
      expect(actions).toContain(a);
    }
    // every entry links to the previous hash
    for (let i = 0; i < entries.length - 1; i++) {
      expect(entries[i].prev_hash).toBe(entries[i + 1].hash);
    }
  });

  it("records and aggregates calls", async () => {
    const q = await app.inject({ method: "GET", url: "/v1/telemetry/query?limit=100" });
    expect(q.statusCode).toBe(200);
    expect(q.json().calls.length).toBeGreaterThan(0);

    // acme/tool was called both before (denied: no policy) and after the allow policy
    const allowed = await app.inject({ method: "GET", url: "/v1/telemetry/query?tool=acme%2Ftool&agent=agent%3A%2F%2Ft" });
    expect(allowed.json().calls.every((c: any) => c.status === "ok")).toBe(true);
    expect(allowed.json().calls.length).toBeGreaterThan(0);

    const denied = await app.inject({ method: "GET", url: "/v1/telemetry/query?tool=acme%2Flimited" });
    expect(denied.json().calls.some((c: any) => c.status === "denied")).toBe(true);

    const sum = await app.inject({ method: "GET", url: "/v1/telemetry/summary" });
    expect(sum.json().summary.calls).toBeGreaterThan(0);
    expect(sum.json().summary.totalCostUsd).toBeGreaterThan(0);
  });

  it("streams the SSE handshake and a live span over a real socket", async () => {
    // inject() waits for a complete response, which a stream never sends.
    const addr = await app.listen({ port: 0, host: "127.0.0.1" });
    const controller = new AbortController();
    try {
      const res = await fetch(`${addr}/v1/telemetry/live`, { signal: controller.signal });
      expect(res.headers.get("content-type")).toContain("text/event-stream");
      expect(res.headers.get("cache-control")).toBe("no-cache");

      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      const first = dec.decode((await reader.read()).value);
      expect(first).toContain("event: hello");
      expect(first).toContain("AgentVault");

      // a span recorded now must arrive on the open stream
      const second = (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return "";
          const chunk = dec.decode(value);
          if (chunk.includes("event: call")) return chunk;
        }
      })();

      app.inject({
        method: "POST", url: "/v1/execute",
        payload: { tool: "acme/tool@1.0.0", arguments: { text: "sse" }, agentUri: "agent://sse" },
      }).catch(() => {});

      const call = await Promise.race([
        second,
        new Promise<string>(r => setTimeout(() => r(""), 3000)),
      ]);
      expect(call).toContain("event: call");
      expect(call).toContain("acme/tool");
    } finally {
      controller.abort();
      await app.close();
      app = await buildApp({ dbPath: DB, masterPassphrase: PASS, tenant: "t1", logger: false });
      await app.ready();
    }
  }, 15_000);
});
