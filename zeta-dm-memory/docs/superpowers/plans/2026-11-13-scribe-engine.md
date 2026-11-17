# Scribe Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. The operator's instructions override stock TDD, Git, installation, and automatic fix-loop instructions. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Approved by the operator on 2026-11-13. Design approved on 2026-11-13.

**Goal:** Build the book engine as tested code that can adopt a whole exported campaign offline, so the operator can judge the book before any of it is wired into the live chat.

**Architecture:** The book is an append-only log of operations; the current state is rebuilt by replaying the log in story order. Pure logic lives in small plain-script files under `scribe/core/`, each declaring one frozen object, loadable by a browser script tag and by a Node VM in tests. A local bench page drives the engine against an exported campaign with the operator's own OpenRouter key and is the acceptance instrument for this plan.

**Tech stack:** Plain JavaScript, no framework, no package, no build step. Node.js v24 built-in test runner and `node:vm`. OpenRouter chat completions over `fetch`.

**Spec:** [Approved scribe design](../specs/2026-11-13-scribe-design.md). Executors read both.

## How Step 1 of the design is divided

The design's Step 1 is too large for one plan and part of it cannot be planned yet, because it depends on answers Step 0 will produce. It is split into three plans, each ending in something that works and can be tested alone:

| Plan | Contents | Depends on |
|---|---|---|
| **This plan** | The book engine (Task 1, the Step 0 observer, was dropped on 2026-11-14): intake, answer parsing, log, replay, knowledge, Analyzer input, model gateway, adoption runner. A local bench to adopt an export and inspect, rule on and audit the book. | Nothing |
| Next | Storing the book in the Worker and D1; meter and caps; the lease for two desktops. | This plan's log format |
| After that | The userscript: capturing replies, catch-up, the side panel, live adoption. Replaces DM Memory. | Step 0's answers, both plans above |

How the core files reach the single userscript without a build step is decided in the third plan. Writing them as separate plain scripts keeps every option open.

## Rulings since approval

These are the operator's, made during execution. Where a task's text below says otherwise, the ruling wins, and the task's text is brought into line before that task is briefed.

**2026-11-14, Task 1.** Dropped. Facts about Zeta's stored chat are read from the exports, never discovered with a new tool or exercise.

**2026-11-14, Task 2 review.**

1. **The code never judges meaning.** Whether a second description of a fixed attribute is the same, a fuller version, or a contradiction is the Analyzer's judgement, and so is reading ages. The code only answers whether two values are literally the same words in the same order, after folding case, punctuation and American and British spellings.
   - Task 2: `ScribeCategory.compare` and `ScribeText.numbersIn` do not exist. `ScribeCategory.same(earlier, later)` replaces them.
   - Task 4: the CHANGES block gains a third form, `F12 | FULLER: the fuller statement | #n`, parsed as type `Refine` with `fact`, `text`, `position`.
   - Task 5: for a Fixed category, a later value that is `same` is dropped; any other later value is `Disputed` and joins a Conflict. A `Refine` replaces the fact it names, which becomes `Replaced`, and is recorded in State under `refinements` as `{ from, to }` fact ids. Refinements are shown to the operator and block nothing.
   - Task 9: the prompt tells the Analyzer that for a fixed attribute someone already has: if the new text means the same (another spelling, a synonym, the same age said another way) write nothing; if it adds detail write a FULLER line; if it contradicts and the story gives no reason, write it as a plain FACT so the code raises it for the player. Ages are written as a plain number whenever the story gives one.
   - Tasks 13 and 14: the bench lists refinements beside the rulings.
2. **Honorific suffixes** (`-san`, `-kun`, `-chan`, `-sama`) are ignored when matching names. Titles are kept.
3. **Category words stay exact**, with `towards` accepted beside `toward`. A relation needs one clean target.
4. **Objects handed between parts are frozen.**
5. **Names in tests** are invented, and are checked against the exports by script before each hand-off.

**2026-11-14, Task 2 second review.**

6. **Look-alike names are the Analyzer's judgement.** Whether a new name is a misspelling of a known one is judged by the Analyzer. `ScribeText.resembles` stays as built in Task 2 and is not tuned further. A LookAlike with reason `Spelling` is a hint shown in the Audit and blocks nothing; `SameName` is unchanged. How the Analyzer reports a misspelling is settled when Task 4 is proposed.
7. **One definition of "the same".** Accents in values are folded like spelling, and a number written against its unit splits from it (`180cm` is `180 cm`). `ScribeText.normaliseValue` does not exist; Task 5's test for a repeated List value is `ScribeCategory.same`.
8. **Names are matched literally.** An ending possessive is not removed (`Orla's` is not `Orla`), and only a leading `the` is dropped, never `a` or `an`. Whether such a pair is one subject is the Analyzer's judgement under ruling 6.
9. **A relation target is never refused for what it says.** This replaces "a relation needs one clean target" in ruling 3. `ScribeCategory.parse` keeps the target as written, joint targets included (`relation to Orla and Maren`); only a missing target is refused. Task 5: a relation links to a subject only when its target is exactly a known subject's name; otherwise the note stays on the character as written, and no subject is created from a relation target. Whether to write one line per person or one joint line is the Analyzer's choice.
11. **A wrong "same" is the worst outcome; a wrong "different" costs one question.** Applied in Task 2 after the third review: in names, apostrophes are kept (every glyph made one), a full stop becomes a space, and a pair of single quotes around the whole name is removed; in values, symbols count as words and accents fold only on Latin letters. The operator accepts that a leading `the`, honorific stripping, and the spelling fold inside names can each merge two names, and that this single-user tool does not chase points that cannot change a result.
12. **Notes are recognised by the old script's own paste formats, not by length and repetition** (Task 3 review, 2026-11-14; read from `zeta-dm-memory.user.js` and the export). Per-line paste: in the last text block of a player message, a closing run of at least three consecutive lines that each start and end with an asterisk and hold a letter or digit. Parenthesised paste: a segment from `*(` to `)*` with no asterisk inside and at least one line break, each of its lines a note. Two notes with the same `ScribeText.words` list are one note, which keeps its first wording and first position. The 40-character and three-message thresholds in Task 3's text do not apply. The message fingerprint covers each block's speaker and position as well as its text. `ScribeIntake.read` throws when any message is later than the one after it. The amended requirements are in `sdd-snapshots/scribe-engine/task-3-fix-1.md` and `task-3-fix-2.md`. Known limits: a notes box of one or two lines, or a paste that is not at the end of the message, reads as story.
10. **Where the story leaves a fact unclear, the Analyzer asks the player.** Neither the code nor the model settles it by guessing ("did you mean she likes him or loves him here"). The design has no such channel yet; its form (how the Analyzer writes a question, where the player answers it, and whether it blocks) is proposed with Task 4.

**2026-11-14, Task 4 proposal.**

13. **One person, two names.** When the Analyzer judges that a name in the story is a known subject under another spelling or name, it writes a NAMES line: `Written name | Known label | #n`, parsed as type `Alias`. The code applies it at once: the written name joins that subject's aka, so later labels using it reach the same subject. Every alias is listed for the operator in State under `aliases`, blocks nothing, and can be undone with the operator operation `Unalias`. Task 5 applies it and refuses one whose known label matches no subject (`Reference`); Task 7 adds `Unalias`; Task 9's prompt explains the line; Tasks 13 and 14 list aliases beside the refinements.
14. **Questions to the player.** Where the story leaves a fact unclear, the Analyzer files nothing for it and writes a QUESTIONS line: `question | #n`, parsed as type `Question`. Questions are kept in State under `questions` and shown in the Rulings tab until the operator answers or dismisses them. **An open question never stops the scribe from speaking**; the unclear fact is simply absent. Task 5 gives each question an id (`Q1`); Task 7 adds the operator operations `Answer` and `Dismiss`; Task 9 sends answered questions, with their answers, to the Analyzer on the next call so the answer is filed as ordinary facts citing the question's message.
15. **A label is never refused for what it says.** Ruling 9 applies to subject labels as well: Task 4 does not refuse a label for holding a comma or ` and `. A label is refused only when it is empty, is the narrator, or is longer than 60 characters. A joint label is handled in Task 5 like any other label, as written.
16. **The answer has nine blocks**, in this order: `SUBJECTS NAMES FACTS CHANGES TOLD SCENES NIGHTS THREADS QUESTIONS`. Task 4's requirements as built are in `sdd-snapshots/scribe-engine/task-4-brief-2.md`; where Task 4's text below differs, that document wins. Where Task 9 says "the seven blocks", read nine.
17. **A line that could mean two things is refused, never guessed** (Task 4 review). A wrong operation is the worst outcome; a refused line is shown to the operator. So: any line without a `|` is a header or starts a quarantine in which every line is refused until the next known header (a header is known by its letters alone, so `### FACTS` and `FACTS:` open the block); `hidden` is read on either side of the citation; `ENDED` and `FULLER` are read as markers in their own field or before `:`, `-`; a statement field after the first that begins with `#` and a digit marks two records glued together and refuses the line; an empty field inside a statement refuses the line; an attendance entry that still holds a `#` number after its bounds are read, or has unbalanced brackets, refuses the line; numbers must be safe integers. Read from the real trial answers: a citation may list several messages (the first is used), and a night may be written `#n: marker`.
    - After the second review (`task-4-fix-2.md`): the markers `hidden`, `ENDED` and `FULLER` are recognised by their letters alone, whatever markdown or brackets surround them, and a marker out of its place refuses the line; a line whose first field begins with a block name in capitals is a header glued to a line and starts a quarantine; in an attendance list an entry holding `and`, `&` or `;` outside brackets is refused (ruling 15 does not reach inside a list: the separator is the comma), and a person's bounds must run forward.
    - Known limits, by decision: a header that is missing altogether leaves the previous block current (CHANGES and TOLD lines have the same shape); two nights glued inside one field; a scene or night wrapped onto a second line keeps its first half; a subheading or remark inside a block refuses the rest of that block; `hidden` written as anything but the one word (`hidden: true`) is kept as text.
    - Task 9's prompt owes: show the `hidden` form as a full example line; one TOLD line per person; "exactly one message number" per line; the both-bounds attendance form `(from #a until #b)`; attendance separated by commas only, a person who left and returned written twice; labels never contain `#`; no subheadings or remarks inside a block.
    - Task 10 owes: when the model's answer was cut off, the last line cannot be trusted (a cut `#12` reads as `#1`).

**2026-11-14, Task 5 proposal.**

18. **Task 5 as briefed.** Its requirements are in `sdd-snapshots/scribe-engine/task-5-brief.md`; where Task 5's text below differs, that document wins. What it settles beyond rulings 1, 7, 9, 13, 14 and 15:
    - **A name that could be two subjects is refused, never guessed.** A written name finds a subject by its label first; otherwise by name or aka, and only when exactly one subject matches. Two matches refuse the operation with `Ambiguous` (a third member of `ScribeLog.Reason`). An ambiguous relation target does not refuse: the relation stays unlinked.
    - **A fact id is only good if the book already holds it.** `Change`, `Refine`, `End` and `Told` must name a fact in the State; one made earlier in the same answer does not count, because the Analyzer cannot know its id.
    - **An alias between two known subjects joins nothing.** It is listed as a LookAlike with reason `Alias` (a suspected merge) for the operator to merge or mark distinct in Task 7.
    - **A Refine or Change carries its own subject and category**, copied when filed, so that if the fact it names is later withdrawn it stands as an ordinary fact instead of vanishing.
    - **A subject, once named, survives the withdrawal of the entry that named it**, so later entries pointing at it still resolve and a re-read finds the same subject.
    - **A relation keeps its target as written** in `targetText`; `target` is a subject id only when linked. Two relations are about the same target when they link to the same subject or their written targets normalise alike.
    - **Stale relations:** restating a side that is marked stale clears the mark and does not mark the other side.
    - **Threads are replayed in Task 5**, not Task 6, because closing a thread is checked against the State. The check that a Scene may reach back before the stretch, and what attendance bounds are stored as, stay with Task 6.
    - A repeat of a hidden fact that is no longer hidden is dropped like any repeat; the reveal is the Analyzer's to write as a TOLD line.
    - After the review (`task-5-fix-1.md`):
      - **An alias always joins the name**, even when the name already reaches another subject; the name then reaches two subjects and its lines are refused until the operator rules. An aka fact naming another subject raises the same `Alias` look-alike.
      - **Names are checked again at the end of an answer**, so a name that became ambiguous later in the same answer refuses the earlier lines too; relation targets are linked at the end of the answer.
      - **A subject's kind is declared or assumed.** A subject made by a mention is `character` and `assumed`; the first SUBJECTS line for it sets the kind. A SUBJECTS line of a different kind for a known name is refused with `Mismatch` (a fourth `ScribeLog.Reason`), and so is every line of that answer filed under that name.
      - A subject's name is its label up to the first bracket. A name once given by an aka fact stays a name after a FULLER line rewrites it.
      - A FULLER line takes a fact's place only while that fact is in force or disputed; otherwise it is filed as an ordinary fact. A linked relation is never replaced by an unlinked one.
      - Stored operations keep the label as written and the message number as written; a Notes fact whose message disappears keeps that number.
      - `append` throws `StaleState` when given a state not made from the log as it stands, and `UnknownOrigin` for an origin other than `Story` or `Notes`.
    - After the second review (`task-5-fix-2.md`):
      - **An answer is resolved as a whole, in passes**, until its end checks refuse nothing: a line refused at the end lends no name and makes no subject, and a `Mismatch` reaches the lines before it as well as after.
      - **A declared kind wins over a `kind` fact**, and counts only from an entry that is not withdrawn. `assumed` means "never declared"; a `Mismatch` arises only between two declarations.
      - A subject's name is its label with every bracketed note removed, not the label up to the first bracket.
      - The State carries `sequence`; `append` throws `StaleState` when it differs from the log's.
      - A FULLER line on an aka fact is an aka line for names.
    - Known limits, by decision: a wrong fact id in a CHANGES line can hit an unrelated fact, because the line carries no label to check against (to be watched in the acceptance run); a FULLER line on a `kind` fact loses the kind word; names under four letters never raise a spelling look-alike; restating a stale side of a relation never marks the other side; a Notes fact whose message disappears keeps its old message number, which is approximate; the look-alike comparison grows with the square of the number of subjects (1,000 distinct names take over 5 seconds a replay in the test harness; the trial campaign has 22 in 400 messages).
    - Owed by Task 6: replay of `Change`, `End`, `Told`, `Scene`, `Night`; a Scene reaching back before the stretch; whether attendance bounds are stored as message ids; a test for the stale mark that outlives its relation. Owed by Task 7: merged subjects in name finding; `StaleState` after a withdrawal; `Unalias`, `Answer`, `Dismiss`; an `Alias` look-alike cleared by Merge or Distinct.

**2026-11-14, Task 6 proposal.**

19. **A line that names a fact by number also says whose fact it is.** CHANGES lines are `F12 | Label | category | statement | #n` (plain, `FULLER:` or `ENDED:`), TOLD lines `F12 | Owner label | Told label | #n`. The code refuses the line with `Mismatch` when the numbered fact is not that subject's, or not of that category (for a relation, not about that target), so a wrong number cannot rewrite an unrelated fact. Where someone has one current value (location, status, role, a relation to a given person) the Analyzer needs no number at all: an ordinary FACTS line replaces the old value. Task 9's prompt owes both forms and that advice.
20. **Task 6 as briefed.** Its requirements are in `sdd-snapshots/scribe-engine/task-6-brief.md`; where Task 6's text below differs, that document wins. Beyond the plan: a value the story changed or ended stops counting as said, so its return is a contradiction and not a repeat; an End or Told naming a fact that a FULLER line replaced lands on the fuller fact; a FULLER line carries over who was told, a Change does not; ending the established value of a conflict promotes the earliest disputed one; a Scene may reach back only to the scene just before its stretch; threads were already replayed in Task 5. Attendance bounds stay message numbers as written: if an earlier message is later deleted they are off by one (known limit).
    - After the review (`task-6-fix-1.md`):
      - **A FULLER line does not pass on who was told**, and a Told lands on the fact it names: crediting a listener with words added later is a leak. Task 8 owes the rule that someone who knows a thinner wording knows that wording, not the fuller one.
      - **The owner name on a numbered line is read as a filing name**: when it is some subject's label, that subject must be the fact's.
      - **A numbered line citing a message before its fact was stated is refused**, instead of being passed over in silence at replay.
      - **Conflicts are derived**: one for every fixed slot that holds a disputed fact; `established` is the in-force fact or null. Ending the established value promotes nothing. Only a FULLER line settles a same-worded dispute; a story change leaves an earlier dispute open.
      - A Change follows a FULLER chain as an End does.
      - **Scenes:** two scenes in one answer cannot start on one message; a Scene may reach back only to the scene still running when its stretch begins (the one that ends latest); a continued scene keeps everyone listed for its earlier part, present to the end of that part.
    - Known limits, by decision: the number still decides among one subject's facts of one category, so a wrong number with the right owner and category passes; a shorter restatement of a scene never replaces a longer one; a Change that gives a disputed value the established wording leaves two alike in dispute.

**2026-11-14, Task 7 proposal.**

21. **Task 7 as briefed.** Its requirements are in `sdd-snapshots/scribe-engine/task-7-brief.md`; where Task 7's text below differs, that document wins. What it settles beyond the plan:
    - `ScribeLog.rule(log, state, operation)` takes the State and checks every id against it; it throws `StaleState`, `UnknownOperation`, `InvalidOperation`, `Reference` or `Ambiguous` and changes nothing. The log carries a `revision`, raised by every change including a withdrawal, and the State carries it in place of `sequence`.
    - **A Pin picks the winner among what was said.** When a fact in the slot already has the pinned words, that fact is in force and pinned, keeping its message, its hidden mark and who was told; a new Operator fact is made only for a value nobody said. (The plan made a new public fact every time, which would have published a hidden value.) Pin is for fixed attributes only; a pinned slot has no Conflict.
    - **AddFact is for everything that is not a fixed attribute**, and is anchored to a message (`cite`, `position`) so that a hand-set location is replaced by a later move in the story.
    - **RemoveFact means the fact was never said**: what it displaced comes back.
    - **Merge** gives the merged subject's names to the survivor, so every name finds the survivor; merges chain and cannot loop. **Split** implies the two are distinct. `Unalias`, `Answer` and `Dismiss` are added. `keepFirst` skips a Conflict with nothing established.
    - Rulings are never withdrawn with a message, and replay passes over a ruling that points at something no longer there.
    - After the review (`task-7-fix-1.md`):
      - **A ruling about a fact remembers what the fact said.** A removal, a widening, an answer or a dismissal applies to the same words when an old message is edited and its stretch is read again, since the re-read gives the statement a new number. A Split stays by number: moving a statement to another person by its words alone risks the wrong person.
      - **A pin never publishes a hidden value.** `Pin` carries `hidden`; it remembers which fact it chose and who was told; it holds a FULLER wording of the pinned value; a fact it had to make keeps the hidden mark. A fact a Pin made cannot be named by a numbered line or another ruling. A story change or ending after a pin does not reopen it: the later value is listed as disputed and the owner pins again to move on.
      - **`ScribeLog.revoke(log, sequence)` takes a ruling back.** A subject already merged away cannot be merged again; the first merge is revoked instead.
      - **Rulings bind later answers.** After an Unalias, or between two subjects declared distinct, the Analyzer's NAMES line joining them is refused with `Ruled` (a fifth `ScribeLog.Reason`). The State lists `unaliased` and `distinct`.
      - On one message the owner's operations come after the story's. A merged subject's label stays a label of the survivor.
    - Known limits, by decision: a Split moves only the listed facts, not what that person was told, their scene attendance or relations aimed at them; when two merged subjects both held a statement in the same words, one copy is dropped with its told list; a pin on a subject stays there when its fact is split away (revoke it).

**2026-11-14, the operator on pace.** "I can't test this halfway, so I need the full engine built first." Tasks 8 to 14 are built one after another without a go between them; each still gets its adversarial review; only a question that needs the operator's ruling interrupts. The operator commits the tasks afterwards from the per-task file lists in the ledger.

22. **Task 8 as briefed** (`sdd-snapshots/scribe-engine/task-8-brief.md`). Beyond the plan: where scenes overlap, the narrowest scene covering a message decides who was there (an aside inside a public scene belongs to the aside); someone who was told, or was present for, a wording that a FULLER line later replaced knows that thinner wording, not the fuller one; a merged-away subject knows as its survivor; `sceneAt` is exposed.

    - After the review (`task-8-fix-1.md`): **a closed scene (private, or public and narrowed) always beats an open one** that covers the same message, whatever their lengths, and with several closed scenes only someone present in all of them knows; a scene's summary goes only to someone who was there throughout.

23. **Leaks found by the knowledge review, fixed in the replay** (`replay-fix-leaks.md`): a Pin remembers where its value was said, so a pinned private value keeps its scene's audience when the story later changes it (facts gain `made`, true only for a fact a Pin had to make); a continued scene cannot rewrite its earlier part (the new line's attendance counts from the first new message on, and a scene once private stays private); a scene whose boundary message is gone is kept at its written numbers; an `Answer` ruling reopens a dismissed question.
24. **Task 9 as briefed** (`task-9-brief.md`, `task-9-fix-1.md`). The three prompts are exact copy in the fix document, with invented examples. What the Analyzer is taught, beyond the plan: which lines end with a message number and which do not; a first name alone is a NAMES line; no comma in a label; CHANGES lines name the subject and category as the LEDGER shows them; **hidden means the subject's own thought or concealment; what a character learns in a scene is not hidden, the scene's list decides; something even its subject does not know is filed under the one who knows it, or the world**; a fact marked pinned is left alone. The notes and the answers each have a prompt of their own and may change or end a fact. The LEDGER marks `pinned`, `(owner)`, `hidden` and stale relations, and shows nothing from after the stretch being read. A subject is selected by its name, an aka, or any one word of its name.
25. **Task 10 as briefed** (`task-10-brief.md`, `task-10-fix-1.md`): arguments checked before sending; a call times out; `fetch` and `sleep` are passed in; a 408 is retried; an error on the choice is refused; the key is masked everywhere in an error; retry cannot loop on a bad `attempts`.
26. **Task 11 as briefed** (`task-11-brief.md`, `task-11-fix-1.md`): three passes (answers, notes, story); the order within a step is append, save, record, progress; an answer nobody could read stops the run but is recorded and reported; a refusal that starts with "None" is unreadable; calls with no reported price are counted as `unpriced`; a pause is honoured before every call; notes are known by their words and none is left behind. Facts from the player's answers have origin `Answers` and are known by the scene around the question's message.
27. **Task 12 as briefed** (`task-12-brief.md`, `task-12-fix-1.md`): the Host header must be the bench's own (against DNS rebinding); a save must carry the page's own Origin; private files are written readable by the owner only; HTML is served with a Content-Security-Policy and cannot be framed.
28. **Tasks 13 and 14 were built as one** (`task-13-brief.md`): Rulings also lists questions, joined names, fuller statements and the rulings made, each revocable; the Book can make a fact public.

## Global constraints

- Plain JavaScript. No framework, dependency, package installation, bundler or build step.
- Every core file is a classic script that declares exactly one `const` named like the file, holding a frozen object. No `import`, `export`, `require` or `module`. A core file refers to other core objects as globals.
- Docblocks on every function, tags only (`@param`, `@return`, `@throws`). No prose comments. Braces always. No single-letter variable names. Enumerated values are frozen objects with TitleCase members.
- Code first, then tests that try to break it. No test-first.
- Agents never touch a database, a network service, credentials, Git state, or deployment. No real model is called by any test or by any agent. Agents delete nothing.
- Every file change goes through the visible Edit or Write tools.
- No real campaign text in any committed file. Tests use made-up text built by `tests/support/CampaignBuilder.mjs`. Exports and results live in `scribe/private/`, which Git ignores.
- The OpenRouter key exists only in the bench page's memory and in the request header. It is never written to a file, a URL, a log, an error message or browser storage.
- Nothing under `spike/` is imported, moved or edited. It is reference only.
- Screen rules for the bench page: no inline `style` attributes, colours as tokens in the stylesheet, visible keyboard focus, every model call or file read shows a loading state at once, every list is paged, the primary action is rightmost and Cancel sits left, confirmation only for destructive actions. Phone-first is waived by the design.
- No emojis anywhere.
- All checks run with `node --test tests/scribe-*.test.mjs` from `zeta-dm-memory/` and need no database.

## Execution and review gates

- One task at a time. Product code is written by an implementer subagent on Sonnet or Opus, never a Fable-class model. The orchestrator writes no product code.
- Each task is then attacked by a fresh Opus reviewer under the directive "THIS CODE IS WRONG! PROVE OTHERWISE!". The orchestrator checks each reviewer claim against the code, one focused check per claim.
- Findings of every severity are fixed before hand-off. Fix rounds are proposed to the operator, who rules on them; fixes get a scoped re-review.
- The hand-off opens with "Commit-ready." or "NOT commit-ready: <what is missing>". The operator reviews and commits, one task per commit. Only then is the next task proposed.
- Every task brief given to an implementer includes this plan's Global constraints and Shared shapes sections along with the task.
- Briefs, reports and review packages live under `~/.claude/projects/-var-www-demo-stuff/sdd-snapshots/scribe-engine/`.

## Review focus

Conditions the design implies and that are most likely to bite the operator. Each has a named test in the task that owns the code.

1. **Two people with one name.** A second "Oswin" must become a second subject when the Analyzer labels him distinctly, and must be listed for the operator, never silently folded into the first. Task 5, `second subject with the same name stays separate`.
2. **A crash between the model answering and the book being saved.** Resuming must read that stretch exactly once more and leave no doubled facts and no skipped messages. Task 11, `resume after a failed save reads the stretch once`.
3. **Text that looks like the answer format.** A statement containing `|`, a line beginning `===`, or a message quoting `#12` must not be mis-split or mistaken for a block header or a citation. Task 4, `pipes and block markers inside a statement`.
4. **Names that are not plain ASCII words.** "Zul'Aman", "Yselle-san", "Fa Xiu", typographic quotes and accented letters must match themselves and not match fragments of other words. Task 2, `names with apostrophes, hyphens and accents`; Task 9, `selection matches whole names only`.
5. **A stretch with nothing in it.** Messages that held only lifted notes, or an answer with no operations at all, are valid: the stretch is marked read and the run continues. Task 11, `an empty stretch and an empty answer are both read`.

## Shared shapes

Every task uses these names exactly.

**Message** (made by `ScribeIntake`): `{ id: string, position: number, fromPlayer: boolean, blocks: Array<{ speaker: string, role: 'Player'|'Narrator'|'Character', text: string }>, text: string, fingerprint: string }`. `position` counts from 1 in story order.

**Note**: `{ text: string, position: number }`, the position of the first message that carried it.

**Parsed operation** (made by `ScribeAnswer`, positions still numbers):

| `type` | Other fields |
|---|---|
| `Subject` | `label`, `kind` |
| `Alias` | `name` (as written in the story), `label` (the known subject), `position` |
| `Question` | `text`, `position` |
| `Fact` | `label`, `category`, `target` (label or null), `text`, `position`, `hidden` |
| `Change` | `fact` (such as `F12`), `label`, `category`, `target`, `text`, `position` |
| `Refine` | `fact`, `label`, `category`, `target`, `text`, `position` (a fuller statement of the same fact, declared by the Analyzer) |
| `End` | `fact`, `label`, `category`, `target`, `reason`, `position` |
| `Told` | `fact`, `owner` (the fact's subject), `label` (the one told), `position` |
| `Scene` | `day`, `first`, `last`, `place`, `reach` (`Public` or `Private`), `present: Array<{ label, from: number|null, until: number|null }>`, `summary` |
| `Night` | `position`, `marker` |
| `ThreadOpen` | `text`, `position` |
| `ThreadClose` | `thread` (such as `T3`), `how`, `position` |

**Log**: `{ version: 1, nextFact: number, nextSubject: number, nextThread: number, nextSequence: number, entries: Entry[], read: Object<string, number>, notes: string[] }`. `read` maps a message id to the sequence of the entry that read it. `notes` holds the text of every note already filed.

**Entry**: `{ sequence: number, kind: 'Update'|'Operator', origin: 'Story'|'Notes'|'Operator', messageIds: string[], operations: object[], withdrawn: boolean }`. Operations inside an entry are resolved: labels have become subject ids (`S1`), positions have become message ids in a `cite` field, and new facts and threads carry their permanent ids (`F1`, `T1`).

**Operator operations** (`type`, filed with `ScribeLog.rule(log, state, operation)`): `Pin { subject, category, target: null, text, hidden }`, `Merge { from, into }`, `Split { subject, label, kind, facts: string[] }`, `Distinct { first, second }`, `Narrow { scene }`, `Widen { fact, to: 'Everyone'|string[] }`, `AddFact { subject, category, target, text, hidden, cite, position }`, `RemoveFact { fact }`, `Unalias { subject, name }`, `Answer { question, text }`, `Dismiss { question }`. `ScribeLog.revoke(log, sequence)` takes one back.

**State** (made by `ScribeReplay.run`; it also carries `unaliased` and `distinct`, and `revision` in place of `sequence` since Task 7): `{ revision, subjects, facts, scenes, nights, threads, conflicts, lookAlikes, stale, refinements, aliases, questions }`. `refinements` is a list of `{ from, to }` fact ids. `aliases` is a list of `{ subject, name, cite }`. `questions` is a list of `{ id, text, cite, position, answer: string|null, dismissed: boolean }`. The Log also carries `nextQuestion`.

- Subject: `{ id, label, name, kind, assumed: boolean, aka: string[], mergedInto: string|null }`. `assumed` is true while the kind was never declared.
- Fact: `{ id, subject, category, target: string|null, targetText: string|null, text, cite, position, origin, hidden, told: string[], widened: 'Everyone'|string[]|null, status: 'InForce'|'Disputed'|'Replaced'|'Ended'|'Expired'|'Removed', replacedBy: string|null, pinned: boolean }`.
- Scene: `{ id, day, first, last, firstPosition, lastPosition, place, reach, narrowed: boolean, present: Array<{ subject, from: number|null, until: number|null }>, summary }`. `id` is the scene's first message id.
- Night: `{ cite, position, marker }`. Thread: `{ id, text, cite, position, closed: { how, cite }|null }`.
- Conflict: `{ subject, category, target, established: string|null, others: string[] }`, fact ids, unresolved only. `established` is null when the value in force was ended and only disputed ones remain. A Fact also carries `ended: { reason, cite }|null`.
- LookAlike: `{ first, second, reason: 'Spelling'|'SameName'|'Alias' }`, subject ids, unresolved only. `Alias` means the Analyzer wrote that two known subjects are one.
- Stale: `{ subject, target }`: the relation from `subject` to `target` is older than the one coming back.

**Categories**: Fixed `kind age eyes hair build skin`; Moving `status location role` and `relation` (which carries a target); List `aka title appearance ability belonging background trait feature rule`; Passing `condition`. Subject kinds: `character group place item world`.

---

### Task 1: Step 0 observer and checklist

**Files:**

| Action | File | Responsibility |
|---|---|---|
| Create | `scribe/observe/zeta-observe.user.js` | Tampermonkey script that records the shape of Zeta's traffic with every private value removed |
| Create | `tests/scribe-observe.test.mjs` | Redaction and recording tests |
| Create | `docs/verification/zeta-observations.md` | The operator's checklist and a table for the answers |
| Modify | `.gitignore` | Add `scribe/private/` |

**Interfaces:** Produces nothing later code consumes. Its output is facts for the design.

#### Dropped by the operator on 2026-11-14

This task is not to be built. After two build-and-review rounds the operator asked why anything was being recorded, and pointed out that the stored chat structure, including how `@:` narrator blocks are kept, is already in the exports. The facts were read from the export and added to the design. The files the two rounds produced (`scribe/observe/`, `tests/scribe-observe.test.mjs`, `tests/support/Observe*.mjs`, `docs/verification/zeta-observations.md`) were never committed and are the operator's to remove. The `scribe/private/` line in `.gitignore` stays; Tasks 12 to 14 use that folder.

Everything below in this task is history.

#### Amended on 2026-11-14 by the operator's rulings

The first build followed the steps below and the review showed that those steps, as written here, would lose the evidence the observer exists to collect. The operator ruled on nine points and the recording rules changed. What now binds this task:

- **Never recorded:** the login token, any `Authorization` value, any cookie value, any storage value. That is the one hard privacy rule.
- **Not private, kept as they are:** message ids, room ids, the list of rooms, message times, field names, addresses.
- **Free text** is saved as a masked shape: letters become `x`, digits `9`, everything else kept, and the test marker `[[s:<digits>]]` kept exactly.
- **Message lists are never cut.** Other lists keep 20 items.
- **Watched:** `zeta-ai.io` and every subdomain. Other hosts are only counted.
- **Streams** keep their event names with counts and their first and last three events with times.
- **The token is traced** to the storage entry or cookie that holds it, by name only.
- **Records are kept in the tab's own storage** across reloads and forks. Every record names its chat, and chats are listed with their page titles.
- **`scribeProbe()`** finds the largest history page by itself; the token it uses stays in memory.
- In this script, helper functions with one caller are allowed. Test stand-ins live in `tests/support/`, one class per file.

The full amended requirements, with the test list, are in the fix brief kept with this plan's records (`sdd-snapshots/scribe-engine/task-1-fix-1.md`). The steps below are the original text, kept for the record; where they differ from the amendment, the amendment wins.

- [ ] **Step 1: Write the userscript.** Header: `@match https://zeta-ai.io/*`, `@run-at document-start`, `@grant none`, version `0.1`, name `Zeta AI - Scribe observer`. Top-level `const ScribeObserve = Object.freeze({ ... })` followed by a start call guarded by `typeof window !== 'undefined'`.
  - `ScribeObserve.redact(value)`: returns a copy in which every string becomes `{ string: <length> }`, except the values of keys `type`, `position`, `edited`, `isIntro`, which are kept, and keys ending in `Id` or equal to `id`, whose values become `{ id: <length>, prefix: <the characters before the first '-'>, mark: <8 hex digits of a 32-bit FNV-1a hash of the value> }`, so two ids can be compared without being shown. A string containing a test marker of the form `[[s:<digits>]]` becomes `{ string: <length>, marker: <the marker exactly as found> }`. Numbers, booleans and null are kept. Arrays keep at most their first 3 items plus `{ more: <count> }`.
  - `ScribeObserve.storageNames()`: the key names in `localStorage` and `sessionStorage` and the cookie names in `document.cookie`, each with the length of its value and never the value.
  - `ScribeObserve.describeUrl(url)`: path kept; each query value replaced by its length, except `limit`, kept.
  - `ScribeObserve.describeHeaders(names)`: header names only; `authorization` reported as `present`.
  - It wraps `window.fetch`, `XMLHttpRequest.prototype.open/setRequestHeader/send`, `window.WebSocket` and `window.EventSource` for `api.zeta-ai.io` and records per request: sequence, method, described URL, header names, redacted request body, status, response content type, redacted response body, milliseconds to first byte and to completion, and for sockets and event streams the described URL and a count of messages with the redacted shape of the first three.
  - A fixed button "Save observations" downloads `zeta-observations.json` holding the records, `storageNames()`, and `document.querySelectorAll('textarea, input[type=text]')` described only by tag, name and placeholder length. No token, message text, name or cursor value may appear in the file.
- [ ] **Step 2: Write the checklist** in `docs/verification/zeta-observations.md`. The operator installs the observer, opens a fork, and performs, in order, saving after each: load the chat; scroll up once; send a short message; send a message of three lines where the second is `@: test [[s:1]]` and the third is plain text; reload the last reply; edit the last reply; delete a message if Zeta allows it; fork the chat and open the fork; request history with `limit=100` and `limit=200` by editing the address of a history request in the console line the checklist gives. The document ends with the table of seven questions from the design's Step 0, each with an empty Answer and Evidence column.
- [ ] **Step 3: Write the tests.** Load the script source in `node:vm` with stub `window`, `document`, `XMLHttpRequest`, `WebSocket`, `EventSource`.

  | Test | Must hold |
  |---|---|
  | `redaction removes every string` | `redact({ text: 'secret', contents: [{ speakerName: 'Orla', type: 'TEXT' }] })` deep-equals `{ text: { string: 6 }, contents: [{ speakerName: { string: 4 }, type: 'TEXT' }] }` |
  | `ids keep only their prefix and a mark` | `redact({ id: 'MESSAGE-123-abc' }).id` has `id` 15, `prefix` `MESSAGE` and an 8-character `mark`; the same id gives the same mark, a different id a different one, and the result does not contain `123-abc` |
  | `a test marker is reported intact` | `redact({ text: 'narration [[s:1]] more' })` deep-equals `{ text: { string: 22, marker: '[[s:1]]' } }` |
  | `storage values are never recorded` | with `localStorage` holding `token=abc123`, `storageNames()` lists `token` with length 6 and its JSON does not contain `abc123` |
  | `authorization is never recorded` | after a wrapped fetch with header `Authorization: Bearer abc123`, `JSON.stringify(records)` contains neither `abc123` nor `Bearer` |
  | `cursor values are hidden` | `describeUrl('https://api.zeta-ai.io/v1/rooms/R/messages?limit=20&cursor=R:M:833')` ends with `?limit=20&cursor=7` |
  | `other hosts are ignored` | a fetch to `https://example.test/` adds no record |
  | `long arrays are cut` | an array of 10 becomes 3 items plus `{ more: 7 }` |

- [ ] **Step 4: Run** `node --test tests/scribe-observe.test.mjs`. Expected: 8 passing.
- [ ] **Step 5: Hand off** "Commit-ready." with the test output. After the commit the operator runs the checklist and returns the file; the orchestrator fills the Answers table and adds the answers to the design's facts about Zeta, as a document change the operator approves.

### Task 2: Words and categories

**Files:**

| Action | File | Responsibility |
|---|---|---|
| Create | `scribe/core/ScribeText.js` | Name and value normalising, numbers in text, edit distance, fingerprint |
| Create | `scribe/core/ScribeCategory.js` | The category table, parsing a category, comparing two values |
| Create | `tests/support/ScribeCore.mjs` | Loads core files into one VM context and returns their objects |
| Create | `tests/scribe-text.test.mjs` | Tests for both |

**Interfaces:**

- Produces `ScribeCore.load(names: string[]): object` (test support): runs `scribe/core/<name>.js` for each name in order in one `node:vm` context and returns `{ [name]: object }`.
- Produces, as amended by the rulings above: `ScribeText.normaliseName(name): string`, `.words(text): string[]`, `.distance(first, second): number`, `.resembles(first, second): boolean`, `.fingerprint(text): string`, `.bytes(text): number`.
- Produces, as amended: `ScribeCategory.Kind` (`Fixed`, `Moving`, `List`, `Passing`), `.SubjectKinds`, `.parse(raw): Readonly<{ category, kind, target }>|null`, `.same(earlier, later): boolean`.
- The amended requirements and test list for this task are in the fix brief kept with this plan's records (`sdd-snapshots/scribe-engine/task-2-fix-1.md`, then `task-2-fix-2.md`, then `task-2-fix-3.md`; the latest wins where they differ). Steps 1 to 3 below are the original text; where they describe reading numbers, `compare`, word-set verdicts or the look-alike thresholds, the amendment replaces them.

- [ ] **Step 1: Write `ScribeText`.**
  - `normaliseName`: remove `“ ” " * \` #`, remove `'` and `’`, collapse whitespace, trim, lower-case, drop one leading `the `, `a ` or `an `.
  - `normaliseValue`: lower-case, keep only Unicode letters and digits.
  - `numbersIn`: digit runs; number words zero to ninety-nine, tens and units joined by a hyphen or a space; decade words (`twenties` to `nineties`) as 20 to 90. In order of appearance.
  - `distance`: Levenshtein. `resembles`: both normalised names at least 5 characters, not equal, distance at most 2.
  - `fingerprint`: 32-bit FNV-1a over the UTF-16 code units, as 8 lower-case hex digits. `bytes`: UTF-8 length.
- [ ] **Step 2: Write `ScribeCategory`.** `parse` lower-cases and trims; accepts exactly the category words in Shared shapes; accepts `relation to <label>`, `relation with <label>` and `toward <label>` as `{ category: 'relation', kind: Moving, target: <label as written, trimmed> }`; anything else returns null. `compare`: equal after `normaliseValue` is `Same`; for `age`, when both have a number, equal first numbers are `Same` and unequal are `Differs`; otherwise take each side's set of words excluding `eyes eye hair skin build the a an with and of very`: later within earlier is `Same`, earlier within later is `Refines`, else `Differs`.
- [ ] **Step 3: Write the tests.**

  | Test | Must hold |
  |---|---|
  | `names with apostrophes, hyphens and accents` | `normaliseName("The Kar’Athun")` is `karathun`; `normaliseName('Maren-san')` is `maren-san`; `normaliseName('  Élodie  Moreau ')` is `élodie moreau`; `normaliseValue('Li Wen!')` is `liwen` |
  | `number words` | `numbersIn('twenty-five, late forties, forty three and 30; seventeen')` deep-equals `[25, 40, 43, 30, 17]` |
  | `resembles near spellings only` | `resembles('Aldrich', 'Aldric')` true; `resembles('Annette', 'Anette')` true; `resembles('Tov', 'Tiv')` false; `resembles('Maren', 'Maren')` false; `resembles('Mrs. Halloran', 'Mrs. Pennington')` false |
  | `fingerprint changes with one character` | `fingerprint('a') !== fingerprint('b')`; equal inputs give equal 8-character results |
  | `unknown category is refused` | `parse('knows')` and `parse('secret')` and `parse('')` are null |
  | `relation carries its target` | `parse('Relation to Orla')` deep-equals `{ category: 'relation', kind: 'Moving', target: 'Orla' }` |
  | `ages compare by number` | `compare('age', 'twenty', '20')` is `Same`; `compare('age', 'twenty', 'almost thirty')` is `Differs`; `compare('age', 'late forties', 'forty-three')` is `Differs` |
  | `a fuller description refines` | `compare('eyes', 'pale grey', 'pale grey ringed with amber')` is `Refines`; reversed is `Same`; `compare('hair', 'red', 'blonde')` is `Differs` |

- [ ] **Step 4: Run** `node --test tests/scribe-text.test.mjs`. Expected: 8 passing.
- [ ] **Step 5: Hand off.**

### Task 3: Intake

**Files:** Create `scribe/core/ScribeIntake.js`, `tests/support/CampaignBuilder.mjs`, `tests/scribe-intake.test.mjs`.

**Interfaces:**

- Consumes `ScribeText.fingerprint`.
- Produces `ScribeIntake.read(rawMessages: object[]): { messages: Message[], notes: Note[], player: string }`, `.transcript(messages: Message[]): string`, `.changed(known: Array<{ id, fingerprint }>, current: Message[]): { withdrawn: string[], unread: string[] }`.
- Produces `CampaignBuilder` (test support): `new CampaignBuilder(player)` with `.player(text)`, `.narrator(text)`, `.says(speaker, text)`, `.reply(blocks: Array<[speaker, text]>)`, each appending one Zeta-shaped message with ids `MESSAGE-1`, `MESSAGE-2`, and `.messages` returning the array. A `.player` text may contain `@:`-style content by passing blocks: `.playerBlocks(blocks: Array<[speaker, position, text]>)`.

- [ ] **Step 1: Write `ScribeIntake`.** `rawMessages` are Zeta messages oldest first, shaped as in the design.
  - Only blocks with `type` `TEXT` are read.
  - The player is the most frequent `speakerName` among `USER` blocks whose `position` is `RIGHT`; `'unknown'` if there are none.
  - Role: `Player` for a `USER` block at `RIGHT` whose speaker is the player; `Narrator` when `position` is `NARRATOR` or the speaker is `Narrator`; otherwise `Character`.
  - Notes: in `USER` messages, a segment `*...*` with no inner asterisk and at least 40 characters, whose whitespace-collapsed form appears in at least 3 different `USER` messages, is a note. It is removed from the block text wherever it appears. Its text without the asterisks, and the position of the first message carrying it, form a Note. Notes are returned in order of first appearance.
  - `text` is one line per block that still has text: `<speaker>: <text>`, with ` (player)` after the speaker for role `Player`.
  - `fingerprint` is taken over the original block texts joined by a newline, before notes are removed.
  - `transcript`: `[#<position>] <text>` per message with non-empty `text`, separated by a blank line.
  - `changed`: an id in `known` that is absent from `current`, or present with a different fingerprint, is `withdrawn`; an id in `current` not in `known` is `unread`. Both in story order.
- [ ] **Step 2: Write the tests** with `CampaignBuilder`.

  | Test | Must hold |
  |---|---|
  | `positions and roles` | three messages get positions 1, 2, 3; a `USER` narrator block has role `Narrator` and its line has no ` (player)` |
  | `the player is found by frequency` | a campaign where the operator once speaks as `Guard` still returns the usual name |
  | `repeated notes are lifted once` | a 45-character `*...*` segment in 3 player messages is absent from all three texts and gives one Note at the first position |
  | `a segment repeated twice stays` | the same segment in only 2 messages remains in the text and gives no Note |
  | `short asterisk actions stay` | `*smiles*` repeated 10 times is never lifted |
  | `non-text blocks are ignored` | a block of type `IMAGE` adds no line |
  | `a message that is only a note has empty text` | its `text` is `''` and `transcript` omits it but later positions are unchanged |
  | `changed detects edits, removals and new messages` | given known ids A, B, C and current A (same), B (edited), D: `withdrawn` is `[B, C]` and `unread` is `[D]` |

- [ ] **Step 3: Run** `node --test tests/scribe-intake.test.mjs`. Expected: 8 passing.
- [ ] **Step 4: Hand off.**

### Task 4: Reading the Analyzer's answer

**Files:** Create `scribe/core/ScribeAnswer.js`, `tests/scribe-answer.test.mjs`.

**Interfaces:**

- Consumes `ScribeCategory.parse`, `ScribeCategory.SubjectKinds`, `ScribeText.normaliseName`.
- Produces `ScribeAnswer.Reason` (`Shape`, `Category`, `Citation`, `Name`), `ScribeAnswer.Type` (the twelve operation types), `ScribeAnswer.Reach` (`Public`, `Private`), `ScribeAnswer.Blocks` (the nine block names in order), `ScribeAnswer.parse(text: string): { operations: object[], refused: Array<{ block: string, line: string, reason: string }> }`.

**Amended 2026-11-14 (rulings 1, 9, 13 to 16):** the requirements as built are in `sdd-snapshots/scribe-engine/task-4-brief-2.md`. The steps below are the approved original and are superseded where they differ; ruling 17 lists the main differences.

- [ ] **Step 1: Write `ScribeAnswer.parse`.** The answer is a sequence of blocks. A block header is a line that, trimmed, is exactly `=== <NAME>` or `=== <NAME> ===`, with NAME one of `SUBJECTS FACTS CHANGES TOLD SCENES NIGHTS THREADS`. Any other line belongs to the current block. Lines before the first header are refused with block `PREAMBLE`, reason `Shape`. A leading `- ` or `* ` bullet and surrounding `**` are stripped. Blank lines and lines that begin, ignoring case, with `none`, `(none`, `no new` or `nothing` are skipped.

  Line forms, fields separated by ` | `:

  | Block | Form |
  |---|---|
  | SUBJECTS | `Label | kind` |
  | FACTS | `Label | category | statement | #n` with an optional fifth field `hidden` |
  | CHANGES | `F12 | statement | #n`, or `F12 | ENDED: reason | #n` |
  | TOLD | `F12 | Label | #n` |
  | SCENES | `Day N | #a-#b | Place | public` or `private` ` | present: A, B (from #x), C (until #y) | summary` |
  | NIGHTS | `#n | marker` |
  | THREADS | `OPEN | text | #n`, or `CLOSE T3 | how | #n` |

  A FACTS line is read from both ends: the first two fields, then from the right an optional `hidden` and the citation; whatever lies between is the statement, pipes included. A citation is `#n`, or `#a-#b` or `#a-b`, of which `a` is used; anything else refuses the line with `Citation`. A category that `ScribeCategory.parse` rejects refuses the line with `Category`. A label that normalises to `narrator`, is empty, is longer than 60 characters, or contains a comma or ` and ` refuses the line with `Name`. A subject kind outside `SubjectKinds` refuses with `Shape`. In SCENES, `present:` is split on commas; `(from #x)` and `(until #y)` set the bounds.
- [ ] **Step 2: Write the tests.**

  | Test | Must hold |
  |---|---|
  | `a full answer parses` | one line of each form yields operations of types `Subject, Fact, Change, End, Told, Scene, Night, ThreadOpen, ThreadClose` in that order, `refused` empty |
  | `pipes and block markers inside a statement` | `Halvard | trait | says "a | b" === loudly | #12` gives a Fact whose text is `says "a | b" === loudly`; a line `=== FACTS are fun` inside FACTS is refused, not treated as a header |
  | `hidden marker` | `Halvard | background | charged an army in plate | #40 | hidden` gives `hidden: true`; without the field `false` |
  | `citation forms` | `#7` gives 7; `#7-#9` gives 7; `(#7)` and `notes` and `7` refuse with `Citation` |
  | `unknown category refuses only that line` | a `knows` line is refused with `Category` and the lines around it parse |
  | `narrator and joined names are refused` | labels `Narrator` and `Halvard and Mirelle` refuse with `Name` |
  | `relation target` | `Mirelle | relation to Halvard | sworn allies | #61` gives `category: 'relation'`, `target: 'Halvard'` |
  | `scene attendance bounds` | `present: Halvard, King Aldric (from #251), Isolde (until #260)` gives three entries with `from` and `until` of `null/null`, `251/null`, `null/260`; `reach` is `Public` for `public` |
  | `none lines and preamble` | `None in this stretch.` is skipped silently; `Here is the update:` before any header is refused with block `PREAMBLE` |
  | `empty answer` | `''` gives no operations and nothing refused |

- [ ] **Step 3: Run** `node --test tests/scribe-answer.test.mjs`. Expected: 10 passing.
- [ ] **Step 4: Hand off.**

### Task 5: The log, and replaying facts and subjects

**Superseded by ruling 18:** the requirements as built are in `sdd-snapshots/scribe-engine/task-5-brief.md`, `task-5-fix-1.md` and `task-5-fix-2.md` (68 tests). The text below is the approved original.

**Files:** Create `scribe/core/ScribeLog.js`, `scribe/core/ScribeReplay.js`, `tests/scribe-facts.test.mjs`.

**Interfaces:**

- Consumes `ScribeText`, `ScribeCategory`, parsed operations, `Message`.
- Produces `ScribeLog.create(): Log`.
- Produces `ScribeLog.append(log, state, operations, { messages: Message[], origin: 'Story'|'Notes' }): { entry: Entry, refused: Array<{ operation, reason }> }`. Throws `Error` with message `AlreadyRead` if any message id is already in `log.read`. Mutates `log`.
- Produces `ScribeReplay.run(log, order: string[]): State`, `order` being every message id in story order.
- Produces `ScribeLog.Reason` (`Reference`, `Citation`).

- [ ] **Step 1: Write `ScribeLog.create` and `append`.** `append` resolves each parsed operation against `state` and the entry so far:
  - A position must be the position of one of `messages`; otherwise the operation is refused with `Citation`. It becomes `cite`, that message's id. With origin `Notes`, `messages` are the messages that first carried the notes; they are used only to turn positions into ids and are not added to `messageIds` or `log.read`, and the `AlreadyRead` check is skipped.
  - A `Subject` operation, or a label not matching any subject, creates a subject id `S<nextSubject>` and stores `{ type: 'Subject', subject, label, kind }` (kind `character` when the label first appears in a FACTS line). A label matches a subject when it equals, after `normaliseName`, the subject's label, name or one of its aka.
  - `Fact` becomes `{ type: 'Fact', fact: 'F<nextFact>', subject, category, target, text, cite, hidden }` with `target` resolved to a subject id the same way.
  - `Change`, `End` and `Told` must name a fact that exists in `state` or earlier in this entry; otherwise refused with `Reference`. `ThreadClose` likewise for threads. `ThreadOpen` gets `T<nextThread>`.
  - With origin `Story`, the entry records all of `messages` ids in `messageIds` and in `log.read`, even when no operation survives.
- [ ] **Step 2: Write `ScribeReplay.run` for subjects and facts.** Skip entries with `withdrawn: true`. Collect fact operations and order them by the position of `cite` in `order`, then entry sequence, then index in the entry.
  - Subjects: name is the label with any trailing ` (...)` removed. A subject created with the same normalised name as an earlier one adds a LookAlike with reason `SameName`; one whose name `ScribeText.resembles` an earlier name adds one with reason `Spelling`. An `aka` fact adds to the subject's aka.
  - Fixed category: the first fact in story order is `InForce`. A later one that compares `Same` is dropped. `Refines`: the earlier becomes `Replaced` with `replacedBy`, the later `InForce`. `Differs`: the later is `Disputed` and joins that subject and category's Conflict; a later fact that is `Same` as an existing disputed one is dropped.
  - Moving category: the later replaces the earlier, keyed by subject, category and target. When a `relation` from A to B is replaced or first set at a position later than the in-force relation from B to A, add `{ subject: B, target: A }` to `stale`; remove it when B to A is next set.
  - List category: added `InForce` unless an in-force fact of the same subject and category has the same `normaliseValue`.
  - Passing category: `InForce` in this task. Expiry comes in Task 6.
  - `kind` facts also set the subject's kind.
- [ ] **Step 3: Write the tests.** Build logs through `ScribeAnswer.parse` and `ScribeLog.append`; a helper `apply(log, order, answerText, messages)` replays, appends and replays again.

  | Test | Must hold |
  |---|---|
  | `first established stays in force` | ages `twenty-five` (#3), `thirty` (#5), `thirty-five` (#9) on one subject: one fact `InForce` (25), two `Disputed`, one Conflict whose `others` has length 2 |
  | `story order beats reading order` | append an update citing #9 (`age thirty`), then an update citing #3 (`age twenty-five`): after replay 25 is `InForce` and 30 is `Disputed` |
  | `a fuller description replaces` | `eyes: pale grey` then `pale grey ringed with amber`: second `InForce`, first `Replaced` with `replacedBy` set, no Conflict |
  | `moving values move on` | two `location` facts: later `InForce`, earlier `Replaced` |
  | `relations are kept per target` | Halvard's relations to Mirelle and to Tamsin are both `InForce` |
  | `one side of a relation goes stale` | Tamsin to Halvard set at #20 after Halvard to Tamsin at #5: `stale` deep-equals `[{ subject: <Halvard>, target: <Tamsin> }]`; setting Halvard to Tamsin at #21 empties it |
  | `list repeats are dropped` | `trait: Teases younger girls.` after `trait: teases younger girls` adds nothing |
  | `second subject with the same name stays separate` | SUBJECTS line `Oswin (Tamsin's uncle) | character` when `Oswin` exists creates a second subject and a LookAlike with reason `SameName`; a fact for label `Oswin` still goes to the first |
  | `near spellings are listed` | subjects `Aldrich` then `Aldric` give a LookAlike with reason `Spelling` |
  | `a citation outside the stretch is refused` | a fact citing #99 with messages 1 to 3 is refused with `Citation` and the others apply |
  | `a change to an unknown fact is refused` | `F999 | new | #2` refused with `Reference` |
  | `the same messages cannot be read twice` | a second `append` with the same messages throws `AlreadyRead` and leaves `log.entries` length unchanged |
  | `messages are marked read even with no operations` | an empty answer still records the three ids in `log.read` |

- [ ] **Step 4: Run** `node --test tests/scribe-facts.test.mjs`. Expected: 13 passing.
- [ ] **Step 5: Hand off.**

### Task 6: Scenes, nights, conditions, changes and threads

**Superseded by rulings 19 and 20:** the requirements as briefed are in `sdd-snapshots/scribe-engine/task-6-brief.md`. The text below is the approved original.

**Files:** Modify `scribe/core/ScribeReplay.js`. Create `tests/scribe-scenes.test.mjs`.

**Interfaces:** Consumes Task 5. Produces the `scenes`, `nights`, `threads` parts of State, fact statuses `Ended` and `Expired`, and `told`.

- [ ] **Step 1: Extend `ScribeReplay.run`.**
  - `Scene`: a scene whose first message id equals an existing scene's replaces it (this is how a scene continues across stretches); otherwise it is added. Scenes are ordered by `firstPosition`. `present` labels were resolved to subject ids by `append`; `from` and `until` are kept as positions.
  - `Night`: added, ordered by position.
  - `Passing` facts become `Expired` when any night has a position greater than the fact's position.
  - `Change`: the named fact becomes `Replaced`; a new fact with the same subject, category and target, the new text and cite, is filed under that category's ordinary rule, except that for a Fixed category it is `InForce` and never a conflict, because the story showed the change.
  - `End`: the named fact becomes `Ended`.
  - `Told`: the subject id is added to the fact's `told`.
  - Threads: opened and closed as given.
- [ ] **Step 2: Extend `ScribeLog.append`** so a `Scene` operation's `first` and `last` must satisfy `first <= last` and `last` must be a position in `messages`; `first` may be earlier than the stretch only when it equals the `firstPosition` of the latest scene in `state`. Otherwise refused with `Citation`.
- [ ] **Step 3: Write the tests.**

  | Test | Must hold |
  |---|---|
  | `a scene continues across stretches` | a scene `#1-#40` then, in the next update, `#1-#52` with one more person present: one scene, `lastPosition` 52, the new attendance |
  | `a scene reaching back to a different start is refused` | latest scene starts at #30; a line `#12-#52` is refused with `Citation` |
  | `conditions expire at the next night` | condition at #78, night at #80: `Expired`; condition at #84 with no later night: `InForce` |
  | `a condition on the night's own message survives it` | condition at #80, night at #80: `InForce` |
  | `a story change is not a conflict` | `F1` is `age: twenty`; `CHANGES F1 | twenty-one | #300`: new fact `InForce`, `F1` `Replaced`, no Conflict |
  | `ended facts leave the book` | `F2 | ENDED: they drank it | #306` gives status `Ended` |
  | `told adds one person` | `TOLD F3 | Kira | #90` puts Kira's id in `told` once, even if repeated |
  | `threads open and close` | `OPEN` then `CLOSE T1` leaves one thread with `closed.how` set |
  | `attendance bounds are kept` | `King Aldric (from #251)` is stored with `from: 251` |

- [ ] **Step 4: Run** `node --test tests/scribe-scenes.test.mjs tests/scribe-facts.test.mjs`. Expected: 22 passing.
- [ ] **Step 5: Hand off.**

### Task 7: The operator's operations and withdrawal

**Superseded by ruling 21:** the requirements as briefed are in `sdd-snapshots/scribe-engine/task-7-brief.md`. The text below is the approved original.

**Files:** Modify `scribe/core/ScribeLog.js`, `scribe/core/ScribeReplay.js`. Create `tests/scribe-operator.test.mjs`.

**Interfaces:**

- Produces `ScribeLog.rule(log, operation): Entry` for the operator operations in Shared shapes (kind `Operator`, origin `Operator`, no message ids).
- Produces `ScribeLog.withdraw(log, messageId): string[]|null`: marks the unwithdrawn `Update` entry that read the message as withdrawn, removes that entry's ids from `log.read`, and returns those ids so they can be read again; `null` if no entry read it.
- Produces `ScribeLog.keepFirst(log, state): Entry[]`: one `Pin` per Conflict in `state`, pinning the established value.

- [ ] **Step 1: Write `rule`, `withdraw`, `keepFirst`.**
- [ ] **Step 2: Extend `ScribeReplay.run` with three layers.**
  - Before story operations: `Merge` makes every reference to `from` mean `into` and sets `mergedInto`; `Split` creates a subject with the given label and kind and moves the listed facts to it; `Distinct` and `Merge` both remove the matching LookAlike.
  - After story operations: `Pin` forces the pinned text `InForce` for that subject, category and target as a fact with origin `Operator` and `pinned: true`, marks every differing fact `Disputed`, and removes the Conflict. `AddFact` files a fact with origin `Operator` at a position after every message. `RemoveFact` sets status `Removed`. `Widen` sets `widened`. `Narrow` sets the scene's `narrowed`.
  - A merge is followed by the Fixed comparison again, so two merged subjects with different ages produce a Conflict.
- [ ] **Step 3: Write the tests.**

  | Test | Must hold |
  |---|---|
  | `a pin settles a conflict` | after ages 25, 30, 35 and `Pin` 35: the pinned fact is `InForce`, three facts `Disputed`, `conflicts` empty |
  | `a pinned value is not reopened` | a later update stating `age thirty` adds a `Disputed` fact and no Conflict |
  | `keep the first value for all` | two Conflicts, `keepFirst`, replay: no Conflicts, each established value `InForce` |
  | `merge joins two subjects and compares again` | `Aldrich` (age mid-thirties) merged into `Aldric` (age late forties): one subject shown, one Conflict on age, the LookAlike gone |
  | `distinct keeps two subjects` | `Distinct` on the two Oswins removes the LookAlike and both subjects remain |
  | `split moves the listed facts` | splitting `Oswin` with two of his four facts gives a new subject holding exactly those two |
  | `withdrawal brings back what was displaced` | update A sets `location: village` (#5); update B sets `location: mansion` (#50); withdraw a message of B: `village` is `InForce` again and B's message ids are no longer in `log.read` |
  | `withdrawn messages can be read again` | after the withdrawal, `append` with B's messages succeeds |
  | `withdrawing an unread message does nothing` | returns `null` and changes nothing |
  | `removing and adding by hand` | `RemoveFact` gives `Removed`; `AddFact` gives an `InForce` fact with origin `Operator` |

- [ ] **Step 4: Run** `node --test tests/scribe-operator.test.mjs tests/scribe-scenes.test.mjs tests/scribe-facts.test.mjs`. Expected: 32 passing.
- [ ] **Step 5: Hand off.**

### Task 8: Who knows what

**Files:** Create `scribe/core/ScribeKnowledge.js`, `tests/scribe-knowledge.test.mjs`.

**Interfaces:**

- Consumes State.
- Produces `ScribeKnowledge.Everyone` (the string `Everyone`), `ScribeKnowledge.audience(state, fact): 'Everyone'|string[]`, `.knows(state, knower: string, fact): boolean`, `.about(state, knower: string, subject: string): { facts: Fact[], scenes: Scene[] }`.

- [ ] **Step 1: Write `ScribeKnowledge`.** For a fact, in this order:
  1. `widened` equal to `Everyone` gives `Everyone`.
  2. `hidden` gives the fact's subject, plus `told`, plus a `widened` list.
  3. Origin `Notes` or `Operator` gives `Everyone`.
  4. Find the scene whose `firstPosition <= position <= lastPosition`. None: the fact's subject, plus `told`, plus a `widened` list.
  5. That scene `Public` and not `narrowed`: `Everyone`.
  6. Otherwise everyone in the scene's `present` whose bounds contain the position (`from` null or `<=` position, `until` null or `>=` position), plus the fact's subject, plus `told`, plus a `widened` list.

  A subject that was merged counts as the subject it was merged into. `knows` is true for `Everyone` or when the knower is in the list. `about` returns the `InForce` facts whose subject is `subject` and that the knower knows, and the scenes in which `subject` was present and which the knower either attended or which are `Public` and not narrowed; both in story order.
- [ ] **Step 2: Write the tests.**

  | Test | Must hold |
  |---|---|
  | `a private scene is known to those present` | a fact at #204 in a private scene with Halvard, Isolde, King: Isolde knows; the Baker does not |
  | `a public scene reaches everyone` | the same fact in a public scene: the Baker knows |
  | `a narrowed public scene reaches only those present` | after `Narrow`: the Baker does not |
  | `hidden facts stay with their subject` | a hidden fact about Halvard in a public scene: only Halvard |
  | `told adds one knower` | hidden fact, `TOLD` Mirelle: Halvard and Mirelle only |
  | `late arrival misses what came before` | King present `from: 251`; a fact at #240 in that scene is unknown to him, one at #255 is known |
  | `early leaver misses what came after` | Isolde `until: 260`; a fact at #270 is unknown to her |
  | `notes and hand-added facts are public` | origin `Notes`: `Everyone` |
  | `a fact outside any scene is known only to its subject` | no covering scene: audience is `[subject]` |
  | `groups know as groups` | group `the court` present: the group id knows; a member not listed does not |
  | `about returns facts and attended scenes` | `about(state, King, Halvard)` returns the two facts shown at the dinner and that dinner scene, and omits a private scene the King missed |

- [ ] **Step 3: Run** `node --test tests/scribe-knowledge.test.mjs`. Expected: 11 passing.
- [ ] **Step 4: Hand off.**

### Task 9: What the Analyzer is sent

**Files:** Create `scribe/core/ScribeAnalyzer.js`, `tests/scribe-analyzer.test.mjs`.

**Interfaces:**

- Consumes State, `Message`, `Note`, `ScribeIntake.transcript`.
- Produces `ScribeAnalyzer.Prompt: string`, `ScribeAnalyzer.NotesPrompt: string`, `ScribeAnalyzer.select(state, text: string): string[]` (subject ids), `ScribeAnalyzer.input(state, player: string, stretch: Message[]): string`, `ScribeAnalyzer.notesInput(state, player: string, notes: Note[]): string`.

- [ ] **Step 1: Write `select`.** A subject is selected when its name or an aka of at least 3 characters appears in `text`, compared lower-case, with a character that is not a Unicode letter or digit, or the string's edge, on both sides. Subjects of kind `world` are always selected, as is everyone in the latest scene's `present`. Merged-away subjects are never selected.
- [ ] **Step 2: Write `input`.** Sections in this order, each headed by its name and a colon on its own line:
  - `PLAYER CHARACTER`: the player's name.
  - `SUBJECTS`: one line per subject not merged away: `- <label> (<kind>; aka <a>, <b>)`, the aka part only when there are any. Labels must be unique: when two subjects share a normalised name, the later one's label carries its qualifier.
  - `LEDGER`: for each selected subject, `## <label>` then one line per `InForce` fact: `<id> <category>: <text> (#<position>)`, with `relation to <target label>` for relations and ` hidden` appended for hidden facts. A relation whose subject and target appear in `stale` ends with ` (check: the other side has changed)`. `(none)` when empty.
  - `LAST SCENES`: the last 3 scenes as `Day <day> | #<first>-#<last> | <place> | <public or private> | present: <labels> | <summary>`.
  - `NIGHTS`: the last 3 as `#<position> | <marker>`.
  - `OPEN THREADS`: `T<n>: <text>` for threads not closed.
  - `NEW MESSAGES (#<first> to #<last>)`: `ScribeIntake.transcript(stretch)`.
- [ ] **Step 3: Write `Prompt`.** Start from `UpdatePrompt` in `spike/ledger-core.js`. Keep its first paragraph, the "What is a fact and what is not" test, and its Right and Wrong examples, changing only what follows:
  - The list of what is received becomes the section names of Step 2.
  - The block list becomes the seven blocks and line forms of Task 4, in that order.
  - Categories: remove `name`, `knows` and `secret`. Add under the category list: "A full name or a nickname is an aka fact."
  - Replace every rule about `knows` and `secret` with: "Mark a fact `hidden` by adding ` | hidden` when it is a thought, something only the narrator states, or something the character conceals. Write a TOLD line when the new messages show a character being told an existing fact."
  - Scenes rule: "SCENES: one line per scene in the new messages, in order, at most four. A scene is a stretch in one place with one main thing going on. If the first new messages continue the last scene shown, repeat that scene's line with the same first number and the new last number. `public` means bystanders could see or hear; `private` means only those listed. List everyone present; add `(from #n)` for someone who arrived after the scene began and `(until #n)` for someone who left before it ended. Continue the day count from LAST SCENES; a night belongs to the day it ends."
  - Subjects rule: "Use a label from SUBJECTS exactly. For someone new, add a SUBJECTS line first. If a new person has the same name as an existing subject, give them a label with a short distinguishing note in brackets, such as `Oswin (Tamsin's uncle)`."
  - Add: "A relation marked (check: the other side has changed) must be restated as it stands now."
  - Remove the CONTRADICTIONS and NOW blocks and their rules.
  - Keep: one fact per line under 25 words; each line ends with its message number; never repeat what the ledger holds; threads at most two per stretch; nights only when slept through or a stated time skip.
- [ ] **Step 4: Write `NotesPrompt` and `notesInput`.** The notes prompt uses the same opening, categories and fact test, and only the SUBJECTS, FACTS and THREADS blocks. It states that the notes were written by the player, that each line of `PLAYER NOTES` is numbered `[#n]`, and that every FACTS line must end with the number of the note line it came from. `notesInput` gives `PLAYER CHARACTER`, `SUBJECTS`, `LEDGER` for subjects named in the notes, and `PLAYER NOTES` as `[#<note position>] <text>` lines.
- [ ] **Step 5: Write the tests.**

  | Test | Must hold |
  |---|---|
  | `selection matches whole names only` | subject `Oswin` is not selected by text `the children ran`; `Yselle` is selected by `Yselle's blouse` and by `viola-san`; `Zul'Aman` is selected by `to Zul'Aman.` |
  | `short aka are ignored` | an aka `Al` never selects |
  | `the world and those present are always sent` | a `world` subject and the latest scene's attendees appear in LEDGER when the text names nobody |
  | `only in-force facts are sent` | a `Disputed`, a `Replaced` and an `Expired` fact are absent |
  | `shared names get distinct labels` | two Oswins appear as two different SUBJECTS lines |
  | `a stale relation is marked` | its line ends with `(check: the other side has changed)` |
  | `hidden facts are marked` | their line ends with ` hidden` |
  | `sections are in order` | the index of each section heading increases in the order of Step 2 |
  | `the prompt names every block and no removed one` | `Prompt` contains each of the seven block headers and none of `CONTRADICTIONS`, `=== NOW`, `knows (`, `secret (` |
  | `merged subjects are not offered` | a merged-away subject is absent from SUBJECTS |

- [ ] **Step 6: Run** `node --test tests/scribe-analyzer.test.mjs`. Expected: 10 passing.
- [ ] **Step 7: Hand off.**

### Task 10: Calling the model

**Files:** Create `scribe/core/ScribeGateway.js`, `tests/scribe-gateway.test.mjs`.

**Interfaces:**

- Produces `ScribeGateway.Endpoint` (`https://openrouter.ai/api/v1/chat/completions`), `ScribeGateway.call({ fetch, key, model, system, user, maxTokens }): Promise<{ text: string, tokensIn: number, tokensOut: number, cost: number|null }>`, `ScribeGateway.retry(attempt: () => Promise<object>, { attempts, pauseMs, sleep }): Promise<object>`.
- A failure is an `Error` with `retryable: boolean`, `status: number|null`, `finish: string|null`.

- [ ] **Step 1: Write `call`.** POST JSON with `Authorization: Bearer <key>`: `{ model, temperature: 0.2, max_tokens: maxTokens, reasoning: { effort: 'low' }, usage: { include: true }, messages: [system, user] }`. The answer is accepted only when the HTTP status is 2xx, the body parses, there is no `error` member, `choices[0].finish_reason` is exactly `stop`, and `choices[0].message.content` is a non-empty string. Anything else throws. Retryable: `fetch` rejecting; status 429 or 500 and above; `finish_reason` `error`; an empty answer whose finish is not `length`. Not retryable: any other 4xx; finish `length`; an unreadable body with a 2xx status is retryable. `cost` is `usage.cost` when it is a number. The error message states status, finish and the provider's reason, and never contains the key.
- [ ] **Step 2: Write `retry`.** Calls `attempt` up to `attempts` times, waiting `pauseMs * n` through the injected `sleep` after the n-th failure, only for retryable errors. Rethrows the last error.
- [ ] **Step 3: Write the tests** with a scripted `fetch`.

  | Test | Must hold |
  |---|---|
  | `a complete answer is returned` | finish `stop` with content gives `text`, token counts and `cost` 0.0123 from `usage.cost` |
  | `a half answer is refused` | finish `error` with content `=== FACTS\nMirelle | age | ninety | #50` throws, `retryable` true |
  | `a cut-off answer is refused and not retried` | finish `length` throws, `retryable` false |
  | `an empty answer is refused` | finish `stop`, content `''` throws, `retryable` true |
  | `rate limits and server errors retry` | 429 and 503 throw `retryable` true; 401 and 402 throw `retryable` false |
  | `a network failure retries` | `fetch` rejecting throws `retryable` true |
  | `the key never appears in an error` | for every failure above, `error.message` does not contain the key |
  | `retry stops after the limit` | three retryable failures with `attempts: 3` rethrow after 3 calls and 2 sleeps of 10000 and 20000 |
  | `retry does not repeat a fatal error` | one non-retryable failure gives 1 call and 0 sleeps |
  | `the request carries the usage flag and no key in the body` | the body JSON has `usage.include` true and does not contain the key |

- [ ] **Step 4: Run** `node --test tests/scribe-gateway.test.mjs`. Expected: 10 passing.
- [ ] **Step 5: Hand off.**

### Task 11: Walking a campaign

**Files:** Create `scribe/core/ScribeAdoption.js`, `tests/scribe-adoption.test.mjs`.

**Interfaces:**

- Consumes everything above.
- Produces `ScribeAdoption.Stop` (`Done`, `Paused`, `Budget`, `Failed`), `ScribeAdoption.next(log, messages: Message[], size: number): Message[]` (the next unread stretch, empty when all are read), and
  `ScribeAdoption.run({ messages, notes, player, log, model, size, budget, spent, ask, save, record, progress, paused }): Promise<{ stop: string, problem: string|null, spent: number, calls: number }>` where `ask(system, user): Promise<{ text, cost }>` is the gateway already wrapped in retry, `save(log): Promise<void>` persists the log, `record({ sequence, pass: 'Notes'|'Story', input, answer }): Promise<void>` keeps the call, `progress({ read, total, spent, refused })` reports, and `paused(): boolean` is polled between stretches.

- [ ] **Step 1: Write `next`.** The first message in story order whose id is not in `log.read`, and the unread messages after it, up to `size`, stopping early at the first message that is already read.
- [ ] **Step 2: Write `run`.** Loop: stop with `Paused` if `paused()`; stop with `Budget` if `spent >= budget`; take `next`; stop with `Done` when it is empty. Replay. If any Note's position falls in the stretch and its text is not in `log.notes`, ask with `NotesPrompt` and `notesInput`, parse, and append with origin `Notes`, passing the messages at those notes' positions; add the texts to `log.notes`. Replay again. Lines refused by the parser and operations refused by `append` are both reported through `progress.refused`. If the stretch's transcript is empty, append an entry with no operations so the messages are marked read. Otherwise ask with `Prompt` and `input`, parse, append with origin `Story`. Then `record`, `save`, `progress`. A thrown `ask` stops with `Failed` and the error's message as `problem`, with nothing appended for that stretch. A thrown `save` stops with `Failed`; the in-memory log is not trusted afterwards.
- [ ] **Step 3: Write the tests** with a `CampaignBuilder` campaign of 100 messages, a scripted `ask` and an in-memory `save` that stores a deep copy.

  | Test | Must hold |
  |---|---|
  | `a campaign is read in stretches` | `size: 40` gives 3 story calls covering #1-40, #41-80, #81-100; every id is in `log.read`; stop is `Done` |
  | `notes are filed once` | a note first seen at #6 causes one notes call, in the first stretch only |
  | `an empty stretch and an empty answer are both read` | a stretch whose messages were only notes makes no story call and is marked read; an answer of `''` marks its stretch read and the run continues |
  | `pause stops between stretches` | `paused` true after the first stretch gives stop `Paused` with 40 read; running again reads the rest |
  | `the budget stops the run` | `budget: 0.05` with each call costing 0.04 stops with `Budget` after 2 calls |
  | `a failed call applies nothing` | `ask` throwing on the second stretch gives `Failed`, 40 read, and the saved copy equals the log after stretch one |
  | `resume after a failed save reads the stretch once` | `save` throwing after the second stretch; a fresh run from the last saved copy makes exactly one more call for #41-80 and the final state has each fact once |
  | `refused lines are counted and kept` | a malformed line appears in `progress.refused` and the rest of that answer is applied |
  | `every call is recorded` | `record` receives one item per call with the exact input and answer |
  | `withdrawn messages are read again` | after `ScribeLog.withdraw` on a message of the first stretch, `next` returns that stretch |

- [ ] **Step 4: Run** `node --test tests/scribe-adoption.test.mjs`. Expected: 10 passing.
- [ ] **Step 5: Hand off.**

### Task 12: The bench server

**Files:** Create `scribe/bench/serve.mjs`, `tests/scribe-serve.test.mjs`.

**Interfaces:** Produces a local server on `127.0.0.1:8766`, started by `node scribe/bench/serve.mjs`, and an exported `handle(request, response, root)` for tests.

- [ ] **Step 1: Write the server.** `serve.mjs` is an ES module using only `node:http`, `node:fs/promises`, `node:path`, `node:url`. It starts listening only when run directly.
  - `GET /` redirects to `/bench/adopt.html`.
  - `GET /bench/<name>` and `GET /core/<name>` serve files from `scribe/bench/` and `scribe/core/` whose names match `^[A-Za-z][A-Za-z0-9.-]{0,80}\.(html|js|css)$`.
  - `GET /private/` returns a JSON array of file names in `scribe/private/` matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.(json|txt)$`, sorted.
  - `GET /private/<name>` serves one such file. `POST /private/<name>` writes the body to it, at most 30 megabytes, creating the folder if absent, and answers `{ "saved": name, "bytes": n }`.
  - A `POST` with an `Origin` header other than `http://localhost:8766` or `http://127.0.0.1:8766` is answered 403.
  - Every response carries `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Anything else is 404; other methods 405.
- [ ] **Step 2: Write the tests** calling `handle` with stub request and response objects against a temporary directory created with `node:fs/promises` `mkdtemp` and removed by the test.

  | Test | Must hold |
  |---|---|
  | `pages and core files are served` | `GET /core/ScribeText.js` is 200 with a JavaScript content type |
  | `saving and reading back` | `POST /private/log-a.json` then `GET` returns the same bytes, including a non-ASCII character |
  | `the listing shows only data files` | a `.json`, a `.txt` and a `.sh` in the folder list the first two |
  | `a foreign origin cannot save` | `Origin: https://evil.example` is 403 and no file is written |
  | `names cannot escape the folder` | `/private/..%2Fserve.mjs`, `/private/a/b.json`, `/core/../bench/serve.mjs` and `/bench/serve.mjs` are each 400 or 404 and read nothing outside |
  | `oversized bodies are refused` | a body over the limit is refused and leaves no partial file |
  | `the server module does not listen when imported` | importing it in the test opens no port |

- [ ] **Step 3: Run** `node --test tests/scribe-serve.test.mjs`. Expected: 7 passing.
- [ ] **Step 4: Hand off.**

### Task 13: The bench page: adopt, Book and Timeline

**Files:**

| Action | File | Responsibility |
|---|---|---|
| Create | `scribe/bench/adopt.html` | Markup only; loads the stylesheet, the core files in dependency order, then the two bench scripts |
| Create | `scribe/bench/bench.css` | Tokens and layout |
| Create | `scribe/bench/BenchView.js` | `const BenchView`: pure functions turning State into rows and text |
| Create | `scribe/bench/BenchPage.js` | `const BenchPage`: wiring, model calls, saving |
| Create | `tests/support/FakePage.mjs` | Minimal document, elements, events and scripted `fetch` for page tests |
| Create | `tests/scribe-bench.test.mjs` | View and wiring tests |

**Interfaces:**

- Consumes all core objects and the server's routes.
- Produces `BenchView.subjects(state, query: string, page: number): { rows, pages }` (20 per page, people present in the latest scene first, then by number of in-force facts), `BenchView.subject(state, id): { heading, facts: Array<{ id, category, text, source, status, audience }> }`, `BenchView.timeline(state, page: number): { rows, pages }` (20 scenes per page: day, range, place, reach, present, summary), `BenchView.progress(report): string`.
- Produces saved files `log-<roomId>.json` (the Log) and `calls-<roomId>-<sequence>.json` in `scribe/private/`.

- [ ] **Step 1: Write the page.** Setup: OpenRouter key (password field, required marker), campaign (a select filled from `/private/`, names beginning `campaign-`), model (default `mistralai/mistral-large-4-0`), messages per stretch (default 40), stop after message (blank for all), budget in dollars (default 3). Actions, left to right: Pause, Continue the saved book, Start. Tabs: Progress, Book, Timeline. Progress shows a line that updates every second while a call is in flight (`Waiting for the model on #41 to #80: 37s`), then per stretch: range, seconds, cost, facts added, lines refused. Book has a search box, the paged subject list and, for the chosen subject, its facts with source position, status and audience (`Everyone` or the names). Timeline is the paged scene list. If a saved log for the chosen campaign exists, the page says so; Continue loads it and resumes; Start begins a new book only after a confirmation, because it replaces a saved one.
- [ ] **Step 2: Write `BenchPage`** to run `ScribeAdoption.run` with `ask` built from `ScribeGateway.call` inside `ScribeGateway.retry` (`attempts: 3`, `pauseMs: 10000`), `save` posting the log, `record` posting each call, and the spent amount taken from the gateway's `cost`. The key is read from the field at call time and stored nowhere.
- [ ] **Step 3: Write the tests.**

  | Test | Must hold |
  |---|---|
  | `subjects are paged at twenty` | 45 subjects give 3 pages and 20 rows on the first |
  | `people in the current scene come first` | a subject present in the latest scene sorts above one with more facts |
  | `search matches names and other names` | query `mardeg` finds `Tamsin` through her aka |
  | `a subject shows status and audience` | a disputed fact is labelled `Disputed`; a hidden fact's audience is the subject's own name; a public one's is `Everyone` |
  | `the timeline pages scenes` | 25 scenes give 2 pages |
  | `a run saves after every stretch` | with a scripted model, three stretches produce three posts of `log-<room>.json` and three `calls-` files |
  | `the key is not saved` | no posted body and no `localStorage` or `sessionStorage` write contains the key |
  | `continue resumes a saved book` | loading a log with 40 read and pressing Continue makes the first model call for #41 |
  | `start over asks first` | with a saved log present, Start does nothing until the confirmation is accepted |
  | `a failed call shows why and can be resumed` | a non-retryable failure shows its message in Progress and enables Continue |
  | `the waiting line appears at once` | Progress shows `Waiting for the model` before the scripted model answers |

- [ ] **Step 4: Run** `node --test tests/scribe-bench.test.mjs`. Expected: 11 passing.
- [ ] **Step 5: Hand off.** The hand-off states that the page has not been seen in a browser by any agent and lists what the operator should look at.

### Task 14: The bench page: Rulings and Audit, and the acceptance run

**Files:** Modify `scribe/bench/adopt.html`, `BenchView.js`, `BenchPage.js`, `bench.css`, `tests/scribe-bench.test.mjs`, `README.md`. Create `docs/verification/scribe-engine-verification.md`.

**Interfaces:**

- Produces `BenchView.rulings(state): { conflicts, lookAlikes, publicScenes }`, `BenchView.audit(state, messages, seed: number): Array<{ fact, subject, category, text, position, message: string }>` (30 in-force story facts chosen by a seeded shuffle, each with the full text of its cited message), and a saved file `audit-<roomId>.json`.

- [ ] **Step 1: Add the Rulings tab.** Conflicts: subject, category, each value with its position as a choice, and "Other" with a text field; choosing writes a `Pin`. A button "Keep the first value for all that remain" applies `ScribeLog.keepFirst`. Look-alikes: "Same person" (asks which name to keep, writes `Merge`) or "Two people" (writes `Distinct`). Public scenes: each with "Only those present" (writes `Narrow`). A subject's page gains "Split" (pick the facts that belong to the second person and give a label) with a confirmation, and "Add a fact" and "Remove" with a confirmation on Remove. Every ruling saves the log and redraws from a fresh replay. Lists are paged at 20.
- [ ] **Step 2: Add the Audit tab.** It shows 30 facts, each beside the text of the message it cites, with Right and Wrong buttons, a running tally, and "Save audit". The seed is shown and can be changed to draw a different 30.
- [ ] **Step 3: Write the tests.**

  | Test | Must hold |
  |---|---|
  | `choosing a value pins it` | choosing 35 for Yselle's age writes a `Pin`, saves, and the conflict leaves the list |
  | `keep the first value clears every conflict` | two conflicts become none in one action |
  | `merge and distinct clear a look-alike` | each leaves the list empty and the subject count is 1 and 2 respectively |
  | `narrowing a public scene changes an audience` | a fact whose audience was `Everyone` then lists only those present |
  | `the audit draws thirty and is repeatable` | the same seed gives the same 30 ids; a different seed differs; a book with 12 facts gives 12 |
  | `the audit shows the cited message` | each row's message text is the text at that fact's position |
  | `the audit excludes facts that are not in force or not from the story` | no `Disputed`, `Expired`, `Notes` or `Operator` fact is drawn |
  | `remove asks first` | Remove does nothing until confirmed |

- [ ] **Step 4: Run** `node --test tests/scribe-*.test.mjs`. Expected: every scribe test passing; the count is reported.
- [ ] **Step 5: Write the README section** "Scribe engine bench": copying an export into `scribe/private/` under a name beginning `campaign-`, starting the server, the address, and what each tab is for. State plainly that the bench is a development tool and not the scribe.
- [ ] **Step 6: Write the verification record** with the automated results filled in and these left for the operator: adopt the 1,326-message export from first message to last; record total time, cost and refused lines; rule on what blocks; audit 30 facts and record how many were wrong; note anything the Book or Timeline got wrong. The plan's acceptance is: the run completes without the operator repairing anything, every in-force fact cites a message that exists, and no more than 2 of the 30 audited facts are wrong.
- [ ] **Step 7: Hand off.** After the commit the operator performs the acceptance run. Its numbers replace the design's estimates through a document change the operator approves.

---

## Plan self-review

- **Coverage of the design's Step 0 and the offline part of Step 1.** Step 0 observer: Task 1. Log and replay: Tasks 5 to 7. Subjects with identity, split and merge: Tasks 5 and 7. The four category kinds, conflicts, stale relations: Task 5. Notes lifted and filed as the operator's statements: Tasks 3, 9, 11. Scenes with attendance and reach, nights, condition expiry: Task 6. Who knows what, with public reaching everyone and narrowing: Task 8. Rulings and "keep the first value": Tasks 7 and 14. Citations by message id with a readable position: Task 5 stores ids, Task 9 shows positions. Refusing a category outside the list: Tasks 2 and 4. Safety rules 1 to 6: Tasks 10 and 11. Fingerprints for reload, edit and catch-up: Task 3 `changed`, Task 7 `withdraw`. The thirty-fact check: Task 14.
- **Deliberately not in this plan:** storage in the Worker, the meter held in the Worker, the lease for two desktops, capturing live replies, the side panel, the Scribe, reminders, the pedant, suggestions. The bench's budget field is a local stand-in for the caps.
- **One place this plan is simpler than the design.** The design refuses a citation range that crosses from one scene into another. Here a range is always read as its first message, so there is nothing to cross and no such refusal exists.
- **A gap this plan leaves open on purpose.** The design has a note that disagrees with the story become a ruling. Here a note's facts are filed with origin `Notes` and take part in the Fixed comparison like any other, so a disagreement surfaces as a Conflict. Whether a note and a story fact should instead be shown as a distinct kind of ruling is left until the operator has seen real conflicts in the bench.
- **Names checked across tasks:** `ScribeLog.append` takes `(log, state, operations, { messages, origin })` everywhere; `ScribeReplay.run(log, order)`; `ScribeAdoption.run`'s `ask` returns `{ text, cost }`; State field names match Shared shapes in Tasks 5 to 9, 13 and 14.
