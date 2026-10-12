# TESTING.md — dsh-speed test evidence

Traceability: every property in [SPEC.md](SPEC.md) maps to the tests that exercise it, with the
latest recorded result. `test/traceability.test.js` fails if a SPEC property ID is unmapped here
(or if this file names an ID that SPEC does not define). No required suite silently skips: host
paths are mandatory under `DSH_REQUIRE_ALL=1` (set by the flake).

## Versions and environment (this evidence)

| Component | Version / source |
| --- | --- |
| dsh (patched web fleet build) | 0.2.1-alpha.2, nix store `i24c2k38…` (nix-dsh `f0ca0d7` + `scripts/patch-model-modal.mjs`) |
| dsh-TUI (patched fleet build) | 0.14.0, nix store `inl2nrkc…` (`nix/fleet/dsh-tui.nix` + `scripts/patch-tui.mjs`) |
| pi-ai (host) | the one dsh 0.2.1-alpha.2 ships, resolved from the host adapter (P-22) |
| Node | 24.21.0 (nixpkgs `7fc6f2c`) |
| Playwright | 1.63.0 with Nix `playwright-driver` browsers (`PLAYWRIGHT_BROWSERS_PATH`) |
| fast-check | 4.10.2 |

## Commands

| Suite | Command |
| --- | --- |
| Fast unit/property/contract suites (sandboxed) | `nix flake check` (runs `npm test`, `NUM_RUNS=1000`) |
| TUI patch contract | `node --test test/tui-patch.test.mjs` (in flake checks, `DSH_TUI_TYPES` set) |
| Real-client suites (web + TUI) | `nix run .#e2e --` (defaults to `test/e2e.test.js test/*.e2e.test.js`) |
| Web property suite alone | `FC_SEED=<seed> [FC_PATH=<path>] E2E_NUM_RUNS=<n> nix run .#e2e -- test/web.property.e2e.test.js` |
| TUI property suite alone | `FC_SEED=<seed> [FC_PATH=<path>] E2E_NUM_RUNS=<n> nix run .#e2e -- test/tui.property.e2e.test.js` |
| Live (opt-in, costs quota) | `npm run test:live` / `npm run test:live:agents` — refuses without `--live`/`DSH_LIVE_TESTS=1` |

## Traceability

"web property" = `test/web.property.e2e.test.js` (fast-check model-based Playwright on the real
patched dsh web; invariants after every step). "TUI property" = `test/tui.property.e2e.test.js`
(fast-check commands driving a real dsh-TUI in a private tmux socket). "e2e" = `test/e2e.test.js`,
"tui e2e" = `test/tui.e2e.test.js` (fixed example flows on real clients). Host rows run the
plugin in-process against the real transport/catalog/preferences code with a mocked boundary.

| Property | Tests (layer) | Surfaces | Latest result |
| --- | --- | --- | --- |
| P-01 tier mapping | web property (wire), TUI property (wire), e2e 'real DSH blank and chat', 'real dst /speed…', proxy 'forwards the tier at the final payload', core 'transport … forwards frozen requests', real-runtime 'all tiers reach HTTP JSON' | web, TUI, host | web 25/25 (seed 20261011); TUI 25/25 (seed 20261012); e2e 13/13; fast suites green (NUM_RUNS=1000, 74b9157) |
| P-02 no selection, no change | web property, TUI property (unselected key unmodified on wire), proxy 'without touching auxiliary requests', core 'skips auxiliary calls' | web, TUI, host | as P-01 |
| P-03 native routing hint | e2e 'real DSH local Codex auth.json supplies both catalog and all six native model/tier requests', native-auth property | web (native), host | e2e 13/13; fast suites green |
| P-04 scope per (session, provider, model) | web property (ChooseModel/NewSession), TUI property (Restart/model switch: fresh session inherits nothing), e2e 'preferences isolate session/model/provider and survive host restart', 'saved browser selection survives restart and a separate fresh session does not inherit it', core 'isolate sessions/models' | web, TUI, host | as P-01 |
| P-05 effort independence | e2e 'model and effort switching preserve isolated preferences' | web | e2e 13/13 |
| P-06 auxiliary requests | proxy 'without touching auxiliary requests', core 'skips auxiliary calls' | host | fast suites green |
| P-07 teammates | e2e 'live-account Team agents complete via …' (parent speed never spills into child; continuation keeps speed) | web, host | NOT RUN this cycle — opt-in live test (`DSH_LIVE_TESTS=1 DSH_LIVE_AGENTS=1`, costs quota); last run recorded in UPSTREAM-era evidence only |
| P-08 subsequent requests only | web property (ChangeWhileStreaming: active request keeps old tier), TUI property (BusyRefusal: 'Wait for the current turn', turn completes), tui 'busy … never save' (handler), e2e 'speed changes during streaming affect only subsequent Responses requests' | web, TUI | web 25/25; TUI 25/25; e2e 13/13 |
| P-10 catalog-driven options | web property (offered speeds = served catalog), TUI property (offered per model), client 'picker shows model-supported options', core 'Codex catalog explicitly gates each tier', proxy 'public proxy capabilities exactly reflect account-advertised native tiers' | web, TUI, host | as P-01 |
| P-11 fail closed | proxy 'malformed catalog fails closed and does not expose authenticated upstream errors', core 'catalog failures/expired sign-in fail closed and raw errors are redacted', client 'picker ignores stale GET responses', native-auth 'missing, malformed, mismatched and expired local auth fail closed' | web, host | fast suites green; e2e 13/13 |
| P-12 unsupported providers | web property (other route: no Speed control, unmodified wire), client 'hides unavailable providers', e2e 'Claude, unknown and another route stay Standard-only' | web, TUI, host | web 25/25; e2e 13/13 |
| P-13 revoked tier | client 'picker surfaces revoked saved tier and does not silently display Standard', proxy 'revoked or failed proxy catalog rejects saved acceleration…', core 'host fails visibly when saved Codex acceleration is revoked…' | web, host | fast suites green |
| P-14 rejected selections | web property (unavailable option absent/disabled, state unchanged), TUI property (invalid word: footer unchanged, no generation), tui 'unavailable selections never save', e2e (PUT rejects unavailable speeds) | web, TUI, host | web 25/25; TUI 25/25 |
| P-15 catalog cache | core 'catalog deduplicates reads, expires, invalidates on credential changes, and never returns secrets' | host | fast suites green |
| P-20 trusted endpoints | core 'endpoint safety rejects proxies, lookalike domains, HTTP and unrelated protocols', proxy 'explicit proxy trust does not authorize another model endpoint', core 'transport rejects nonofficial matching routes' | host | fast suites green |
| P-21 native auth | native-auth property + 'missing, malformed…' + 'concurrent expiring-token reads delegate one refresh…', e2e native Codex flow | host, web (native) | fast suites green; e2e 13/13 |
| P-22 audited runtime | runtime 'runtime allowlist accepts only explicitly audited pi-ai releases', real-runtime 'default plugin loader patches the host adapter's pi-ai instance, not a second copy' | host | fast suites green (`DSH_REQUIRE_ALL=1`: real-runtime cannot skip) |
| P-23 ultrafast needs Responses | core 'P-23 ultrafast is rejected on an openai-completions route and reaches the wire on Responses' | host | added this cycle (traceability gap found and closed); fast suites green |
| P-30 durable per-key records | core 'preferences persist atomically with private permissions, serialize concurrent writes, isolate sessions/models', TUI property (state dir gains one file per distinct key; fresh session after restart inherits nothing), e2e 'saved browser selection survives restart…' | web, TUI, host | TUI 25/25; e2e 13/13; fast green |
| P-31 modal patch contract | modal 'pinned modal patch declares a session child…' + 'the installed (patched) bundle is exactly the patch applied to the pinned upstream bundle' | web build | flake checks green (74b9157); re-verified every `nix flake check` |
| P-32 modal patch drift | modal 'DSH_MODEL_BUNDLE is the unpatched upstream bundle' + 'rejects upstream drift instead of silently shipping no Speed' | web build | flake checks green |
| P-33 TUI patch contract | tui-patch 'TUI reads the plugin speed for the live session and renders it on both footers' + 'the speed dialog stays over the first screen and clears its command draft' | TUI build | flake checks green |
| P-40 placement | web property (Speed combobox inside the Model/Effort menu, no toolbar button), e2e 'Model/Effort/Speed share a menu', modal P-31 (mounted once in the root menu) | web | web 25/25; e2e 13/13 |
| P-41 route contract | e2e 'authenticated speed route rejects missing cookies; preferences isolate…', web property (speed actions never start a generation — invariant after every step) | web | e2e 13/13; web 25/25 |
| P-42 picker consistency | web property (displayed = saved after model switches/new sessions), client 'picker ignores stale GET responses after model switches' | web | web 25/25; fast green |
| P-43 layout | e2e 'narrow viewport keeps Speed in the native menu and its keyboard choices inside screen bounds' | web | e2e 13/13 |
| P-44 clean page | web property (no uncaught page errors — invariant after every step) | web | web 25/25 |
| P-50 /speed command | TUI property (picker title/rows/navigation/Escape, direct words, toggle, status, invalid), tui 'three speeds open the managed picker…' (handler) | TUI | TUI 25/25; fast green |
| P-51 launchpad and chat | TUI property (generated sequences mix both screens), tui e2e 'TUI two-speed toggle works on the first screen and at narrow width', e2e 'real dst /speed works before the first prompt and in chat with the proxy bearer' | TUI | TUI 25/25; tui e2e 3/3; e2e 13/13 |
| P-52 footer label | TUI property (footer invariant after every step), tui e2e 'TUI arrow picker and lightning footer: <model>' | TUI | TUI 25/25; tui e2e 3/3 |
| P-53 stale picker | tui 'busy, changed-model, and unavailable selections never save an accelerated mode' ('The session changed') | TUI (handler; host-runtime) | fast green |
| P-60 disposal | tui 'unloading removes the speed projection and releases its subscriptions', core 'transport … cleans up on cancellation/disposal' | host | fast green |
| P-61 live opt-in | live-gate 'live entry refuses before credential access unless explicitly opted in' | test tooling | fast green |

## Surface coverage notes (rationale, not gaps)

- **Launchpad renders no command output**: a command run on the first screen gives feedback only
  through the persistent footer (and the cleared draft). Chat renders command results in the
  transcript. The TUI property suite therefore treats "draft cleared" as the universal execution
  signal and asserts result text only in chat (P-50/P-51/P-52 rows above).
- **Busy refusal e2e**: covered on the TUI by the generated BusyRefusal command (held mock stream,
  refusal text, turn completes) and at handler level by `tui.test.js`.
- **P-07 teammates** is the only opt-in live property; it is never run implicitly (P-61 gate).

## Observed host behavior kept under watch

- One occurrence during campaign development (seed 20261012, case 15): a chat composer draft
  `/speed` survived a picker selection in dsh-TUI 0.14.0, so the next submission concatenated
  ('`/speed/speed`' went out as a literal chat message). The property suite now fails fast on any
  leftover `/speed` draft between steps. It did not recur in the green campaign or the 5x repeat
  loops. Host-level (dsh-TUI), not plugin code; watched, not fixed here.

## Red → green evidence

- No product red commits this cycle: the two failing campaign runs were test-oracle defects
  (text-based `until` signals matching stale transcript text; P-30 counting save events instead of
  distinct keys), fixed before the suite's first commit. The pre-existing interrupted work's
  `{ timeout: 0 }` (instant Node 24 cancel) was fixed pre-commit as well.
- `test/traceability.test.js` added this cycle: fails if a SPEC property ID is unmapped above.

## Mutants

Recorded in speed-fid.8 (this cycle): see "Mutation results" below once recorded — three
deliberate mutants must each be caught by a named property.

## Release run (round 3, pending)

Full campaign ≥100 generated cases per surface across ≥3 seeds, plus `nix flake check`, before a
tag. Not yet executed — release procedure is speed-fid.9.
