# RALPH.md — dsh-speed loop state

Ralph loop for the "5.3 FLASH" program (spec-driven real-client tests, Nix env, SemVer releases).
Work graph: beads (prefix `speed`) via `/nix/store/8yhl7n32v992xlidv0jy53gyl4mgq8a3-beads-1.3.0/bin/bd`.
Rules: commit `5.3 FLASH: ` straight to main, stage only own paths, `git pull --ff-only` first,
test before commit (red commits only for real bugs), never touch ~/.dsh, ~/.dsh-tui, port 3080 or
Jake's tmux. Every round ends with `bd export`, a commit, a push and a report to the lead.

## Round 1 (2026-10-11, engineer glm-5.3-flash)

Recovered the interrupted previous round: untracked `test/web.property.e2e.test.js` was inspected,
fixed (`{ timeout: 0 }` makes Node 24 cancel the test instantly — now 1200000 ms) and finished.

Done this round:

- **c8438e8** — real-client web property suite. fast-check model-based Playwright on the pinned,
  patched `dsh web` 0.2.1-alpha.2. Commands: ChooseSpeed / ChooseModel / Send /
  ChangeWhileStreaming / OpenCancel / NewSession (maxCommands 8); invariant checked after every
  step; independent oracle (served catalog + abstract per-(session, provider, model) saved-mode
  map); wire asserted on mock `/v1/responses`. Properties: P-01 P-02 P-04 P-08 P-10 P-12 P-14
  P-40 P-42 P-44. Replay: `FC_SEED=<seed> [FC_PATH=<path>] E2E_NUM_RUNS=<n> nix run .#e2e --
  test/web.property.e2e.test.js`. Failure screenshots under `DSH_SPEED_ARTIFACTS` (per-run dir).
- **speed-fid.2 closed** — SPEC.md (committed 3a68853) has stable P-01..P-61 IDs, oracles,
  surfaces and versions.
- **speed-fid.5 closed** — evidence: `FC_SEED=20261011 E2E_NUM_RUNS=25 nix run .#e2e --
  test/web.property.e2e.test.js` → **25/25 green, 143.7 s**, dsh 0.2.1-alpha.2,
  playwright 1.63.0 (Nix browsers), node 24.21.0.

Already done in the prior (interrupted) round, committed at 74b9157/3a68853 and verified via
beads .1/.3/.4 close reasons: source reconcile, flake env (fleet-identical dsh/dsh-TUI), vendored
rig, FC_SEED in tui.test.js, non-vacuous modal drift test, per-run screenshot dirs.

## Open beads (in dependency order)

1. **speed-fid.6 — dsh-TUI property tests on real dsh-TUI** (now unblocked). Generate
   `/speed` key/command sequences on Launchpad and chat with the `tui.e2e.test.js` fixture
   pattern (private tmux socket, `startTui`); footer label + picker + wire invariants after each
   step; FC_SEED replay. ≥25 sequences/round; ≥100 across ≥3 seeds for release.
2. **speed-fid.7 — TESTING.md traceability** (needs .6): every P-ID → test → surface →
   result/seed/versions; no silent skips.
3. **speed-fid.8 — bugs + mutants** (needs .6, .7): red commit → fix commit per real bug;
   ≥3 deliberate mutants caught N/N recorded in TESTING.md.
4. **speed-fid.9 — release** (needs .7, .8; round 3): RELEASING.md + CHANGELOG.md, tag if green.

## Test commands

- Fast suites: `nix flake check` (runs `npm test` with NUM_RUNS=1000 in the sandbox).
- Real-client suites: `nix run .#e2e -- [test files]` (defaults to all `*.e2e.test.js`).
- TUI patch contract: `test/tui-patch.test.mjs` (in checks).
