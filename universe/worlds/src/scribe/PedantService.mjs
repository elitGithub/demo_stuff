import { FindingKind } from '../store/enums/FindingKind.mjs';
import { FindingStatus } from '../store/enums/FindingStatus.mjs';
import { SpendStage } from '../store/enums/SpendStage.mjs';
import { TurnRole } from '../store/enums/TurnRole.mjs';
import { ScribeAnalyzer } from './ScribeAnalyzer.mjs';
import { ScribeAnswer } from './ScribeAnswer.mjs';
import { ScribeCategory } from './ScribeCategory.mjs';
import { ScribeIntakeAdapter } from './ScribeIntakeAdapter.mjs';
import { ScribeKnowledge } from './ScribeKnowledge.mjs';
import { ScribeLogCore } from './ScribeLogCore.mjs';
import { ScribeReplay } from './ScribeReplay.mjs';
import { ScribeText } from './ScribeText.mjs';

export class PedantService {
  static Prompt = Object.freeze([
    'You are the Pedant: a proofreader for an ongoing adult fiction roleplay between consenting adult characters. You never write story.',
    'You receive PLAYER CHARACTER, a LEDGER of facts with their IDs, what speakers DO NOT KNOW, RECENT MESSAGES, messages SINCE THE BOOK WAS LAST READ, the storyteller’s REPLY, and the book’s subject roster with IDs, kinds and aliases.',
    'Find contradictions, leaks and misspelled names in the REPLY.',
    '',
    'Answer with these three blocks, each starting with its === line. Leave a block out if it has nothing. Write nothing else.',
    '',
    '=== CONTRADICTIONS',
    'F12 | Label | category | the words of the reply that say otherwise',
    '=== LEAKS',
    'F7 | Label of the speaker | the words of theirs that show they know it',
    '=== MISSPELLINGS',
    'spelling used in the reply | intended subject ID',
    '',
    'Rules.',
    "1. A contradiction is a statement in the REPLY, about the LEDGER fact's own subject, that cannot be true together with that fact: another age, number, colour, name, place or description of the same thing. Give the fact's id, its subject's label and its category exactly as the LEDGER shows them, and copy the reply's own words for the other value. Never report a fact marked (hidden) as contradicted.",
    '2. More detail about the same thing is not a contradiction. Less detail is not a contradiction. The same thing in other words is not a contradiction. Something the story has plainly changed (a move, a promotion, a wound), in the REPLY or in the messages since the book was last read, is not a contradiction.',
    "3. A leak is a line spoken by a speaker that states or uses a fact listed for that speaker under DOES NOT KNOW. Copy the few words of that speaker's own line that show it, exactly as the REPLY has them. What the narrator says, or what another character says or thinks, is not that speaker's leak.",
    '4. It is not a leak if the speaker was told or shown the fact earlier in the REPLY, or anywhere in the messages since the book was last read.',
    '5. Report only what the REPLY itself shows. Never guess. When in doubt, leave it out.',
    '6. Judge from context whether a name in the REPLY is a misspelling of a known subject. A similar spelling alone is insufficient. Give the written name and intended roster ID, one pair per line.',
  ]).join('\n');

  #store;
  #client;
  #scribeService;
  #modelProvider;

  /**
   * @param {{store: object, client?: object | null, scribeService: object, modelProvider?: ((context: {stage: string, campaignId: string}) => string | Promise<string>) | null}} options
   * @throws {TypeError}
   */
  constructor({ store, client = null, scribeService, modelProvider = null } = {}) {
    if (store === null || typeof store !== 'object') {
      throw new TypeError('store must be a valid StoryStore instance.');
    }
    if (client !== null && (typeof client !== 'object' || typeof client.complete !== 'function')) {
      throw new TypeError('client must be null or an OpenRouterClient with complete().');
    }
    if (scribeService === null || typeof scribeService !== 'object' || typeof scribeService.loadState !== 'function') {
      throw new TypeError('scribeService must be a valid ScribeService instance.');
    }
    if (modelProvider !== null && typeof modelProvider !== 'function') {
      throw new TypeError('modelProvider must be null or a function.');
    }
    this.#store = store;
    this.#client = client;
    this.#scribeService = scribeService;
    this.#modelProvider = modelProvider;
  }

  /**
   * @param {object} state
   * @param {object} fact
   * @returns {boolean}
   */
  isRestricted(state, fact) {
    return ScribeKnowledge.audience(state, fact) !== ScribeKnowledge.Everyone;
  }

  /**
   * @param {{campaignId: string, turn: object, beats?: ReadonlyArray<object> | null, signal?: AbortSignal | null}} options
   * @returns {Promise<Array<object>>}
   * @throws {Error}
   */
  async checkTurn({ campaignId, turn, beats = null, signal = null } = {}) {
    if (typeof campaignId !== 'string' || campaignId.trim().length === 0) {
      throw new RangeError('campaignId must be a non-empty string.');
    }
    if (turn === null || typeof turn !== 'object' || typeof turn.id !== 'string') {
      throw new TypeError('turn must be a valid turn object.');
    }
    if (beats !== null && !Array.isArray(beats)) {
      throw new TypeError('beats must be null or an array.');
    }
    if (signal !== null && (typeof signal !== 'object' || typeof signal.aborted !== 'boolean')) {
      throw new TypeError('signal must be null or an AbortSignal.');
    }

    const turnWithBeats = beats !== null ? { ...turn, beats } : turn;
    if (turnWithBeats.role === TurnRole.User) {
      return [];
    }

    const loaded = this.#scribeService.loadState(campaignId);
    const { log, state, messages, player } = loaded;
    if (state.subjects.length === 0 && state.facts.length === 0) {
      return [];
    }

    if (this.#client === null) {
      throw new Error('OpenRouterClient is required for PedantService.checkTurn().');
    }
    const rawModel = this.#modelProvider !== null
      ? await this.#modelProvider({ stage: SpendStage.Pedant, campaignId })
      : this.#store.getSettings().models.scribe;
    if (typeof rawModel !== 'string' || rawModel.trim().length === 0) {
      throw new Error('Pedant model is not configured.');
    }
    const model = rawModel.trim();

    const campaign = this.#store.getCampaign(campaignId);
    const allCharacters = this.#scribeService.listAllCharacters(campaignId);
    const charactersById = new Map(allCharacters.map((character) => [character.id, character]));

    let message;
    if (beats !== null) {
      message = ScribeIntakeAdapter.fromTurns([turnWithBeats], {
        playerCharacterId: campaign?.playerCharacterId ?? null,
        playerName: player,
      }).messages[0];
    } else {
      message = messages.find((item) => item.id === turnWithBeats.id);
      if (message === undefined) {
        message = ScribeIntakeAdapter.fromTurns([turnWithBeats], {
          playerCharacterId: campaign?.playerCharacterId ?? null,
          playerName: player,
        }).messages[0];
      }
    }

    const speakers = [];
    const seenSpeakerSubjects = new Set();
    for (const block of message.blocks) {
      if (block.role !== ScribeIntakeAdapter.Role.Character) {
        continue;
      }
      if (campaign?.playerCharacterId && block.characterId === campaign.playerCharacterId) {
        continue;
      }
      let character = block.characterId ? charactersById.get(block.characterId) ?? null : null;
      if (character === null) {
        const speakerNorm = ScribeText.normaliseName(block.speaker);
        character = allCharacters.find((candidate) => {
          if (candidate.isPlayer) {
            return false;
          }
          const names = [candidate.name, ...(candidate.aliases ?? [])];
          return names.some((name) => ScribeText.normaliseName(name) === speakerNorm);
        }) ?? null;
      }
      let subject = null;
      if (character !== null && typeof character.scribeSubjectId === 'string' && character.scribeSubjectId.trim().length > 0) {
        const survivorId = ScribeKnowledge.survivor(state, character.scribeSubjectId.trim());
        subject = state.subjects.find((item) => item.id === survivorId && item.mergedInto === null) ?? {
          id: survivorId,
          label: character.name,
          name: character.name,
          kind: ScribeCategory.SubjectKinds.Character,
          aka: character.aliases ?? [],
          mergedInto: null,
        };
      }
      if (subject === null) {
        subject = this.#findSubject(state, block.speaker);
      }
      if (subject === null && character !== null) {
        subject = {
          id: character.id,
          label: character.name,
          name: character.name,
          kind: ScribeCategory.SubjectKinds.Character,
          aka: character.aliases ?? [],
          mergedInto: null,
        };
      }
      if (subject !== null && !seenSpeakerSubjects.has(subject.id)) {
        seenSpeakerSubjects.add(subject.id);
        speakers.push({ character, subject });
      }
    }

    const contestedIds = new Set();
    for (const conflict of state.conflicts) {
      for (const id of [conflict.established, ...conflict.others]) {
        contestedIds.add(id);
      }
    }

    const activeFacts = state.facts.filter((fact) => {
      return fact.status === ScribeReplay.Status.InForce && !contestedIds.has(fact.id);
    });
    const publicFacts = activeFacts.filter((fact) => !this.isRestricted(state, fact));

    const earlierUnread = messages
      .filter((item) => !Object.hasOwn(log.read, item.id) && item.position < message.position)
      .sort((left, right) => left.position - right.position);
    const sinceTranscript = ScribeIntakeAdapter.transcript(earlierUnread);

    const unknownPairs = [];
    for (const speakerEntry of speakers) {
      for (const fact of activeFacts) {
        if (!ScribeKnowledge.knows(state, speakerEntry.subject.id, fact)) {
          unknownPairs.push({ speaker: speakerEntry.subject, fact });
        }
      }
    }

    const ledgerFacts = activeFacts.filter((fact) => {
      return publicFacts.includes(fact) || unknownPairs.some((pair) => pair.fact === fact);
    });

    const seenEarlierIds = new Set(earlierUnread.map((item) => item.id));
    let recentMessages = messages
      .filter((item) => item.position < message.position && !seenEarlierIds.has(item.id))
      .slice(-10);
    while (recentMessages.length > 1 && Array.from(ScribeIntakeAdapter.transcript(recentMessages)).length > 20000) {
      recentMessages = recentMessages.slice(1);
    }
    const recentTranscript = ScribeIntakeAdapter.transcript(recentMessages);

    const labels = ScribeAnalyzer.labels(state);
    const ledgerLines = ledgerFacts.map((fact) => {
      const category = fact.category === ScribeCategory.Settings.RelationCategory
        ? `relation to ${fact.target === null ? fact.targetText : labels.get(fact.target)}`
        : fact.category;
      const base = [fact.id, labels.get(fact.subject), category, fact.text].join(' | ');
      return this.isRestricted(state, fact) ? `${base} (hidden)` : base;
    });
    const unknownLines = unknownPairs.map((pair) => `${pair.speaker.label} does not know ${pair.fact.id}`);
    const rosterLines = state.subjects
      .filter((subject) => subject.mergedInto === null)
      .map((subject) => [subject.id, subject.label, subject.kind, ...subject.aka].join(' | '));

    const sections = [
      ScribeAnalyzer.section('PLAYER CHARACTER:', [player]),
      ScribeAnalyzer.section('SUBJECT ROSTER:', rosterLines),
      ScribeAnalyzer.section('LEDGER:', ledgerLines),
      ScribeAnalyzer.section('DOES NOT KNOW:', unknownLines),
    ];
    if (recentTranscript !== '') {
      sections.push(ScribeAnalyzer.section('RECENT MESSAGES:', [recentTranscript]));
    }
    sections.push(
      ScribeAnalyzer.section('SINCE THE BOOK WAS LAST READ:', sinceTranscript === '' ? [] : [sinceTranscript]),
      ScribeAnalyzer.section(`REPLY (#${message.position}):`, [ScribeIntakeAdapter.transcript([message])]),
    );

    const completion = await this.#client.complete({
      model,
      messages: [
        { role: 'system', content: PedantService.Prompt },
        { role: 'user', content: sections.join('\n\n') },
      ],
      stage: SpendStage.Pedant,
      campaignId,
      signal,
    });

    const parsedContradictions = [];
    const parsedLeaks = [];
    const parsedMisspellings = [];
    const blockAliases = { MISSPELLING: 'MISSPELLINGS' };
    const nonePattern = /^(?:none|\(none\))\.?$/iu;
    const factNumberPattern = /^F0*(\d+)$/iu;
    const candidateNumberPattern = /^N\s*0*([1-9]\d*)$/iu;
    let activeBlock = null;

    for (const rawLine of completion.text.split(ScribeAnswer.Settings.LineBreak)) {
      const cleanedLine = rawLine
        .replace(/\p{Cf}/gu, '')
        .trim()
        .replace(ScribeAnswer.Settings.ListMarkers, '')
        .replace(ScribeAnswer.Settings.Bold, '$1')
        .replace(ScribeAnswer.Settings.ListMarkers, '')
        .trim();
      const letters = cleanedLine.replace(/[^\p{L}]/gu, '').toUpperCase();
      const heading = blockAliases[letters] ?? letters;
      if (['CONTRADICTIONS', 'LEAKS', 'MISSPELLINGS', 'SITUATION', 'NOW'].includes(heading)) {
        activeBlock = heading;
        continue;
      }
      if (cleanedLine === '' || ScribeAnswer.Settings.Fence.test(cleanedLine) || activeBlock === null) {
        continue;
      }
      const unedged = cleanedLine.replace(/^\|\s*|\s*\|$/gu, '');
      if (nonePattern.test(unedged) || nonePattern.test(cleanedLine)) {
        continue;
      }
      if (activeBlock === 'MISSPELLINGS') {
        const names = unedged.split('|').map((field) => field.trim());
        if (names.length === 2 && names.every(Boolean) && !names.every((field) => candidateNumberPattern.test(field))) {
          parsedMisspellings.push({ written: names[0], intended: names[1] });
        }
        continue;
      }
      if (activeBlock !== 'CONTRADICTIONS' && activeBlock !== 'LEAKS') {
        continue;
      }
      const fields = unedged.split('|').map((field) => field.trim());
      const factIdToken = fields[0].replace(/[`\[\]*_]|:+(?=[`\[\]*_]*$)/gu, '').trim();
      const factMatch = factIdToken.match(factNumberPattern);
      if (factMatch === null) {
        continue;
      }
      const factId = `F${factMatch[1]}`;
      if (activeBlock === 'CONTRADICTIONS' && fields.length >= 4) {
        const said = fields.slice(3).join(' | ').trim();
        if (said.length === 0) {
          continue;
        }
        parsedContradictions.push({
          fact: factId,
          label: fields[1],
          category: fields[2],
          said,
        });
      } else if (activeBlock === 'LEAKS' && fields.length >= 3) {
        const words = fields.slice(2).join(' | ').trim();
        if (words.length === 0) {
          continue;
        }
        parsedLeaks.push({
          fact: factId,
          speaker: fields[1],
          words,
        });
      }
    }

    const toInsert = [];
    const dedupeKeys = new Set();

    for (const claim of parsedContradictions) {
      const fact = ScribeLogCore.lookup(state.facts, claim.fact);
      const owner = fact === undefined ? undefined : ScribeLogCore.lookup(state.subjects, fact.subject);
      if (
        fact === undefined ||
        fact.status !== ScribeReplay.Status.InForce ||
        owner === undefined ||
        this.isRestricted(state, fact)
      ) {
        continue;
      }
      const speakerCharacterId = this.#findSpeakerCharacterIdForQuote(message, claim.said, allCharacters, owner.label);
      const item = {
        kind: FindingKind.Contradiction,
        subjectId: owner.id,
        subjectName: owner.label,
        speakerCharacterId,
        factId: fact.id,
        category: fact.category,
        bookText: fact.text,
        summary: `Contradicts ${owner.label}'s ${fact.category}: book states "${fact.text}"`,
        quote: claim.said,
      };
      const dedupeKey = JSON.stringify([item.kind, item.subjectId, item.speakerCharacterId, item.factId, item.quote]);
      if (!dedupeKeys.has(dedupeKey)) {
        dedupeKeys.add(dedupeKey);
        toInsert.push(item);
      }
    }

    for (const claim of parsedLeaks) {
      const fact = ScribeLogCore.lookup(state.facts, claim.fact);
      const owner = fact === undefined ? undefined : ScribeLogCore.lookup(state.subjects, fact.subject);
      const normalizedClaimSpeaker = ScribeText.normaliseName(claim.speaker);
      let speakerEntry = speakers.find((entry) => {
        return (
          entry.subject.id === claim.speaker ||
          entry.subject.label === claim.speaker ||
          ScribeText.normaliseName(entry.subject.label) === normalizedClaimSpeaker ||
          ScribeText.normaliseName(entry.subject.name) === normalizedClaimSpeaker ||
          entry.subject.aka.some((alias) => ScribeText.normaliseName(alias) === normalizedClaimSpeaker)
        );
      }) ?? null;
      if (speakerEntry === null) {
        const matchedSubject = this.#findSubject(state, claim.speaker);
        if (matchedSubject !== null) {
          speakerEntry = speakers.find((entry) => entry.subject.id === matchedSubject.id) ?? null;
        }
      }
      if (
        fact === undefined ||
        fact.status !== ScribeReplay.Status.InForce ||
        owner === undefined ||
        speakerEntry === null
      ) {
        continue;
      }
      const speakerSubject = speakerEntry.subject;
      if (ScribeKnowledge.knows(state, speakerSubject.id, fact)) {
        continue;
      }
      const claimWordsNormalized = ScribeText.words(claim.words).join(' ');
      const speakerBeatMatched = message.blocks.some((block) => {
        if (block.role !== ScribeIntakeAdapter.Role.Character) {
          return false;
        }
        const belongsToSpeaker =
          speakerEntry.character !== null && block.characterId !== null
            ? block.characterId === speakerEntry.character.id
            : [speakerSubject.label, speakerSubject.name, ...(speakerSubject.aka ?? [])].some(
                (name) => ScribeText.normaliseName(name) === ScribeText.normaliseName(block.speaker),
              );
        if (!belongsToSpeaker) {
          return false;
        }
        if (block.text.includes(claim.words)) {
          return true;
        }
        const blockWordsNormalized = ScribeText.words(block.text).join(' ');
        return (
          claimWordsNormalized.length > 0 &&
          ` ${blockWordsNormalized} `.includes(` ${claimWordsNormalized} `)
        );
      });
      if (!speakerBeatMatched) {
        continue;
      }
      const speakerCharacter =
        speakerEntry.character ??
        allCharacters.find((candidate) => candidate.scribeSubjectId === speakerSubject.id) ??
        null;
      const item = {
        kind: FindingKind.SecretLeak,
        subjectId: owner.id,
        subjectName: owner.label,
        speakerCharacterId: speakerCharacter?.id ?? null,
        factId: fact.id,
        category: fact.category,
        bookText: fact.text,
        summary: `${speakerSubject.label} may have leaked ${owner.label}'s ${fact.category}`,
        quote: claim.words,
      };
      const dedupeKey = JSON.stringify([item.kind, item.subjectId, item.speakerCharacterId, item.factId, item.quote]);
      if (!dedupeKeys.has(dedupeKey)) {
        dedupeKeys.add(dedupeKey);
        toInsert.push(item);
      }
    }

    for (const row of parsedMisspellings) {
      const subject =
        state.subjects.find((item) => item.id === row.intended && item.mergedInto === null) ??
        this.#findSubject(state, row.intended);
      if (subject === null || subject === undefined) {
        continue;
      }
      const speakerCharacterId = this.#findSpeakerCharacterIdForQuote(message, row.written, allCharacters, subject.label);
      const item = {
        kind: FindingKind.NameMismatch,
        subjectId: subject.id,
        subjectName: subject.label,
        speakerCharacterId,
        factId: null,
        category: 'aka',
        bookText: subject.label,
        summary: `"${row.written}" may be a misspelling of ${subject.label}`,
        quote: row.written,
      };
      const dedupeKey = JSON.stringify([item.kind, item.subjectId, item.speakerCharacterId, item.factId, item.quote]);
      if (!dedupeKeys.has(dedupeKey)) {
        dedupeKeys.add(dedupeKey);
        toInsert.push(item);
      }
    }

    if (toInsert.length === 0) {
      return [];
    }
    return this.#store.insertFindings(campaignId, turnWithBeats.id, toInsert);
  }

  /**
   * @param {{campaignId: string, findingId: string, action: string, replacementText?: string | null}} options
   * @returns {object}
   * @throws {Error}
   */
  resolveFinding({ campaignId, findingId, action, replacementText = null } = {}) {
    if (typeof campaignId !== 'string' || campaignId.trim().length === 0) {
      throw new RangeError('campaignId must be a non-empty string.');
    }
    if (typeof findingId !== 'string' || findingId.trim().length === 0) {
      throw new RangeError('findingId must be a non-empty string.');
    }
    if (
      action !== FindingStatus.Ruled &&
      action !== FindingStatus.Told &&
      action !== FindingStatus.Dismissed
    ) {
      throw new RangeError(`Invalid finding resolution action: ${String(action)}`);
    }
    if (replacementText !== null && replacementText !== undefined && typeof replacementText !== 'string') {
      throw new TypeError('replacementText must be null or a string.');
    }

    let finding = null;
    let after = null;
    while (finding === null) {
      const page = this.#store.listFindings(campaignId, { limit: 50, after });
      finding = page.items.find((item) => item.id === findingId) ?? null;
      if (finding !== null || page.nextCursor === null) {
        break;
      }
      after = page.nextCursor;
    }
    if (finding === null) {
      throw new RangeError(`Finding not found: ${findingId}`);
    }
    if (finding.status !== FindingStatus.Open) {
      throw new Error(`Finding is already resolved (${finding.status}): ${findingId}`);
    }

    if (action === FindingStatus.Dismissed) {
      return this.#store.resolveFinding(campaignId, findingId, FindingStatus.Dismissed);
    }

    const loaded = this.#scribeService.loadState(campaignId);
    const { log, turns, messages, lastTurnSeq, dirty } = loaded;
    let state = loaded.state;
    const order = turns.map((turn) => ({ id: turn.id, position: turn.seq }));
    const fingerprints = new Map(messages.map((message) => [message.id, message.fingerprint]));

    if (action === FindingStatus.Told) {
      if (typeof finding.factId !== 'string' || finding.factId.trim().length === 0) {
        throw new Error('Cannot apply Told resolution without finding.factId.');
      }
      if (typeof finding.speakerCharacterId !== 'string' || finding.speakerCharacterId.trim().length === 0) {
        throw new Error('Cannot apply Told resolution without finding.speakerCharacterId.');
      }
      const speakerCharacter = this.#store.getCharacter(campaignId, finding.speakerCharacterId);
      if (speakerCharacter === null) {
        throw new Error(`Speaker character not found: ${finding.speakerCharacterId}`);
      }
      let speakerSubjectId = typeof speakerCharacter.scribeSubjectId === 'string' && speakerCharacter.scribeSubjectId.trim().length > 0
        ? speakerCharacter.scribeSubjectId.trim()
        : null;
      const subjectExists = speakerSubjectId !== null && state.subjects.some((subject) => {
        return subject.id === speakerSubjectId && subject.mergedInto === null;
      });
      if (speakerSubjectId === null || !subjectExists) {
        const synced = ScribeLogCore.syncCharacterSubject(log, state, {
          subjectId: speakerSubjectId,
          name: speakerCharacter.name,
          aliases: speakerCharacter.aliases,
          kind: ScribeCategory.SubjectKinds.Character,
        });
        speakerSubjectId = synced.subjectId;
        if (synced.changed) {
          state = ScribeReplay.run(log, order, null, fingerprints, null, null, messages);
        }
      }
      ScribeLogCore.tell(log, state, {
        factId: finding.factId,
        speakerSubjectId,
      });
      this.#store.saveScribeBook(campaignId, {
        bookJson: JSON.stringify(log),
        lastTurnSeq,
        dirty,
      });
      if (speakerCharacter.scribeSubjectId !== speakerSubjectId) {
        this.#store.updateCharacter(campaignId, speakerCharacter.id, { scribeSubjectId: speakerSubjectId });
      }
      return this.#store.resolveFinding(campaignId, findingId, FindingStatus.Told);
    }

    const trimmedReplacement = typeof replacementText === 'string' && replacementText.trim().length > 0
      ? replacementText.trim()
      : null;

    if (trimmedReplacement !== null) {
      const existingFact = typeof finding.factId === 'string' && finding.factId.length > 0
        ? ScribeLogCore.lookup(state.facts, finding.factId)
        : undefined;
      if (
        existingFact !== undefined &&
        [ScribeReplay.Status.InForce, ScribeReplay.Status.Disputed, ScribeReplay.Status.Reported].includes(existingFact.status)
      ) {
        if (existingFact.text !== trimmedReplacement) {
          try {
            ScribeLogCore.rule(log, state, {
              type: ScribeLogCore.Ruling.EditFact,
              fact: existingFact.id,
              expected: ScribeLogCore.editExpected(existingFact, state),
              text: trimmedReplacement,
            });
          } catch (editError) {
            if (editError.message.includes('combine two facts') && !ScribeLogCore.unnamed(existingFact)) {
              ScribeLogCore.rule(log, state, {
                type: ScribeLogCore.Ruling.RemoveFact,
                fact: existingFact.id,
              });
            } else {
              throw editError;
            }
          }
          state = ScribeReplay.run(log, order, null, fingerprints, null, null, messages);
        }
        const refreshedFact = ScribeLogCore.lookup(state.facts, existingFact.id);
        if (
          refreshedFact !== undefined &&
          refreshedFact.status !== ScribeReplay.Status.Removed &&
          ScribeLogCore.categoryKind(refreshedFact.category) === ScribeCategory.Kind.Fixed
        ) {
          ScribeLogCore.rule(log, state, {
            type: ScribeLogCore.Ruling.Pin,
            subject: refreshedFact.subject,
            category: refreshedFact.category,
            ...ScribeCategory.scope(refreshedFact),
            target: null,
            text: trimmedReplacement,
            hidden: refreshedFact.hidden,
          });
        }
      } else {
        if (typeof finding.subjectId !== 'string' || finding.subjectId.trim().length === 0) {
          throw new Error('Cannot apply Ruled replacement without subjectId or live factId.');
        }
        const resolvedSubjectId = ScribeKnowledge.survivor(state, finding.subjectId.trim());
        const category = typeof finding.category === 'string' && finding.category.trim().length > 0
          ? finding.category.trim()
          : 'trait';
        let relationTarget = null;
        if (category === ScribeCategory.Settings.RelationCategory) {
          if (typeof existingFact?.target === 'string' && existingFact.target.trim().length > 0) {
            relationTarget = ScribeKnowledge.survivor(state, existingFact.target.trim());
          } else if (typeof existingFact?.targetText === 'string' && existingFact.targetText.trim().length > 0) {
            relationTarget = this.#findSubject(state, existingFact.targetText)?.id ?? null;
          }
          if (relationTarget === null) {
            throw new Error('Cannot file relation ruling without a target subject.');
          }
        }
        if (ScribeLogCore.categoryKind(category) === ScribeCategory.Kind.Fixed) {
          ScribeLogCore.rule(log, state, {
            type: ScribeLogCore.Ruling.Pin,
            subject: resolvedSubjectId,
            category,
            target: null,
            text: trimmedReplacement,
            hidden: false,
          });
        } else {
          ScribeLogCore.rule(log, state, {
            type: ScribeLogCore.Ruling.AddFact,
            subject: resolvedSubjectId,
            category,
            target: relationTarget,
            text: trimmedReplacement,
            hidden: false,
            cite: null,
            position: 0,
          });
        }
      }
    } else if (typeof finding.factId === 'string' && finding.factId.trim().length > 0) {
      const targetFact = ScribeLogCore.lookup(state.facts, finding.factId.trim());
      if (targetFact === undefined) {
        throw new RangeError(`Fact not found: ${finding.factId}`);
      }
      if (targetFact.made) {
        const pinEntry = log.entries.find((entry) => {
          return (
            entry.kind === ScribeLogCore.Kind.Operator &&
            !entry.withdrawn &&
            entry.operations.some((op) => op.type === ScribeLogCore.Ruling.Pin && op.fact === targetFact.id)
          );
        });
        if (pinEntry === undefined) {
          throw new Error(`Cannot locate Pin entry for fact ${targetFact.id}.`);
        }
        ScribeLogCore.revoke(log, pinEntry.sequence);
      } else {
        ScribeLogCore.rule(log, state, {
          type: ScribeLogCore.Ruling.RemoveFact,
          fact: targetFact.id,
        });
      }
    } else if (
      finding.kind === FindingKind.NameMismatch &&
      typeof finding.subjectId === 'string' &&
      finding.subjectId.trim().length > 0 &&
      finding.quote.trim().length > 0
    ) {
      const resolvedSubjectId = ScribeKnowledge.survivor(state, finding.subjectId.trim());
      ScribeLogCore.rule(log, state, {
        type: ScribeLogCore.Ruling.AddFact,
        subject: resolvedSubjectId,
        category: ScribeLogCore.Settings.AkaCategory,
        target: null,
        text: finding.quote.trim(),
        hidden: false,
        cite: null,
        position: 0,
      });
    } else {
      throw new Error('Cannot resolve finding as Ruled without factId or replacementText.');
    }

    this.#store.saveScribeBook(campaignId, {
      bookJson: JSON.stringify(log),
      lastTurnSeq,
      dirty,
    });
    return this.#store.resolveFinding(campaignId, findingId, FindingStatus.Ruled);
  }

  /**
   * @param {object} state
   * @param {string} written
   * @returns {object | null}
   */
  #findSubject(state, written) {
    const active = state.subjects.filter((subject) => subject.mergedInto === null);
    const direct = active.filter((subject) => subject.id === written || subject.label === written);
    if (direct.length === 1) {
      return direct[0];
    }
    let undressed = written.replace(/\p{Cf}/gu, '').replace(/\t/gu, ' ').replace(/[\s\p{Cc}]+/gu, ' ').trim();
    for (let pass = 0; pass < 4; pass += 1) {
      const next = undressed
        .replace(/^(\*\*|\*|_|`)([\s\S]*)\1$/u, '$2')
        .trim()
        .replace(/^["'“‘]([\s\S]*)["'”’]$/u, '$1')
        .trim()
        .replace(/^(?:\.\.\.|…)/u, '')
        .trim()
        .replace(/(?:\.\.\.|…)$/u, '')
        .trim();
      if (next === undressed) {
        break;
      }
      undressed = next;
    }
    const named = active.filter((subject) => subject.id === undressed || subject.label === undressed);
    if (named.length === 1) {
      return named[0];
    }
    const matches = active.filter((subject) => {
      return subject.name === undressed || subject.aka.includes(undressed);
    });
    return matches.length === 1 ? matches[0] : null;
  }

  /**
   * @param {object} message
   * @param {string} quote
   * @param {ReadonlyArray<object>} allCharacters
   * @param {string} [subjectName]
   * @returns {string | null}
   */
  #findSpeakerCharacterIdForQuote(message, quote, allCharacters, subjectName = '') {
    if (typeof quote !== 'string' || quote.trim().length === 0) {
      return null;
    }
    const quoteWords = ScribeText.words(quote).join(' ');
    const subjectTokens = typeof subjectName === 'string' && subjectName.trim().length > 0
      ? ScribeText.words(subjectName)
      : [];
    const characterBlocks = message.blocks.filter((block) => block.role === ScribeIntakeAdapter.Role.Character);

    let bestCharacterId = null;
    let bestScore = -1;

    for (const block of characterBlocks) {
      const matchesSubstring = block.text.includes(quote);
      const blockWords = ScribeText.words(block.text).join(' ');
      const matchesWords = quoteWords.length > 0 && (` ${blockWords} `).includes(` ${quoteWords} `);
      if (!matchesSubstring && !matchesWords) {
        continue;
      }

      let candidateId = null;
      if (typeof block.characterId === 'string' && block.characterId.length > 0) {
        candidateId = block.characterId;
      } else {
        const blockNorm = ScribeText.normaliseName(block.speaker);
        const matchedChar = allCharacters.find((character) => {
          return [character.name, ...(character.aliases ?? [])].some(
            (alias) => ScribeText.normaliseName(alias) === blockNorm,
          );
        });
        if (matchedChar !== undefined) {
          candidateId = matchedChar.id;
        }
      }
      if (candidateId === null) {
        continue;
      }

      let score = matchesSubstring ? 4 : 2;
      if (subjectTokens.length > 0) {
        const paddedBlockWords = ` ${blockWords} `;
        const mentionsSubject = subjectTokens.some((token) => paddedBlockWords.includes(` ${token} `));
        if (mentionsSubject) {
          score += 2;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestCharacterId = candidateId;
      }
    }

    return bestCharacterId;
  }
}
