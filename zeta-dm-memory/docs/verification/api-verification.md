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

## Scribe routes

Date: 2026-11-18. Working directory: `zeta-dm-memory/`. Runtime: Linux Node.js v24.20.0. `node --check worker.mjs` exited 0. `NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test --test-timeout=20000 tests/http.test.mjs` exited 0 with 31 passed (the 17 notes tests unchanged and 14 scribe tests), 0 failed, 0 cancelled, 0 skipped, in 984.9 ms. The scribe tests cover every route and method, exact queries, the separate 600-a-minute counter, the heads, part bodies at the 400,000-code-unit and 1,200,000-byte limits, refusal precedence, commit, spend, lease and ask shapes, and redacted storage failures. `tests/sqlite.test.mjs` gained 12 scribe tests (24 in all). With the operator's approval, the adversarial reviewer ran it as `NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test --test-timeout=20000 tests/sqlite.test.mjs` on in-memory SQLite: 24 passed, 0 failed. Running the schema, redeploying the Worker and the hosted scribe checks are pending with the operator.

Fix round 1, 2026-11-18, same runtime and commands, the SQLite run with the operator's approval: `node --check worker.mjs` exited 0; `tests/http.test.mjs` 32 passed, 0 failed, 0 cancelled, 0 skipped, in 1,453.7 ms; `tests/sqlite.test.mjs` 27 passed, 0 failed, 0 cancelled, 0 skipped, in 1,900.1 ms. The round makes each staged part carry the SHA-256 digest of its text and each commit name its parts by digest, caps a kind at 10 parts and the scribe's JSON bodies at 16,384 bytes, refuses U+0000 in a part and impossible days, and gives the scribe routes their own 415 and 503 wording. The new tests show that parts left by an earlier lease holder, a late stale `PUT`, and digests named in the wrong order are refused with `409 parts_missing` and that the correct commit then lands.

## Hosted verification

Pending operator deployment and hosted checks. The dashboard steps and PowerShell checks cover no key and wrong key, independent rooms, conditional replacement, stale-write rejection, unchanged metadata on an identical save, clearing notes, and metadata-only pagination. Rate capacity and concurrency were checked in isolated SQLite. The distributed Cloudflare runtime and D1 response behavior still require hosted verification. [Dashboard steps and PowerShell checks](../../README.md).

Operator screenshots are pending. Add supplied screenshots here when available.
