# Legacy source retirement

Completed 2026-10-16 (Asia/Jerusalem), after standalone workflow verification and independent review.

Removed only real_estate_demo/Real-Estate/. All 171 source files (7,021,418 bytes) matched the original [SHA-256 inventory](legacy-source-inventory.json) before removal. No symlinks, changed files, new files or missing files were found. The new app had no runtime/build references to the old source, and its asset provenance records original illustrations.

## Recovery

Ignored local archive: real_estate_demo/.cache/legacy-reference-2026-10-15.tar.gz.

Archive size: 5,915,005 bytes. SHA-256: 7b11423989a793a388082db39677688e144e23f64625a9d4fc5f32724fc0d154.

Every archived file was re-read and its SHA-256 matched the inventory before the exact legacy directory was removed. The inventory, new Laravel application and all project documentation remain. Keep this archive private: it contains the original source and is excluded from Git and hosting packages.

To recover, inspect the archive and validate its members against the inventory before restoring only Real-Estate/ beneath real_estate_demo. Never extract it into the public hosting directory.

## Verification after removal

- vendor/bin/phpunit --no-progress: 196 tests, 783 assertions; one intentional concurrency opt-in skip. No failures.
- npm run build: passed.
- Browser: homepage, Juniper profile, private kitchen image, customer/provider/admin role switches, completed job history and hired-provider receipt all worked.
- The current runtime source and Vite manifest match the previously extraction-verified InfinityFree package.

No Git mutations, commits or publishing were performed. See [the complete verification record](verification/2026-10-15-haven-verification.md) and [execution ledger](superpowers/plans/2026-10-15-haven-progress.md).
