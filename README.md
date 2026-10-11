# dsh-speed

Fast and Ultrafast for DSH web, terminal commands, and agent model requests. Managed source: [nix-config/pkgs/dsh-speed](https://github.com/jakehemmerle/nix-config/tree/main/pkgs/dsh-speed).

## Use

Open the existing **Model / Effort** menu and choose **Speed**: Standard, Fast, or Ultrafast. In `dst`, `/speed` opens an arrow-key picker when all three speeds are available; use Up/Down and Enter, or Escape to cancel. With only Standard and Fast available it toggles between them. `/speed status` reports the current choice, and `/speed standard`, `/speed fast`, `/speed ultrafast` set it directly. The start screen and bottom bar display `Speed: Standard`, `Speed: ⚡` (Fast), or `Speed: ⚡⚡` (Ultrafast). Changes apply to subsequent requests. A web selection during streaming leaves the active request unchanged; the terminal command requires an idle agent.

Selections are independent for each session, provider, and model. Titles and other auxiliary requests do not inherit the conversational speed. Teammates start with their own Standard selection; their authentication still uses the same configured provider. A parent's Fast or Ultrafast setting never silently spills into a teammate.

| Route | Credential source | Speed availability |
| --- | --- | --- |
| Local `openai-codex` | Local Codex `auth.json` | That account's native model catalog |
| Configured `providerproxy` | ProviderProxy client key | Proxy `/v1/models` catalog |
| Official `openai` API | Existing DSH API credential | Explicit supported-model list / configured opt-ins |

**Fast sends `priority`; Ultrafast sends `ultrafast`.** Native requests also send Codex's `x-codex-routing-hint`. Standard sends `default` after explicitly selecting it. Before selection the existing transport defaults apply.

## Authentication and configuration

Managed profiles read `~/.codex/auth.json` directly for local Codex requests, including agents. They do not copy refresh tokens into DSH's credential store. Reads follow the current file so an account switch takes effect on the next request. Near expiry, the configured Codex executable refreshes its own login through `account/read`; DSH then rereads the file. Missing or invalid native credentials fail visibly. Use `codex login` if that device has never signed in.

ProviderProxy is a separate credential plane. The launcher reads its client key from the managed token file; the proxy owns and refreshes its upstream OAuth login. Local Codex tokens are never forwarded to the proxy. Only an explicitly configured provider with the exact allowed base URL can receive proxy speed options.

Example host-entry configuration:

```yaml
- id: dsh-speed
  name: /absolute/path/to/dsh-speed/index.js
  config:
    codexAuthFile: /home/you/.codex/auth.json
    codexCommand: /absolute/path/to/codex
    codexClientVersion: 0.160.1
    proxyProviders:
      providerproxy:
        baseURL: http://gpu.tail47033e.ts.net:4000/v1
        apiKeyEnv: PROVIDERPROXY_API_KEY
```

Use the managed Nix profile to upgrade; do not install a duplicate row. DSH must restart to load a new host plugin. The Model/Effort child slot is a checked build-time patch to pinned DSH 0.2.1-alpha.2. Runtime transport compatibility is audited for pi-ai 0.87.1 and 1.1.0; other versions fail rather than silently ignoring speed.

The native catalog caches for five minutes and the proxy catalog for one minute, keyed by credentials. Refresh forces a new catalog read. Unknown models, unavailable credentials, and failed catalogs expose only Standard. A revoked saved tier warns and rejects generation until a valid speed is selected.

Preferences default to `~/.dsh/dsh-speed.json.d/`, one atomically replaced 0600 record per session/provider/model in a 0700 directory. Independent web and terminal processes cannot overwrite unrelated records. Existing array-format `dsh-speed.json` is a read-only migration fallback. `stateFile: false` uses memory only.

Accelerated access depends on the selected account and may consume more allowance or cost more. A work account may advertise Fast without Ultrafast. The plugin cannot grant entitlement. Reported response tiers may differ from requested tiers even in the native Codex client; request parity proves correct protocol use, not a latency or billing guarantee.

## Tests

The Nix derivation runs unit, property, client, runtime, and pinned-bundle contract tests. The real DSH E2E suite uses an isolated HOME, workspace, port, and tmux socket with synthetic HTTP credentials. It exercises native and proxy routes, six model/tier combinations, browser persistence and isolation, busy states, narrow layout, terminal commands, and Team delegation.

```sh
DSH_PI_AI_MODULE=/path/to/host/pi-ai/dist/index.js \
DSH_MODEL_BUNDLE=/path/to/unpatched/model-selection/lib/client.js npm test

DSH_BIN=/path/to/patched/dsh CHROMIUM_PATH=/path/to/chrome npm run test:e2e
```

All real-account tests are gated. `npm test` and `npm run test:e2e` use only synthetic credentials and loopback HTTP mocks. Direct live-runner invocation refuses before reading credentials unless `--live` or `DSH_LIVE_TESTS=1` is supplied. Real agent E2E additionally requires `DSH_LIVE_AGENTS=1`; run it only deliberately with `npm run test:live:agents`.

Real-account smoke tests consume plan allowance. From the nix-config root:

```sh
python3 -B tests/test_dsh_speed.py "$(command -v dsh)" --live --all-tiers
python3 -B tests/test_dsh_speed.py "$(command -v dsh)" --live --provider providerproxy --all-tiers
```

Native tests use the actual local auth bridge with an empty DSH credential store. Proxy tests use the same managed token file as the launcher. They save selections through the public handler, inspect the final HTTP payload, require a successful terminal response and `SPEED_OK`, and report requested and returned tiers separately. Unsupported account tiers are reported explicitly. Timing is diagnostic, not a benchmark.

## Native protocol evidence

**Native comparison, 2026-10-10, bundled Codex CLI 0.160.1:** isolated real CLI runs using the same local OAuth login completed all six model/mode combinations with `SPEED_OK`. A loopback proxy scoped only to those CLI processes captured the actual WebSocket requests to `wss://chatgpt.com/backend-api/codex/responses`; the running desktop app and system trust store were unchanged. The native wire contract was:

| Mode | `response.create.service_tier` | `x-codex-routing-hint` on the WebSocket handshake |
| --- | --- | --- |
| Standard | omitted | `model=<model>` |
| Fast | `priority` | `model=<model>;tier=priority` |
| Ultrafast | `ultrafast` | `model=<model>;tier=ultrafast` |

Both `gpt-6.1-sol` and `gpt-6-astra` accepted Ultrafast through the native CLI. Every actual generation, including native Fast and Ultrafast, nevertheless reported `service_tier: "default"` in `response.completed`. Native connection prewarming used `generate: false` and reported `auto`; those events are not generations. Adding the native routing header to the DSH SSE probe did not change its reported tier. Therefore the strict tier-confirmation failures above also occur with the native client; they do not establish that DSH was downgraded or that acceleration occurred. Compare request parity separately from latency/throughput and billing evidence.

To reproduce a native Sol Ultrafast smoke test using the CLI's existing login (substitute `gpt-6-astra` for Astra):

```sh
codex --no-daemon --disable apps --disable plugins exec \
  --ignore-user-config --ignore-rules --ephemeral --skip-git-repo-check \
  -s read-only -m gpt-6.1-sol \
  -c 'service_tier="ultrafast"' -c 'model_reasoning_effort="low"' \
  'Reply only SPEED_OK. Do not use tools.'
```
