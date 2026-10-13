# RELEASING.md — dsh-speed release procedure

Semantics: **Semantic Versioning 2.0.0** with prerelease channels, following
[the new-dsh-plugin release reference](https://github.com/jakehemmerle/nix-config/tree/main/skills/new-dsh-plugin/references/release.md)
and DSH's own scheme (prereleases only so far; npm dist-tags, exact peer pins for build-time imports).

## Version rules

1. `MAJOR.MINOR.PATCH[-PRERELEASE]`. While the plugin only ships under an `x.y` its own SemVer is
   independent of DSH's number; the *channel suffix* matches the DSH build the suites qualified
   against: `-alpha.N` against a DSH alpha (current: `0.2.1-alpha.2`), `-rc.N` against an rc.
   Drop the suffix only after the suites pass against a stable DSH.
2. `PATCH` fixes, `MINOR` new user-visible capability (SemVer's 0.x rule: incompatible behaviour
   changes bump `MINOR` instead of `MAJOR`).
3. No npm `peerDependencies` on DSH packages: the plugin imports DSH host modules at runtime
   (`require.resolve` of `@deepseek-ai/dsh-llm-pi-ai`, bundle seams by path), so there is nothing
   for npm to range-check. The DSH compatibility contract is enforced by the suites instead:
   `DSH_VERSION_EXPECTED`/`DSH_TUI_VERSION_EXPECTED` in `flake.nix`, the byte-exact bundle
   contracts P-31/P-32/`tui-patch`, and the audited pi-ai runtime allowlist (P-22). Moving to a new
   DSH build is therefore a release that re-runs every suite against that exact `flake.nix` pin.
4. The flake's package version is derived from `package.json` — never update them separately.

## Release gate (no bypass; a skipped required suite blocks the release)

1. `git pull --ff-only` on clean `main`; close or defer every open release-blocking bead
   (`bd ready`).
2. `nix flake check` — sandboxed fast suites (`NUM_RUNS=1000`) plus the build-time patch
   contracts on the pinned DSH/dsh-TUI.
3. Real-client release campaign: `nix run .#e2e` (defaults to `test/e2e.test.js` and every
   `test/*.e2e.test.js`, i.e. fixed examples plus the generated web and TUI property suites) with
   **≥100 generated cases per surface across ≥3 logged seeds** (`FC_SEED=... E2E_NUM_RUNS=n`;
   replay with `FC_PATH`). Fast properties stay at `NUM_RUNS=1000`. Live/agent properties
   (`P-07`) remain opt-in (`DSH_LIVE_TESTS=1 DSH_LIVE_AGENTS=1`) and are never run implicitly —
   state them in the changelog as their own note.
4. Record seeds, run counts, versions and the tested commit in `TESTING.md` and `CHANGELOG.md`.
5. Mutants (three realistic bugs) re-verified caught, code restored, `git status` clean.

## Cut the release

1. Bump `package.json` (`npm version X.Y.Z[-alpha.N] --no-git-tag-version`), which also updates
   `package-lock.json`.
2. Add the `CHANGELOG.md` entry (versions, commit, evidence).
3. Commit `5.3 FLASH: release: vX.Y.Z-alpha.N …`; run `bd export` first so the bead state is
   current.
4. `git tag -a vX.Y.Z[-alpha.N] -m …` on that commit; push `main` and the tag.
5. Consumers (nix-config) pin tagged revisions only; profile wiring and fleet rollout follow the
   new-dsh-plugin rollout reference and are out of scope for this repo.
