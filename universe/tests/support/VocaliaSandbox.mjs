import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Script, createContext, runInContext } from 'node:vm';

export class VocaliaSandbox {
  static Project = dirname(dirname(import.meta.dirname));
  static Vocalia = readFileSync(join(VocaliaSandbox.Project, 'node_modules/st-aspect-vocalia/index.js'), 'utf8');
  static Fragment = readFileSync(join(VocaliaSandbox.Project, 'extension/vocalia-overrides.js'), 'utf8');
  static Members = Object.freeze(['Narrator', 'Collette', 'Lize', 'Viola'].map(name => Object.freeze({ name, avatar: `${name}.png` })));
  static Absent = 'absent';
  static Present = 'present';
  static Departing = 'departing';
  static Idle = 'idle';
  static Now = Date.parse('2026-11-23T12:00:00Z');
  static ModuleUrl = 'file:///public/scripts/extensions/third-party/st-aspect-vocalia/index.js';
  static Anchors = Object.freeze([
    Object.freeze({
      name: "import from '../../../../script.js'",
      pattern: /^import \{[^}]*\} from '\.\.\/\.\.\/\.\.\/\.\.\/script\.js';$/gm,
      replacement: VocaliaSandbox.blankLines,
    }),
    Object.freeze({
      name: "import from '../../../extensions.js'",
      pattern: /^import \{[^}]*\} from '\.\.\/\.\.\/\.\.\/extensions\.js';$/gm,
      replacement: VocaliaSandbox.blankLines,
    }),
    Object.freeze({ name: 'export async function onEnable(', pattern: /^export (?=async function onEnable\()/gm, replacement: '' }),
    Object.freeze({ name: 'export async function onDisable(', pattern: /^export (?=async function onDisable\()/gm, replacement: '' }),
    Object.freeze({ name: 'import.meta.url', pattern: /import\.meta\.url/g, replacement: `'${VocaliaSandbox.ModuleUrl}'` }),
  ]);
  static FragmentScript = new Script(`'use strict';${VocaliaSandbox.Fragment}`, { filename: 'vocalia-overrides.js' });
  static #vocaliaScripts = new Map();

  context;
  calls;
  tavern;
  prompts = [];

  /**
   * @param {string} statement
   * @returns {string}
   * @throws {TypeError}
   */
  static blankLines(statement) {
    return statement.replace(/[^\n]/g, '');
  }

  /**
   * @param {string} [fragment]
   * @returns {string[]}
   * @throws {TypeError}
   */
  static overriddenNames(fragment = VocaliaSandbox.Fragment) {
    return [...fragment.matchAll(/^function ([\w$]+)\(/gm)]
      .map(match => match[1])
      .filter(name => !name.startsWith('universe'));
  }

  /**
   * @param {string} [vocalia]
   * @param {string} [fragment]
   * @returns {string}
   * @throws {Error}
   */
  static built(vocalia = VocaliaSandbox.Vocalia, fragment = VocaliaSandbox.Fragment) {
    let text = vocalia;
    for (const name of VocaliaSandbox.overriddenNames(fragment)) {
      const declaration = `function ${name}(`;
      const count = text.split(declaration).length - 1;
      if (count !== 1) {
        throw new Error(`Vocalia declares ${declaration} ${count} times`);
      }
      text = text.replace(declaration, `function vocaliaBase_${name}(`);
    }
    return `${text}\n${fragment}`;
  }

  /**
   * @param {string} text
   * @returns {string}
   * @throws {Error}
   */
  static anchored(text) {
    let result = text;
    for (const { name, pattern, replacement } of VocaliaSandbox.Anchors) {
      const count = result.match(pattern)?.length ?? 0;
      if (count !== 1) {
        throw new Error(`Anchored change ${name} matches ${count} times`);
      }
      result = result.replace(pattern, replacement);
    }
    return `'use strict';${result}`;
  }

  /**
   * @param {Array<Array<*>>} calls
   * @param {?string} speaker
   * @returns {{firstSpeaker: function(number): ?string, isNarrator: function(string): boolean, onReplyBlock: function(object, ?string, number): void}}
   */
  static narratorStub(calls, speaker) {
    return {
      /**
       * @param {number} userMessageId
       * @returns {?string}
       */
      firstSpeaker(userMessageId) {
        calls.push(['firstSpeaker', [userMessageId]]);
        return speaker;
      },
      /**
       * @param {string} avatar
       * @returns {boolean}
       */
      isNarrator(avatar) {
        return avatar === 'Narrator.png';
      },
      /**
       * @param {object} block
       * @param {?string} ownerAvatar
       * @param {number} messageId
       * @returns {void}
       */
      onReplyBlock(block, ownerAvatar, messageId) {
        calls.push(['onReplyBlock', [block, ownerAvatar, messageId]]);
      },
    };
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.universe]
   * @param {?string} [options.speaker]
   * @param {boolean} [options.narrator]
   * @param {boolean} [options.muted]
   * @param {boolean} [options.ownerEligible]
   * @param {?number} [options.unanswered]
   * @param {?number} [options.lastReply]
   * @param {?object} [options.tailWindow]
   * @param {Object<string, Function>} [options.bases]
   * @returns {VocaliaSandbox}
   * @throws {*}
   */
  static stubbed({
    universe = true, speaker = null, narrator = true, muted = false, ownerEligible = true, unanswered = null, lastReply = null,
    tailWindow = null, bases = {},
  } = {}) {
    const calls = [];
    const members = VocaliaSandbox.Members
      .filter(member => narrator || member.name !== 'Narrator')
      .map(member => (muted && member.name === 'Narrator' ? { ...member, disabled: true } : member));
    const globals = {
      MEMBER_STATUS_ABSENT: VocaliaSandbox.Absent,
      MEMBER_STATUS_PRESENT: VocaliaSandbox.Present,
      MEMBER_STATUS_DEPARTING: VocaliaSandbox.Departing,
      MEMBER_STATUS_IDLE: VocaliaSandbox.Idle,
      /**
       * @returns {{chat: Array<object>}}
       */
      ctx() {
        return { chat: [] };
      },
      /**
       * @param {number} messageId
       * @returns {?{messageId: number, message: object, text: string}}
       */
      findLatestUserMessageBefore(messageId) {
        calls.push(['findLatestUserMessageBefore', [messageId]]);
        return unanswered === null ? null : { messageId: unanswered, message: { is_user: true, mes: '' }, text: '' };
      },
      /**
       * @returns {?number}
       */
      findLastAssistantMessageId() {
        calls.push(['findLastAssistantMessageId', []]);
        return lastReply;
      },
      /**
       * @returns {?object}
       */
      getTailRegenerateDeleteWindow() {
        calls.push(['getTailRegenerateDeleteWindow', []]);
        return tailWindow;
      },
      /**
       * @returns {void}
       */
      updateExtensionPrompt() {
        calls.push(['updateExtensionPrompt', []]);
      },
      /**
       * @returns {void}
       */
      updateDiagnosticsPanel() {
        calls.push(['updateDiagnosticsPanel', []]);
      },
      /**
       * @returns {Promise<void>}
       */
      async saveMetadata() {
        calls.push(['saveMetadata', []]);
      },
      /**
       * @param {string} name
       * @returns {boolean}
       */
      isUserAlias(name) {
        return /^(?:user|you|me|player|human|{{user}}|<user>)$/i.test(String(name ?? '').trim());
      },
      /**
       * @param {string} name
       * @param {Array<object>} candidates
       * @returns {?object}
       * @throws {TypeError}
       */
      getMemberByName(name, candidates) {
        calls.push(['getMemberByName', [name]]);
        return candidates.find(member => member.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase()) ?? null;
      },
      /**
       * @param {?string} avatar
       * @returns {?object}
       */
      getMemberByAvatar(avatar) {
        calls.push(['getMemberByAvatar', [avatar]]);
        return members.find(member => member.avatar === avatar) ?? null;
      },
      /**
       * @returns {Array<object>}
       */
      getGroupMembers() {
        calls.push(['getGroupMembers', []]);
        return [...members];
      },
      /**
       * @param {string} avatar
       * @param {string} presence
       * @returns {void}
       */
      setPresence(avatar, presence) {
        calls.push(['setPresence', [avatar, presence]]);
      },
      /**
       * @param {object} member
       * @returns {boolean}
       */
      isOwnerEligibleForStateTransitions(member) {
        calls.push(['isOwnerEligibleForStateTransitions', [member]]);
        return ownerEligible;
      },
    };
    for (const name of VocaliaSandbox.overriddenNames()) {
      const base = `vocaliaBase_${name}`;
      /**
       * @param {...*} args
       * @returns {*}
       * @throws {*}
       */
      globals[base] = (...args) => {
        calls.push([base, args]);
        if (!bases[name]) {
          throw new Error(`${base} was not expected`);
        }
        return bases[name](...args);
      };
    }
    if (universe) {
      globals.universeNarrator = VocaliaSandbox.narratorStub(calls, speaker);
    }
    return new VocaliaSandbox(globals, calls, VocaliaSandbox.FragmentScript, null);
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.built]
   * @param {boolean} [options.universe]
   * @param {?string} [options.speaker]
   * @param {boolean} [options.narrator]
   * @param {boolean} [options.muted]
   * @param {string[]} [options.disabled]
   * @param {string[]} [options.outside]
   * @param {string[]} [options.deletedCards]
   * @param {string[]} [options.absent]
   * @param {Array<object>} [options.chat]
   * @param {object} [options.state]
   * @param {object} [options.settings]
   * @param {number} [options.random]
   * @returns {VocaliaSandbox}
   * @throws {*}
   */
  static vocalia({
    built = true, universe = false, speaker = null, narrator = true, muted = false, disabled = [], outside = [], deletedCards = [],
    absent = [], chat = [], state = {}, settings = {}, random = 0,
  } = {}) {
    if (!VocaliaSandbox.#vocaliaScripts.has(built)) {
      const text = VocaliaSandbox.anchored(built ? VocaliaSandbox.built() : VocaliaSandbox.Vocalia);
      VocaliaSandbox.#vocaliaScripts.set(built, new Script(text, { filename: 'st-aspect-vocalia/index.js' }));
    }
    const calls = [];
    const prompts = [];
    const avatars = VocaliaSandbox.Members
      .filter(member => (narrator || member.name !== 'Narrator') && !outside.includes(member.name))
      .map(member => member.avatar);
    const absentAvatars = absent.map(name => `${name}.png`);
    const disabledAvatars = [...(muted ? ['Narrator'] : []), ...disabled].map(name => `${name}.png`);
    const tavern = {
      groupId: 'universe',
      groups: [{ id: 'universe', name: 'Universe', members: avatars, disabled_members: disabledAvatars, activation_strategy: 2 }],
      characters: VocaliaSandbox.Members.filter(member => !deletedCards.includes(member.name)).map(member => ({ ...member })),
      chat: structuredClone(chat),
      chatMetadata: {
        aspect_vocalia: {
          groupId: 'universe',
          present: avatars.filter(avatar => !absentAvatars.includes(avatar)),
          remote: [],
          absent: absentAvatars,
          pendingArrivals: [],
          ...structuredClone(state),
        },
      },
      extensionSettings: { aspect_vocalia: structuredClone(settings) },
      /**
       * @returns {Promise<void>}
       */
      async saveMetadata() {},
      /**
       * @returns {void}
       */
      saveSettingsDebounced() {},
      /**
       * @param {string} key
       * @param {string} value
       * @returns {void}
       */
      setExtensionPrompt(key, value) {
        prompts.push([key, value]);
      },
    };
    const globals = {
      /**
       * @returns {object}
       */
      importedGetContext() {
        return tavern;
      },
      importedExtensionSettings: tavern.extensionSettings,
      /**
       * @returns {void}
       */
      importedSaveSettingsDebounced() {},
      /**
       * @returns {Promise<void>}
       */
      async importedDeleteLastMessage() {
        tavern.chat.pop();
      },
      /**
       * @returns {null}
       */
      importedFindExtension() {
        return null;
      },
      /**
       * @returns {void}
       */
      jQuery() {},
      /**
       * @returns {{length: number}}
       */
      $() {
        return { length: 0 };
      },
      /**
       * @returns {void}
       */
      setTimeout() {},
      console: {
        /**
         * @returns {void}
         */
        debug() {},
        /**
         * @returns {void}
         */
        warn() {},
        /**
         * @returns {void}
         */
        error() {},
      },
      Element: class {},
      HTMLElement: class {},
    };
    if (universe) {
      globals.universeNarrator = VocaliaSandbox.narratorStub(calls, speaker);
    }
    const sandbox = new VocaliaSandbox(globals, calls, VocaliaSandbox.#vocaliaScripts.get(built), tavern);
    sandbox.prompts = prompts;
    const contextMath = runInContext('Math', sandbox.context);
    const contextDate = runInContext('Date', sandbox.context);
    /**
     * @returns {number}
     */
    contextMath.random = () => random;
    /**
     * @returns {number}
     */
    contextDate.now = () => VocaliaSandbox.Now;
    return sandbox;
  }

  /**
   * @param {object} globals
   * @param {Array<Array<*>>} calls
   * @param {Script} script
   * @param {?object} tavern
   * @throws {*}
   */
  constructor(globals, calls, script, tavern) {
    this.calls = calls;
    this.tavern = tavern;
    this.context = createContext(globals);
    script.runInContext(this.context);
  }

  /**
   * @returns {boolean}
   * @throws {*}
   */
  get picking() {
    return runInContext('universePicking', this.context);
  }

  /**
   * @param {string} name
   * @returns {Array<Array<*>>}
   */
  called(name) {
    return this.calls.filter(([callee]) => callee === name).map(([, args]) => args);
  }

  /**
   * @param {string} name
   * @returns {?object}
   * @throws {*}
   */
  member(name) {
    return this.context.getMemberByAvatar(`${name}.png`);
  }

  /**
   * @returns {object}
   * @throws {*}
   */
  state() {
    return this.context.ensureStateForCurrentGroup();
  }
}
