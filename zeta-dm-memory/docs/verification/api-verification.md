# Zeta DM notes API verification

Date: 2026-11-10. Working directory: `zeta-dm-memory/`. Runtime: Windows Node.js v24.11.0.

| Command | Result |
| --- | --- |
| `& 'C:/Program Files/nodejs/node.exe' --check worker.mjs` | Key-range correction. Exit 0. |
| `& 'C:/Program Files/nodejs/node.exe' --test tests/http.test.mjs` | Key-range correction. Exit 0. 17 passed, 0 failed, 0 cancelled, 0 skipped. Node test runner duration 518.0355 ms. |
| `& 'C:/Program Files/nodejs/node.exe' --check worker.mjs` | Fix round 1. Exit 0. |
| `& 'C:/Program Files/nodejs/node.exe' --test tests/http.test.mjs` | Fix round 1. Exit 0. 14 passed, 0 failed, 0 cancelled, 0 skipped. Node test runner duration 660.3979 ms. |
| `& 'C:/Program Files/nodejs/node.exe' --test tests/sqlite.test.mjs` | Prior authorized run by the orchestrator. Exit 0. 12 passed, 0 failed, 0 cancelled, 0 skipped. Node test runner duration 658.9581 ms. Fix round 1 changed only comments in this suite and left the schema and SQL statements intact. |

The HTTP suite calls the Worker directly. Its adapter records SQL and bind arguments and returns scripted results. The key regressions exercise length boundaries, literal punctuation, whitespace and control character rejection, 32-byte digest comparisons, and rejection before storage. The revision regressions exercise raw number tokens, exact integer-valued notation, the safe integer boundary, and a simulated runtime without reviver source support. The isolated SQLite suite exercised the production statements in fresh in-memory databases, including conditional writes, captured snapshots, binary pagination, rate capacity, delayed requests, and scheduled rate claims. Node separately emitted its experimental-module warning for `node:sqlite` during that prior run.

Scoped adversarial re-review passed on 2026-11-10. Both original findings were resolved, with zero remaining or new findings. The reviewer also passed five database-free probes of revision tokens in bodies of about 250 KB.

Scoped adversarial review of the key-range correction passed on 2026-11-10 with no findings. Operator redeployment and hosted verification remain pending.

## Hosted verification

Pending operator deployment and hosted checks. The dashboard steps and PowerShell checks cover no key and wrong key, independent rooms, conditional replacement, stale-write rejection, unchanged metadata on an identical save, clearing notes, and metadata-only pagination. Rate capacity and concurrency were checked in isolated SQLite. The distributed Cloudflare runtime and D1 response behavior still require hosted verification. [Dashboard steps and PowerShell checks](../../README.md).

Operator screenshots are pending. Add supplied screenshots here when available.
