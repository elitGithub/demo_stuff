import { SceneType } from '../store/enums/SceneType.mjs';
import { TurnMode } from '../store/enums/TurnMode.mjs';

export const EncounterRoller = Object.freeze({
  /**
   * @param {() => number} random
   * @returns {number}
   * @throws {RangeError}
   */
  rollUnit(random) {
    const value = random();
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError(`random() must return a finite number in [0, 1): ${String(value)}`);
    }
    return value;
  },

  /**
   * @param {{mode: string, sceneType: string, publicOdds: number, privateOdds: number, absentCast?: ReadonlyArray<unknown>, random?: () => number}} options
   * @returns {Readonly<{triggered: boolean, forced: boolean, plausibilityRequired: boolean, targetKind: 'cast' | 'stranger' | null, stance: 'enemy' | 'friendly' | 'chatter' | null}>}
   * @throws {TypeError | RangeError}
   */
  rollEncounter(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Encounter options must be a plain object.');
    }

    const {
      mode,
      sceneType,
      publicOdds,
      privateOdds,
      absentCast = [],
      random = Math.random,
    } = options;

    TurnMode.label(mode);
    SceneType.label(sceneType);

    if (!Number.isInteger(publicOdds) || publicOdds < 0) {
      throw new RangeError(`publicOdds must be a non-negative integer: ${String(publicOdds)}`);
    }
    if (!Number.isInteger(privateOdds) || privateOdds < 0) {
      throw new RangeError(`privateOdds must be a non-negative integer: ${String(privateOdds)}`);
    }
    if (!Array.isArray(absentCast)) {
      throw new TypeError('absentCast must be an array.');
    }
    if (typeof random !== 'function') {
      throw new TypeError('random must be a function.');
    }

    if (mode === TurnMode.Narrator) {
      return Object.freeze({
        triggered: false,
        forced: false,
        plausibilityRequired: false,
        targetKind: null,
        stance: null,
      });
    }

    if (mode === TurnMode.Normal) {
      const odds = sceneType === SceneType.Private ? privateOdds : publicOdds;
      if (odds <= 0) {
        return Object.freeze({
          triggered: false,
          forced: false,
          plausibilityRequired: false,
          targetKind: null,
          stance: null,
        });
      }
      const rollHit = EncounterRoller.rollUnit(random);
      if (rollHit >= 1 / odds) {
        return Object.freeze({
          triggered: false,
          forced: false,
          plausibilityRequired: false,
          targetKind: null,
          stance: null,
        });
      }
    }

    const rollTarget = EncounterRoller.rollUnit(random);
    const rollStance = EncounterRoller.rollUnit(random);
    const targetKind = absentCast.length > 0 && rollTarget < 1 / 3 ? 'cast' : 'stranger';
    let stance = 'chatter';
    if (rollStance < 1 / 3) {
      stance = 'enemy';
    } else if (rollStance < 2 / 3) {
      stance = 'friendly';
    }

    return Object.freeze({
      triggered: true,
      forced: mode === TurnMode.Encounter,
      plausibilityRequired: mode === TurnMode.Normal,
      targetKind,
      stance,
    });
  },
});
