# Elsewhere (travel-business): agent instructions

The primary instructions for every demo in this workspace are in `/var/www/demo_stuff/CLAUDE.md` (its `AGENTS.md` is an identical copy). Read it first; its operator laws and workflow apply here in full.

Demo-specific notes:

- PHP 8.4 with PDO SQLite only. There is no Node, Composer or npm package, and no external API or paid service; none may be added.
- The site lives in `site/` and mirrors `htdocs/travel-agency-demo/` on the host. Pages are PHP files rendering through `site/private/views/`; catalog content is `site/private/catalog.json`.
- Package with `php bin/package.php`; run locally with `bin/router.php` (see `README.md`). Neither `bin/` nor `tests/` is ever shipped.
- Run steps, the client walkthrough, configuration and the InfinityFree deployment are in `README.md` and `deploy/infinityfree/DEPLOY.md`.
