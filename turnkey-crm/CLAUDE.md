# CustomCRM (turnkey-crm): agent instructions

The primary instructions for every demo in this workspace are in `/var/www/demo_stuff/CLAUDE.md` (its `AGENTS.md` is an identical copy). Read it first; its operator laws and workflow apply here in full.

Demo-specific notes:

- Krayin CRM conventions, module layout and skills are described in `AGENTS.md` in this folder; follow them for anything that touches CRM code.
- The demo setup, accounts, read-only mode and InfinityFree deployment are documented in `DEMO.md`. Custom functionality lives in `packages/Webkul/Turnkey/`.
- The installer and seeder are one-time operator actions on an empty `_demo` database; never run them to restart the demo.
