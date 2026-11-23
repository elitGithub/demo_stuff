import { NarratorSettings } from './NarratorSettings.js';

export const WalkOns = Object.freeze({
  /**
   * @param {string[]} walkOns
   * @param {{enter: (string|undefined), leave: (string|undefined)}} parameters
   * @returns {string[]}
   * @throws {TypeError}
   */
  apply(walkOns, { enter, leave }) {
    /**
     * @param {(string|undefined)} value
     * @returns {string[]}
     * @throws {TypeError}
     */
    const splitNames = value => (value ?? '')
      .split('|')
      .map(name => name.trim())
      .filter(name => name !== '' && !NarratorSettings.NoneNames.includes(name.toLocaleLowerCase()));
    const listed = [...walkOns];
    for (const name of splitNames(enter)) {
      if (!listed.some(walkOn => walkOn.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        listed.push(name);
      }
    }
    const leaving = splitNames(leave).map(name => name.toLocaleLowerCase());
    return listed.filter(walkOn => !leaving.includes(walkOn.toLocaleLowerCase()));
  },

  /**
   * @param {Array<object>} messages
   * @returns {string[]}
   * @throws {TypeError}
   */
  inChat(messages) {
    return messages
      .filter(message => !message.is_system && message.extra?.[NarratorSettings.RecordKey])
      .reduce((walkOns, message) => WalkOns.apply(walkOns, message.extra[NarratorSettings.RecordKey]), []);
  },

  /**
   * @param {string[]} walkOns
   * @returns {string}
   * @throws {TypeError}
   */
  prompt(walkOns) {
    if (!walkOns.length) {
      return '';
    }
    return `${NarratorSettings.WalkOnsLead} ${walkOns.join(', ')}\n${NarratorSettings.WalkOnsLeave}`;
  },
});
