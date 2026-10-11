# Vendored test rig

Source: `jakehemmerle/nix-config` `skills/new-dsh-plugin/scripts/` at commit
`2d658d4187ce36db8ff01936620950dc44f760d2` (last commit touching the scripts when copied, 2026-10-11).

| File | Upstream sha256 | Local changes |
| --- | --- | --- |
| `rig.mjs` | `4a79aeb02e5c419eb4dbf16396eb0812e1343147ddf1fe084f775c99e0382d93` | `DSH_BIN`/`DSH_TUI_DIR` required (no fallback to the managed launcher, which exports real credentials, or to `~/.dsh`); private tmux servers start with `-f /dev/null`. |
| `mock-llm.mjs` | `a44562f2f5f1754692fcc3f28f5e19d22f83ddf7b98b423ce90ddc607d8695f1` | none |

Tests import these by relative path (`./rig/rig.mjs`). Never import the rig from `~/.agents` or
another checkout: that made nix-config CI depend on a developer's home directory.
To update, copy the files again, re-apply the changes above and record the new commit here.
