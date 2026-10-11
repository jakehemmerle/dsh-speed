# Agent instructions

- Work is tracked in **beads** (`bd`, prefix `speed`): `bd ready`, `bd show <id>`, `bd close <id> --reason "<evidence>"`.
  `bd` comes from the flake dev shell (`nix develop`). Run `bd export` before every commit so
  `.beads/issues.jsonl` is current; the Dolt database itself is not committed.
- Read [RALPH.md](RALPH.md) for the current loop state, [SPEC.md](SPEC.md) for the properties and
  [TESTING.md](TESTING.md) for the traceability table and evidence. Releases follow [RELEASING.md](RELEASING.md).
- Commit straight to `main` as `jakehemmerle <jakehemmerle@protonmail.com>`; stage only your own paths.
- Never touch `~/.dsh`, `~/.dsh-tui`, port 3080 or the user's tmux server. Real-client tests go through
  `test/rig/rig.mjs` (private HOME/DSH_HOME, port 0, private tmux socket, local mock model).
