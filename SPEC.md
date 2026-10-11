# dsh-speed specification

Product: choose **Standard / Fast / Ultrafast** for OpenAI, local Codex and trusted ProviderProxy
routes in DeepSeek Harness, from the web Model/Effort menu and from dsh-TUI (`/speed`, footer).
Sources consolidated here: README.md, UPSTREAM.md, code comments in `index.js`, `client.js`,
`lib/*`, `scripts/*`, and the assertions of every pre-existing test (imported at nix-config 2db2ca1).
Property IDs are stable; never renumber. [TESTING.md](TESTING.md) maps each ID to tests and results.

## Versions and channel

| Component | Version | Source |
| --- | --- | --- |
| dsh | 0.2.1-alpha.2 (temporary alpha exception, new-dsh-plugin SKILL.md) | nix-dsh `f0ca0d745df8cbe99bad91d59153dbd690ae6660`, plus `scripts/patch-model-modal.mjs` as nix-config `home/dsh.nix` applies it |
| dsh-TUI | 0.14.0 | npm tarball + fleet patches + `scripts/patch-tui.mjs` (`nix/fleet`, from nix-config `pkgs/dsh-tui.nix`) |
| pi-ai (host) | 0.87.1 or 1.1.0 audited; dsh 0.2.1-alpha.2 ships the one the real-runtime tests load | host `@deepseek-ai/dsh-llm-pi-ai` |
| Node | 24.21.0 | nixpkgs `7fc6f2c` |

The flake rebuilds the installed store paths exactly (`nix/fleet/README.md`).

## Surfaces

| Surface | Present | Seam |
| --- | --- | --- |
| **web** (`dsh web`) | yes | `conversation.input.model.controls` child slot inside the Model/Effort menu (build-time patch of the pinned model-selection bundle); `/api/dsh-speed` route on `connection` |
| **TUI** (dsh-TUI Launchpad and chat) | yes | `/speed` command via `commands`, managed `tuiDialogs.select` picker, footer/Launchpad label via the `dshSpeed` service (build-time patch `scripts/patch-tui.mjs`) |
| **host** (any profile, incl. headless and teammates) | yes | `llm/stream` middleware + scoped pi-ai `streamSimple`/`getAuth` transport |

No surface is "not applicable": both clients exist, so every user-facing property has a web and/or TUI
driver. Properties marked *host* are below the UI and are observed through real HTTP requests.

## Properties

Oracle = what an independent tester observes. "Wire" = the JSON body/headers the provider mock receives.

### Speed semantics

- **P-01 Tier mapping.** After a speed is chosen for the current session/provider/model, the next
  conversational request carries `service_tier`: Standard → `default`, Fast → `priority`,
  Ultrafast → `ultrafast`. Oracle: wire `service_tier`. Surfaces: web, TUI, host.
- **P-02 No selection, no change.** Before any explicit selection for a key, requests are unmodified
  (no `service_tier` injected, or the transport default). Oracle: wire. Surfaces: web, TUI, host.
- **P-03 Native routing hint.** For local `openai-codex`, requests also carry
  `x-codex-routing-hint: model=<id>` plus `;tier=<tier>` for non-default tiers, and the same bearer
  and `ChatGPT-Account-Id` from `auth.json`. Oracle: wire headers. Surfaces: web (native e2e), host.
- **P-04 Scope.** A selection belongs to exactly one (session, provider, model). Another session,
  provider or model shows and sends Standard/default until chosen; switching back restores the saved
  choice. Oracle: displayed value + wire. Surfaces: web, TUI, host.
- **P-05 Effort independence.** Changing reasoning effort does not change the speed, and vice versa.
  Oracle: displayed speed + wire `reasoning.effort` and `service_tier`. Surface: web.
- **P-06 Auxiliary requests.** Title and other `purpose` requests never inherit the conversational
  speed. Oracle: wire of title requests. Surfaces: host, web.
- **P-07 Teammates.** A teammate/subagent starts with its own Standard selection while using the same
  provider credential; the parent's Fast/Ultrafast never spills into a child, and the parent's own
  continuation keeps its speed. Oracle: wire of child vs parent requests. Surfaces: web, host.
- **P-08 Applies to subsequent requests only.** Changing speed while a turn streams leaves the active
  request unchanged; the next request uses the new speed. TUI `/speed` refuses while the agent is busy
  ("Wait for the current turn"). Oracle: wire + error text. Surfaces: web, TUI.

### Availability

- **P-10 Catalog-driven options.** Offered speeds: local Codex → that account's native catalog
  (`additional_speed_tiers`/`service_tiers`); ProviderProxy → proxy `/v1/models` `service_tiers`
  (`priority`/`fast` → Fast, `ultrafast` → Ultrafast); official `openai` API → the enumerated model list
  plus configured opt-ins. Standard is always offered. Oracle: options shown / `modes`. Surfaces: web, TUI, host.
- **P-11 Fail closed.** Unknown models, missing/expired credentials, HTTP errors and malformed catalogs
  expose only Standard, and never echo upstream text, tokens, account ids or paths. Oracle: options,
  route JSON, rendered text. Surfaces: web, host.
- **P-12 Unsupported providers.** Providers other than `openai`, `openai-codex` and configured proxies
  get no web control (`available: false`), only Standard from `/speed`, and unmodified requests.
  Oracle: absent combobox, wire. Surfaces: web, TUI, host.
- **P-13 Revoked tier.** If a saved accelerated tier disappears from the catalog, the UI warns
  ("Saved speed unavailable…") and generation fails visibly until a valid speed is chosen; choosing
  Standard recovers. Oracle: alert text, error, wire. Surfaces: web, host.
- **P-14 Rejected selections.** Choosing an unavailable speed (disabled web option, `/speed <mode>`,
  PUT) is rejected and leaves every saved selection unchanged. Oracle: displayed value, route 400,
  `Available speeds: …`. Surfaces: web, TUI, host.
- **P-15 Catalog cache.** Native catalog cached 5 min, proxy 1 min, keyed by credential; refresh forces
  a re-read; failures retry after ≤15 s. Oracle: catalog request count. Surface: host.

### Trust and credentials

- **P-20 Trusted endpoints only.** Speed transport applies only to official HTTPS endpoints
  (api.openai.com; chatgpt.com/backend-api[/codex]) or an explicitly configured proxy with the exact base
  URL; a lookalike, HTTP or unconfigured route fails or is untouched. Proxy config cannot name
  `openai`/`openai-codex`. Surface: host.
- **P-21 Native auth.** `codexAuthFile` is read per request (account switches apply next request);
  account id must match the token claim; within 5 min of expiry one shared `codex app-server
  account/read` refresh runs and the file is re-read; refresh tokens are never copied into DSH; failure
  is visible. Local Codex tokens never go to a proxy. Surface: host.
- **P-22 Audited runtime.** Only pi-ai 0.87.1 and 1.1.0 are accepted, resolved from the host adapter
  (not a second copy). Surface: host.
- **P-23 Ultrafast needs Responses.** Ultrafast on an `openai-completions` route is rejected. Surface: host.

### Persistence

- **P-30 Durable per-key records.** With the default store, each selection is one atomically replaced
  0600 file in a 0700 `<stateFile>.d/` directory; selections survive restart of web and TUI;
  concurrent writers do not lose unrelated records; the legacy array file is a read-only fallback;
  corrupt/missing files read as "no selection"; `stateFile: false` keeps memory only. Oracle: files on
  disk, values after restart. Surfaces: web, TUI, host.

### Web client

- **P-40 Placement.** Speed is a `Speed` combobox inside the existing *Model and reasoning effort* menu,
  next to Model and Effort, with no separate toolbar button; options are labelled Standard, Fast ⚡,
  Ultrafast ⚡⚡ with unavailable saved tiers shown disabled. Oracle: DOM roles. Surface: web.
- **P-41 Route contract.** `/api/dsh-speed` GET/PUT need the host auth cookie (401 without), validate
  input (400 invalid/malformed), reject unavailable speeds (400), hide internal errors (503 generic),
  and never start a generation. Oracle: HTTP status/body, mock turn count. Surface: web.
- **P-42 Picker consistency.** After any sequence of model switches, selections, reloads and new
  sessions, the displayed speed equals the saved speed for the current key; stale responses for an
  earlier model are ignored. Oracle: displayed value vs independent model. Surface: web.
- **P-43 Layout.** At 390×844 the menu stays inside the viewport, Speed is keyboard operable, and the
  page has no horizontal overflow; light and dark themes render the control. Surface: web.
- **P-44 Clean page.** No uncaught page errors during plugin use. Surface: web.

### TUI client

- **P-50 /speed command.** `/speed` with three offered speeds opens a picker titled
  `Select speed — <model>` listing Standard, ⚡ Fast, ⚡⚡ Ultrafast (cursor starts on the first row,
  ↑/↓ wrap, Enter selects, Escape cancels without change); with two offered speeds it toggles; with one
  it reports status. `/speed status|standard|fast|ultrafast` report or set directly; anything else errors
  with the available list. Running `/speed` never sends a model request. Surface: TUI.
- **P-51 Launchpad and chat.** `/speed` works on the Launchpad (before the first prompt, draft cleared,
  Launchpad stays) and in chat. Surface: TUI.
- **P-52 Footer label.** The Launchpad parameter row and chat status line show `Speed: Standard`,
  `Speed: ⚡` or `Speed: ⚡⚡` for the current session/provider/model, updated on change. Surface: TUI.
- **P-53 Stale picker.** If the session, provider or model changes while the picker is open, the choice
  is refused ("The session changed"). Surface: TUI (host-runtime test).

### Lifecycle and build

- **P-60 Disposal.** Unloading restores pi-ai `streamSimple`/`getAuth`, aborts catalogs, unregisters
  route and command, makes `dshSpeed.getMode` return undefined and notifies subscribers once. A second
  install in one process is refused. Surface: host.
- **P-61 Live tests are opt-in.** The live runner refuses before reading credentials without
  `--live`/`DSH_LIVE_TESTS=1`; live agent e2e also needs `DSH_LIVE_AGENTS=1`. Surface: test tooling.
- **P-31 Modal patch contract.** The installed model-selection bundle equals `patchModelModal` applied to
  the pinned upstream bundle; it declares one session-scoped child and mounts it once in the root menu.
- **P-32 Modal patch drift.** Any missing or duplicated anchor fails the patch (and so the build).
- **P-33 TUI patch contract.** The installed dsh-TUI reads `dshSpeed` for the live session and renders
  it on both footers; the speed dialog overlays the Launchpad and clears its draft; drift fails the build.

## Non-goals

Granting entitlement, measuring latency or billing, confirming the tier the upstream reports back
(native Codex itself reports `default`; see README), and any surface other than the existing Model/Effort
menu and `/speed`.
