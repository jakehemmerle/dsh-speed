# Changelog

## 0.2.1-alpha.2 — 2026-10-13

- Fix: a background poll started during a web speed save no longer invalidates the save (poll no-ops while a save is in flight).
- Red: test/e2e.test.js polling case fails at e2e.test.js:457 with the pre-fix client (jobs bash-1527/1529); green 14/14 with the fix (bash-1524). Fast 38/38 at NUM_RUNS=1000 (FC_SEED=424242).
- Qualified against DSH 0.2.1-alpha.2 and dsh-TUI 0.14.0.
- Recovered from a parallel fix that landed directly in nix-config (8499b5e) without the repo red stage.
## 0.2.1-alpha.1 — 2026-10-12

First tagged release of the rebuilt plugin (seeded from nix-config `pkgs/dsh-speed` at
`2db2ca1`). **No user-visible product change**: `lib/`, `index.js`, `client.js`,
`cordis.patch.yml` and both patch scripts are byte-identical to the deployed store artifact
(`dsh-speed-0.2.0`, `l2n5awyh…`) — the released delta is the spec-driven test system, the pinned
Nix environment and the release procedure itself.

Qualified against: **dsh 0.2.1-alpha.2** patched (nix-dsh `f0ca0d7` +
`scripts/patch-model-modal.mjs`, store `i24c2k38…`) and **dsh-TUI 0.14.0** patched (fleet
patches + `scripts/patch-tui.mjs`, store `inl2nrkc…`), Node 24.21.0, Playwright 1.63.0 on Nix
`playwright-driver` browsers, fast-check 4.10.2.

### Added
- **SPEC.md** — every plugin claim mapped to stable property IDs P-01…P-61 with observable
  oracles and surfaces (web, TUI, host; none not-applicable).
- **Real-client generated property suites** (fast-check model runs; invariants after every
  step; `FC_SEED`/`FC_PATH`/`E2E_NUM_RUNS` replay):
  - `test/web.property.e2e.test.js` — Playwright on the real patched dsh web; Speed stays
    installed, saved state and wire in agreement (P-01 P-02 P-04 P-08 P-10 P-12 P-14 P-40 P-42
    P-44).
  - `test/tui.property.e2e.test.js` — real patched dsh-TUI in a private tmux socket; `/speed`,
    footer and wire agree in Launchpad and chat, including busy refusal and restart (P-01 P-02
    P-04 P-08 P-10 P-14 P-30 P-50 P-51 P-52).
- **Traceability gate** `test/traceability.test.js` — fails when a SPEC property ID is unmapped
  in TESTING.md (or phantom); part of `npm test` and the flake checks.
- **P-23 coverage** — core suite asserts ultrafast is rejected on an `openai-completions` route
  and reaches the wire on Responses (traceability gap closed; the guard itself ships unchanged).
- **Nix environment** (`flake.nix`): `packages.default` rebuilt byte-exact with the fleet's
  pinned dsh/dsh-TUI builds, sandboxed `checks` (`npm test` at `NUM_RUNS=1000`, patch contracts
  on the pinned bundles), devShell with node/tmux/Nix Chromium/beads/dsh/dsh-TUI, and
  `nix run .#e2e` for the real-client suites (private HOME/DSH_HOME/port 0/private tmux socket,
  local mock model only).
- **RELEASING.md** (SemVer prerelease-channel procedure) and **TESTING.md** release-run evidence.

### Evidence for this release (all on the released tree)
- `nix flake check`: **all checks passed** on `dsh-speed-0.2.1-alpha.1`
  (drv `6vyi7ksdxmw8zzyqddij8ckzb5328ysk`); fresh `npm test` **38/38, 0 skipped** at
  `NUM_RUNS=1000`.
- Web property campaign (real patched dsh web): **200 green cases across 6 fresh seeds**
  (20261019/21/22/27/28 ×25 = 125; 20261020 replayed 25/25 ×3 after one intermittent mid-batch
  failure — investigated in TESTING.md). Sequences ≤8 actions, full app fixture per case.
- TUI property campaign (real patched dsh-TUI, private socket): **100 green cases across 4
  seeds** (20261023–20261026).
- Fixed-example suites `test/e2e.test.js` + `test/tui.e2e.test.js`: **16/16 ×5** green
  consecutive loops, 0 skipped.
- Mutants re-verified during the release closure audit: transport ultrafast/completions guard,
  `TIERS.fast` mapping and preferences record naming each caught by the named suite (**3/3**).
- Opt-in live properties (P-07 teammates; agent account checks) were **not** run in this
  campaign — they cost real account allowance and stay behind `DSH_LIVE_TESTS=1` +
  `DSH_LIVE_AGENTS=1` (P-61); this is the one deliberately deferred coverage, by design.
- Automated campaigns drove the local mock model only; no paid endpoints, no real credentials.

### Known behaviours watched (host-level, unchanged in this release)
- dsh-TUI 0.14.0 host behavior: a chat composer draft survived a picker selection once during
  suite development (documented in TESTING.md; the property suite now fails fast on any leftover
  `/speed` draft) — it did not reappear in any campaign here; outside this repository.
- The one intermittent web-campaign failure above, unreproduced over deterministic replays.

### Version identity
- `0.2.1-alpha.1`: prerelease channel `-alpha.N` matches the DSH alpha the suites qualified
  against (`0.2.1-alpha.2`, temporary alpha exception). Bump level: patch-equivalent delta
  (tests + packaging); no capability change.
- **No npm peerDependencies**: the plugin imports DSH host modules at runtime via
  `require.resolve('@deepseek-ai/dsh-llm-pi-ai')` and bundle seams by path — the exact-build
  compatibility contract is enforced by the suites instead (P-31/P-32 patch contracts,
  P-22 audited-runtime allowlist, `DSH_VERSION_EXPECTED`/`DSH_TUI_VERSION_EXPECTED`).
- Consumers (nix-config) pin tagged revisions; profile wiring and fleet rollout are governed by
  the new-dsh-plugin rollout reference, not this repo.
