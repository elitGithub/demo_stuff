# Zeta Scribe handoff for the second computer

**Checkpoint, 19 November 2026. Task 1 of 9 is commit-ready.** The rebuilt userscript matches its sources. All 832 tests in the 11 affected suites pass. The final native review reproduced the two last failures on the old behavior and verified their fixes. The working tree still contains the implementation, earlier edits, and untracked design files. At handoff, the operator's Task 1 commit is pending.

## Start here on the second computer

1. Open the `demo_stuff` workspace and read its root [AGENTS.md](../AGENTS.md). The demo is `zeta-dm-memory/`. Paths and verification commands below are relative to that demo. The tested runtime was Node.js **v24.20.0**. The verification commands use Node's built-in test runner and the project's own fixtures.
2. Read the [approved three-helper design](docs/superpowers/specs/2026-11-19-session-helpers-design.md), the [ordered implementation plan](docs/superpowers/plans/2026-11-19-session-helpers.md), and the [proposed fork design](docs/superpowers/specs/2026-11-19-scribe-room-forks-design.md). The later operator decisions on 401s and missing receipts are recorded below.
3. Run the read-only checks in **Verify the transferred copy**. If files or results differ, compare them with the source computer before rebuilding or editing. A more recent operator commit may already contain this work.
4. Check the operator's commit status. If Task 1 is still uncommitted, the next action belongs to the operator. Once committed, **propose Task 2** and wait for approval. Task 1 approval covered reminder delivery and its fix rounds. The fork has its own design approval pending.

Follow the workspace's one-task workflow. A native OpenAI implementer writes code first and then regression tests. A fresh native reviewer tries to break it and supplies a reproducing input for every finding. The orchestrator independently verifies each finding. The operator rules on fix rounds, reviews and commits. Git access by agents is read-only. The root instructions now explicitly map Anthropic model names to native OpenAI models of comparable capability. The final reviews and verification used native reviewers and local fixtures.

## What to transfer

The source checkout was on `master` at `38e977aef6fc95ca2d6903f1548448327ca13169` (`scribe: add cloud sync and contradiction dismissal`). **That commit alone is insufficient.** Preserve the current working files as well as the Git baseline. Use an operator-controlled transfer into a fresh destination so existing work on either machine is preserved.

| Include | Why |
| --- | --- |
| Workspace root `AGENTS.md` and its identical `CLAUDE.md` copy | Carries the operator's workflow and native model selection rule. |
| The demo's tracked working files, including local modifications, `scribe/core/`, `scribe/page/`, `tests/` and `scribe/scribe.user.js` | The bundle can run in Tampermonkey. The editable sources, packer and harnesses are needed to resume development. Keep pre-existing bench, cloud, adoption, README and verification edits with the working copy. The bulk Git diff spans earlier work as well as Task 1. |
| This handoff and **all three** linked design/plan files | At this checkpoint all four files are untracked. A pull or a tracked-files-only patch will omit them. |
| The six JSON files under `scribe/private/`, via the operator's private transfer | This directory is Git-ignored. The four story exports define acceptance evidence. The Covenant pair establishes fork behavior. Keep them on the operator's machines. Local automated tests use synthetic fixtures. |

The six filenames are `last_mage_on_the_list.json`, `finally_unsealed.json`, `the_princess_at_down.json` (the actual spelling), `the_unchained_princess.json`, `covenant_of_black_scales_original_before_split.json`, and `covenant_of_black_scales.json`.

For a transfer onto a checkout of the same baseline, these read-only commands list the overlay. Run them at the **workspace root** on the source computer. Copy the modified and untracked paths with their relative locations intact, then include the six ignored exports separately. On the destination, compare the same listings and run the checks below.

```sh
git diff --name-only HEAD -- AGENTS.md CLAUDE.md zeta-dm-memory/
git status --short --untracked-files=all -- AGENTS.md CLAUDE.md zeta-dm-memory/
```

Development can resume from these files without the old Codex chat, subagent IDs, browser login, OpenRouter key or a running Worker. To use Scribe in the browser on the new computer, follow the project's Tampermonkey instructions for **Zeta Scribe**. The older `zeta-dm-memory.user.js` was the reference for the interval setting. Browser-local Tampermonkey data and credentials are separate from the development copy. The README describes room-book sharing for an operator who already uses cloud sync. [Browser setup](README.md#build-and-install) · [Room-book storage](README.md#the-book-in-your-worker)

## Why Task 1 came first

The operator described three helpers at a D&D table. The Scribe keeps a chronological book and fact ledger. The Checker reads the book against original passages, tracks evidence independently and asks what is right. The Reminder periodically writes a short “story so far” paragraph that tells Zeta what happened and where everyone is.

The visible delivery defect had a concrete example in *The Unchained Princess*. The saved paragraph targeted #896, appeared on player message **#897**, and was still queued with the forced flag set. The operator had to press Clear. The interval also became due one send late. An earlier “last read at #894” status described a different problem. In the supplied 904-message export the saved **book** covered #1–863 and the **live scene** had reached #896. The paragraph that actually went out was a writer refusal. Task 1 handles its delivery record. Tasks 4, 5, 7 and 8 cover reading through the target, checking it, validating the paragraph and finishing overdue work.

## Delivered behavior and implementation

| Operator-visible rule | How it works and why |
| --- | --- |
| A successful send clears the delivered reminder immediately. | Settle the matching room, offer and attempt. Clear its preview, forced flag, matching draft and frame attachment. Invalidate late writer results for that offer. Preserve a newer edit, including one that appends a sentence to the old text. Two offers can have identical paragraphs. |
| Each room chooses **User messages between reminders**. | `refresh` is a positive integer, default 6. When a paragraph is ready, interval 8 attaches it to sends 8 and 16. Delivery resets the count. Manual delivery on send 3 moves the next regular target to send 11. A storyteller reply, Force click or failed send contributes zero. An accepted player message too full for the paragraph counts once and leaves the reminder due. |
| History and acknowledgements agree after reload, edits, and concurrent sends. | Persist the send attempt before confirmation. Reconcile distinct player message IDs and fingerprints, the send boundary, submission text fingerprint and the exact carried block. Allocate matching receipts one-to-one even when two player messages say the same thing. A partial paragraph, a storyteller echo or the other device's identical ordinary text cannot prove delivery. |
| The top page and embedded frame use the same room history. | Frame reports are authenticated and scoped to the current frame/session and attempt. The rate limit and bounded cache stay in place. History accounts for accepted messages after a burst. A late terminal report can recover its original attempt from the room's persisted send journal even after its frame entry has aged out. |
| A POST 401 leaves the paragraph queued for the operator's next manual send. | Observe the exact-room native message POST in the window that sent it. Zeta can reject reads or sends while a reply is generating. A cleared composer alone cannot confirm delivery. A rejection preserves the count, player text and any newer draft. Enter can retry even if the original text remains in the box. Scribe never posts a retry on its own. A failed history GET preserves the saved state and retries on a later poll. |
| A sign-in redirect ending in HTTP 200 leaves delivery uncertain. | Fetch redirect metadata or a different final endpoint on fetch/XHR prevents false confirmation. Matching room history can settle it later. The operator can explicitly queue a manual resend. XHR exposes its final URL. A wrapper supplying only a status code can conceal a redirect. |
| An old saved preview with no receipt stays visible during stale history reads. | Check the player message immediately following its saved target for the exact owned reminder block. A positive match clears it once and reconstructs the interval from later player messages. While the outcome is ambiguous, ordinary sends carry no copy. **Resend this reminder with my next message** explicitly rearms it. Repeated reads ending at the same target never rearm it. |

**Where to debug.** Start with [ScribeLive](scribe/page/ScribeLive.js) for the persisted room record and the functions `starting`, `went`, `delivered`, `reconcile`, `inherited` and `unconfirmed`. [ScribeSender](scribe/page/ScribeSender.js) owns the composer and its per-attempt completion. [ZetaSource](scribe/page/ZetaSource.js) observes native fetch/XHR status. [ScribeFrame](scribe/page/ScribeFrame.js), [ScribeBoot](scribe/page/ScribeBoot.js) and [ScribeStart](scribe/page/ScribeStart.js) connect frame reports, the reader session and the originating window. [ScribeIntake](scribe/core/ScribeIntake.js) and [ScribeText](scribe/core/ScribeText.js) provide source and submission fingerprints. [ScribeKeeper](scribe/page/ScribeKeeper.js) and [ScribePanel](scribe/page/ScribePanel.js) expose the room setting and reminder state. The build entry point is [scribe/pack.mjs](scribe/pack.mjs).

## Reproductions worth keeping

The initial implementation built successfully while four Live assertions still failed. We corrected their fixtures for scene changes, reader takeover during an unresolved send, a cache hit during a held lookup, and a finding already marked reminded. Native adversarial review then found real failures that the green paths missed. They now have regression coverage through the [packed browser harness](tests/scribe-whole.test.mjs) as well as focused unit tests.

| Input or timing | Expected outcome |
| --- | --- |
| Force, send once by Enter or button, then send again. Also trigger Enter and click together. | One accepted attachment. The preview clears and the next send is bare. A repeated report cannot consume a newer offer. |
| Reload 1 ms after Enter, before the host posts anything. Then send one ordinary message. | One accepted message and a count of one. If the host accepted a reminder before reload but its acknowledgement was lost, the matching source row settles that delivery once. |
| Another device sends plain #92. This device sends the reminder on #93. Return the rows together or in separate polls and send again between polls. Both devices may type “I wait.” | The plain #92 counts. The exact attachment at #93 settles. The intermediate send never repeats the uncertain paragraph. |
| Accept two identical ordinary messages and edit the first before the first history poll. Reload. | Two player IDs and a count of two. Neither an edit nor the second identical submission adds a third count. |
| Send 13 frame messages 180 ms apart with the reminder on the first. Also deliver a newly edited reminder on send 11 after ten rapid sends. | Thirteen real messages yield twelve since the first delivery. A reminder delivered after the frame rate limit engages still settles and resets its own interval. |
| Hold a reminder POST, then let nine newer sends return 503, 2,600 ms apart. Release the first POST as 401. | The late rejection reaches the original attempt. The next manual retry carries the reminder once. Reports from a detached frame or a previous visit cannot change the current attempt. |
| A POST returns 401 with the composer emptied or with the submitted text still present. Also delay the rejection while the operator edits a newer draft. | Zero accepted rows, no delivery and no automatic resend. A manual retry works without retyping. The newer draft and selection survive. A redirected HTTP 200 with no accepted row stays unresolved across reload. |
| Load the saved Unchained preview for #896 and then read its owned block at #897. | The old preview clears. The export has three later player messages. Its recovered count is three before and after reload. |

## Verify the transferred copy

Run in `zeta-dm-memory/`. These checks require no live chat, database, API key or package install. The first checks identify the transferred files before any rebuild.

```sh
git log -1 --format='%H %s'
git status --short --branch
node --version
sha256sum scribe/scribe.user.js
node --input-type=module -e "
  import { readFileSync } from 'node:fs'
  import { ScribePack } from './scribe/pack.mjs'
  const read = path => readFileSync(path, 'utf8')
  if (ScribePack.build(read) !== read('scribe/scribe.user.js')) process.exit(1)
  console.log('Bundle matches source')
"
```

The handoff bundle is **1,147,687 bytes**, packed from 27 source files. Its SHA-256 is `5b137a437f106e23888dafff817a06af5a1ea575292bbda92d53d623f5f87cca`. For a later approved source change, the normal rebuild command is `node scribe/pack.mjs`.

```sh
for suite in live sender frame boot keeper panel whole pack intake text zeta
do
  node "tests/scribe-$suite.test.mjs" || exit 1
done
git diff --check
```

Expected individual passes in that order are **144, 28, 20, 90, 109, 134, 130, 19, 51, 58, 49**. Total **832**. The 130 whole-app tests exercise packed code with simulated Zeta, model responses, timers, reloads and both browser layouts. The private export was also checked locally for the #896/#897 migration. Production Zeta, a deployed Worker and live model accuracy were outside this verification.

To repeat the private migration check, use the synthetic legacy-migration test in [the Live suite](tests/scribe-live.test.mjs) as the harness. In memory, pass the export's `campaign.messages` through `ScribeIntake.read`, seed the fixture room's Live store with the export's `live` object, and present the resulting `messages` and owned blocks to the keeper. Inspect the view, close it, then reopen it against the same fake storage. Expected results are 904 source messages, source target #896, matched delivery on #897, forced flag cleared, no queued preview, and count 3 on both opens. This checks the untouched local JSON without sending it to a model.

## What remains and how to judge it

| Work | First acceptance check |
| --- | --- |
| **Task 2, next to propose**. Preserve source identity and remove reminder echoes. | At Unchained #892 keep Kira's genuine exit and discard the echoed attendance. At Last Mage #217 keep Magera's release. Preserve numbering, raw edit fingerprints and genuine user text. Task 1's submission fingerprint solves delivery matching only. |
| **Tasks 3–6**. Store cited claims, keep the Scribe current, give the Checker its own ledger, then apply rulings. | In Last Mage, question the unsupported staff destruction at #166–167 and Mavan's access to Magera's guarded staff at #209. Accept Thessaly's documented transfer at #221–223. Keep the hatchling guess, weapon account and reward attributed to their speakers. Correct the reward citation to #209. Sera's 5 ft 9 in human height (#148) and 20 m full-dragon length (#196) must coexist. |
| **Tasks 7–9**. Write and validate the actual paragraph, drive overdue reads to completion, then replay all four exports. | If the book truly ends at #894, read #895–896. In the real Unchained export, read #864–896 and complete the Checker's outstanding comparisons. A valid #896 paragraph places Frost and Mirra at the Guild Inn, Kira away preparing the decoy ride, and the ride still ahead. The full accepted example and evidence are in the design. |
| **Separate fork proposal**, awaiting approval. | Zeta's “Start over from here” creates new room and message IDs. The Covenant pair has zero shared message IDs but identical senders, timestamps and ordered content through #229. The proposed child inherits verified book entries through #223, remaps their citations, preserves Sera's supported ruling, and reads #224–229. Original-only #230 and pending reminders belong to the parent. The Checker has gaps at #216, #218 and #220. Fork recognition has design evidence only. |

The design also records the expected findings for *Finally Unsealed* (watch order and sound crossing the barrier), *The Princess at Dawn* (wager terms, prior farmhouse visit, knowledge and day count), and *The Unchained Princess* (the king's name, bounty subject, town and hair rulings). Use those per-message tables when implementing the Checker. Task 1's green delivery tests establish how a paragraph travels. Verification of its story content belongs to the remaining tasks.

## First message to Codex on the new computer

> Read the workspace AGENTS.md and zeta-dm-memory/CODEX-HANDOFF.md. Verify the copied sources, bundle hash and Task 1 tests. Tell me whether the operator's Task 1 commit is present and which task is next for approval. Keep the current working tree intact.
