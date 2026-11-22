const pending = new Map();
const tab = crypto.randomUUID();
const route = '/api/plugins/universe/barrier';
let active = 0;
const failures = new Map();
const personaChats = new Map();
let frozen;
let resume;
let localDeadline;
let epoch;
let headers;
let generating;
let suspended = false;
let completed = 0;
export const worldRenames = new Map();

/**
 * @param {string} command
 * @param {object} body
 * @returns {Promise<object>}
 */
async function loreControl(command, body) {
  while (!suspended) {
    try {
      return await control(command, body);
    } catch (error) {
      if (error.status && error.status !== 429 && error.status < 500) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  throw new Error('The lorebook editor closed.');
}

/**
 * @param {string[]} names
 * @param {string[]} allowMissing
 * @returns {Promise<object>}
 */
export async function reserveWorlds(names, allowMissing = []) {
  const operation = crypto.randomUUID();
  try {
    while (!suspended) {
      const { lore } = await loreControl('lore-begin', { operation, names, allowMissing });
      if (lore === 'ready') {
        return {
          async release() {
            await loreControl('lore-end', { operation, saved: this.saved, removed: this.removed });
          },
        };
      }
      if (lore !== 'waiting') {
        throw new Error('The lorebook changed names while this save was waiting.');
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error('The lorebook editor closed.');
  } catch (error) {
    if (!suspended) {
      await loreControl('lore-end', { operation });
    }
    throw error;
  }
}

/**
 * @param {object} options
 * @returns {Promise<boolean>}
 */
export async function renameWorld({ oldName, newName, data, retargetPersonaLore, save, remove, relink, list }) {
  let recovery = worldRenames.get(oldName);
  if (!recovery) {
    if (worldRenames.has(newName)) {
      throw new Error('The destination already belongs to an unfinished lorebook rename.');
    }
    recovery = { oldName, newName, retargetPersonaLore };
    worldRenames.set(oldName, recovery);
    worldRenames.set(newName, recovery);
  }
  const settle = track('rename-world:' + JSON.stringify([oldName, newName]));
  let permit;
  let complete = false;
  try {
    permit = await reserveWorlds([oldName, newName], [oldName, newName]);
    const confirmedDelete = track('public/scripts/world-info.js/deleteWorldInfo' + JSON.stringify(oldName));
    if (recovery.attemptedDelete && !recovery.removed) {
      const files = await list();
      recovery.removed = !files.includes(oldName) && files.includes(newName);
    }
    if (!recovery.removed) {
      recovery.supersedes = track('public/scripts/world-info.js/_save' + JSON.stringify(oldName));
      if (await save(newName, data, true, permit) === false) {
        return false;
      }
      recovery.attemptedDelete = true;
      if (!await remove(oldName, permit)) {
        return false;
      }
      recovery.removed = true;
    }
    permit.removed = oldName;
    if (await relink(oldName, newName, recovery) === false) {
      return false;
    }
    recovery.supersedes?.(false);
    confirmedDelete(false);
    worldRenames.delete(oldName);
    worldRenames.delete(newName);
    complete = true;
    return true;
  } finally {
    if (permit?.removed === oldName) {
      recovery.removed = true;
    }
    try {
      await permit?.release();
    } finally {
      settle(!complete);
    }
  }
}

/**
 * @param {string|URL|Request} input
 * @returns {boolean}
 */
export function storyRequest(input) {
  const value = input instanceof Request ? input.url : input;
  const url = new URL(value, location.href);
  return url.origin === location.origin && /^\/api\//i.test(url.pathname) && url.pathname !== route;
}

/**
 * @param {XMLHttpRequest} xhr
 * @param {string} url
 * @returns {void}
 */
export function identify(xhr, url) {
  if (storyRequest(url)) {
    xhr.setRequestHeader('X-Universe-Tab', tab);
  }
}

/**
 * @param {string} key
 * @returns {void}
 */
export function fail(key) {
  failures.set(key, Symbol());
}

/**
 * @param {string} key
 * @returns {Function}
 */
export function track(key) {
  const previous = failures.get(key);
  return failed => {
    if (failed) {
      fail(key);
    } else if (failures.get(key) === previous) {
      failures.delete(key);
    }
  };
}

/**
 * @param {string} avatar
 * @param {Function} currentChat
 * @param {boolean} locked
 * @param {Function} remove
 * @returns {Promise<boolean>}
 */
export async function trackPersonaDeletion(avatar, currentChat, locked, remove) {
  const leave = await enter();
  const settle = track('delete-persona:' + avatar);
  let complete = false;
  try {
    const checkChat = () => {
      if (personaChats.has(avatar) && currentChat() !== personaChats.get(avatar)) {
        throw new Error('Return to the original chat to finish deleting this persona.');
      }
      return personaChats.has(avatar);
    };
    checkChat();
    if (locked) {
      personaChats.set(avatar, currentChat());
    }
    complete = await remove(checkChat);
    if (complete) {
      personaChats.delete(avatar);
    }
    return complete;
  } finally {
    settle(!complete);
    leave();
  }
}

/**
 * @param {string} avatar
 * @param {object} headers
 * @returns {Promise<boolean>}
 */
export async function portraitMissing(avatar, headers) {
  const response = await fetch('/api/avatars/get', { method: 'POST', headers, cache: 'no-store' });
  if (!response.ok) {
    return false;
  }
  const portraits = await response.json();
  return Array.isArray(portraits) && portraits.every(name => typeof name === 'string') && !portraits.includes(avatar);
}

/**
 * @param {string} avatar
 * @param {object} metadata
 * @param {Function} save
 * @param {string} character
 * @param {string} group
 * @param {string} chat
 * @returns {Promise<void>}
 */
export async function savePersonaChat(avatar, metadata, save, character, group, chat) {
  const chatKey = JSON.stringify([character, group, chat]);
  const settle = track('persona-chat:' + JSON.stringify([avatar, character, group, chat]));
  const writes = ['public/script.js/saveChatConditional' + chatKey];
  if (group) {
    writes.push('public/scripts/group-chats.js/saveGroupChat' + JSON.stringify([group, chat]),
      'public/scripts/group-chats.js/_save' + JSON.stringify(group));
  } else {
    writes.push('public/script.js/saveChat' + JSON.stringify([character, chat]));
  }
  const previouslyLocked = metadata.persona === avatar;
  if (previouslyLocked) {
    delete metadata.persona;
  }
  try {
    await save();
    if (group) {
      await pending.get('group:' + group)?.run();
    }
    if (writes.some(key => failures.has(key))) {
      throw new Error('The persona could not be removed from this chat. Retry deletion in this chat.');
    }
    settle(false);
  } catch (error) {
    if (previouslyLocked && !Object.hasOwn(metadata, 'persona')) {
      metadata.persona = avatar;
    }
    settle(true);
    throw error;
  }
}

/**
 * @returns {Promise<Function>}
 */
export async function enter() {
  while (frozen) {
    await frozen;
  }
  active++;
  return () => { active--; completed++; };
}

/**
 * @param {string} key
 * @returns {void}
 */
export function cancel(key) {
  const job = pending.get(key);
  if (job) {
    clearTimeout(job.timer);
    pending.delete(key);
  }
}

/**
 * @param {string|Function} identity
 * @param {Function} callback
 * @param {number} delay
 * @returns {Function}
 */
export function debounce(identity, callback, delay) {
  return (...args) => {
    const key = typeof identity === 'function' ? identity(...args) : identity;
    cancel(key);
    const run = async () => {
      if (pending.get(key)?.run !== run) {
        return;
      }
      cancel(key);
      const leave = await enter();
      const settle = typeof identity === 'function' ? null : track(key);
      try {
        await callback(...args);
        settle?.(false);
      } catch (error) {
        settle?.(true);
        throw error;
      } finally {
        leave();
      }
    };
    pending.set(key, { run, timer: setTimeout(run, delay) });
  };
}

/**
 * @param {string} command
 * @param {object} extra
 * @param {boolean} keepalive
 * @returns {Promise<object>}
 */
async function control(command, extra = {}, keepalive = false) {
  const response = await fetch(route, {
    method: 'POST', headers: headers(), cache: 'no-store', keepalive,
    body: JSON.stringify({ command, tab, ...extra }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    const error = new Error(`Universe checkpoint control returned HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/**
 * @returns {void}
 */
function release() {
  clearTimeout(localDeadline);
  epoch = null;
  frozen = null;
  resume?.();
  resume = null;
}

/**
 * @param {object} state
 * @returns {Promise<void>}
 */
async function observe(state) {
  if (state.epoch !== epoch) {
    release();
    epoch = state.epoch;
  }
  if (!epoch || suspended) {
    return;
  }
  if (frozen) {
    if (!state.acknowledged) {
      await control('ack', { epoch });
    }
    return;
  }
  if (failures.size) {
    await control('failed', { epoch });
    return;
  }
  if (active || generating()) {
    return;
  }
  if (pending.size) {
    await Promise.all(Array.from(pending.values(), job => job.run()));
    return;
  }
  frozen = new Promise(resolve => { resume = resolve; });
  localDeadline = setTimeout(release, 62_000);
  await control('ack', { epoch });
}

/**
 * @param {Function} getHeaders
 * @param {Function} isGenerating
 * @returns {Promise<void>}
 */
export async function connect(getHeaders, isGenerating) {
  headers = getHeaders;
  generating = isGenerating;
  window.addEventListener('pagehide', () => {
    suspended = true;
    clearTimeout(localDeadline);
    void control('leave', { clean: !active && !pending.size && !generating() && !failures.size }, true)
      .catch(error => console.warn('[universe]', error.message));
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      location.reload();
    }
  });
  const previousFetch = window.fetch.bind(window);
  window.fetch = (input, options) => {
    if (!storyRequest(input)) {
      return previousFetch(input, options);
    }
    const tagged = new Headers(options?.headers ?? (input instanceof Request ? input.headers : undefined));
    tagged.set('X-Universe-Tab', tab);
    return previousFetch(input, { ...options, headers: tagged });
  };
  let initial;
  while (!suspended && !initial?.admitted) {
    try {
      await control('join');
      if (!suspended) {
        initial = await control('admit');
      }
      if (!suspended && !initial?.admitted) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error) {
      console.warn('[universe]', error.message);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  if (suspended) {
    return new Promise(() => {});
  }
  await observe(initial);
  let reported = completed;
  const poll = async () => {
    if (suspended) {
      return;
    }
    let delay = epoch ? 100 : 1000;
    try {
      const idle = reported !== completed && !active && !pending.size && !generating() && !failures.size;
      const turn = completed;
      const state = await control(idle ? 'idle' : 'poll');
      if (idle) {
        reported = turn;
      }
      await observe(state);
      delay = state.epoch ? 100 : 1000;
    } catch (error) {
      console.warn('[universe]', error.message);
      delay = 1000;
    } finally {
      if (!suspended) {
        setTimeout(poll, delay);
      }
    }
  };
  setTimeout(poll, 100);
  while (frozen) {
    await frozen;
  }
}
