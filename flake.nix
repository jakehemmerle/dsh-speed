{
  description = "dsh-speed: Fast/Ultrafast for DeepSeek Harness web and dsh-TUI, with its pinned test environment";

  inputs = {
    # Same nixpkgs and nix-dsh revisions as jakehemmerle/nix-config (flake.lock), so the
    # dsh and dsh-TUI built here are the fleet's installed artifacts, byte for byte.
    nixpkgs.url = "github:NixOS/nixpkgs/7fc6f2c20af09cdcaf48b92ec3121860139ec668";
    # nix-config's tool channel: beads 1.3.0 and playwright-driver 1.63.0.
    nixpkgs-tools.url = "github:NixOS/nixpkgs/b6c8664de9b6cc07fe5666a29f91884ba81197c4";
    nix-dsh = {
      url = "github:jakehemmerle/nix-dsh/f0ca0d745df8cbe99bad91d59153dbd690ae6660";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, nixpkgs-tools, nix-dsh }:
    let
      lib = nixpkgs.lib;
      systems = [ "x86_64-linux" "aarch64-darwin" ];
      manifest = lib.importJSON ./package.json;
      perSystem = system:
        let
          pkgs = import nixpkgs { inherit system; config.allowUnfree = true; };
          tools = import nixpkgs-tools { inherit system; };
          isLinux = pkgs.stdenv.hostPlatform.isLinux;

          # dsh 0.2.1-alpha.2 exactly as nix-config's home/dsh.nix installs it: the
          # Model/Effort child-slot patch (scripts/patch-model-modal.mjs) and the
          # tailnet-login substitution. Keep this block identical to home/dsh.nix.
          dshBase = pkgs.callPackage "${nix-dsh}/package.nix" { };
  dsh = dshBase.overrideAttrs (old: {
    postInstall = old.postInstall + ''
      ${pkgs.nodejs}/bin/node ${./scripts/patch-model-modal.mjs} \
        $out/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js
      substituteInPlace \
        $out/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js \
        --replace-fail '	isAuthenticated(request, secure = false) {' '	isAuthenticated(request, secure = false) {
		const tailnetLogin = process.env.DSH_TAILSCALE_TRUSTED_LOGIN;
		if (tailnetLogin && header(request.headers, "tailscale-user-login") === tailnetLogin) return true;'
    '';
  });

          # dsh-TUI 0.14.0 with the fleet's patches and this repo's scripts/patch-tui.mjs
          # (nix/fleet is vendored from nix-config pkgs/; see nix/fleet/README.md).
          dsh-tui = pkgs.callPackage ./nix/fleet/dsh-tui.nix {
            speedPatchScript = ./scripts/patch-tui.mjs;
            speedPatchTest = ./test/tui-patch.test.mjs;
          };
          tuiPackage = "${dsh-tui}/lib/node_modules/@deepseek-harness-tui/dsh-tui";
          dshModules = drv: "${drv}/lib/node_modules/@deepseek-ai/dsh/node_modules";

          src = lib.fileset.toSource {
            root = ./.;
            fileset = lib.fileset.unions [
              ./package.json ./package-lock.json ./index.js ./client.js ./cordis.patch.yml
              ./LICENSE ./README.md ./UPSTREAM.md ./lib ./scripts ./test
            ];
          };

          # Environment shared by the sandboxed checks, the dev shell and the e2e app.
          testEnv = {
            DSH_PI_AI_MODULE = "${dshModules dshBase}/@earendil-works/pi-ai/dist/index.js";
            # The UNPATCHED host bundle: modal.test.js applies the patch itself.
            DSH_MODEL_BUNDLE = "${dshModules dshBase}/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js";
            # The bundle actually installed (patched); modal.test.js checks it equals the patch output.
            DSH_PATCHED_MODEL_BUNDLE = "${dshModules dsh}/@deepseek-ai/dsh-client-ui-model-selection/lib/client.js";
            DSH_TUI_TYPES = "${tuiPackage}/lib/types";
            DSH_BIN = "${dsh}/bin/dsh";
            DSH_TUI_DIR = tuiPackage;
            # No required suite may skip silently for a missing host path.
            DSH_REQUIRE_ALL = "1";
            DSH_VERSION_EXPECTED = "0.2.1-alpha.2";
            DSH_TUI_VERSION_EXPECTED = "0.14.0";
          } // lib.optionalAttrs isLinux {
            # Playwright's downloaded browsers do not run on NixOS; use nixpkgs' build of the
            # browsers for the exact playwright version pinned in package.json (1.63.0).
            PLAYWRIGHT_BROWSERS_PATH = "${tools.playwright-driver.browsers}";
            PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
          };
          exportEnv = lib.concatStringsSep "\n" (lib.mapAttrsToList (k: v: "export ${k}=${lib.escapeShellArg v}") testEnv);

          dsh-speed = pkgs.buildNpmPackage ({
            pname = "dsh-speed";
            inherit (manifest) version;
            inherit src;
            npmDeps = pkgs.importNpmLock { npmRoot = src; };
            npmConfigHook = pkgs.importNpmLock.npmConfigHook;
            npmFlags = [ "--ignore-scripts" ];
            dontNpmBuild = true;
            dontNpmPrune = true;
            doCheck = true;
            nativeCheckInputs = [ pkgs.nodejs ];
            # Fast unit, property and contract suites against the pinned host (no network).
            checkPhase = ''
              runHook preCheck
              export HOME=$TMPDIR NUM_RUNS=${"$"}{NUM_RUNS:-1000}
              npm test
              runHook postCheck
            '';
            installPhase = ''
              runHook preInstall
              mkdir -p $out
              cp package.json index.js client.js cordis.patch.yml LICENSE README.md UPSTREAM.md $out/
              cp -r lib scripts $out/
              runHook postInstall
            '';
            meta = {
              description = manifest.description;
              homepage = "https://github.com/jakehemmerle/dsh-speed";
              license = lib.licenses.mit;
              platforms = lib.platforms.unix;
            };
          } // testEnv);

          e2e = pkgs.writeShellApplication {
            name = "dsh-speed-e2e";
            runtimeInputs = [ pkgs.nodejs_24 pkgs.tmux pkgs.coreutils ];
            text = ''
              ${exportEnv}
              # Real-client suites: real dsh web (Playwright) and real dsh-TUI (private tmux
              # socket), private HOME/DSH_HOME per profile, port 0, local mock model only.
              if [ ! -f package.json ] || [ "$(node -p 'require("./package.json").name')" != dsh-speed ]; then
                echo "run nix run .#e2e from the dsh-speed checkout" >&2; exit 2
              fi
              [ -d node_modules/playwright ] || npm ci --ignore-scripts
              root=$(mktemp -d -t dsh-speed-e2e.XXXXXX)
              trap 'rm -rf "$root"' EXIT
              export TMPDIR=$root DSH_SPEED_ARTIFACTS=${"$"}{DSH_SPEED_ARTIFACTS:-$PWD/test-results}
              unset PROVIDERPROXY_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY
              if [ "$#" -eq 0 ]; then set -- test/e2e.test.js test/*.e2e.test.js; fi
              node --test --test-concurrency=1 "$@"
            '';
          };
        in {
          packages = { default = dsh-speed; inherit dsh dsh-tui; };
          checks = { inherit dsh-speed dsh dsh-tui; };
          apps.e2e = { type = "app"; program = "${e2e}/bin/dsh-speed-e2e"; meta.description = "dsh-speed real-client suites"; };
          devShells.default = pkgs.mkShell ({
            packages = [ pkgs.nodejs_24 pkgs.tmux tools.beads dsh e2e ];
            shellHook = ''
              echo "dsh-speed dev shell: dsh $(${dsh}/bin/dsh --version), dsh-TUI 0.14.0, tmux, node $(node --version), bd"
            '';
          } // testEnv);
        };
      all = lib.genAttrs systems perSystem;
    in {
      packages = lib.mapAttrs (_: s: s.packages) all;
      checks = lib.mapAttrs (_: s: s.checks) all;
      apps = lib.mapAttrs (_: s: s.apps) all;
      devShells = lib.mapAttrs (_: s: s.devShells) all;
    };
}
