{ lib, buildNpmPackage, fetchurl, jq, runCommand, speedPatchScript, speedPatchTest }:

# dsh-TUI, the community terminal front end for DeepSeek Harness
# (https://github.com/ccch1mneyyy/dsh-TUI), installed as the dsh-tui profile's
# bundle by home/dsh.nix. The npm tarball ships no lockfile; ours was made with
#   npm install --package-lock-only --omit=dev --legacy-peer-deps --ignore-scripts
# against the manifest edited exactly as below. Peers are DSH's own packages,
# which the dsh Loader supplies at runtime, so they are not installed here.
# To update: bump version and hash, regenerate package-lock.json, then fix
# npmDepsHash from the build error.
let
  version = "0.14.0";
  tarball = fetchurl {
    url = "https://registry.npmjs.org/@deepseek-harness-tui/dsh-tui/-/dsh-tui-${version}.tgz";
    hash = "sha512-syU0CLbAoxA97URyhnPFiLbWm3dXrmCR5NCO6mFovRi7mebX2HeEYdhpugEoT9vZ1vpUfE/+uX7xrs6zOGUJ1g==";
  };
  # npm ci empties node_modules, so the bundled @dsh-std and @dsh-tui-vendor
  # packages are taken out of the manifest and restored after installation.
  # The installed manifest keeps the published peers, since dsh routes a
  # linked package's imports to its own copies only for names listed there,
  # plus the host packages dsh-TUI 0.14.0 imports without listing them (the
  # pnpm install it expects lives inside the profile, where every name routes).
  # Recheck on every bump with the command in README.md (dsh-tui profile).
  unlistedPeers = [
    "@deepseek-ai/cordis-plugin-include"
    "@deepseek-ai/dsh-agent-preset"
    "@deepseek-ai/dsh-attachment-local"
    "@deepseek-ai/dsh-mcp-client"
    "@deepseek-ai/dsh-session-persistence"
    "@deepseek-ai/dsh-session-persistence-jsonl"
  ];
  src = runCommand "dsh-tui-source-${version}" { nativeBuildInputs = [ jq ]; } ''
    mkdir -p $out
    tar -xzf ${tarball} -C $out --strip-components=1
    jq --argjson names '${builtins.toJSON unlistedPeers}' '
      .peerDependencies += ($names | map({ key: ., value: "*" }) | from_entries)
      | .peerDependenciesMeta += ($names | map({ key: ., value: { optional: true } }) | from_entries)' \
      $out/package.json > $out/package.json.runtime
    jq 'del(.devDependencies, .scripts, .bundledDependencies, .peerDependencies, .peerDependenciesMeta)
      | .optionalDependencies |= with_entries(select(.key | startswith("@dsh-") | not))' \
      $out/package.json.runtime > $out/package.json
    mv $out/node_modules $out/bundled
    cp ${./dsh-tui/package-lock.json} $out/package-lock.json
  '';
in
buildNpmPackage {
  pname = "dsh-tui";
  inherit version src;

  # The first screen (Launchpad) is its own single-line editor and ignores
  # Ctrl+W and Ctrl+Left/Right, which the chat prompt binds and dsh-alt maps
  # Option+Backspace/arrows onto. Drop once dsh-TUI handles word edits there.
  #
  # dsh-omp-keys (./dsh-omp-keys): omp's keys. Shift+Tab cycles reasoning
  # effort, Alt+P opens the model picker (chat prompt and first screen alike),
  # permission modes move to /permission(s), and the prompt glyph is tinted by
  # effort tier. dsh-TUI has no plugin seam for these, so it is a patch; its
  # install check fails the build if a dsh-TUI bump breaks it.
  #
  # model-selector-scene: a bare /model (typed, Alt+P, the launch page's or
  # the footer's model segment) opens the dsh-model-selector scene when it is
  # registered, else the built-in picker.
  #
  # preset-schedule-deny: dsh 0.2.1-alpha's Standard/PTC/Cordis presets deny
  # schedule_* to subagents, but those tools exist only beside dsh-web-app's
  # schedule service, which a TUI-only profile lacks; tools.restrict() then
  # rejected every subagent/subagent_fork call. Without that service the
  # TUI's copy of the presets drops exactly those names. Drop once dsh-TUI
  # fixes https://github.com/ccch1mneyyy/dsh-TUI/issues/1450.
  #
  # launchpad-status (dsh-usage-limits): plugin status contributions
  # (ctx.tuiStatus text and rich views) render only in Chat, above the prompt;
  # the Launchpad showed none, so the Claude/Codex usage line appeared only
  # after the first prompt. Chat now passes them to the Launchpad, which draws
  # them above its input card. Source copy: jakehemmerle/dsh-usage-limits
  # patches/. Its install check renders the patched Launchpad.
  patches = [
    ./dsh-tui/launchpad-word-edit.patch
    ./dsh-omp-keys/dsh-tui-0.14.0.patch
    ./dsh-tui/model-selector-scene.patch
    ./dsh-tui/preset-schedule-deny.patch
    ./dsh-tui/launchpad-status.patch
  ];

  # Account-aware speed picker uses the existing managed dialog. The patch
  # only mounts it on the Launchpad and projects dsh-speed into both footers.
  postPatch = ''
    node ${speedPatchScript} lib/types
  '';

  npmDepsFetcherVersion = 2;
  npmDepsHash = "sha256-EMVmgJJ3sc0iqN+vmW/t6vWtrQWANc50biq6h15XfpA=";
  npmFlags = [ "--legacy-peer-deps" "--ignore-scripts" ];
  dontNpmBuild = true;

  postInstall = ''
    pkg=$out/lib/node_modules/@deepseek-harness-tui/dsh-tui
    cp -r bundled/. $pkg/node_modules/
    cp package.json.runtime $pkg/package.json
    # Its launchers bootstrap and self-update a mutable profile; the profile
    # here is managed, so home/dsh.nix supplies `dst` instead.
    rm -r $out/bin
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck
    HOME=$TMPDIR DSH_TUI_TYPES=$out/lib/node_modules/@deepseek-harness-tui/dsh-tui/lib/types \
      node --test ${./dsh-omp-keys/test/omp-keys.test.mjs}
    DSH_TUI_TYPES=$out/lib/node_modules/@deepseek-harness-tui/dsh-tui/lib/types \
      node --test ${speedPatchTest}
    DSH_TUI_TYPES=$out/lib/node_modules/@deepseek-harness-tui/dsh-tui/lib/types \
      node --test ${./dsh-tui/test/schedule-deny-filter.test.mjs}
    HOME=$TMPDIR DSH_TUI_TYPES=$out/lib/node_modules/@deepseek-harness-tui/dsh-tui/lib/types \
      node --test ${./dsh-tui/test/launchpad-status.test.mjs}
    runHook postInstallCheck
  '';

  meta = {
    description = "Terminal user interface for DeepSeek Harness";
    homepage = "https://github.com/ccch1mneyyy/dsh-TUI";
    license = lib.licenses.mit;
  };
}
