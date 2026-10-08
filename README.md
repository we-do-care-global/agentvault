<p align="center">
  <img src="docs/assets/logo.jpg" alt="We Do Care Global" width="120">
</p>

<h1 align="center">AgentVault</h1>

<p align="center"><strong>Enterprise Control Plane for AI Tools</strong><br/>
by <a href="https://github.com/we-do-care-global">We Do Care Global</a> &middot; Sarajevo, Bosnia and Herzegovina</p>

<p align="center">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-Apache--2.0-d9a95f?style=flat-square&labelColor=0a0b10"></a>
  <a href="https://www.npmjs.com/package/@we-do-care/agentvault"><img alt="npm" src="https://img.shields.io/npm/v/@we-do-care/agentvault?style=flat-square&labelColor=0a0b10&color=d9a95f"></a>
  <a href="https://orcid.org/0009-0009-8515-2727"><img alt="ORCID" src="https://img.shields.io/badge/ORCID-0009--0009--8515--2727-a6ce39?style=flat-square&labelColor=0a0b10"></a>
  <a href="https://doi.org/10.5281/zenodo.22983557"><img alt="DOI" src="https://zenodo.org/badge/DOI/10.5281/zenodo.22983557.svg" style="flat-square&labelColor=0a0b10"></a>
  <a href="#"><img alt="Node" src="https://img.shields.io/badge/Node-20%2B-d9a95f?style=flat-square&labelColor=0a0b10"></a>
  <a href="#"><img alt="Enact" src="https://img.shields.io/badge/Enact-compatible-d9a95f?style=flat-square&labelColor=0a0b10"></a>
  <a href="#"><img alt="MCP" src="https://img.shields.io/badge/MCP-ready-8b90a6?style=flat-square&labelColor=0a0b10"></a>
  <a href="https://github.com/we-do-care-global/agentvault/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/we-do-care-global/agentvault/ci.yml?style=flat-square&labelColor=0a0b10&color=d9a95f"></a>
</p>

---

**AgentVault** adds governance, secrets lifecycle, multi-provider function calling, and per-tool telemetry on top of the [Enact](https://github.com/enactprotocol/enact) protocol. Self-hosted. Auditable. Fail-closed. Built by [We Do Care Global](https://github.com/we-do-care-global).

## The problem

AI tools today are a mess: manifests scattered across providers, secrets sitting in `.env` files, no rate limits, no audit trail, no cost visibility, and every LLM vendor wanting a different function-calling format.

## What AgentVault answers

| Layer | Package | Responsibility |
|---|---|---|
| **1. Tool Registry** | `@we-do-care/agentvault-core` | Enact-compatible manifests &middot; OpenAPI 3.x importer &middot; versioned lookup |
| **2. Secrets Vault** | `@we-do-care/agentvault-vault` | AES-256-GCM envelope &middot; Argon2id KDF &middot; rotation &middot; hash-chained audit |
| **3. Multi-Provider** | `@we-do-care/agentvault-adapters` | One schema &rarr; Gemini, OpenAI, Claude, Ollama |
| **4. Governance** | `@we-do-care/agentvault-governance` | JSON policy DSL &middot; RBAC &middot; rate limits &middot; budget &middot; fail-closed |
| **5. Telemetry** | `@we-do-care/agentvault-telemetry` | Per-tool latency &amp; cost &middot; live SSE &middot; error classification |

Plus `@we-do-care/agentvault-server` (Fastify HTTP API), `@we-do-care/agentvault-importer` (OpenAPI 3.1), and the `agentvault` CLI.

## Quickstart

```bash
npm i -g @we-do-care/agentvault

agentvault init
agentvault tools register examples/slack-webhook/manifest.yaml
echo "https://hooks.slack.com/services/..." | agentvault vault set webhook --namespace slack
agentvault policy attach we-do-care/slack-webhook --role agent --max-calls 10
agentvault serve --port 7420
```

In another shell:

```bash
agentvault tools execute we-do-care/slack-webhook@1.0.0 --arg action=post --arg text=hello
agentvault telemetry live
agentvault audit query
```

Calls are **denied until a policy allows them** &mdash; that is the fail-closed default, not a bug.

## Architecture

```text
+---------------------------------------------------------------+
| L5  Telemetry & Observability   agentvault-telemetry            |
| L4  Governance                 agentvault-governance           |
| L3  Multi-Provider Adapter     agentvault-adapters             |
| L2  Secrets & Capability Vault agentvault-vault                |
| L1  Tool Registry & Import     agentvault-core                 |
+---------------------------------------------------------------+
        shared (types, brand, errors)  |  server  |  cli
```

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health`, `/ready`, `/version` | Liveness and brand metadata |
| `GET` | `/v1/tools` | List registered tools |
| `POST` | `/v1/tools` | Register a manifest |
| `GET`/`DELETE` | `/v1/tools/:name/:version` | Fetch or remove one version |
| `GET` | `/v1/secrets` | Secret metadata (never plaintext) |
| `POST` | `/v1/secrets` | Store or update a secret |
| `POST` | `/v1/secrets/rotate` | Rotate to a new key version |
| `DELETE` | `/v1/secrets` | Revoke a secret |
| `GET`/`POST` | `/v1/policies` | List / upsert policies |
| `POST` | `/v1/execute` | Governed tool call |
| `GET` | `/v1/audit` | Ledger entries + chain verification |
| `GET` | `/v1/telemetry/query` | Recorded calls |
| `GET` | `/v1/telemetry/summary` | Aggregates |
| `GET` | `/v1/telemetry/live` | SSE stream |

## Security model

- **Envelope encryption.** Every secret gets a fresh 256-bit DEK; the DEK is sealed under a KEK derived from the master passphrase with Argon2id (64 MiB, t=3). AAD binds `tenant|namespace|key|version`, so a row cannot be replayed under another name.
- **Immutable audit.** Each ledger entry hashes the previous entry's hash. `agentvault audit query` reports `chain_ok`; tampering is detectable and localised to the first bad sequence.
- **Fail-closed.** No matching policy means denied. Unknown roles, disallowed contexts and breached rate limits all deny with a machine-readable `reason`.
- **Tenant isolation.** Every table is keyed by `tenant_id`; the registry, vault, policies, telemetry and ledger each scope reads and writes to it.

## Development

```bash
pnpm install
pnpm typecheck   # tsc -b across the project graph, incl. tests
pnpm build       # composite project build
pnpm test        # 75 tests across 10 packages
```

Requires Node &ge; 20. `better-sqlite3` and `argon2` install from prebuilds (no compiler toolchain needed); pnpm &ge; 11 asks for explicit build approval via `allowBuilds` in `pnpm-workspace.yaml`.

## Links

- Landing page: https://we-do-care-global.github.io/agentvault/
- Source: https://github.com/we-do-care-global/agentvault
- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Installation: [docs/INSTALLATION.md](docs/INSTALLATION.md)
- Portfolio: https://we-do-care-global.github.io/we-do-care-global/
- ORCID: https://orcid.org/0009-0009-8515-2727

## Ecosystem

- **AgentGuard** &mdash; security &amp; governance control plane for autonomous agents
- **Enterprise Hybrid-RAG** &mdash; production RAG with NVIDIA NeMo retrieval
- **Agent Eval** &mdash; agent evaluation and observability

## Citation

```bibtex
@software{perla2026agentvault,
  author       = {Perla, Emir},
  title        = {AgentVault: Enterprise Control Plane for AI Tools},
  year         = 2026,
  publisher    = {We Do Care Global},
  url          = {https://github.com/we-do-care-global/agentvault},
  orcid        = {0009-0009-8515-2727}
}
```

## License

Apache-2.0 &mdash; see [`LICENSE`](LICENSE). &copy; 2026 We Do Care Global &middot; Author: <emirperla96@gmail.com> &middot; ORCID 0009-0009-8515-2727
