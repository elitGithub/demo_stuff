# Hand-off: Worlds Task 8, Zeta export seeder (2026-11-25)

Temporary. Review on the other PC, then delete this file.

**Status: NOT commit-ready.** The scoped adversarial re-review of fix round 5 finished. On the real export, every
required point holds. It found five problems that do not occur on the real export; they are listed under
"Re-review findings" and need a fix round (round 6), then a scoped re-check, then commit.

## Uncommitted files

`git diff -- universe/worlds`:

- `scripts/seed-from-export.mjs`
- `tests/seed.test.mjs`, `tests/scribe.test.mjs`
- `README.md` (seeding section)
- `src/scribe/ScribeLogCore.mjs`, `src/scribe/ScribeReplay.mjs`, `src/scribe/ScribeKnowledge.mjs`,
  `src/scribe/ScribeAnswer.mjs`

The uncommitted `zeta-dm-memory/` changes (`scribe/core/ScribeFork.js`, the 2026-11-24 fork-verification spec and plan)
are separate work. This round did not touch them.

## Operator rulings

1. The seeder reads only the bundle written by Zeta's `ScribeStore.exportText()` and copies Zeta's book as it is.
   Every other input shape (pre-replayed book or state, bare logs, hand-written character lists, slugs, tiers,
   personas, `sceneState`, `premise`) is removed.
2. A book Zeta has not finished reading is accepted, and the seeder reports how far it was read. The real export
   (`zeta-dm-memory/scribe/private/hero_gone_latest.json`) has `book.adopted: false` and was read through message 680
   of 1384. Finishing that read is deferred.
3. Seeded facts carry Zeta's status as it is. The seeder never re-judges a fact.
4. Implementers: use the lowest model tier that keeps quality (Sonnet with a precise brief over Opus). Opus stays
   the reviewer.
5. The seeded SQLite file is moved between PCs by the operator. It is not a code concern.

## What the seeder does now

- **Refuses** (with a clear error):
  - a payload that is not an object;
  - `book` or `book.log` malformed, or `book.log.read` not an object;
  - `campaign.messages` empty or malformed;
  - `campaign.completeHistory !== true`, or `needsHistory`;
  - `damaged` naming `book` or `campaign`;
  - a Story `messageId` missing from the messages;
  - a replay failure (rethrown with its cause);
  - pinned or Disputed facts;
  - facts with a `form` or `dimension` scope;
  - relations with a null target.

  The last three groups do not occur in the real export. They are refused rather than seeded wrong.
- **Replays** `book.log` with `campaign.messages` through Worlds' own `ScribeReplay`. On the real export this gives the
  same state as Zeta's replay.
- **Cast:** live character subjects except the Narrator.
  - Zeta's `assumed` kind flag is kept (23 subjects), and so are all alias records (18).
  - Names are clamped without splitting a surrogate pair.
- **Player** comes from `--player` (the export names none).
  - `--main` matches the same way, and an unknown ref is an error.
  - Tiers: the player, `--main`, and the top 3 by mentions are `main`; everyone else is `recurring`.
- **Facts:** every live fact plus every Reported fact.
  - Each keeps `{attribution, speaker}` from Zeta's evidence. Message ids and fingerprints are dropped.
  - Reported facts are seeded with `reported: true`.
  - Who knows each fact is copied from Zeta (`ScribeKnowledge.audience`): a named audience goes on `audience`, and a
    hidden fact Zeta widened to Everyone gets a Widen-to-Everyone ruling.
  - `hidden` stays exactly as in Zeta.
- **Threads:** the open threads.
- **Opening scene** comes from the last scene:
  - day and place;
  - private when the reach is Private or the scene is narrowed;
  - present means `until === null`, resolved through merges.
- **Summary:** includes `claims`, `readThrough` and `chatMessages`. The CLI prints
  `Scribe book read through message N of M.` to stderr when N < M.
- **CLI:** a repeated flag is an error, an empty `--main` is an error, and values may start with a dash unless they are
  a known flag. `--title` defaults to `Seeded Campaign`.
- **Kept safeguards:**
  - the realpath guard under `/var/www`, including symlink-escape refusal;
  - dry-run never opens SQLite;
  - duplicate-title refusal, and `--force` inside one transaction;
  - NUL-byte DB path refusal;
  - seeded facts at `position 0`, `cite null`, `Origin: 'Operator'`.
- `replacedExisting` reports only what actually happened.

## Worlds Scribe core changes

- `ScribeLogCore.Rulers.AddFact` accepts three optional fields, each validated (an invalid value present is
  `InvalidOperation`):
  - `evidence` as `{attribution, speaker}`, exactly those keys;
  - `reported: true`;
  - `audience`: a non-empty array of unique ids of known subjects.
- `ScribeReplay.file()`:
  - an AddFact with `reported: true` is filed Reported;
  - an AddFact without it is InForce whatever its evidence says;
  - the Story-origin Reported rule is unchanged;
  - `audience` is copied onto the fact.
- `ScribeKnowledge.listeners`: when a fact has an `audience` array, it returns subject + audience + told + widened.
  This check sits after the Everyone check and before the Notes/Operator check.
- The attribution values are defined once, in `ScribeAnswer.Settings.Attributions`.
- Nothing in live Worlds play sends `evidence`, `reported` or `audience`, so play behaviour is unchanged.

## Verified on this PC (2026-11-25)

Each test file was run alone, under limits:

| Test file | Passed |
|---|---|
| `seed.test.mjs` | 18/18 |
| `scribe.test.mjs` | 26/26 |
| `http.test.mjs` | 13/13 |
| `engine.test.mjs` | 21/21 |

`node scripts/seed-from-export.mjs --dry-run --player frost` gives characters 48, subjects 61, facts 195,
relations 36, claims 3, threads 23, player Frost, readThrough 680, chatMessages 1384.

A real-export check script was run. It lived in this PC's scratchpad and does not travel; recreate it on the other PC:

- **What it does:** builds Zeta's state with `ScribeReplay.run(bundle.book.log, bundle.campaign.messages)`, runs
  `ZetaSeeder.parseExport` then `ZetaSeeder.materializeScribeLog` (both pure, no database), and replays the seeded
  log.
- **What it compared** (Zeta state vs seeded state):

| Check | Result |
|---|---|
| Facts | 234 in both |
| Audience mismatches | 0 |
| Characters with different known-fact counts | 0 of 48 (S1: 214 live facts, 217 including claims) |
| Assumed subjects | 23 in both, 0 id mismatches |
| Alias records | 18 in both |

## Re-review findings (round 5)

The re-review compared against the real export by fact id and content: 0 mismatches in audience, hidden, status or
text across 234 facts, and 0 knows-count mismatches across all 61 subjects. Assumed kinds and aliases match and
survive the first live Scribe re-sync. Live play: nothing in `src` sends `audience`, `ScribeLogCore.append` drops it
from Fact ops, and a hand-built AddFact is validated.

None of the problems below occurs on the real export. The orchestrator confirmed 1, 2 and 5 by running the probes,
and 3 by reading the code.

1. **Important. A seeded Widen-to-Everyone also widens other facts with the same wording.**
   - Where: `scripts/seed-from-export.mjs` near lines 617-619 and 637-644.
   - Zeta can produce this: an EditFact ruling followed by a Widen to Everyone. Zeta sets `editedSource`
     (`zeta-dm-memory/scribe/core/ScribeLog.js:1652`), so its Widen applies by fact id only.
   - The seeded Widen carries no `editedSource`, so Worlds' Widen (`src/scribe/ScribeReplay.mjs` near lines
     1001-1003) applies it by statement mark.
   - Probe: F1 hidden "bold" is edited to "brave". A later hidden F2 "brave" exists. F1 is widened.
   - Result: in Zeta, F2's audience is `["S1"]`; in the seed it is Everyone.
2. **Nit, but a privacy leak. A pinned copy of a seeded private fact becomes known to everyone.**
   - The `Rulers.Pin` stored op (`src/scribe/ScribeLogCore.mjs` near lines 1039-1053) and the made copy in
     `ScribeReplay` Pinning.Pin (near lines 937-958) do not carry `audience`.
   - Live play can reach this: a Pedant Ruled finding files a Pin, then a later one files a RemoveFact on the
     original.
   - Probe: F1 has audience `["S1","S2"]`. Pin, then remove F1.
   - Result: the copy F2 has audience Everyone, so S3 knows it in the seed but not in Zeta.
3. **Nit, hand-made only. `audience` ids are not resolved through merges.**
   - Where: `src/scribe/ScribeReplay.mjs` near line 509, which copies `audience` raw. `told`, `widened` and `subject`
     all go through `resolve`.
   - After merging S2 into S4, S4 does not know the fact.
4. **Nit. Two alias problems.**
   - Where: `scripts/seed-from-export.mjs` near lines 365 and 566-575.
   - A live fact in the `aka` category also becomes an extra alias record (1 in Zeta, 2 in the seed).
   - An Alias op with `other` loses its look-alike pair. This may predate round 5.
5. **Nit.** `src/scribe/ScribeKnowledge.mjs:110` reads `const noted =fact.origin` (missing space).

## Pending, in order

1. Fix round 6 for the findings above. Check each finding against the real export before acting on it.
2. Do a scoped re-check, then commit.
3. The operator runs the real seed (it writes `local/worlds.sqlite`):
   `node scripts/seed-from-export.mjs --player frost --title "<title>"`
   Then playtest turns 1-30 per plan Task 8.
4. Deferred: let Zeta's scribe finish reading messages 681-1384, re-export, and re-seed.

## Re-review brief (scoped to round 5)

Directive: "Assume this code has defects and try to prove it. A finding counts only with an input that reproduces it;
if you cannot break something, say so."

**Scope** (rounds 1-4 were reviewed already):
- per-fact `audience` and the AddFact `audience` field;
- `ScribeKnowledge.listeners`;
- assumed subjects, and the seeder's own Subject/Alias entry;
- alias records;
- the four new refusals (pinned, Disputed, form/dimension, null-target relation);
- the coverage line;
- the single attribution list;
- the `resolveSafeExportPath` error (it used to `continue`);
- the Widen-to-Everyone restoration (`seed-from-export.mjs` near lines 426 and 617).

**Must hold on the real export:**
- every seeded fact's audience equals Zeta's;
- every character knows the same facts;
- the 23 assumed subjects and 18 alias records match;
- live play is unchanged by the core edits.

**Classify each finding:** real export, Zeta can produce (name the Zeta code path), or hand-made only (list
separately).

**Rules:**
- Read-only. Git read-only. Never run the seeder without `--dry-run`. Never open any SQLite file.
- Do not quote story text from the private export; counts and ids only.

## Running Node on these machines

Run one test file at a time, under a memory and time limit. An unbounded test has crashed WSL before.

```
cd /var/www/demo_stuff/universe/worlds
NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 120 node --test tests/seed.test.mjs
NODE_OPTIONS=--max-old-space-size=600 prlimit --as=3000000000 timeout -s KILL 60 node scripts/seed-from-export.mjs --dry-run --player frost
```
