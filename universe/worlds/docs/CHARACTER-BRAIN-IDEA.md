# The character brain: the operator's root idea and notes

Recorded 2026-11-26 at the operator's request, so it travels with the code. Everything below the first section is the
operator's collected research, copied as given. It is background, not rulings: each design decides which parts are
built and how (output formats included), and the operator rules on each.

## Root idea (operator, verbatim)

"The root idea is this: I want to create a sort of 'brain' for my AI characters. The models behind the scenes get a
unified, specific prompt that's partially based on TST's structure, the Vocalia protocol, and my ideas to make it so
the characters actually have their own thoughts, goals, ideas, and tone."

## Where it already shows up

- `docs/superpowers/specs/2026-11-24-worlds-poc-design.md`: why Worlds exists, the three character tiers, witness
  isolation, two memory layers.
- `docs/superpowers/specs/2026-11-25-reply-tuning-design.md`, "Operator's intent" and "Project split": project 1 is
  request assembly and one request per character; project 2 is the character brain (inner monologue as a budgeted
  summary, reflection ("dream") into beliefs at scene breaks, possibly a Thinker pass and mood meters, timed runs for
  characters not in the scene); project 3 is the book pass at intervals.

## Note 1: five patterns for a character brain (pasted by the operator, 2026-11-26)

To turn an LLM into an actual character brain—rather than a passive text completer—you move beyond passive memory
retrieval into cognitive architecture: decoupling what the character knows, thinks, and wants from what they actually
say out loud.

These five high-leverage patterns achieve this without inflating your token budget:

### 1. The "Talker / Thinker" Split (Async Subconscious)

Instead of forcing one massive prompt to both track deep motivation and write snappy prose, split the brain into two
passes—an architecture formalized in recent conversational agent research like MIRROR:

- The Talker (Fast, Foreground): Handles immediate dialogue and prose using a lean context window.
- The Thinker (Async, Background): Runs after your turn is sent (while the user is reading and typing). A background
  model reads the last exchange and updates a tiny 100-token `<subconscious>` block covering three questions: What is
  the user really trying to do? How does that clash with my goals? What am I hiding?

Why it saves tokens: You never need long chain-of-thought reasoning inside the main prompt. The Thinker distills
complex psychological subtext into 3–4 crisp sentences injected right before the next reply.

### 2. Hidden Pre-Turn Scratchpad (Private Inner Monologue)

If you want single-pass generation without an async worker, force the model to generate a private `<thought>` block
before its spoken reply, then strip that block out of the saved history before the next turn:

- Prompt rule: "Before speaking, write 2–3 sentences inside `<inner_monologue>` assessing your current emotion, secret
  agenda, and what you refuse to say out loud. Then write your visible response."
- History pruning: Your app parses out `<inner_monologue>` to display (or hide) in the UI, and never feeds old
  monologues back into subsequent API calls.

Why it works: The character gets full reasoning power on the current turn—preventing sycophancy and sudden personality
drift—at zero cumulative token cost over a 1,000-turn chat.

### 3. Finite State Machines (FSM) for Mood & Relationship Phases

LLMs drift toward bland agreeableness over time because raw chat history averages out their tone. Counteract this with
deterministic state variables outside the LLM:

- Maintain numeric or enum trackers in your database (e.g., trust: -10 to +10, alert_level: calm | suspicious |
  hostile, patience: 3).
- Map each state to a 2-line behavioral directive swapped into the prompt dynamically:
  - If trust < -3: "You suspect the user is setting a trap. Give short, evasive answers and demand proof before sharing
    information."
  - If trust > 5: "You speak candidly and volunteer useful warnings without being asked."

Why it saves tokens: Instead of keeping 50 old messages in context just to prove "we had an argument earlier," a
25-token behavioral rule enforces the emotional consequence deterministically.

### 4. Tool-Use Memory ("Active Recall" Instead of Passive Injection)

Rather than guessing what memories to cram into every prompt via RAG, give the character SQLite/JSON lookup tools
(`recall_person(name)`, `check_journal(topic)`, `inspect_inventory()`)—the same paradigm used by memory-as-OS runtimes
like Letta:

- How it works: Keep the base prompt tiny (only core persona + last 6–8 messages). When the user asks, "Hey, didn't we
  meet a blacksmith in Oakhaven?", the model triggers `recall_person("blacksmith")`, pulls the 80-token database row,
  and answers accurately.
- Turn-scoped pruning: Drop the tool call and tool output from the history after 2–3 turns once the fact has been
  woven into dialogue.

Why it saves tokens: Zero lore or memory tokens are spent on normal banter turns; tokens are only burned on the exact
turn a memory is needed.

### 5. Periodic "Sleep / Reflection" Consolidation

Inspired by Stanford's Generative Agents and modern episodic-to-semantic memory pipelines, run a lightweight
consolidation job at natural scene breaks (e.g., when characters travel, rest, or end a session):

- Feed the last 20–30 messages into a background call with one prompt: "Extract 2–3 permanent beliefs, lessons, or
  grudges this character formed from this scene."
- Save those as short core beliefs (e.g., "Believes the user prioritizes gold over loyalty"), replacing raw episodic
  logs.

Why it works: Humans don't remember every word of a conversation from last week—they remember the conclusion they drew
from it. Storing conclusions instead of transcripts compresses 5,000 tokens of dialogue into 40 tokens of durable
character growth.

### How They Fit Together Without Bloat

| Layer | Mechanism | Token Cost per Turn |
|---|---|---|
| Core Identity | Static Character Card + Voice Examples (KV-cached) | ~600–900 (cached) |
| Emotional Engine | Deterministic FSM directive (trust / mood state) | ~40 |
| Subconscious | Async Thinker note or stripped `<inner_monologue>` | ~80 (ephemeral) |
| World & Past | Tool-use lookups (`recall_*`) + consolidated beliefs | ~0–150 (on demand) |
| Immediate Context | Sliding window of last 8–12 turns | ~1,500–2,500 |

Total active payload stays locked around 2.5k–4k tokens—fast, cheap, and far sharper than stuffing 100k tokens of raw
history into a single prompt.

## Note 2: structured state schema and background extraction

Copied from the operator's file `universe/local/Design a structured JSON state schema and backgro....txt` (gitignored,
so it does not travel on its own).

To keep roleplay continuity sharp without bloating your context window, the structured state needs to capture hard
facts and current deltas rather than prose summaries. Prose summaries suffer from "JPEG compression" over repeated
rewrites; a flat, strictly typed JSON object forces the background model to overwrite obsolete states instead of
endlessly appending text.

### 1. The Compact State Schema (~350–600 Tokens)

Keep the schema flat, cap array lengths explicitly, and separate mutable scene state (changes every few turns) from
durable campaign facts (changes rarely).

```json
{
 "scene": {
   "location": "The Rusty Anchor tavern, lower docks (rainy night)",
   "time_elapsed": "Day 3, ~11:00 PM",
   "present_characters": ["Lyra", "Bram", "Tavernkeeper Torin"],
   "immediate_situation": "Negotiating passage out of the city before the harbor patrol arrives."
 },
 "entities": {
   "User": {
     "physical_state": "Bruised left ribs; soaked cloak; fatigued",
     "inventory_notable": ["Silver harbor pass (forged)", "14 gold coins", "Dagger"],
     "active_goals": ["Secure a boat to Oakhaven", "Hide the forged pass from guards"]
   },
   "Lyra": {
     "physical_state": "Uninjured, alert",
     "disposition_toward_user": "Guarded ally (trusts user's skill, suspects user is hiding something)",
     "active_goals": ["Collect half her payment upfront"]
   }
 },
 "active_threads": [
   {
     "id": "t1",
     "summary": "Harbor patrol is searching dockside taverns for the missing courier.",
     "status": "urgent"
   },
   {
     "id": "t2",
     "summary": "Promised to deliver the sealed ledger to Magistrate Vance in Oakhaven.",
     "status": "active"
   }
 ],
 "established_facts": [
   "Lyra's brother was arrested by the harbor watch last winter.",
   "The forged pass fails inspection if checked against the main ledger."
 ]
}
```

Why Each Field Earns Its Tokens

- scene: Stops the model from hallucinating daytime during a midnight scene or forgetting an NPC walked out of the room
  three turns ago.
- entities (keyed by name): Tracks injuries, critical items, and attitude/disposition. Storing disposition explicitly
  prevents the classic LLM failure mode where a hostile NPC suddenly acts friendly after 20 turns of banter.
- active_threads: Tracks open promises, timers, and unresolved quests. Completed threads get pruned so they don't eat
  tokens forever.
- established_facts: A hard-capped list (e.g., max 10–12 one-line strings) for irrevocable lore or secrets revealed
  during play. When full, the extractor must drop the least relevant fact to add a new one.

### 2. The Background Extraction Prompt

Run this asynchronously whenever a chunk of messages is evicted from your sliding window (or every ~8–10 turns) using a
fast, cheap JSON-capable model (e.g., gpt-4o-mini, claude-3-5-haiku, gemini-2.5-flash, or a local 8B/12B model with
structured outputs enabled).

Pass in only two inputs: the current_state_json and the newly_evicted_messages. Do not pass the whole history.

```text
You are a state-tracking engine for an interactive roleplay session. Your job is to update a structured JSON state object based on a batch of newly transpired dialogue.

### RULES
1. **Overwrite, don't append:** Replace outdated locations, physical states, and dispositions with their current values.
2. **Strict brevity:** Keep every string concise and factual (under 15 words). No narrative prose, metaphors, or filler.
3. **Prune dead weight:** Remove items that were consumed/lost, characters who left the scene, and threads marked "resolved".
4. **Hard caps:**
  - `entities`: Keep only the User and up to 4 most relevant active characters.
  - `active_threads`: Max 5 items. Drop resolved or trivial threads.
  - `established_facts`: Max 10 one-sentence facts. Only add permanent lore, secrets, or major commitments. If at 10, replace the least relevant fact.
5. **No hallucination:** Only record facts explicitly stated or directly implied in the transcript. If nothing changed in a field, preserve the existing value verbatim.

### CURRENT STATE
{{CURRENT_STATE_JSON}}

### NEW TRANSCRIPT SEGMENT
{{EVICTED_MESSAGES}}

### OUTPUT
Return ONLY valid JSON matching the exact schema of CURRENT STATE. Do not include markdown fences or commentary.
```

### 3. Where to Inject It in the Main Payload

You have two placement options depending on how aggressively you want to protect your KV-cache:

1. Cache-Friendly Placement (Recommended): Place the state block right below your static Character Card and only
   update it when chunked eviction happens (e.g., once every 12–15 turns). Between evictions, the top of your prompt
   stays 100% byte-identical, preserving prefix cache hits across the entire sliding window.
2. Recency-Biased Placement: Inject it 2–3 messages above the bottom of the chat history (alongside your Author's
   Note). The model adheres to it slightly more strictly here, at the cost of invalidating the cache for the final 2–3
   turns—which is usually negligible (~300 tokens).

Format the injected block cleanly as XML or Markdown so the main roleplay model treats it as ground truth without
parroting JSON syntax in its replies:

```xml
<story_state>
Location: The Rusty Anchor tavern, lower docks (rainy night) | Time: Day 3, ~11:00 PM
Present: Lyra, Bram, Tavernkeeper Torin
Situation: Negotiating passage out of the city before the harbor patrol arrives.
- User: Bruised left ribs; soaked cloak | Items: Silver harbor pass (forged), 14 gold, Dagger | Goal: Secure a boat to Oakhaven
- Lyra: Guarded ally (suspects user is hiding something) | Goal: Collect half payment upfront
Open Threads: [URGENT] Harbor patrol searching dockside taverns; Deliver sealed ledger to Magistrate Vance.
Key Facts: Lyra's brother was arrested by harbor watch last winter; Forged pass fails main ledger check.
</story_state>
```

Converting the stored JSON into a compact key-value text block at render time saves an extra ~25–30% tokens compared
to feeding raw braces and quotes to the main model, while keeping your database storage strictly structured and easy
to validate.
