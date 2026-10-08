// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 We Do Care Global
// Author: Emir Perla <emirperla96@gmail.com>  ORCID 0009-0009-8515-2727

import { Command } from "commander";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import YAML from "yaml";
import { openDb, ToolRegistry, loadManifest, parseManifest } from "@we-do-care/agentvault-core";
import { SecretVault, AuditLedger } from "@we-do-care/agentvault-vault";
import { PolicyStore } from "@we-do-care/agentvault-governance";
import { Telemetry } from "@we-do-care/agentvault-telemetry";
import { importOpenAPI } from "@we-do-care/agentvault-importer";
import { buildApp } from "@we-do-care/agentvault-server";
import { BRAND, type TrustLevel } from "@we-do-care/agentvault-shared";

const DB_PATH = process.env.AGENTVAULT_DB ?? "./data/vault.db";
const PORT = Number(process.env.AGENTVAULT_PORT ?? 7420);
const HOST = process.env.AGENTVAULT_HOST ?? "0.0.0.0";
const MASTER = process.env.AGENTVAULT_MASTER_KEY ?? "wdc-dev-master-key";
const API = `http://127.0.0.1:${PORT}`;

function ensureDataDir() {
  try { mkdirSync(dirname(resolve(DB_PATH)), { recursive: true }); } catch { /* already there */ }
}

/** Reads a value from --value, else stdin, so secrets never sit in shell history. */
function readValue(flagValue?: string): string {
  if (flagValue !== undefined) return flagValue;
  if (!process.stdin.isTTY) return readFileSync(0, "utf8").trim();
  throw new Error("no value supplied: pass --value or pipe via stdin");
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: any;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!res.ok) {
    const err: any = new Error(body?.message ?? body?.error ?? `HTTP ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

const program = new Command();
program
  .name("agentvault")
  .description(`${BRAND.product} - Enterprise Control Plane for AI Tools - by ${BRAND.org}`)
  .version(BRAND.version);

// ---- init ----
program.command("init")
  .description("Initialize the AgentVault data directory and database")
  .action(() => {
    ensureDataDir();
    openDb(DB_PATH).close();
    console.log(`Initialized ${BRAND.product} at ${DB_PATH}`);
    console.log(`${BRAND.org} - ORCID ${BRAND.orcid}`);
  });

// ---- doctor ----
program.command("doctor")
  .description("Check environment, database, registry and audit chain")
  .action(() => {
    ensureDataDir();
    const db = openDb(DB_PATH);
    const registry = new ToolRegistry(db);
    const audit = new AuditLedger(db);
    const telemetry = new Telemetry(db);
    const chain = audit.verifyChain();
    const usesDefaultKey = !process.env.AGENTVAULT_MASTER_KEY;
    console.log(`${BRAND.product} v${BRAND.version} - Node ${process.versions.node}`);
    console.log(`  DB            : ${DB_PATH}`);
    console.log(`  Tools         : ${registry.list().length}`);
    console.log(`  Tool calls    : ${telemetry.summary().calls}`);
    console.log(`  Audit chain   : ${chain.ok ? "ok" : `BROKEN at seq ${chain.firstBadSeq}`}`);
    console.log(`  Master key    : ${usesDefaultKey ? "DEFAULT (dev only)" : "from AGENTVAULT_MASTER_KEY"}`);
    if (usesDefaultKey) {
      console.log("  ! Set AGENTVAULT_MASTER_KEY before storing real secrets.");
    }
    if (!chain.ok) process.exitCode = 1;
    db.close();
  });

// ---- tools ----
const tools = program.command("tools");

tools.command("register <file>")
  .description("Register a tool manifest (.yaml or enact.md with frontmatter)")
  .option("--trust <level>", "trust level: Untrusted|Low|Medium|High|System", "Medium")
  .action((file, opts) => {
    ensureDataDir();
    const manifest = loadManifest(resolve(file));
    const db = openDb(DB_PATH);
    const t = new ToolRegistry(db).register(manifest, opts.trust as TrustLevel);
    new AuditLedger(db).append("cli", "tool.register", `tool:${t.name}@${t.version}`, { trust: opts.trust });
    console.log(`Registered ${t.name}@${t.version} (trust: ${t.trust_level})`);
    db.close();
  });

tools.command("list")
  .description("List registered tools")
  .action(() => {
    ensureDataDir();
    const db = openDb(DB_PATH);
    const list = new ToolRegistry(db).list();
    db.close();
    if (!list.length) { console.log("No tools registered."); return; }
    console.log(`Tools in ${BRAND.product}:`);
    for (const t of list) console.log(`   ${t.name}@${t.version}  [${t.trust_level}]`);
  });

tools.command("show <name>")
  .description("Show one registered tool manifest (org/tool)")
  .option("--tool-version <version>", "version (defaults to the most recent)")
  .action((name, opts) => {
    const db = openDb(DB_PATH);
    const t = new ToolRegistry(db).get(name, opts.toolVersion);
    db.close();
    if (!t) { console.error(`Not found: ${name}`); process.exitCode = 1; return; }
    console.log(JSON.stringify(t, null, 2));
  });

tools.command("remove <name>")
  .description("Remove a tool version (org/tool)")
  .requiredOption("--tool-version <version>", "version to remove")
  .action((name, opts) => {
    const db = openDb(DB_PATH);
    const ok = new ToolRegistry(db).remove(name, opts.toolVersion);
    if (ok) new AuditLedger(db).append("cli", "tool.remove", `tool:${name}@${opts.toolVersion}`);
    db.close();
    if (!ok) { console.error(`Not found: ${name}@${opts.toolVersion}`); process.exitCode = 1; return; }
    console.log(`Removed ${name}@${opts.toolVersion}`);
  });

tools.command("import <spec>")
  .description("Import an OpenAPI 3.x spec as tool manifests")
  .requiredOption("--name <org>", "publisher/org name")
  .action((spec, opts) => {
    ensureDataDir();
    const manifests = importOpenAPI(YAML.parse(readFileSync(resolve(spec), "utf8")), { name: opts.name });
    const db = openDb(DB_PATH);
    const registry = new ToolRegistry(db);
    const audit = new AuditLedger(db);
    for (const m of manifests) {
      registry.register(m, "Medium", opts.name);
      audit.append("cli", "tool.import", `tool:${m.name}@${m.version}`, { source: spec });
    }
    db.close();
    console.log(`Imported ${manifests.length} tools from ${spec}`);
  });

tools.command("validate <file>")
  .description("Validate a manifest without registering it")
  .action((file) => {
    try {
      const m = parseManifest(readFileSync(resolve(file), "utf8"));
      console.log(`Valid: ${m.name}@${m.version}`);
    } catch (e) {
      console.error(`Invalid manifest: ${(e as Error).message}`);
      process.exitCode = 1;
    }
  });

tools.command("execute <tool>")
  .description("Execute a tool through the running server (name@version)")
  .option("--arg <pairs...>", "key=value arguments")
  .option("--role <role>", "caller role", "agent")
  .option("--context <context>", "execution context", "production")
  .option("--agent <uri>", "calling agent URI", "agent://cli")
  .action(async (tool, opts) => {
    const args: Record<string, string> = {};
    for (const kv of opts.arg ?? []) {
      const idx = kv.indexOf("=");
      if (idx === -1) throw new Error(`--arg must be key=value, got: ${kv}`);
      args[kv.slice(0, idx)] = kv.slice(idx + 1);
    }
    const body = await api("/v1/execute", {
      method: "POST",
      body: JSON.stringify({ tool, arguments: args, role: opts.role, context: opts.context, agentUri: opts.agent }),
    });
    console.log(JSON.stringify(body, null, 2));
  });

// ---- vault ----
const vault = program.command("vault");

vault.command("set <key>")
  .description("Store or update a secret (AES-256-GCM envelope)")
  .option("--value <value>", "value; omit to read from stdin")
  .option("--namespace <ns>", "namespace", "default")
  .option("--scope <scope>", "scope")
  .option("--ttl <seconds>", "time to live in seconds")
  .action(async (key, opts) => {
    ensureDataDir();
    const db = openDb(DB_PATH);
    const v = new SecretVault(db, "default", MASTER);
    const meta = await v.put(opts.namespace, key, readValue(opts.value), {
      scope: opts.scope,
      ttlSeconds: opts.ttl ? Number(opts.ttl) : undefined,
    });
    new AuditLedger(db).append("cli", "secret.create", `vault://${meta.namespace}/${meta.key}`, { key_version: meta.key_version });
    v.lock(); db.close();
    console.log(`Secret stored: vault://${meta.namespace}/${meta.key} (v${meta.key_version})`);
  });

vault.command("list")
  .description("List secret metadata (never plaintext)")
  .action(() => {
    const db = openDb(DB_PATH);
    const v = new SecretVault(db, "default", MASTER);
    const items = v.list();
    v.lock(); db.close();
    if (!items.length) { console.log("No secrets stored."); return; }
    for (const s of items) {
      console.log(`   vault://${s.namespace}/${s.key} (v${s.key_version})${s.expires_at ? ` expires ${s.expires_at}` : ""}`);
    }
  });

vault.command("get <key>")
  .description("Read a secret value back (use sparingly; it decrypts in-process)")
  .option("--namespace <ns>", "namespace", "default")
  .action(async (key, opts) => {
    const db = openDb(DB_PATH);
    const v = new SecretVault(db, "default", MASTER);
    try {
      console.log(await v.get(opts.namespace, key));
    } finally {
      v.lock(); db.close();
    }
  });

vault.command("rotate <key>")
  .description("Rotate a secret: re-wrap under a new DEK, or set a new value")
  .option("--namespace <ns>", "namespace", "default")
  .option("--value <value>", "new value; omit to re-wrap the current value")
  .action(async (key, opts) => {
    const db = openDb(DB_PATH);
    const v = new SecretVault(db, "default", MASTER);
    const meta = await v.rotate(opts.namespace, key, opts.value);
    new AuditLedger(db).append("cli", "secret.rotate", `vault://${meta.namespace}/${meta.key}`, { key_version: meta.key_version });
    v.lock(); db.close();
    console.log(`Rotated vault://${meta.namespace}/${meta.key} -> v${meta.key_version}`);
  });

vault.command("revoke <key>")
  .description("Destroy every version of a secret")
  .option("--namespace <ns>", "namespace", "default")
  .action((key, opts) => {
    const db = openDb(DB_PATH);
    const ok = new SecretVault(db, "default", MASTER).revoke(opts.namespace, key);
    new AuditLedger(db).append("cli", "secret.revoke", `vault://${opts.namespace}/${key}`, { removed: ok });
    db.close();
    if (!ok) { console.error(`Not found: vault://${opts.namespace}/${key}`); process.exitCode = 1; return; }
    console.log(`Revoked vault://${opts.namespace}/${key}`);
  });

// ---- policy ----
const policy = program.command("policy");

policy.command("attach <tool>")
  .description("Attach an allow policy with a rate limit to a tool")
  .option("--role <role>", "role", "agent")
  .option("--max-calls <n>", "max calls per minute", "60")
  .option("--context <ctx>", "context", "production")
  .option("--priority <n>", "policy priority (higher wins)", "100")
  .action((tool, opts) => {
    ensureDataDir();
    const db = openDb(DB_PATH);
    const id = `${tool.replace(/\W+/g, "-")}-${opts.role}`;
    const rule = new PolicyStore(db).put({
      id,
      match: { tool, agent_role: [opts.role], context: [opts.context] },
      conditions: { max_calls_per_minute: Number(opts.maxCalls) },
      action: "allow",
      on_violation: "deny_with_reason",
      priority: Number(opts.priority),
    });
    new AuditLedger(db).append("cli", "policy.upsert", `policy:${rule.id}`);
    db.close();
    console.log(`Attached policy ${rule.id} (max ${opts.maxCalls}/min for role ${opts.role})`);
  });

policy.command("list")
  .description("List policies, highest priority first")
  .action(() => {
    const db = openDb(DB_PATH);
    const list = new PolicyStore(db).list();
    db.close();
    if (!list.length) { console.log("No policies. Calls are denied until one is attached (fail-closed)."); return; }
    for (const p of list) {
      console.log(`   ${p.id} [${p.action}] priority=${p.priority ?? 100} match=${JSON.stringify(p.match)}`);
    }
  });

policy.command("remove <id>")
  .description("Remove a policy by id")
  .action((id) => {
    const db = openDb(DB_PATH);
    const ok = new PolicyStore(db).remove(id);
    if (ok) new AuditLedger(db).append("cli", "policy.remove", `policy:${id}`);
    db.close();
    if (!ok) { console.error(`Not found: ${id}`); process.exitCode = 1; return; }
    console.log(`Removed policy ${id}`);
  });

// ---- telemetry ----
const telemetry = program.command("telemetry");

telemetry.command("query")
  .description("Query recorded tool calls")
  .option("--tool <name>", "filter by tool name")
  .option("--agent <uri>", "filter by agent URI")
  .option("--limit <n>", "limit", "20")
  .action(async (opts) => {
    const q = new URLSearchParams({ limit: opts.limit });
    if (opts.tool) q.set("tool", opts.tool);
    if (opts.agent) q.set("agent", opts.agent);
    const data = await api(`/v1/telemetry/query?${q}`);
    if (!data.calls.length) { console.log("No calls recorded."); return; }
    for (const c of data.calls) {
      console.log(`   ${c.tool}@${c.version} ${c.status} ${c.latencyMs}ms $${c.costUsd ?? 0} ${c.agentUri}`);
    }
  });

telemetry.command("summary")
  .description("Aggregate call counts, errors, latency and spend")
  .option("--tool <name>", "filter by tool name")
  .action(async (opts) => {
    const q = opts.tool ? `?tool=${encodeURIComponent(opts.tool)}` : "";
    const { summary } = await api(`/v1/telemetry/summary${q}`);
    console.log(`   calls        : ${summary.calls}`);
    console.log(`   errors       : ${summary.errors}`);
    console.log(`   avg latency  : ${summary.avgLatencyMs}ms`);
    console.log(`   total cost   : $${summary.totalCostUsd}`);
  });

telemetry.command("live")
  .description("Stream tool calls over SSE (Ctrl+C to stop)")
  .action(async () => {
    console.log(`Live telemetry (${BRAND.product}) - Ctrl+C to stop`);
    const res = await fetch(`${API}/v1/telemetry/live`);
    if (!res.body) throw new Error(`SSE stream unavailable (HTTP ${res.status}) - is the server running?`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      process.stdout.write(dec.decode(value));
    }
  });

// ---- audit ----
program.command("audit")
  .command("query")
  .description("Read the hash-chained audit ledger")
  .option("--limit <n>", "limit", "20")
  .action(async (opts) => {
    const data = await api(`/v1/audit?limit=${opts.limit}`);
    console.log(`Chain ok: ${data.chain_ok}`);
    for (const e of data.entries) {
      console.log(`  #${e.seq} ${e.timestamp} ${e.actor} ${e.action} (${e.resource})`);
    }
  });

// ---- serve ----
program.command("serve")
  .description("Start the HTTP API")
  .option("--port <port>", "HTTP port", String(PORT))
  .option("--host <host>", "bind host", HOST)
  .action(async (opts) => {
    ensureDataDir();
    const app = await buildApp({ dbPath: DB_PATH, masterPassphrase: MASTER });
    await app.listen({ port: Number(opts.port), host: opts.host });
    console.log(`\n  ${BRAND.product} v${BRAND.version}`);
    console.log(`  ${BRAND.org} - ORCID ${BRAND.orcid}`);
    console.log(`  http://localhost:${opts.port}\n`);
  });

program.parseAsync(process.argv).catch((err: Error & { body?: unknown }) => {
  console.error(`${err.message}`);
  process.exit(1);
});
