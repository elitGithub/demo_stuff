import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const server = 'src/server-main.js';
const chat = 'public/script.js';
const groups = 'public/scripts/group-chats.js';
const worlds = 'public/scripts/world-info.js';
const settings = 'src/endpoints/settings.js';
const chats = 'src/endpoints/chats.js';
const stats = 'src/endpoints/stats.js';
const characters = 'src/endpoints/characters.js';
const thumbnails = 'src/endpoints/thumbnails.js';
const personas = 'public/scripts/personas.js';
const hashes = {
  [server]: '567d8a9d52e70816e74f119409933f2b42ad03132d7ef01f8db3ae145c2fe7bf',
  [chat]: '955c603d0bad84bac5a716f0818d85c2543e44d4c43878e0d63ef1e55ca91855',
  [groups]: '862eb24dfe1f596a2bd6d039a69397667829e0fc34471d22d2028d7781a5c73c',
  [worlds]: '111c7f47945839e75b021e09bdbb112a54f0a9b7857d2b95435f573efc7cd9a5',
  [settings]: 'bbc3d36ad758b1fc567f63f1e24eada063172791005c5b3baadc195b78726955',
  [chats]: '40012ebc71a75357e62f7532e5b20def0d8b6c132bb6ab48f662993cc97b9063',
  [stats]: '3ff08d54af9e6468ccba158b94530eed460175343e04d6a66ab24f5c2cb36fb2',
  [characters]: '71079a401ed4ae7858a71feb9c8a911354e9769242c8a6b7a3f4ec9f08783975',
  [thumbnails]: 'cab7d42763d6a9743d45cea7e4269eff87c451d372b4deeca6437797e2cdbb46',
  [personas]: '9cef6f9ad424f9c59628b039a65b8e141ffa71aa4519c7108e8c33b5d97f090c',
};
const bridgeUrl = '/scripts/universe-checkpoint-bridge.js';
const tracked = {
  [chat]: ['Generate', 'saveSettings', 'saveChat', 'saveChatConditional', 'createOrEditCharacter', 'renameCharacter',
    'renamePastChats', 'deleteCharacter', 'importCharacter', 'importCharacterChat', 'renameGroupOrCharacterChat',
    'replaceCurrentChat', 'openCharacterChat', 'duplicateCharacter', 'deleteCharacterChatByName'],
  [groups]: ['generateGroupWrapper', 'saveGroupChat', '_save', 'editGroup', 'createGroup', 'renameGroupMember',
    'deleteGroup', 'renameGroupChat', 'deleteGroupChatByName', 'deleteGroupChat', 'importGroupChat', 'openGroupChat', 'saveGroupBookmarkChat'],
  [worlds]: ['saveWorldInfo', '_save', 'renameWorldInfo', 'deleteWorldInfo', 'importWorldInfo', 'importEmbeddedWorldInfo'],
};

/**
 * @param {string} source
 * @param {string} before
 * @param {string} after
 * @returns {string}
 */
function replace(source, before, after) {
  if (source.split(before).length !== 2) {
    throw new Error('Expected exactly one SillyTavern checkpoint hook anchor.');
  }
  return source.replace(before, () => after);
}

/**
 * @param {string} source
 * @param {string} file
 * @returns {string}
 */
function instrument(source, file) {
  if (file.startsWith('src/')) {
    const bridge = new URL('./server-bridge.mjs', import.meta.url).href;
    source = `import * as universe from ${JSON.stringify(bridge)};\n` + source;
    if ([settings, chats].includes(file)) {
      const map = file === settings ? 'AUTOSAVE_FUNCTIONS' : 'backupFunctions';
      source = replace(source, `const ${map} = new Map();`, `const ${map} = new Map();\nuniverse.registerFlush(() => { for (const save of ${map}.values()) save.flush(); });`);
      if (file === settings) {
        source = replace(source, "triggerAutoSave(request.user.profile.handle);\n        response.send({ result: 'ok' });\n    } catch (err) {\n        console.error(err);\n        response.send(err);", "triggerAutoSave(request.user.profile.handle);\n        response.send({ result: 'ok' });\n    } catch (err) {\n        console.error(err);\n        response.sendStatus(500);");
      }
      return source;
    }
    if (file === stats) {
      return replace(source, 'setInterval(saveStatsToFile,', 'setInterval(() => universe.background(saveStatsToFile),');
    }
    if (file === characters) {
      return replace(source, 'setInterval(this.#syncCacheEntries.bind(this),', 'setInterval(() => universe.background(() => this.#syncCacheEntries()),');
    }
    if (file === thumbnails) {
      return replace(source, 'await generateThumbnail(request.user.directories, type, file, false);',
        'await universe.background(() => generateThumbnail(request.user.directories, type, file, false));');
    }
    source = replace(source, 'setInterval(writeHeartbeat, intervalMs)', 'setInterval(() => universe.background(writeHeartbeat), intervalMs)');
    for (const [anchor, method] of [
      ["app.get('/', cacheBuster.middleware", 'mountWrites(app)'],
      ['const webpackMiddleware = getWebpackServeMiddleware();', 'mountAssets(app)'],
      ['setupPrivateEndpoints(app);', 'mountGate(app)'],
    ]) {
      source = replace(source, anchor, `if (!cliArgs.disableCsrf) universe.${method};\n${anchor}`);
    }
    const started = 'serverEvents.emit(EVENT_NAMES.SERVER_STARTED, { url: browserLaunchUrl });';
    return replace(source, started, `universe.ready(!cliArgs.disableCsrf);\n${started}`);
  }
  if (file === personas) {
    source = replace(source, "    const request = await fetch('/api/avatars/delete', {",
      "    const currentChat = () => JSON.stringify([characters[this_chid]?.avatar, selected_group, getCurrentChatId()]);\n" +
      "    return universe.trackPersonaDeletion(avatarId, currentChat, avatarId === chat_metadata.persona, async needsChatSave => {\n    const request = await fetch('/api/avatars/delete', {");
    source = replace(source, "if (request.ok) {\n        console.log(`Deleted avatar",
      "if (request.ok || (request.status === 404 && await universe.portraitMissing(avatarId, getRequestHeaders()))) {\n        console.log(`Deleted avatar");
    const metadata = /^        if \(avatarId === chat_metadata\.persona\) \{[\s\S]*?^        \}\n/m.exec(source)[0];
    source = replace(source, metadata, '');
    source = replace(source, '        delete power_user.personas[avatarId];',
      replace(replace(metadata, 'avatarId === chat_metadata.persona', 'needsChatSave()'), 'delete chat_metadata.persona;\n            await saveMetadata();',
        'await universe.savePersonaChat(avatarId, chat_metadata, saveMetadata, characters[this_chid]?.avatar, selected_group, getCurrentChatId());') +
      '        delete power_user.personas[avatarId];');
    source = replace(source, '    return false;\n}\n\nasync function onPersonaDescriptionInput()',
      '    return false;\n    });\n}\n\nasync function onPersonaDescriptionInput()');
    return `import * as universe from '${bridgeUrl}';\n` + source;
  }
  for (const name of tracked[file]) {
    const match = new RegExp('^(?:export )?async function ' + name + '\\([^\\n]*\\) \\{\\n[\\s\\S]*?^\\}', 'm').exec(source);
    if (!match) {
      throw new Error(`Missing SillyTavern save function ${name}.`);
    }
    const body = match[0];
    const start = body.indexOf('\n') + 1;
    const key = ({
      saveChat: '[characters[this_chid]?.avatar, chatName ?? getCurrentChatId()]',
      saveChatConditional: '[characters[this_chid]?.avatar, selected_group, getCurrentChatId()]',
      createOrEditCharacter: "[$('#form_create [name=avatar_url]').val(), $('#character_name_pole').val()]",
      saveGroupChat: '[groupId, groups.find(group => group.id == groupId)?.chat_id]',
      saveGroupBookmarkChat: '[groupId, name]',
      _save: file === worlds ? 'name' : 'group.id',
      deleteWorldInfo: 'worldInfoName',
      saveSettings: "'settings'",
    })[name];
    const failure = ['Generate', 'generateGroupWrapper'].includes(name) ? '' : 'universeFailed = true;';
    const responsible = !['editGroup', 'saveWorldInfo', 'renameWorldInfo'].includes(name);
    const track = key ? `universe.track(${JSON.stringify(file + '/' + name)} + JSON.stringify(${key}))` :
      responsible ? 'failed => { if (failed) universe.fail(Symbol()); }' : 'null';
    const worldWrite = file === worlds && ['_save', 'deleteWorldInfo'].includes(name);
    const reserve = name === '_save' ? 'await universe.reserveWorlds([name], create ? [name] : [])' :
      'await universe.reserveWorlds([worldInfoName], [worldInfoName])';
    const admission = worldWrite ? `worldPermit ??= ${reserve}; universeSettle = ${track};\n` : '';
    const leave = worldWrite ? 'try { if (!inherited) await worldPermit?.release(); } finally { universeLeave(); }' : 'universeLeave();';
    source = replace(source, body, body.slice(0, start) +
      `const universeLeave = await universe.enter(); let universeFailed = false; let universeSettle = ${track}; try {\n` +
      admission + body.slice(start, -1) + `\n} catch (error) { ${failure} throw error; } finally { universeSettle?.(universeFailed); ${leave} }\n}`);
  }
  if (file === chat) {
    source = replace(source, 'const initLoaderOverlay = loader.createOverlay();', 'await universe.connect(getRequestHeaders, isGenerating);\n    const initLoaderOverlay = loader.createOverlay();');
    source = replace(source, "xhr.setRequestHeader('X-CSRF-Token', token);", "xhr.setRequestHeader('X-CSRF-Token', token);\n    universe.identify(xhr, options.url);");
    source = replace(source, "saveCharacterDebounced = debounce(", "saveCharacterDebounced = universe.debounce('character', ");
    source = replace(source, 'saveSettingsDebounced = debounce(', "saveSettingsDebounced = universe.debounce('settings', ");
    source = replace(source, "console.error('Error saving settings:', error);", "universeFailed = true; console.error('Error saving settings:', error);");
    source = replace(source, 'chatSaveTimeout = setTimeout(async () => {', "chatSaveTimeout = true;\n    universe.debounce('chat', async () => {");
    source = replace(source, "console.debug('Chat saved');\n    }, DEFAULT_SAVE_EDIT_TIMEOUT);", "console.debug('Chat saved');\n    }, DEFAULT_SAVE_EDIT_TIMEOUT)();");
    source = replace(source, 'clearTimeout(chatSaveTimeout);', "universe.cancel('chat');");
    for (const anchor of [
      "console.warn('saveChat called without chat_name", "console.warn('Timeout waiting for chat to save",
      "console.error('Error saving chat', error);", "toastr.error(t`Check the server connection and reload the page to prevent data loss.`, t`Chat could not be saved`)",
      "console.error('Error creating character', error);", 'toastr.error(t`Something went wrong while saving the character',
      "console.warn('Settings not ready, aborting character creation/editing.", "toastr.error(t`Cannot create characters while generating.",
    ]) {
      source = replace(source, anchor, 'universeFailed = true; ' + anchor);
    }
  } else if (file === groups) {
    source = replace(source, 'saveGroupDebounced = debounce(', "saveGroupDebounced = universe.debounce(group => 'group:' + group.id, ");
    source = replace(source, 'return await _save(group, reload);', "universe.cancel('group:' + group.id);\n        return await _save(group, reload);");
    source = replace(source, "await fetch('/api/groups/edit', {", "const universeResponse = await fetch('/api/groups/edit', {");
    source = replace(source, 'body: JSON.stringify(group),\n    });\n    if (reload)', 'body: JSON.stringify(group),\n    });\n    if (!universeResponse.ok) universeFailed = true;\n    if (reload)');
    source = replace(source, "            console.error('Group chat could not be saved'", "            universeFailed = true; console.error('Group chat could not be saved'");
    source = replace(source, "\n        console.error('Group chat could not be saved'", "\n        universeFailed = true; console.error('Group chat could not be saved'");
  } else {
    source = replace(source, 'async function _save(name, data) {', 'async function _save(name, data, inherited = null, create = false) {\nlet worldPermit = inherited;');
    source = replace(source, 'async function deleteWorldInfo(worldInfoName) {', 'async function deleteWorldInfo(worldInfoName, inherited = null) {\nlet worldPermit = inherited;');
    source = replace(source, 'async function saveWorldInfo(name, data, immediately = false)', 'async function saveWorldInfo(name, data, immediately = false, permit = null)');
    source = replace(source, 'saveWorldDebounced = debounce(', "saveWorldDebounced = universe.debounce(name => 'world:' + name, ");
    source = replace(source, 'async (name, data) => await _save(name, data)', 'async (name, data, create) => await _save(name, data, null, create)');
    source = replace(source, 'saveWorldDebounced(name, data);', 'saveWorldDebounced(name, data, !world_names.includes(name));');
    source = replace(source, 'cancelDebounce(saveWorldDebounced);', '');
    source = replace(source, 'return await _save(name, data);', "universe.cancel('world:' + name);\n        return await _save(name, data, permit, !world_names.includes(name));");
    source = replace(source, "await fetch('/api/worldinfo/edit', {", "const universeResponse = await fetch('/api/worldinfo/edit', {");
    source = replace(source, 'await eventSource.emit(event_types.WORLDINFO_UPDATED', 'if (!universeResponse.ok) { universeFailed = true; return false; }\n    worldPermit.saved = name;\n    await eventSource.emit(event_types.WORLDINFO_UPDATED');
    source = replace(source, "const oldName = name;\n    const newName = await Popup.show.input('Rename World Info'", "const recovery = universe.worldRenames.get(name);\n    const oldName = recovery?.oldName ?? name;\n    const newName = recovery?.newName ?? await Popup.show.input('Rename World Info'");
    source = replace(source, 'await saveWorldInfo(newName, data, true);\n    await deleteWorldInfo(oldName);\n\n    await updateWorldInfoLinks(oldName, newName, { retargetPersonaLore });',
      'const complete = await universe.renameWorld({ oldName, newName, data, retargetPersonaLore, save: saveWorldInfo, remove: deleteWorldInfo, relink: updateWorldInfoLinks,\n' +
      "        list: async () => { const response = await fetch('/api/worldinfo/list', { method: 'POST', headers: getRequestHeaders() }); if (!response.ok) throw new Error('Could not check the lorebook list.'); return (await response.json()).map(book => book.file_id); } });\n" +
      "    if (!complete) { toastr.error('Could not finish renaming this lorebook. Choose Rename on the source or destination to retry.'); return; }");
    source = replace(source, 'if (!world_names.includes(worldInfoName)) {\n        return false;', 'if (!world_names.includes(worldInfoName)) {\n        universeSettle = null; return false;');
    source = replace(source, 'if (!response.ok) {\n        return false;\n    }\n\n    if (worldInfoCache.has(worldInfoName))',
      "if (!response.ok) { universeFailed = true; return false; }\n    worldPermit.removed = worldInfoName;\n    universe.cancel('world:' + worldInfoName);\n    if (worldInfoCache.has(worldInfoName))");
    source = replace(source, "if ($('#character_world').val() === worldInfoName)", "if (!inherited && $('#character_world').val() === worldInfoName)");
    source = replace(source, 'async function updateWorldInfoLinks(oldName, newName, { retargetPersonaLore } = {}) {',
      'async function updateWorldInfoLinks(oldName, newName, recovery) {\n    const { retargetPersonaLore } = recovery;\n    if (!recovery.auxiliaryUpdated) {');
    source = replace(source, '// find all characters using the old lorebook name', 'recovery.auxiliaryUpdated = true;\n    }\n    // find all characters using the old lorebook name');
    source = replace(source, 'if (!linkedChIDs.length) {', 'if (!linkedChIDs.length && !recovery.cards?.size) {');
    source = replace(source, 'const updatePastLinksConfirm = await Popup.show.confirm(', 'const updatePastLinksConfirm = recovery.cards ? recovery.cards.size > 0 : await Popup.show.confirm(');
    source = replace(source, 'if (updatePastLinksConfirm) {', 'recovery.cards ??= new Set(updatePastLinksConfirm ? linkedChIDs.map(id => characters[id].avatar) : []);\n    if (updatePastLinksConfirm) {');
    source = replace(source, 'for (const chid of linkedChIDs) {\n            const character = characters[chid];',
      'for (const avatar of recovery.cards) {\n            const chid = characters.findIndex(card => card.avatar === avatar);\n            const character = characters[chid];\n            if (!character) continue;');
    source = replace(source, 'toastr.success(`Successfully updated link for ${character.name}.`);', 'recovery.cards.delete(avatar);\n                toastr.success(`Successfully updated link for ${character.name}.`);');
    source = replace(source, 'setWorldInfoButtonClass(this_chid, true);\n        }\n    }\n}\n\n/**\n * Deletes a world info',
      'setWorldInfoButtonClass(this_chid, true);\n        }\n    }\n    return recovery.cards.size === 0;\n}\n\n/**\n * Deletes a world info');
  }
  return `import * as universe from '${bridgeUrl}';\n` + source;
}

/**
 * @param {string} root
 * @returns {Promise<object>}
 */
export async function prepareHooks(root) {
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (manifest.name !== 'sillytavern' || manifest.version !== '1.19.1') {
    throw new Error('Expected SillyTavern 1.19.1.');
  }
  const assets = new Map();
  let loader;
  for (const [file, expected] of Object.entries(hashes)) {
    const bytes = await readFile(join(root, file));
    if (createHash('sha256').update(bytes).digest('hex') !== expected) {
      throw new Error(`Unrecognized SillyTavern source: ${file}.`);
    }
    const source = instrument(bytes.toString('utf8'), file);
    if (file === server) {
      loader = { url: pathToFileURL(join(root, file)).href, source, modules: new Map() };
    } else if (file.startsWith('src/')) {
      loader.modules.set(pathToFileURL(join(root, file)).href, source);
    } else {
      assets.set(file.slice('public'.length), source);
    }
  }
  assets.set(bridgeUrl, await readFile(new URL('./browser-bridge.js', import.meta.url), 'utf8'));
  return { loader, assets };
}

let target;

/**
 * @param {object} data
 * @returns {void}
 */
export function initialize(data) {
  target = data;
}

/**
 * @param {string} url
 * @param {object} context
 * @param {Function} next
 * @returns {Promise<object>}
 */
export async function load(url, context, next) {
  const source = url === target.url ? target.source : target.modules.get(url);
  return source === undefined ? next(url, context) : { format: 'module', source, shortCircuit: true };
}
