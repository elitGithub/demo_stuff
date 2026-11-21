# Universe local server scaffold implementation plan

**Goal** — From a clean copy of `universe/`, the operator can run `npm start` and see the launcher status at `http://127.0.0.1:8767/`.

**Architecture** — One Node process serves a fixed text response using `node:http`. The upstream installation and private story data will live outside the served interface.

**Execution** — Use the workspace's implementer and adversarial reviewer loop with the `superpowers:subagent-driven-development` skill after operator approval. The checkboxes below belong to one task.

**Design** — [Approved scaffold design](../specs/2026-11-21-universe-scaffold-design.md)

## Global constraints

Use Node built-ins with zero package dependencies. Keep all changes inside `universe/`. Reserve `local/SillyTavern/` and `local/data/` relative to that directory and leave them absent during scaffolding. Installing SillyTavern, opening the dedicated window and saving to Cloudflare belong to later tasks.

## Review focus

Check a fresh start with both reserved directories absent, the actual listening interface, requests for private paths, a second launch on the occupied port, and an immediate restart after shutdown.

## Task 1 — Build and verify the local status server

All paths below are relative to `universe/`.

- [ ] Create `package.json` with `name` set to `universe`, `private` set to `true`, and `scripts.start` set to `node server.mjs`. Starting the project requires no install step.
- [ ] Create `server.mjs`. Pass a request listener with the signature `(request: IncomingMessage, response: ServerResponse) => void` to `http.createServer`. Match the root pathname, including when a query string is present. For `GET /`, return 200, `Content-Type: text/plain; charset=utf-8`, and the single line `Universe launcher is running.` followed by a newline. Support `HEAD /` with the same status and headers and an empty body. Return 405 with `Allow: GET, HEAD` for other methods at the root. Return 404 for every other path. Use fixed responses throughout.
- [ ] Bind the server to `127.0.0.1`, port `8767`. Print the URL only after listening succeeds. On a bind error, report the address, port and error code on stderr and exit with a nonzero status. Use Node's normal foreground interrupt behavior for this task.
- [ ] Create `.gitignore` containing `/local/`. Create `AGENTS.md` directing agents to read and follow `../AGENTS.md` before working in this folder.
- [ ] Create `README.md` with the Ubuntu run directory `/var/www/demo_stuff/universe`, the start command, URL, expected status line and Ctrl+C stop instruction. Describe both reserved paths and identify window launching and cloud saves as future milestones.

### Local verification

Run these checks after implementation from the Ubuntu project directory. Use a second terminal while the first runs the server.

| Check | Command or action | Expected result |
| --- | --- | --- |
| Clean start | Run `node --check server.mjs`, then `npm start` with the reserved directories absent. | Syntax check exits 0. Startup prints the loopback URL and stays running. |
| Bind address | `ss -ltn 'sport = :8767'` | The listener's local address is exactly `127.0.0.1:8767`. |
| Status | `curl -i http://127.0.0.1:8767/` and `curl -i 'http://127.0.0.1:8767/?check=1'` | Both return 200 and the specified content type and status line. |
| Other methods | `curl -I http://127.0.0.1:8767/` and `curl -i -X POST http://127.0.0.1:8767/` | HEAD returns 200. POST returns 405 and the allowed methods. |
| Missing and private paths | Request `/missing`, `/local/data/default-user/secrets.json` and `/local/SillyTavern/server.js` with `curl -i` against the same origin. Inspect the request listener for filesystem access or static serving. | All three return 404. The listener serves fixed responses regardless of what files exist on disk. |
| Port collision | Run a second `npm start`, inspect its exit status with `echo $?`, then repeat the root GET. | Second launch reports `EADDRINUSE` and exits nonzero. The first server still returns 200. |
| Shutdown and reuse | Press Ctrl+C in the first terminal. Repeat the `ss` check, run `npm start` again, repeat the root GET, then stop it. | The listener disappears on stop. The next launch binds the same port and returns 200. |

- [ ] Have a fresh adversarial reviewer run the workspace review directive. Check each reported finding against its reproducing input and present any fix round for operator approval before handoff.
