# Vendored dsh-speed provenance

Imported from Jake's unversioned `/Users/jake/code/dsh-speed` on the work Mac on 2026-10-09. The original source and the separately installed `~/.local/share/dsh-plugins/dsh-speed-0.1.0` were preserved. MIT license retained. No runtime dependencies or credentials are vendored.

Original source SHA-256 fingerprints before the managed 0.1.1 compatibility update:

```text
7c90e114c6cbf2012495607f372c94ca538cf2debe02e4d81ce0aa8b6b49f9df  index.js
50b3a6f7e7edfbebaddf0667a6f4630a8b8b22c14b4eda8751c80ba924408902  client.js
ea108fead319d74087e634a1bd92fa595e8eed0b6c56ee6e13e779590e1ec1fc  lib/capabilities.js
483082001d2bdf7fb41c2fac6d270fe2277463f7518f3bb9de47c605a5ccb17d  lib/catalog.js
d4f1057749db2884c7f10bf42d560495506c324e0ca618b4d29053043d8f189a  lib/preferences.js
9f5f89c0df6ee6ec79c44d0c444758aeac61b19d71f1a86833419e8ef3f0cc28  lib/transport.js
```

Managed changes: version 0.1.1, explicit audited pi-ai 1.1.0 support alongside 0.87.1, compatibility gate tests, and Nix packaging/host integration. The real-runtime tests must run against the exact host pi-ai during package validation; skipped runtime tests are not upgrade evidence.
