# Installation

SPDX-License-Identifier: Apache-2.0
Copyright (c) 2026 We Do Care Global
Author: Emir Perla &lt;emirperla96@gmail.com&gt; ORCID 0009-0009-8515-2727

## Requirements

- **Node.js 20 or newer** (developed and tested on 24)
- **pnpm 9 or newer** (the workspace uses `allowBuilds`, which pnpm 11 requires)
- No compiler toolchain: `better-sqlite3` and `argon2` both install from prebuilds

## Install the CLI

```bash
npm i -g @we-do-care/agentvault
agentvault --version
```

## From source

```bash
git clone https://github.com/we-do-care-global/agentvault.git
cd agentvault
pnpm install
pnpm build
```

Verify:

```bash
pnpm typecheck   # tsc -b across the project graph, including tests
pnpm test        # 75 tests across 10 packages
```

## First run

```bash
# 1. Choose a master key. Without one, AgentVault uses a dev default and warns.
export AGENTVAULT_MASTER_KEY="$(openssl rand -base64 32)"

# 2. Point at a database (defaults to ./data/vault.db)
export AGENTVAULT_DB="./data/vault.db"

# 3. Initialise and check
agentvault init
agentvault doctor
```

`doctor` prints the database path, tool count, audit chain status, and whether the
master key came from the environment. It exits non-zero if the audit chain is
broken.

## Register a tool

```bash
agentvault tools validate examples/slack-webhook/manifest.yaml
agentvault tools register examples/slack-webhook/manifest.yaml --trust High
agentvault tools list
agentvault tools show we-do-care/slack-webhook --tool-version 1.0.0
```

Or import an OpenAPI 3.x spec:

```bash
agentvault tools import openapi.yaml --name acme
```

## Store a secret

Pipe the value so it never lands in shell history:

```bash
echo "https://hooks.slack.com/services/T000/B000/XXX" \
  | agentvault vault set webhook --namespace slack

agentvault vault list      # metadata only, never plaintext
agentvault vault rotate webhook --namespace slack
agentvault vault revoke webhook --namespace slack
```

The master key is required to read a secret back. Changing
`AGENTVAULT_MASTER_KEY` after storing secrets makes them unreadable &mdash; there
is no recovery path by design.

## Attach a policy

Calls are denied until a policy allows them:

```bash
agentvault policy attach we-do-care/slack-webhook --role agent --max-calls 10
agentvault policy list
```

## Run the server

```bash
agentvault serve --port 7420 --host 0.0.0.0

curl -s localhost:7420/health
curl -s localhost:7420/version
```

Execute and observe:

```bash
agentvault tools execute we-do-care/slack-webhook@1.0.0 --arg action=post --arg text=hello
agentvault telemetry live     # SSE stream
agentvault audit query        # chain_ok + entries
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `AGENTVAULT_DB` | `./data/vault.db` | SQLite database path |
| `AGENTVAULT_MASTER_KEY` | `wdc-dev-master-key` (dev only) | KEK passphrase |
| `AGENTVAULT_PORT` | `7420` | Default HTTP port |
| `AGENTVAULT_HOST` | `0.0.0.0` | Default bind host |

## Windows note

Run through a POSIX-style shell (Git Bash, WSL). Native Windows paths with spaces
can confuse the pnpm workspace linker; a space-free path such as `C:\dev\agentvault`
is the safe default.

## Troubleshooting

**`ERR_PNPM_IGNORED_BUILDS`** &mdash; pnpm 11 blocks install scripts until you
approve them. `pnpm-workspace.yaml` already lists `argon2`, `better-sqlite3` and
`esbuild` under `allowBuilds`; if you added a native dependency, add it there too.

**Every call returns 403 `no_matching_policy`** &mdash; expected. Attach a policy
with `agentvault policy attach`.

**Secrets unreadable after a restart** &mdash; `AGENTVAULT_MASTER_KEY` changed.
The passphrase is the only input to the KEK; there is no fallback.

**`audit chain BROKEN at seq N`** &mdash; a ledger row was modified outside
AgentVault. Restore from a backup; the chain cannot be repaired in place.
