# RALPH.md — dsh-speed loop state

Ralph loop for the "5.3 FLASH" program (spec-driven real-client tests, Nix env, SemVer releases).
Work graph: beads (prefix `speed`) via `/nix/store/8yhl7n32v992xlidv0jy53gyl4mgq8a3-beads-1.3.0/bin/bd`.
Rules: commit `5.3 FLASH: ` straight to main, stage only own paths, `git pull --ff-only` first,
test before commit (red commits only for real product bugs), never touch ~/.dsh, ~/.dsh-tui,
port 3080 or Jake's tmux. Every round ends with `bd export`, a push and a report to the lead.

## ROUND A (2026-10-12, fresh-start resume; engineer glm-5.3-flash)

Recovered and finished the interrupted round's work, then the round-2 bead set.

Done this round (all pushed unless noted):

- **c8438e8** — real-client web property suite (finished the interrupted untracked file; fixed its
  `{ timeout: 0 }`, which Node 24 treats as an instant cancel). Properties P-01 P-02 P-04 P-08
  P-10 P-12 P-14 P-40 P-42 P-44. **aa280bd** — RALPH.md + closed speed-fid.2 (SPEC) and .5 (web).
- **e46faf8** — real-client TUI property suite + traceability gate:
  - `test/tui.property.e2e.test.js`: fast-check commands (SpeedWord / SpeedToggle / SpeedPicker /
    SpeedPickerCancel / SpeedStatus / Send / BusyRefusal / Restart) drive a real patched
    dsh-TUI 0.14.0 in a private tmux socket; footer + picker + wire invariants after every step.
  - Suite-oracle findings fixed before commit (no product bug): Node-24 `timeout: 0` cancel;
    text-based `until`s matching stale transcript output (draft-clear is the universal execution
    signal — the Launchpad renders NO command output; chat does); chat/Launchpad discriminated per
    current session (`m.chat`), not lifetime sends; P-30 counts distinct keys (same-key saves
    replace the file).
  - Evidence: TUI property **3 seeds × 25/25 green** (20261012 / 20261015 / 20261017, ~170 s each).
    Web property **6 seeds × 25/25** (20261011 + loop seeds 20261012–20261016 = 150 sequences).
    Fast suites 38/38; **nix flake check: all checks passed** (sandboxed NUM_RUNS=1000) at e46faf8.
  - `test/traceability.test.js` fails if a SPEC property ID is unmapped in TESTING.md (or
    vice versa). `TESTING.md` maps P-01…P-61 → tests → surfaces → results; the mapping exposed
    and closed the P-23 gap (ultrafast rejected on openai-completions routes).
  - Watch item (host, dsh-TUI 0.14.0): one campaign observation of a chat composer draft
    surviving a picker selection ('`/speed/speed`' sent as a literal message). The suite now
    fails fast on leftover drafts; did not recur in the green campaigns. Host-level, not plugin code.

## Bead status (speed-fid epic)

- ✓ .1 source reconcile, ✓ .2 SPEC, ✓ .3 flake env, ✓ .4 rig, ✓ .5 web property, ✓ .6 TUI property
  (this round), ✓ .7 TESTING.md traceability (this round).
- .8 bugs + mutants: no product red/fix pair this cycle (all failures were suite-oracle defects);
  mutants are the remaining item.
- .9 release: **round 3 — do not start without the lead's go** (Jake is deciding scope).

## Test commands

- Fast suites: `nix flake check` (sandboxed, `NUM_RUNS=1000`).
- Real-client suites: `nix run .#e2e -- [files]`; per-file replay with `FC_SEED`/`FC_PATH`/`E2E_NUM_RUNS`.
