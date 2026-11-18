# Zeta Scribe: three checker false alarms

Date: 2026-11-18
Status: revised 2026-11-18 after two adversarial reviews. The operator chose to let the model judge name spellings ("Let the model judge and i can already rule. As long as I can change book data myself to update the model"). Location and leak parts unchanged from the first approval ("Go").

## Why

On the operator's room `/en/rooms/45359def-...`, 2026-11-18, the Findings tab raised:

1. `Name spelt another way: "Fine" in the reply; the book has Nine Quarter.` The spelling check (`ScribePedant.spellings`, no model) compares every capitalised word of the reply with every word of every name in the book; `Fine` is one letter from `Nine` of the place `Nine Quarter`.
2. `The reply contradicts the book: Frost, location: ... apartment in the Nine Quarter of Lakama town; the reply says kitchen.` Earlier the same with `cramped apartment`. Location is a scene fact; it changes with the story.
3. `Someone knows what they were not told: Selene uses ...` for a reply where Selene only reads Frost's reaction. Rule 3 counts a line that "states, uses or reacts to" a secret.

The first approved fix for 1 (word rules: lower-case words in the chat are ordinary, multi-word names matched as whole runs) was built and reviewed twice. Each round of rules opened new false alarms (`Will` against `Old Mill`, `Leon` against `Red Lion`) or new misses (`Thieves’ Gild` with a curly apostrophe). A letter-distance rule cannot tell an English word or a new name from a misspelling.

## Goal

None of the three alarms above is raised again; a misspelt name is still caught.

## Non-goals

No change to findings' display, rulings, the reminder, the book, or any other check.

## Approaches for alarm 1

- A. Keep refining word rules. Rejected after two review rounds.
- **B. Chosen by the operator.** The existing word check (as it was before this work) finds candidates; the checker model confirms which candidates (in the call the checker already makes; a reply with candidates and no facts to check makes one call where it made none) are real misspellings of a known name. Ordinary words and new names are dropped by the model.

## Design

1. **Candidates.** `ScribePedant.spellings` is restored to its behaviour before this work (the code at the commit before Task 1). Its results are candidates, no longer findings.
2. **The model confirms.** The checker input gains a section `NAME CANDIDATES`, one line per candidate: `N<k> | <known name label> | <the word of that name it looks like> | <word as written in the reply>`, numbered from 1 in the order `spellings` returns them. The prompt gains an answer block `=== MISSPELLINGS` holding the numbers of the confirmed candidates, one per line (`N3`), and a rule:
   `6. A misspelling is a word in the REPLY that is meant as the listed known name but is written another way. An ordinary word, a word at the start of a sentence that is not meant as the name, and a different or new name are not misspellings. Report only numbers from NAME CANDIDATES. In the MISSPELLINGS block write only the numbers of the misspellings, one per line, nothing else on the line.`
   A MISSPELLINGS line counts only when it consists solely of candidate numbers separated by commas, semicolons, spaces or `and`; any other text on the line voids it.
   Only confirmed candidates become Spelling findings, with the same fields as today.
3. **When the call is made.** The checker calls the model when the ledger is not empty (as today) or when there is at least one candidate. A reply with no ledger and no candidates makes no call, as today.
4. **When the call fails** (no key, budget reached, network), no Spelling finding is raised for that reply and the failure propagates: the live layer raises nothing for it and shows the problem; findings of unchanged replies are kept, and an edited or regenerated reply's old findings go, as they always have. The new text is checked when the model is back and the reply is shown again, not on a timer and not after a reload; a check refused because the budget ran out during it is checked again when the budget frees. A false alarm is worse than a missed one.
5. **The operator stays in charge of the names.** The model is given the book's names on every call, so what the operator changes in the book (a name added on the Book tab or through Tell the scribe, a merge, a ruling) applies from the next reply. A dismissed finding stays dismissed by the existing key.
6. **Location is never checked for contradictions.** Facts of category `location` are left out of the contradiction candidates in `ScribePedant.survey`. (`condition` is already left out.) Location facts stay in the ledger when a leak check needs them. Unchanged from the first approval; built and reviewed twice with no defect.
7. **A leak must state or use the secret.** Rule 3 drops "or reacts to". Unchanged from the first approval; built and reviewed twice with no defect.
8. **Removed from the working tree:** the run matching, the lower-case word set and its cache, the `messages` argument of `review` and `spellings`, the `messages: view.messages` line in `ScribeLive.js`, and their tests. None of it shipped.

Findings already raised and stored stay until dismissed or until their reply changes.

## Tests that try to break it

See the plan, `docs/superpowers/plans/2026-11-18-scribe-checker-fixes.md`.
