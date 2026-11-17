# Scribe engine verification

## Automated checks

Run from the demo directory.

```
node --test tests/scribe-*.test.mjs
```

Result on 2026-11-15: 510 tests, 510 passing, 0 failing, in twelve files (text 58, intake 44, answer 59, facts 69, scenes 43, operator 48, knowledge 27, analyzer 29, gateway 30, adoption 32, serve 22, bench 49).

Also checked by the orchestrating assistant, not by a test:

- The server was started with `node scribe/bench/serve.mjs`. Over real HTTP it redirected `/` to the page, served the page, the stylesheet, the three bench scripts and the core scripts with the right content types, listed an empty private folder, answered 403 to a save from a foreign origin, and sent the Content-Security-Policy with the page.
- The whole engine was run over a real exported campaign of 1,326 messages with a scripted model in place of the real one: every message was read once, in 34 story calls and 4 notes calls; the 31 notes were each filed once; nothing was refused; a run interrupted by a failed save and resumed from the last saved book made one extra call and ended with a book identical, byte for byte, to the uninterrupted one.

## Not verified by any agent

- The bench page has not been opened in a browser. Its tests drive the page scripts in a Node VM against a fake document, clock and server.
- No real model was called. Every model answer in the tests is scripted.

## The owner's acceptance run

- [ ] Adopt the whole export from the first message to the last. Messages read: ____ of ____
- [ ] Total time: ____
- [ ] Total cost: $____ (calls that carried no price: ____)
- [ ] Lines refused: ____
- [ ] Conflicts raised: ____ Look-alikes raised: ____ Questions raised: ____
- [ ] Rule on everything that blocks. Blocking items left: ____
- [ ] Audit 30 facts. Wrong: ____ of 30
- [ ] Anything the Book or Timeline got wrong: ____

## Acceptance bar

The run completes without the owner repairing anything, every in-force fact cites a message that exists, and no more than 2 of the 30 audited facts are wrong.
