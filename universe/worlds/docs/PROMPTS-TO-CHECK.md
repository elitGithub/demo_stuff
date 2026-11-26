# Prompts to check

The operator's list (2026-11-26): "I want to be sure these pipelines are functional." Each LLM pipeline in Worlds,
what is known to go wrong, and what to check. Nothing here is decided; fixes go to the operator first.

## Pipelines

| Pipeline | Code | Model slot | Status |
|---|---|---|---|
| Director | `src/engine/Director.mjs` | `director` | Replaced by the tagged Director (reply tuning Task 5); not checked |
| Character Mind | `src/engine/CharacterMind.mjs` | `main` / `recurring` | Replaced by CharacterBrain (Task 6); known failure below |
| Narrator Composer | `src/engine/NarratorComposer.mjs` | `composer` | Replaced by Narrator (Task 6); known failure below |
| Scribe | `src/scribe/ScribeAnalyzer.mjs`, `ScribeService.mjs` | `scribe` | Not checked |
| Pedant | `src/scribe/PedantService.mjs` | `scribe` (no own slot, `:109-111`) | Known failures below |
| Muse | `src/scribe/MuseService.mjs` | `scribe` (no own slot, `:204-205`) | Not checked |

## Known failures

### Pedant: a character's own name filed as a misspelling of another (2026-11-26, operator's screenshots)

- Findings: "Collete" may be a misspelling of Lize; "Collette-chan" may be a misspelling of Lize.
- The request did carry the answer: the subject roster (`PedantService.mjs:236-238`) lists every book subject with
  its ID and aliases. In the seeded Hero Gone book, Collette is S3 with aliases "Collette Mardeguere" and
  "Collette-chan" (checked in the Zeta export); Lize is S2.
- The code files whatever subject ID the model writes (`:448-451`), with no check.
- The Pedant runs on the Scribe slot; its default is `cognitivecomputations/dolphin-mistral-24b-venice-edition`,
  which the Zeta spikes already ruled out for who-knows-what. The model in use at the time is not known.
- Likely failure (unverified): the model gave the line's speaker (Lize, addressing Collette) as the "intended
  subject".
- To check: the raw Pedant reply in `local/model-replies.log` (agents may read headers only; the operator reads it
  or allows that one entry); which model the Scribe slot held; the wording of rule 6 (`:36`).
- Proposed code checks, not ruled: refuse a misspelling whose written name is a known name or alias of any
  subject, or that does not appear in the reply.

### Pedant: the prompt's example line copied back as a quote (2026-11-26, same screenshots)

- Finding: Contradicts Lize's trait "eager for public affection after years of secrecy"; quote: "the words of the
  reply that say otherwise".
- That text is the format example in the Pedant's instructions (`PedantService.mjs:24`:
  `F12 | Label | category | the words of the reply that say otherwise`). The model copied it; nothing checks that a
  quote appears in the reply.
- Proposed code check, not ruled: refuse any finding whose quote is not found in the reply text.

### Character Mind: malformed JSON aborts the turn (2026-11-25)

- "CharacterMind (Collette) returned malformed JSON after repair retry"; cause unknown. The JSON output goes away
  with reply tuning (tags, a miss never kills the turn: Tasks 5-7).

### Narrator Composer: request over the model's context (2026-11-25)

- ~174k tokens sent to a 131k model on the seeded campaign (every prior scene turn, uncapped,
  `TurnEngine.mjs:773`). Fixed by reply tuning's budgets (Tasks 4 and 7).

### Scribe: default model

- The default Scribe slot model (dolphin-mistral-24b) was ruled out by the Zeta spikes for who-knows-what; the
  operator changes it in Settings (spec decision 14). The Pedant inherits it.
