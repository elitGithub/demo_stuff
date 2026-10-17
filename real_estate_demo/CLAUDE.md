# Haven (real_estate_demo): agent instructions

The primary instructions for every demo in this workspace are in `/var/www/demo_stuff/CLAUDE.md` (its `AGENTS.md` is an identical copy). Read it first; its operator laws and workflow apply here in full.

Demo-specific notes:

- The application lives in `marketplace/`; its own `CLAUDE.md` and `AGENTS.md` carry the Laravel notes and refer back to the primary file.
- The design document is in `docs/superpowers/specs/`, the plans in `docs/superpowers/plans/`, and the verification record with screenshots in `docs/verification/`.
- The legacy source was retired after the audit recorded in `docs/legacy-retirement.md`; nothing outside `marketplace/` is runtime code.
