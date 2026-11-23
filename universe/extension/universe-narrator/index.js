import { editGroup } from '../../../group-chats.js';
import { extension_prompt_roles, extension_prompt_types } from '../../../../script.js';
import { NarratorSettings } from './NarratorSettings.js';
import { NarratorTurn } from './NarratorTurn.js';
import { WalkOns } from './WalkOns.js';

const {
  NarratorName, SettingsKey, RecordKey, PromptKeys, CreateEndpoint, ArrivalRules, SceneTagRule, CardDescription,
  DisplayName, AddButton, AddingButton, NoGroupLine, InGroupLine, AddedToast, AddFailedTitle,
} = NarratorSettings;
const vocaliaSettingsKey = 'aspect_vocalia';
const settingsColumn = '#extensions_settings2';
const groupPanelButton = '#rm_button_selected_ch';
const hiddenClass = 'displayNone';
const impersonateType = 'impersonate';
let adding = false;
let wrapperType = null;

/**
 * @returns {object}
 * @throws {*}
 */
function tavern() {
  return globalThis.SillyTavern.getContext();
}

/**
 * @returns {string}
 * @throws {*}
 */
function narratorAvatar() {
  const avatar = tavern().extensionSettings[SettingsKey]?.narratorAvatar;
  return typeof avatar === 'string' ? avatar : '';
}

/**
 * @param {?string} avatar
 * @returns {boolean}
 * @throws {*}
 */
function isNarrator(avatar) {
  const narrator = narratorAvatar();
  return narrator !== '' && avatar === narrator;
}

/**
 * @returns {?object}
 * @throws {*}
 */
function currentGroup() {
  const { groupId, groups } = tavern();
  if (!groupId) {
    return null;
  }
  return groups.find(group => group.id === groupId) ?? null;
}

/**
 * @returns {?string}
 * @throws {*}
 */
function heldNarrator() {
  const group = currentGroup();
  const avatar = narratorAvatar();
  if (group === null || avatar === '' || !group.members.includes(avatar) || group.disabled_members.includes(avatar)) {
    return null;
  }
  return avatar;
}

/**
 * @param {string} key
 * @param {string} value
 * @returns {void}
 * @throws {*}
 */
function setPrompt(key, value) {
  tavern().setExtensionPrompt(key, value, extension_prompt_types.IN_CHAT, 0, false, extension_prompt_roles.SYSTEM);
}

/**
 * @returns {void}
 * @throws {*}
 */
function clearPrompts() {
  setPrompt(PromptKeys.Turn, '');
  setPrompt(PromptKeys.WalkOns, '');
  setPrompt(PromptKeys.SceneTag, '');
}

/**
 * @param {{selected_group: string, type: string}} wrapper
 * @returns {void}
 */
function onWrapperStarted({ type }) {
  wrapperType = type;
}

/**
 * @returns {void}
 * @throws {*}
 */
function onWrapperFinished() {
  wrapperType = null;
  clearPrompts();
}

/**
 * @param {number} characterId
 * @returns {void}
 * @throws {*}
 */
function onMemberDrafted(characterId) {
  const narrator = wrapperType === impersonateType ? null : heldNarrator();
  const { chat, characters } = tavern();
  const drafted = narrator !== null && characters[characterId].avatar === narrator;
  setPrompt(PromptKeys.Turn, drafted ? NarratorTurn.turnInstruction({ messages: chat, narratorAvatar: narrator }) : '');
  setPrompt(PromptKeys.WalkOns, drafted ? WalkOns.prompt(WalkOns.inChat(chat)) : '');
  setPrompt(PromptKeys.SceneTag, narrator === null ? '' : SceneTagRule);
}

const drawer = document.createElement('div');
drawer.id = 'universe_narrator_settings';
drawer.innerHTML = `
  <div class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b></b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <button type="button" class="menu_button menu_button_icon">
        <i class="fa-solid fa-user-plus" aria-hidden="true"></i>
        <span></span>
      </button>
      <div aria-live="polite"></div>
    </div>
  </div>`;
drawer.querySelector('b').textContent = DisplayName;
const addButton = drawer.querySelector('button');
const addLabel = addButton.querySelector('span');
const statusLine = drawer.querySelector('[aria-live]');
addLabel.textContent = AddButton;

/**
 * @returns {void}
 * @throws {*}
 */
function refreshDrawer() {
  const group = currentGroup();
  const avatar = narratorAvatar();
  const inGroup = group !== null && avatar !== '' && group.members.includes(avatar);
  addButton.disabled = adding || group === null;
  addButton.classList.toggle(hiddenClass, inGroup);
  if (group === null) {
    statusLine.textContent = NoGroupLine;
  } else if (inGroup) {
    statusLine.textContent = InGroupLine;
  } else {
    statusLine.textContent = '';
  }
}

/**
 * @returns {Promise<void>}
 * @throws {*}
 */
async function addNarrator() {
  const groupId = tavern().groupId;
  adding = true;
  addLabel.textContent = AddingButton;
  refreshDrawer();
  try {
    const context = tavern();
    let avatar = narratorAvatar();
    if (avatar === '' || !context.characters.some(character => character.avatar === avatar)) {
      const response = await fetch(CreateEndpoint, {
        method: 'POST',
        headers: context.getRequestHeaders(),
        body: JSON.stringify({ ch_name: NarratorName, description: CardDescription, first_mes: '' }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      avatar = await response.text();
      context.extensionSettings[SettingsKey] ??= {};
      context.extensionSettings[SettingsKey].narratorAvatar = avatar;
      context.saveSettingsDebounced();
      await context.getCharacters();
    }
    const group = tavern().groups.find(candidate => candidate.id === groupId);
    if (!group.members.includes(avatar)) {
      group.members.push(avatar);
    }
    await editGroup(groupId, true);
    $(groupPanelButton).trigger('click');
    const { eventSource, eventTypes } = tavern();
    await eventSource.emit(eventTypes.GROUP_UPDATED);
    toastr.success(AddedToast);
  } catch (error) {
    console.error(error);
    toastr.error(error.message, AddFailedTitle);
  } finally {
    adding = false;
    addLabel.textContent = AddButton;
    refreshDrawer();
  }
}

/**
 * @returns {void}
 * @throws {*}
 */
function onChatChanged() {
  clearPrompts();
  refreshDrawer();
}

/**
 * @returns {void}
 * @throws {*}
 */
function onAppReady() {
  const { extensionSettings, saveSettingsDebounced } = tavern();
  const vocalia = extensionSettings[vocaliaSettingsKey];
  if (!vocalia || typeof vocalia.protocolInjectionOverrides?.arrival_rules === 'string') {
    return;
  }
  vocalia.protocolInjectionOverrides ??= {};
  vocalia.protocolInjectionOverrides.arrival_rules = ArrivalRules;
  saveSettingsDebounced();
}

globalThis.universeNarrator = Object.freeze({
  isNarrator,

  /**
   * @param {number} userMessageId
   * @returns {?string}
   * @throws {*}
   */
  firstSpeaker(userMessageId) {
    return NarratorTurn.firstSpeaker({ text: tavern().chat[userMessageId].mes, narratorAvatar: heldNarrator(), encounter: null });
  },

  /**
   * @param {object} block
   * @param {?string} ownerAvatar
   * @param {number} messageId
   * @returns {void}
   * @throws {*}
   */
  onReplyBlock(block, ownerAvatar, messageId) {
    if (!isNarrator(ownerAvatar)) {
      return;
    }
    tavern().chat[messageId].extra[RecordKey] = { enter: block.parameters.enter, leave: block.parameters.leave };
  },
});

const { eventSource, eventTypes } = tavern();
addButton.addEventListener('click', addNarrator);
document.querySelector(settingsColumn).append(drawer);
refreshDrawer();
eventSource.on(eventTypes.APP_READY, onAppReady);
eventSource.on(eventTypes.GROUP_WRAPPER_STARTED, onWrapperStarted);
eventSource.on(eventTypes.GROUP_MEMBER_DRAFTED, onMemberDrafted);
eventSource.on(eventTypes.GROUP_WRAPPER_FINISHED, onWrapperFinished);
eventSource.on(eventTypes.CHAT_CHANGED, onChatChanged);
eventSource.on(eventTypes.GROUP_UPDATED, refreshDrawer);
