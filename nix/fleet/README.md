# Fleet build inputs (vendored)

Copied from `jakehemmerle/nix-config` at `6a7e6130ea0f45cdf0f3ea51b99565c9264df564` (pkgs/dsh-tui.nix,
pkgs/dsh-tui/, pkgs/dsh-omp-keys/{dsh-tui-0.14.0.patch,test/omp-keys.test.mjs}) so this repo's flake
builds dsh-TUI 0.14.0 **exactly as the fleet installs it**, including every other fleet patch.

The only change to `dsh-tui.nix` is that the dsh-speed patch script and its install test are
parameters (`speedPatchScript`, `speedPatchTest`) supplied from this repo's `scripts/patch-tui.mjs`
and `test/tui-patch.test.mjs`. Store paths are content-addressed, so identical files give the identical
derivation. Verified 2026-10-11:

| Output | This flake | Installed on fw13 (`~/.dsh` profiles) |
| --- | --- | --- |
| `.#dsh` (0.2.1-alpha.2 + model-modal patch) | `/nix/store/i24c2k38bz3h86r0v7bjr4amk7d4vxrj-dsh-0.2.1-alpha.2` | same |
| `.#dsh-tui` (0.14.0 + fleet patches + patch-tui) | `/nix/store/inl2nrkcnbp50r1yq7fh5y0zibx96gvl-dsh-tui-0.14.0` | same |

When nix-config changes any of these files, copy them again and re-check the paths
(`nix build .#dsh .#dsh-tui --print-out-paths`).
