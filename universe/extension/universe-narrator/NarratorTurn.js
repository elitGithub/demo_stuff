import { NarratorSettings } from './NarratorSettings.js';

export const NarratorTurn = Object.freeze({
  /**
   * @param {string} text
   * @returns {boolean}
   */
  isNarratorMessage(text) {
    return NarratorSettings.NarratorPrefix.test(text);
  },

  /**
   * @param {{text: string, narratorAvatar: ?string, encounter: ?function(): boolean}} turn
   * @returns {?string}
   * @throws {*}
   */
  firstSpeaker({ text, narratorAvatar, encounter }) {
    if (narratorAvatar === null) {
      return null;
    }
    if (NarratorTurn.isNarratorMessage(text)) {
      return narratorAvatar;
    }
    return encounter !== null && encounter() === true ? narratorAvatar : null;
  },

  /**
   * @param {{messages: Array<object>, narratorAvatar: string}} turn
   * @returns {string}
   * @throws {TypeError}
   */
  turnInstruction({ messages, narratorAvatar }) {
    const playerIndex = messages.findLastIndex(message => message.is_user && !message.is_system);
    if (playerIndex < 0 || !NarratorTurn.isNarratorMessage(messages[playerIndex].mes)) {
      return '';
    }
    const answered = messages.slice(playerIndex + 1).some(message => message.original_avatar === narratorAvatar
      && !message.is_system && String(message.mes ?? '').replace(/​/g, '').trim() !== '');
    return answered ? '' : NarratorSettings.TurnInstruction;
  },
});
