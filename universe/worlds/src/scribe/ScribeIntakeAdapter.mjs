import { SpeakerType } from '../store/enums/SpeakerType.mjs';
import { TurnMode } from '../store/enums/TurnMode.mjs';
import { TurnRole } from '../store/enums/TurnRole.mjs';
import { ScribeText } from './ScribeText.mjs';

export const ScribeIntakeAdapter = Object.freeze({
  Role: Object.freeze({
    Player: 'Player',
    Narrator: 'Narrator',
    Character: 'Character',
  }),

  Settings: Object.freeze({
    NarratorName: 'Narrator',
    UnknownPlayer: 'unknown',
    Nothing: '',
    Space: ' ',
    Newline: '\n',
    BlankLine: '\n\n',
    PlayerSuffix: ' (player)',
    SpeakerSeparator: ': ',
    PositionOpen: '[#',
    PositionClose: '] ',
    UnorderedMessage: 'Messages must be given oldest first.',

    /**
     * @returns {RegExp}
     */
    get Whitespace() {
      return /\s+/g;
    },
  }),

  /**
   * @param {string} text
   * @returns {string}
   * @throws {TypeError}
   */
  collapse(text) {
    if (typeof text !== 'string') {
      throw new TypeError('text must be a string.');
    }
    const settings = ScribeIntakeAdapter.Settings;
    return text.replace(settings.Whitespace, settings.Space).trim();
  },

  /**
   * @param {readonly object[]} messages
   * @returns {string}
   * @throws {TypeError}
   */
  transcript(messages) {
    if (!Array.isArray(messages)) {
      throw new TypeError('messages must be an array.');
    }
    const settings = ScribeIntakeAdapter.Settings;
    return messages
      .filter((message) => typeof message?.text === 'string' && message.text !== settings.Nothing)
      .map((message) => settings.PositionOpen + message.position + settings.PositionClose + message.text)
      .join(settings.BlankLine);
  },

  /**
   * @param {readonly object[]} turns
   * @param {{playerCharacterId?: string | null, playerName?: string | null}} [options]
   * @returns {Readonly<{messages: readonly object[], player: string}>}
   * @throws {Error}
   */
  fromTurns(turns, options = {}) {
    if (!Array.isArray(turns)) {
      throw new TypeError('turns must be an array.');
    }
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('options must be a plain object.');
    }
    const settings = ScribeIntakeAdapter.Settings;
    const roleEnum = ScribeIntakeAdapter.Role;
    const playerCharacterId = options.playerCharacterId ?? null;
    const configuredPlayerName = typeof options.playerName === 'string' && options.playerName.trim().length > 0
      ? options.playerName.trim()
      : null;

    let previousSeq = 0;
    let detectedPlayerName = configuredPlayerName;
    const messages = [];

    for (const turn of turns) {
      if (turn === null || typeof turn !== 'object' || Array.isArray(turn)) {
        throw new TypeError('Each turn must be an object.');
      }
      if (typeof turn.id !== 'string' || turn.id.trim().length === 0) {
        throw new RangeError('turn.id must be a non-empty string.');
      }
      if (!Number.isInteger(turn.seq) || turn.seq < 1) {
        throw new RangeError('turn.seq must be a positive integer.');
      }
      if (turn.seq <= previousSeq) {
        throw new Error(settings.UnorderedMessage);
      }
      previousSeq = turn.seq;

      TurnRole.label(turn.role);
      const turnMode = turn.mode ?? TurnMode.Normal;
      TurnMode.label(turnMode);
      const fromPlayer = turn.role === TurnRole.User;
      const turnWitnessIds = Array.isArray(turn.witnessIds) ? [...turn.witnessIds] : [];

      let rawBeats = [];
      if (Array.isArray(turn.beats) && turn.beats.length > 0) {
        rawBeats = [...turn.beats].sort((left, right) => (left.seq ?? 0) - (right.seq ?? 0));
      } else if (typeof turn.rawText === 'string' && turn.rawText.trim().length > 0) {
        if (fromPlayer && turnMode !== TurnMode.Narrator) {
          rawBeats = [{
            speakerType: SpeakerType.Player,
            characterId: playerCharacterId,
            speakerName: configuredPlayerName ?? 'Player',
            text: turn.rawText,
            witnessIds: turnWitnessIds,
          }];
        } else {
          rawBeats = [{
            speakerType: SpeakerType.Narrator,
            characterId: null,
            speakerName: settings.NarratorName,
            text: turn.rawText,
            witnessIds: turnWitnessIds,
          }];
        }
      }

      const blocks = [];
      for (const beat of rawBeats) {
        if (beat === null || typeof beat !== 'object') {
          continue;
        }
        const speakerType = beat.speakerType ?? SpeakerType.Narrator;
        SpeakerType.label(speakerType);
        let beatText = typeof beat.text === 'string' ? beat.text.trim() : settings.Nothing;
        if (speakerType === SpeakerType.Narrator) {
          beatText = beatText.replace(/^narrator:\s*/i, '').trim();
        }
        if (beatText === settings.Nothing) {
          continue;
        }
        let blockRole = roleEnum.Character;
        if (speakerType === SpeakerType.Player) {
          blockRole = roleEnum.Player;
        } else if (speakerType === SpeakerType.Narrator) {
          blockRole = roleEnum.Narrator;
        }
        const speaker = speakerType === SpeakerType.Narrator
          ? settings.NarratorName
          : (typeof beat.speakerName === 'string' && beat.speakerName.trim().length > 0
            ? beat.speakerName.trim()
            : settings.NarratorName);
        if (blockRole === roleEnum.Player && detectedPlayerName === null) {
          detectedPlayerName = speaker;
        }
        const blockWitnessIds = Array.isArray(beat.witnessIds)
          ? [...beat.witnessIds]
          : [...turnWitnessIds];
        blocks.push(Object.freeze({
          blockNumber: blocks.length + 1,
          speaker,
          role: blockRole,
          text: beatText,
          characterId: beat.characterId ?? null,
          speakerType,
          witnessIds: Object.freeze(blockWitnessIds),
        }));
      }

      const lines = blocks.map((block) => {
        const suffix = block.role === roleEnum.Player ? settings.PlayerSuffix : settings.Nothing;
        return block.speaker + suffix + settings.SpeakerSeparator + block.text;
      });
      const messageText = lines.join(settings.Newline);
      const fingerprintSource = blocks.length > 0
        ? blocks.map((block) => [block.speaker, block.speakerType, block.text].join(settings.Newline)).join(settings.Newline)
        : (typeof turn.rawText === 'string' ? turn.rawText : settings.Nothing);

      messages.push(Object.freeze({
        id: turn.id,
        position: turn.seq,
        role: turn.role,
        mode: turnMode,
        fromPlayer,
        sceneNumber: Number.isInteger(turn.sceneNumber) ? turn.sceneNumber : 1,
        witnessIds: Object.freeze(turnWitnessIds),
        sceneStateAfter: turn.sceneStateAfter ?? null,
        blocks: Object.freeze(blocks),
        text: messageText,
        fingerprint: ScribeText.fingerprint(fingerprintSource),
      }));
    }

    return Object.freeze({
      messages: Object.freeze(messages),
      player: detectedPlayerName ?? settings.UnknownPlayer,
    });
  },
});
