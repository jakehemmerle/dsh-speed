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
  mutants caught 3/3 at 39c1297 (TESTING.md "Mutation results"; independently re-caught 3/3 in
  round C's closure audit) — the earlier "remaining item" note was stale and is corrected here.
- .9 release: **completed in round C** (release `0.2.1-alpha.1`, tag `v0.2.1-alpha.1`).

## ROUND C (2026-10-12 — closure audit + release; engineer 5.3 FLASH fast)

Jake's instruction first: audit every closed bead against its recorded evidence before shipping.

**Closure audit (STEP 0), nothing needed reopening:**
- `bd show speed-fid.1…8`: every close-reason commit exists (7648423, 3a68853, 74b9157, c8438e8,
  e46faf8, 39c1297). Re-verified the claims that are checkable on disk: no `~/.agents` rig import
  (only the VENDORED.md prohibition text), `tui.test.js` honours `FC_SEED`, the modal drift test
  is not vacuous (already-patched bundle → hard fail; missing/duplicated anchor → drift; installed
  bundle must equal patch-of-pinned, forced by `DSH_REQUIRE_ALL=1` in the flake), no fixed `/tmp`
  paths, traceability gate present in `npm test`, and zero product-code diff since the nix-config
  seed. Mutants M1/M2/M3 re-planted one at a time and re-caught 3/3, sources restored (`git status`
  clean after each).
- Honest gaps that stand (documented, not blockers): P-07 teammates is the opt-in-live property
  (never emulated without authorization); the dsh-TUI host draft-survival watch item; one
  unreproduced web-campaign failure at seed 20261020 (deterministic replay green 3/3 — TESTING.md
  "Intermittent web-campaign failure, investigated").

**Release (STEP 1, speed-fid.9) — 0.2.1-alpha.1:**
- Gates green on the released tree: fresh `npm test` 38/38 (0 skipped, `NUM_RUNS=1000`);
  `nix flake check` **all checks passed five times** this round — three of them fresh-drv builds
  (post-bump `6vyi7ks…` and `yxs63di…` with successive TESTING.md edits, final released tree
  `rmy3g1xd9531vywfk7s0m2ppdb437ssg`); web property
  200 green cases across 6 fresh seeds (one intermittent batch failure investigated and
  unreproduced); TUI property 100/100 across 4 fresh seeds (20261023–20261026); e2e+tui-e2e
  16/16 ×5 flake loops.
- Docs: RELEASING.md + CHANGELOG.md added; TESTING.md release-run section written; traceability
  note refreshed. Version `0.2.0 → 0.2.1-alpha.1` (prerelease channel matches dsh 0.2.1-alpha.2).
- Board closed (post-push, so the close reasons state facts): release commit `bce44c6` tagged
  `v0.2.1-alpha.1` and pushed with the tag, then speed-fid.9 + the epic closed with the final
  evidence and `bd export` committed.

## Test commands

- Fast suites: `nix flake check` (sandboxed, `NUM_RUNS=1000`).
- Real-client suites: `nix run .#e2e -- [files]`; per-file replay with `FC_SEED`/`FC_PATH`/`E2E_NUM_RUNS`.
