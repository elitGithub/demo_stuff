export const WitnessFilter = Object.freeze({
  /**
   * @param {{turns: ReadonlyArray<object>, characterId: string, maxTurns: number}} options
   * @returns {ReadonlyArray<Readonly<{turnId: string, seq: number, role: string, mode: string, sceneNumber: number, beats: ReadonlyArray<Readonly<{id: string, seq: number, speakerType: string, characterId: string | null, speakerName: string, text: string}>>}>>}
   * @throws {TypeError | RangeError}
   */
  selectWitnessedBeats(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('WitnessFilter options must be a plain object.');
    }

    const { turns, characterId, maxTurns } = options;

    if (!Array.isArray(turns)) {
      throw new TypeError('turns must be an array.');
    }
    if (typeof characterId !== 'string' || characterId.trim().length === 0) {
      throw new RangeError('characterId must be a non-empty string.');
    }
    if (!Number.isInteger(maxTurns) || maxTurns <= 0) {
      throw new RangeError(`maxTurns must be a positive integer: ${String(maxTurns)}`);
    }

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

    const witnessedTurns = [];
    for (const turn of sortedTurns) {
      const rawBeats = Array.isArray(turn.beats) ? [...turn.beats] : [];
      const matchingBeats = rawBeats
        .filter((beat) => {
          return (
            beat !== null &&
            typeof beat === 'object' &&
            Array.isArray(beat.witnessIds) &&
            beat.witnessIds.includes(characterId)
          );
        })
        .sort((leftBeat, rightBeat) => (leftBeat.seq ?? 0) - (rightBeat.seq ?? 0))
        .map((beat) => {
          return Object.freeze({
            id: beat.id,
            seq: beat.seq,
            speakerType: beat.speakerType,
            characterId: beat.characterId ?? null,
            speakerName: beat.speakerName,
            text: beat.text,
          });
        });

      if (matchingBeats.length === 0) {
        continue;
      }

      witnessedTurns.push(
        Object.freeze({
          turnId: turn.id,
          seq: turn.seq,
          role: turn.role,
          mode: turn.mode,
          sceneNumber: turn.sceneNumber,
          beats: Object.freeze(matchingBeats),
        }),
      );
    }

    return Object.freeze(witnessedTurns.slice(-maxTurns));
  },
});
