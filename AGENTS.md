# Agent instructions

- Work is tracked in the workspace Beads instance (`nx`, `~/ws/.beads`), label `project:dsh`.
  In the `~/ws/code/personal/<repo>` clone `bd` resolves there through `.beads/redirect`
  (written by `ws sync`); this repo has no Beads database of its own.
- Read [RALPH.md](RALPH.md) for the current loop state, [SPEC.md](SPEC.md) for the properties and
  [TESTING.md](TESTING.md) for the traceability table and evidence. Releases follow [RELEASING.md](RELEASING.md).
- Commit straight to `main` as `jakehemmerle <jakehemmerle@protonmail.com>`; stage only your own paths.
- Never touch `~/.dsh`, `~/.dsh-tui`, port 3080 or the user's tmux server. Real-client tests go through
  `test/rig/rig.mjs` (private HOME/DSH_HOME, port 0, private tmux socket, local mock model).
