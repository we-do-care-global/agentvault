# slack-webhook - AgentVault example

Minimal example tool for **AgentVault** by [We Do Care Global](https://github.com/we-do-care-global).
ORCID 0009-0009-8515-2727.

## Quickstart

```bash
# 1. Build the workspace
pnpm install && pnpm build

# 2. Register the manifest
node packages/cli/dist/index.js tools register examples/slack-webhook/manifest.yaml

# 3. Store the webhook URL in the vault (piped, so it stays out of shell history)
echo "https://hooks.slack.com/services/T000/B000/XXXX" \
  | node packages/cli/dist/index.js vault set webhook --namespace slack

# 4. Attach an allow policy (calls are denied until one exists - fail-closed)
node packages/cli/dist/index.js policy attach we-do-care/slack-webhook --role agent --max-calls 10

# 5. Start the API
node packages/cli/dist/index.js serve --port 7420

# 6. Execute (in another shell)
node packages/cli/dist/index.js tools execute we-do-care/slack-webhook@1.0.0 --arg action=post --arg text=hello

# 7. Observe
node packages/cli/dist/index.js audit query
node packages/cli/dist/index.js telemetry live
```

## What the manifest declares

| Field | Meaning |
|---|---|
| `enact` / `vault` | Protocol versions the manifest targets |
| `inputSchema` | JSON Schema handed to the LLM as the function signature |
| `governance.required_role` | Roles allowed to call it (enforced by the server) |
| `governance.max_calls_per_minute` | Sliding-window cap enforced before the policy DSL |
| `secrets[].source` | `vault://` pointer; plaintext never enters the manifest |
| `telemetry.alert_threshold` | Latency / error-rate alerting hints |
| `providers` | Per-vendor function name mapping |
| `circuit_breaker` | Error threshold and open duration |

## Note on execution

v0.1.0 ships an **in-process executor**: `/v1/execute` echoes the arguments after
policy evaluation and records a telemetry span. Containerised sandboxed
execution (Docker / gVisor) is v0.2.0. To make this example post to a real
Slack workspace, implement the `command` above against the container runtime.
