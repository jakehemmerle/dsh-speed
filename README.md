# dsh-speed

Standalone DSH web plugin: a **Speed** selector beside the composer model controls, with **Standard**, **Fast**, and **Ultrafast** when supported.

- OpenAI API: explicit supported-model list from the [Fast pricing table](https://developers.openai.com/api/docs/pricing). Astra and GPT-6.1 Sol expose Ultrafast. GPT-5.6 Sol Ultrafast needs explicit preview-entitlement opt-in.
- ChatGPT/Codex: options come from the signed-in account’s model catalog, not guesses about model names or subscription plans. Unknown models and unavailable catalogs expose Standard only.
- Selections persist separately for each session/provider/model. In-flight requests retain their selected tier.
- Reuses DSH’s built-in adapter and credentials. No separate sign-in, replacement provider or global fetch patch.

## Install

Audited runtime versions: **DSH 0.2.0-rc.2 / pi-ai 0.87.1** and **DSH 0.2.1-alpha.2 / pi-ai 1.1.0**. Other pi-ai versions fail activation until the compatibility seam and real-runtime wire tests are re-audited.

From this package directory:

```sh
npm pack
dsh plugin --profile web add /absolute/path/to/dsh-speed-0.1.1.tgz
```

Or use the source directory for development:

```sh
dsh plugin --profile web add /Users/jake/code/dsh-speed
```

Restart the existing DSH web process and refresh the existing GUI. Installation does not update an already-running host. Jake’s managed DSH web profile declares this package through Nix. Do not also add a local plugin entry there; use the Nix-managed package/profile workflow for upgrades.

The [bundle patch](./cordis.patch.yml) activates the host; the manifest activates the client. Do not add a duplicate host entry or install a separate pi-ai copy. The plugin resolves the host’s builtin llm-pi-ai adapter.

## Use

1. Choose an OpenAI API or Codex model.
2. Pick **Standard**, **Fast**, or **Ultrafast** under **Speed**. Only available options appear.
3. Send the next message normally.

After saving a preference, Standard sends `service_tier: "default"`, Fast sends `"priority"` (the supported Fast alias), and Ultrafast sends `"ultrafast"`. Before a preference is saved, DSH’s existing defaults are untouched. Session-title and compaction requests are unaffected. Subagents do not inherit the parent session’s preference.

The Codex catalog is cached for five minutes and invalidated when the sign-in changes. The picker refreshes every 30 seconds; its refresh button respects that host cache. Failed reads retry after a 15-second backoff. If a saved accelerated mode becomes unavailable, the picker warns and generation fails visibly until you select an available mode. OpenAI can still reject or downgrade tiers based on live entitlement/capacity.

## Optional configuration

Example profile override for the installed host entry:

```yaml
- select: dsh-speed
  config:
    stateFile: /absolute/path/to/private/dsh-speed.json
    # Catalog compatibility version; older versions can return an empty catalog.
    codexClientVersion: 0.160.1
    # Explicitly confirmed additional Fast-capable API model IDs.
    apiFastModels: []
    # Only after confirming your API organization’s preview entitlement.
    apiUltrafastModels:
      - gpt-5.6-sol
```

Default preferences live at `~/.dsh/dsh-speed.json`, mode 0600, atomically replaced, without credentials. Set `stateFile: false` for in-memory preferences. Use separate state files for separate profiles/processes: writes are serialized within one process, not across multiple hosts. Up to 10,000 session/model entries are retained.

Overrides assert API support explicitly; they never bypass Codex account gating.

## Costs and limitations

- Accelerated API tiers cost more and have separate rate limits; Codex may consume more plan allowance and require a specific subscription. This plugin cannot grant access.
- Only builtin `openai` / `openai-codex` route names and official HTTPS endpoints are supported. Renamed routes, proxies, regional endpoints and other adapters are unsupported. A saved selection on an unsupported matching transport fails rather than silently doing nothing.
- API Ultrafast requires Responses and global/US processing; EU and other regional inference endpoints are unsupported. The plugin does not change residency settings or transport preference. OpenAI recommends WebSocket for Ultrafast.
- A scoped [transport shim](./lib/transport.js) compensates for DSH’s adapter dropping arbitrary options, and sets the final payload tier for HTTP and WebSocket payload construction. Do not combine it with another speed-controlling plugin.
- DSH’s estimated costs may not reflect accelerated-tier pricing. OpenAI usage/billing is authoritative.
- Default tests use mocked HTTP and synthetic credentials. The opt-in live test below uses the local Codex login and actual generations; it does not test the GUI.

References: [Fast](https://developers.openai.com/api/docs/guides/fast-mode), [Ultrafast](https://developers.openai.com/api/docs/guides/ultrafast-mode), [Codex account catalog reference](https://github.com/WSL043/dsh-codex-subscription/blob/main/src/model-catalog.js).

## Tests

```sh
npm test
# Include the exact installed host’s protocol stacks:
DSH_PI_AI_MODULE=/absolute/path/to/host/node_modules/@earendil-works/pi-ai/dist/index.js npm test
```

Coverage: model gating, preview opt-in, account changes/expiry/failures, private persistence, concurrent session isolation, immutable options, payload-hook composition, cancellation/disposal, host endpoint validation, picker async guards, and actual OpenAI/Codex HTTP serialization (including zstd-compressed Codex bodies). Runtime tests skip without `DSH_PI_AI_MODULE`. The default suite never calls OpenAI.

### Live Codex OAuth tests

From the **nix-config repository root**, this runner finds the exact managed DSH package, Node binary and pi-ai module. No npm install or separate API key is needed:

```sh
# Two real generations: Ultrafast on GPT-6.1 Sol and GPT-6 Astra over SSE.
python3 -B tests/test_dsh_speed.py "$(command -v dsh)" --live

# Six generations: Standard, Fast and Ultrafast on both models.
python3 -B tests/test_dsh_speed.py "$(command -v dsh)" --live --all-tiers

# Require actual WebSocket transport; an SSE fallback fails this check.
python3 -B tests/test_dsh_speed.py "$(command -v dsh)" --live --transport websocket
```

When `DSH_PI_AI_MODULE` and Node are already configured, the equivalent package command is `npm run test:live -- --all-tiers`. Live tests are separate from `npm test` and CI. They consume Codex plan allowance. They read `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`), require a valid access token, and never refresh or write that file. Sign in or refresh through Codex if it has expired.

The test activates the plugin with in-memory preferences and credentials, saves each mode through its handler, and streams through its middleware and the installed pi-ai provider to the real Codex endpoint. It checks account-catalog gating, the final compressed HTTP payload when using SSE, the terminal response's model and `service_tier`, and the expected `SPEED_OK` reply. JSON lines report requested/served tiers, transport, timing, token counts and pass/fail without credentials or account IDs. Missing tier metadata, a tier mismatch, an error or a strict WebSocket fallback exits nonzero. `--transport auto` reports any fallback without requiring WebSocket. Timings are smoke-test diagnostics, not a speed benchmark.

**Observed 2026-10-10, DSH 0.2.1-alpha.2 / pi-ai 1.1.0:** the local account catalog advertised Fast and Ultrafast for both models. All six SSE requests completed and returned `SPEED_OK`; final payloads contained the requested `default`, `priority` or `ultrafast`. Standard passed. Both accelerated modes returned `service_tier: "default"`, so their strict checks failed. Ultrafast over WebSocket also returned `default` for both models. A separate direct SSE probe using Codex-style client headers returned the same result. This establishes request delivery and working generations, **not confirmed accelerated service**; account/backend behavior or tier reporting needs further investigation.
