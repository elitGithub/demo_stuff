import { WitnessFilter } from './WitnessFilter.mjs';

export const HistoryWindow = Object.freeze({
  Settings: Object.freeze({
    LineSeparator: '\n',
    SpeakerSeparator: ': ',
    EmptyText: '',
  }),

  /**
   * @param {{turns: ReadonlyArray<object>, characterId?: string | null, maxTurns: number, budget: {limitTokens: number | null, estimate: (text: string) => number, fits: (usedTokens: number, text: string) => boolean}, usedTokens?: number}} [options]
   * @returns {Readonly<{text: string, tokens: number, turnCount: number}>}
   * @throws {TypeError | RangeError | Error}
   */
  build(options = {}) {
    if (
      options === null ||
      typeof options !== 'object' ||
      Array.isArray(options) ||
      (Object.getPrototypeOf(options) !== Object.prototype && Object.getPrototypeOf(options) !== null)
    ) {
      throw new TypeError('HistoryWindow options must be a plain object.');
    }

    const { turns, characterId = null, maxTurns, budget, usedTokens = 0 } = options;

    if (!Array.isArray(turns)) {
      throw new TypeError('turns must be an array.');
    }
    let trimmedCharacterId = null;
    if (characterId !== null) {
      if (typeof characterId !== 'string') {
        throw new TypeError('characterId must be null or a non-empty string.');
      }
      trimmedCharacterId = characterId.trim();
      if (trimmedCharacterId.length === 0) {
        throw new RangeError('characterId must be null or a non-empty string.');
      }
    }
    if (typeof maxTurns !== 'number') {
      throw new TypeError('maxTurns must be a positive integer.');
    }
    if (!Number.isInteger(maxTurns) || maxTurns <= 0) {
      throw new RangeError(`maxTurns must be a positive integer: ${String(maxTurns)}`);
    }
    if (
      budget === null ||
      typeof budget !== 'object' ||
      Array.isArray(budget) ||
      typeof budget.estimate !== 'function' ||
      typeof budget.fits !== 'function'
    ) {
      throw new TypeError('budget must provide estimate(), fits(), and limitTokens.');
    }
    if (budget.limitTokens !== null) {
      if (typeof budget.limitTokens !== 'number') {
        throw new TypeError('budget.limitTokens must be null or a non-negative integer.');
      }
      if (!Number.isInteger(budget.limitTokens) || budget.limitTokens < 0) {
        throw new RangeError('budget.limitTokens must be null or a non-negative integer.');
      }
    }
    if (typeof usedTokens !== 'number') {
      throw new TypeError('usedTokens must be a finite non-negative number.');
    }
    if (!Number.isFinite(usedTokens) || usedTokens < 0) {
      throw new RangeError('usedTokens must be a finite non-negative number.');
    }

    let candidateTurns;
    if (trimmedCharacterId !== null) {
      candidateTurns = WitnessFilter.selectWitnessedBeats({
        turns,
        characterId: trimmedCharacterId,
        maxTurns,
      });
    } else {
      const sortedTurns = [...turns];
      for (const turn of sortedTurns) {
        if (turn === null || typeof turn !== 'object' || Array.isArray(turn)) {
          throw new TypeError('Each turn must be an object.');
        }
        if (!Number.isInteger(turn.seq)) {
          throw new RangeError('Each turn must have an integer seq.');
        }
      }
      sortedTurns.sort((leftTurn, rightTurn) => leftTurn.seq - rightTurn.seq);

      const nonEmptyTurns = [];
      for (const turn of sortedTurns) {
        const rawBeats = Array.isArray(turn.beats) ? turn.beats : [];
        const cleanBeats = rawBeats
          .filter((beat) => {
            return (
              beat !== null &&
              typeof beat === 'object' &&
              !Array.isArray(beat) &&
              typeof beat.speakerName === 'string' &&
              typeof beat.text === 'string'
            );
          })
          .sort((leftBeat, rightBeat) => (leftBeat.seq ?? 0) - (rightBeat.seq ?? 0))
          .map((beat) => ({
            speakerName: beat.speakerName,
            text: beat.text,
          }));
        if (cleanBeats.length > 0) {
          nonEmptyTurns.push({ beats: cleanBeats });
        }
      }
      candidateTurns = nonEmptyTurns.slice(-maxTurns);
    }

    const settings = HistoryWindow.Settings;
    const candidateTurnTexts = candidateTurns.map((turn) => {
      return turn.beats
        .map((beat) => `${beat.speakerName}${settings.SpeakerSeparator}${beat.text}`)
        .join(settings.LineSeparator);
    });

    const selectedReversed = [];
    for (let turnIndex = candidateTurnTexts.length - 1; turnIndex >= 0; turnIndex -= 1) {
      const candidateJoinedText = [...selectedReversed, candidateTurnTexts[turnIndex]]
        .reverse()
        .join(settings.LineSeparator);
      if (!budget.fits(usedTokens, candidateJoinedText)) {
        break;
      }
      selectedReversed.push(candidateTurnTexts[turnIndex]);
    }

    const selected = selectedReversed.reverse();
    const text = selected.length === 0 ? settings.EmptyText : selected.join(settings.LineSeparator);
    return Object.freeze({
      text,
      tokens: budget.estimate(text),
      turnCount: selected.length,
    });
  },
});
