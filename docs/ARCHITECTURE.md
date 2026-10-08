# AgentVault - Architecture

SPDX-License-Identifier: Apache-2.0
Copyright (c) 2026 We Do Care Global
Author: Emir Perla &lt;emirperla96@gmail.com&gt; ORCID 0009-0009-8515-2727

AgentVault is a pnpm workspace of nine TypeScript packages. Each is independently
usable; the server and CLI compose all of them.

## Layers

```text
+---------------------------------------------------------------+
| L5  Telemetry & Observability   @we-do-care/agentvault-telemetry |
| L4  Governance                 @we-do-care/agentvault-governance|
| L3  Multi-Provider Adapter     @we-do-care/agentvault-adapters  |
| L2  Secrets & Capability Vault @we-do-care/agentvault-vault     |
| L1  Tool Registry & Import     @we-do-care/agentvault-core      |
+---------------------------------------------------------------+
        shared (types, brand, errors)  |  server (Fastify)  |  cli
```

Dependencies point strictly downward. `shared` depends on nothing but `zod`;
nothing depends on `server` or `cli` except each other.

## Package graph

| Package | Depends on | Responsibility |
|---|---|---|
| `shared` | zod | `BRAND`, protocol types, `AgentVaultError` |
| `core` | shared, better-sqlite3, yaml, zod | Schema + migrations, manifest parsing, tool registry |
| `vault` | core, shared, argon2 | Envelope crypto, secret lifecycle, hash-chained audit |
| `adapters` | shared | Four provider wire formats |
| `governance` | core, shared | RBAC, policy DSL, sliding window, policy store |
| `telemetry` | core, shared | Call spans, listeners, aggregates |
| `importer` | shared, yaml | OpenAPI 3.x to tool manifests |
| `server` | all of the above | Fastify HTTP API |
| `cli` | all of the above | The `agentvault` binary |

## Data model

Five tables, every one keyed by `tenant_id`:

- **tools** &mdash; `(tenant_id, name, version)` unique. Stores the manifest as JSON
  plus a `trust_level` and optional `publisher`.
- **secrets** &mdash; `(tenant_id, namespace, key, key_version)` unique. Holds
  `ciphertext`/`nonce`/`tag` for the value and `wrapped_dek`/`dek_nonce`/`dek_tag`
  for the DEK, with `aad` binding tenant, namespace, key and version.
- **policies** &mdash; `(tenant_id, name)` unique, rule stored as JSON with a priority.
- **audit_ledger** &mdash; autoincrement `seq` plus `prev_hash`/`hash`.
- **tool_calls** &mdash; one row per call with latency, status, error class and cost.

## Secrets: envelope encryption

```text
master passphrase
      |  Argon2id (m=64 MiB, t=3, p=1)
      v
     KEK (32 bytes, cached per process)
      |  AES-256-GCM, AAD = tenant|namespace|key|version
      v
  wrapped DEK  <-- stored
      |
      |  AES-256-GCM, same AAD
      v
  ciphertext   <-- stored
```

Rotation writes `key_version + 1` with a fresh DEK. With no new value the current
plaintext is re-sealed, so key material rotates without a value change. Reads
always resolve the highest version; the prior row is retained for rollback.
`revoke` deletes every version.

The KEK uses a fixed application salt so it survives a process restart. The
passphrase is the only secret; per-installation random salts land in v0.2.0.

## Audit chain

Each entry hashes a canonical JSON object:

```json
{"tenant_id":"...","timestamp":"...","actor":"...","action":"...","resource":"...","context":...,"prev_hash":"..."}
```

`prev_hash` starts at 64 zeros (genesis). Because each hash covers the previous
one, editing or deleting any row invalidates every subsequent link.
`verifyChain()` walks the chain and returns the first bad `seq`, and the
`AuditLedger.tamper()` helper exists so tests can prove the detection works.

## Policy evaluation

`evaluate()` is fail-closed:

1. Sort rules by `priority` descending.
2. Take the first rule whose `match` block applies (tool with optional semver
   range, `agent_role`, `context`).
3. Check conditions in order &mdash; rate limit, daily quota, daily budget,
   allowed UTC hours &mdash; each returning a machine-readable `reason`.
4. Otherwise return the rule's `action`.
5. If nothing matches: `{ decision: "deny", reason: "no_matching_policy" }`.

The server applies three gates before this: RBAC (`can(role, "execute")`),
manifest `required_role`, and manifest `allowed_contexts`. Manifest
`max_calls_per_minute` is applied after evaluation against the sliding window,
so it cannot be loosened by a permissive policy.

## Execution path

```text
POST /v1/execute
   -> validate role/context enums
   -> registry.get(name, version)          404 if unknown
   -> RBAC + manifest gates                403
   -> limiter.count(key)                   sliding window
   -> policyStore.list() + evaluate()      403 with reason
   -> limiter.hit(key)
   -> audit.append(actor, "tool.allowed")
   -> execute (v0.1.0: in-process echo)
   -> telemetry.record(span)
   -> 200 { status, call_id, result, latency_ms, cost_usd, governance }
```

## Provider adapters

Each adapter implements `formatTool`, `formatTools`, `parseToolCall`,
`formatToolResult`, `supportsStreaming`, `supportsParallel`. `parseToolCall`
normalises every vendor response into `NormalizedCall { name, arguments, callId,
provider, raw }` and never throws on malformed arguments. Gemini keys its
`functionResponse` by function name (passed as the optional third argument);
the others use the call id.

## v0.2.0 roadmap

- Postgres backend with Drizzle migrations and row-level security
- Container execution (Docker / gVisor sandbox) replacing the in-process executor
- mTLS and Ed25519 agent identity
- MCP server transport
- Dashboard (React + Recharts) and multi-tenancy UI
- Redis-backed distributed rate limiting
