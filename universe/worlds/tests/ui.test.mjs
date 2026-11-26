import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { WorldsApi } from '../public/api.mjs';
import { WorldsApp } from '../public/app.mjs';
import { CampaignModal } from '../public/components/CampaignModal.mjs';
import { CharacterModal } from '../public/components/CharacterModal.mjs';
import { ChatView } from '../public/components/ChatView.mjs';
import { ComposerBar } from '../public/components/ComposerBar.mjs';
import { ConfirmModal } from '../public/components/ConfirmModal.mjs';
import { InspectorDrawer } from '../public/components/InspectorDrawer.mjs';
import { Security } from '../src/http/Security.mjs';
import { OpenRouterClient } from '../src/openrouter/OpenRouterClient.mjs';
import { WorldsServer } from '../src/server.mjs';
import { SqliteStore } from '../src/store/SqliteStore.mjs';
import { createFakeModelCatalog } from './support/createFakeModelCatalog.mjs';

const PublicDirPath = path.resolve(import.meta.dirname, '..', 'public');

/**
 * @param {string} directoryPath
 * @returns {Array<string>}
 */
function listFilesRecursively(directoryPath) {
  const results = [];
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursively(fullPath));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results.sort();
}

/**
 * @returns {{documentRef: object, createRootShell: () => object}}
 */
function createFakeDomEnvironment() {
  let focusedElement = null;
  const scrollLog = [];

  class FakeClassList {
    #element;

    /**
     * @param {FakeElement} element
     */
    constructor(element) {
      this.#element = element;
    }

    /**
     * @returns {Set<string>}
     */
    #readTokens() {
      const raw = this.#element.className.trim();
      return new Set(raw.length > 0 ? raw.split(/\s+/) : []);
    }

    /**
     * @param {Set<string>} tokens
     * @returns {void}
     */
    #writeTokens(tokens) {
      this.#element.className = [...tokens].join(' ');
    }

    /**
     * @param {...string} names
     * @returns {void}
     */
    add(...names) {
      const tokens = this.#readTokens();
      for (const name of names) {
        if (typeof name === 'string' && name.length > 0) {
          tokens.add(name);
        }
      }
      this.#writeTokens(tokens);
    }

    /**
     * @param {...string} names
     * @returns {void}
     */
    remove(...names) {
      const tokens = this.#readTokens();
      for (const name of names) {
        tokens.delete(name);
      }
      this.#writeTokens(tokens);
    }

    /**
     * @param {string} name
     * @returns {boolean}
     */
    contains(name) {
      return this.#readTokens().has(name);
    }
  }

  class FakeElement {
    #tagName;
    #attributes = new Map();
    #listeners = new Map();
    #children = [];
    #textContent = '';
    #className = '';
    #classList;

    /**
     * @param {string} tagName
     */
    constructor(tagName) {
      this.#tagName = String(tagName).toUpperCase();
      this.#classList = new FakeClassList(this);
      this.id = '';
      this.parentNode = null;
      this.type = FakeElement.defaultTypeFor(this.#tagName);
      this.value = '';
      this.checked = false;
      this.disabled = false;
      this.required = false;
      this.noValidate = false;
      this.placeholder = '';
      this.autocomplete = '';
      this.rows = 0;
      this.min = '';
      this.step = '';
      this.maxLength = 0;
      this.pattern = '';
      this.scrollTop = 0;
      this.scrollHeight = 100;
      this.selectionStart = 0;
      this.selectionEnd = 0;
    }

    /**
     * @param {string} upperTagName
     * @returns {string}
     */
    static defaultTypeFor(upperTagName) {
      const defaultTypes = { INPUT: 'text', BUTTON: 'submit', SELECT: 'select-one', TEXTAREA: 'textarea' };
      return defaultTypes[upperTagName] ?? '';
    }

    /**
     * @returns {boolean}
     */
    get isConnected() {
      let node = this;
      while (node !== null) {
        if (node === documentRef.body) {
          return true;
        }
        node = node.parentNode;
      }
      return false;
    }

    /**
     * @returns {string}
     */
    get tagName() {
      return this.#tagName;
    }

    /**
     * @returns {string}
     */
    get className() {
      return this.#className;
    }

    /**
     * @param {string} nextClass
     */
    set className(nextClass) {
      this.#className = String(nextClass);
      this.#attributes.set('class', this.#className);
    }

    /**
     * @returns {FakeClassList}
     */
    get classList() {
      return this.#classList;
    }

    /**
     * @returns {Array<FakeElement>}
     */
    get children() {
      return this.#children;
    }

    /**
     * @returns {string}
     */
    get textContent() {
      if (this.#children.length === 0) {
        return this.#textContent;
      }
      return this.#children.map((child) => child.textContent).join('');
    }

    /**
     * @param {string} nextText
     */
    set textContent(nextText) {
      for (const child of this.#children) {
        child.parentNode = null;
      }
      this.#children = [];
      this.#textContent = nextText === null || nextText === undefined ? '' : String(nextText);
    }

    /**
     * @returns {never}
     */
    get innerHTML() {
      throw new Error('innerHTML access is forbidden.');
    }

    /**
     * @param {string} value
     */
    set innerHTML(value) {
      throw new Error(`innerHTML assignment is forbidden: ${String(value)}`);
    }

    /**
     * @returns {never}
     */
    get outerHTML() {
      throw new Error('outerHTML access is forbidden.');
    }

    /**
     * @param {string} value
     */
    set outerHTML(value) {
      throw new Error(`outerHTML assignment is forbidden: ${String(value)}`);
    }

    /**
     * @returns {never}
     */
    insertAdjacentHTML() {
      throw new Error('insertAdjacentHTML is forbidden.');
    }

    /**
     * @param {string} attrName
     * @param {string} attrValue
     * @returns {void}
     */
    setAttribute(attrName, attrValue) {
      if (String(attrName).toLowerCase() === 'style') {
        throw new Error('Setting inline style attribute is forbidden.');
      }
      const strValue = String(attrValue);
      this.#attributes.set(attrName, strValue);
      if (attrName === 'id') {
        this.id = strValue;
      } else if (attrName === 'class') {
        this.#className = strValue;
      }
    }

    /**
     * @param {string} attrName
     * @returns {string | null}
     */
    getAttribute(attrName) {
      if (attrName === 'id' && this.id.length > 0) {
        return this.id;
      }
      return this.#attributes.get(attrName) ?? null;
    }

    /**
     * @param {...FakeElement} nodes
     * @returns {void}
     */
    append(...nodes) {
      for (const node of nodes) {
        if (node.parentNode !== null) {
          node.parentNode.#children = node.parentNode.#children.filter((sibling) => sibling !== node);
        }
        node.parentNode = this;
        this.#children.push(node);
        if (this.#tagName === 'SELECT' && this.#children.length === 1 && !this.value) {
          this.value = node.value;
        }
      }
    }

    /**
     * @param {...FakeElement} nodes
     * @returns {void}
     */
    replaceChildren(...nodes) {
      for (const child of this.#children) {
        child.parentNode = null;
      }
      this.#textContent = '';
      this.#children = [];
      this.append(...nodes);
    }

    /**
     * @param {string} eventType
     * @param {Function} handler
     * @returns {void}
     */
    addEventListener(eventType, handler) {
      const list = this.#listeners.get(eventType) ?? [];
      list.push(handler);
      this.#listeners.set(eventType, list);
    }

    /**
     * @param {string} eventType
     * @param {Function} handler
     * @returns {void}
     */
    removeEventListener(eventType, handler) {
      const list = this.#listeners.get(eventType) ?? [];
      this.#listeners.set(
        eventType,
        list.filter((entry) => entry !== handler),
      );
    }

    /**
     * @param {string} eventType
     * @param {object} [eventPayload]
     * @returns {Promise<void>}
     */
    async dispatchEvent(eventType, eventPayload = {}) {
      const event = {
        type: eventType,
        target: this,
        defaultPrevented: false,
        /**
         * @returns {void}
         */
        preventDefault() {
          this.defaultPrevented = true;
        },
        ...eventPayload,
      };
      const handlers = [...(this.#listeners.get(eventType) ?? [])];
      for (const handler of handlers) {
        await handler(event);
      }
    }

    /**
     * @returns {void}
     */
    focus() {
      if (this.disabled || !this.isConnected) {
        return;
      }
      focusedElement = this;
    }

    /**
     * @param {object} scrollOptions
     * @returns {void}
     */
    scrollIntoView(scrollOptions) {
      scrollLog.push({ element: this, options: scrollOptions });
    }

    /**
     * @param {number} rangeStart
     * @param {number} rangeEnd
     * @returns {void}
     * @throws {Error}
     */
    setSelectionRange(rangeStart, rangeEnd) {
      if (this.#tagName !== 'TEXTAREA' && !['text', 'search', 'password', 'url', 'tel'].includes(this.type)) {
        throw new Error(`InvalidStateError: setSelectionRange is not supported on ${this.#tagName} ${this.type}.`);
      }
      this.selectionStart = rangeStart;
      this.selectionEnd = rangeEnd;
    }

    /**
     * @param {FakeElement} node
     * @returns {boolean}
     */
    contains(node) {
      return node === this || this.#children.some((child) => child.contains(node));
    }

    /**
     * @param {string} selector
     * @returns {FakeElement | null}
     */
    querySelector(selector) {
      const matches = this.querySelectorAll(selector);
      return matches[0] ?? null;
    }

    /**
     * @param {string} selector
     * @returns {Array<FakeElement>}
     */
    querySelectorAll(selector) {
      const found = [];
      /**
       * @param {FakeElement} node
       * @returns {void}
       * @throws {Error}
       */
      const visit = (node) => {
        for (const child of node.children) {
          if (matchesSelector(child, selector)) {
            found.push(child);
          }
          visit(child);
        }
      };
      visit(this);
      return found;
    }
  }

  /**
   * @param {FakeElement} element
   * @param {string} selector
   * @returns {boolean}
   * @throws {SyntaxError}
   */
  function matchesSelector(element, selector) {
    if (selector.startsWith('#')) {
      if (!/^#[A-Za-z_-][A-Za-z0-9_-]*$/.test(selector)) {
        throw new SyntaxError(`'${selector}' is not a valid selector.`);
      }
      return element.id === selector.slice(1);
    }
    if (selector.startsWith('.')) {
      return element.classList.contains(selector.slice(1));
    }
    const metaMatch = /^meta\[name="([^"]+)"\]$/.exec(selector);
    if (metaMatch !== null) {
      return element.tagName === 'META' && element.getAttribute('name') === metaMatch[1];
    }
    return element.tagName === selector.toUpperCase();
  }

  const docListeners = new Map();
  const metaTag = new FakeElement('meta');
  metaTag.setAttribute('name', 'worlds-csrf');
  metaTag.setAttribute('content', 'test-csrf-token-hex');

  const bodyElement = new FakeElement('body');

  const documentRef = {
    body: bodyElement,
    scrollLog,
    /**
     * @returns {FakeElement}
     */
    get activeElement() {
      return focusedElement !== null && focusedElement.isConnected ? focusedElement : bodyElement;
    },
    /**
     * @param {string} tagName
     * @returns {FakeElement}
     */
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    /**
     * @param {string} eventType
     * @param {Function} handler
     * @returns {void}
     */
    addEventListener(eventType, handler) {
      const list = docListeners.get(eventType) ?? [];
      list.push(handler);
      docListeners.set(eventType, list);
    },
    /**
     * @param {string} eventType
     * @param {Function} handler
     * @returns {void}
     */
    removeEventListener(eventType, handler) {
      const list = docListeners.get(eventType) ?? [];
      docListeners.set(
        eventType,
        list.filter((entry) => entry !== handler),
      );
    },
    /**
     * @param {string} keyName
     * @returns {Promise<void>}
     * @throws {Error}
     */
    async dispatchKeydown(keyName) {
      const handlers = [...(docListeners.get('keydown') ?? [])];
      for (const handler of handlers) {
        await handler({
          key: keyName,
          /**
           * @returns {void}
           */
          preventDefault() {},
        });
      }
    },
    /**
     * @param {string} eventType
     * @returns {number}
     */
    getDocumentListenerCount(eventType) {
      return (docListeners.get(eventType) ?? []).length;
    },
    /**
     * @param {string} selector
     * @returns {FakeElement | null}
     * @throws {SyntaxError}
     */
    querySelector(selector) {
      if (matchesSelector(metaTag, selector)) {
        return metaTag;
      }
      return null;
    },
  };

  /**
   * @returns {FakeElement}
   */
  function createRootShell() {
    const root = new FakeElement('div');
    root.id = 'app';
    const ids = [
      ['select', 'campaign-select'],
      ['button', 'load-more-campaigns-btn'],
      ['button', 'new-campaign-btn'],
      ['button', 'edit-campaign-btn'],
      ['button', 'scene-pill'],
      ['span', 'spend-badge'],
      ['span', 'sync-badge'],
      ['button', 'sync-save-btn'],
      ['button', 'inspector-toggle-btn'],
      ['span', 'findings-badge'],
      ['div', 'spend-warning-banner'],
      ['div', 'global-status-banner'],
      ['section', 'chat-view'],
      ['section', 'composer-bar'],
      ['div', 'drawer-backdrop'],
      ['aside', 'inspector-drawer'],
      ['div', 'modal-root'],
    ];
    for (const [tag, elementId] of ids) {
      const node = new FakeElement(tag);
      node.id = elementId;
      root.append(node);
    }
    bodyElement.append(root);
    return root;
  }

  return { documentRef, createRootShell };
}

/**
 * @param {object} rootElement
 * @returns {Array<string>}
 */
function findAllButtonLabels(rootElement) {
  return rootElement.querySelectorAll('button').map((btn) => btn.textContent);
}

/**
 * @param {object} root
 * @param {string} label
 * @returns {object}
 * @throws {Error}
 */
function findButton(root, label) {
  const button = root.querySelectorAll('button').find((candidate) => candidate.textContent === label);
  if (button === undefined) {
    throw new Error(`Button "${label}" not found.`);
  }
  return button;
}

/**
 * @param {() => boolean} predicate
 * @param {number} [timeoutMs]
 * @returns {Promise<void>}
 * @throws {Error}
 */
async function waitUntil(predicate, timeoutMs = 2000) {
  const deadlineMs = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadlineMs) {
      throw new Error('Timed out waiting for the condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * @returns {{promise: Promise<any>, resolve: (value: any) => void}}
 */
function createDeferred() {
  const deferred = {};
  deferred.promise = new Promise((resolve) => {
    deferred.resolve = resolve;
  });
  return deferred;
}

/**
 * @param {number} status
 * @param {unknown} body
 * @returns {Response}
 */
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * @param {Promise<any>} pending
 * @param {AbortSignal | undefined} signal
 * @returns {Promise<any>}
 * @throws {Error}
 */
function awaitUnlessAborted(pending, signal) {
  if (signal === undefined) {
    return pending;
  }
  return new Promise((resolve, reject) => {
    const abortError = new Error('The operation was aborted.');
    abortError.name = 'AbortError';
    if (signal.aborted) {
      reject(abortError);
      return;
    }
    signal.addEventListener('abort', () => reject(abortError), { once: true });
    pending.then(resolve, reject);
  });
}

/**
 * @param {number} count
 * @param {{fetchedAt?: string | null, stale?: boolean, warning?: string | null}} [options]
 * @returns {{defaults: Record<string, string>, openrouter: Array<object>, fetchedAt: string | null, stale: boolean, warning: string | null}}
 */
function buildCatalog(count, { fetchedAt = '2026-11-25T12:00:00.000Z', stale = false, warning = null } = {}) {
  const openrouter = [];
  for (let index = 0; index < count; index += 1) {
    openrouter.push({
      id: `vendor/model-${String(index).padStart(3, '0')}`,
      name: `Model ${index}`,
      contextLength: 32768,
      promptCostPerMillion: 0.3,
      completionCostPerMillion: 0.5,
      isModerated: false,
      supportsStructuredOutput: true,
      providerCount: 1,
    });
  }
  return {
    defaults: {
      director: 'vendor/model-000',
      composer: 'vendor/model-000',
      main: 'vendor/model-000',
      recurring: 'vendor/model-000',
      scribe: 'vendor/model-000',
    },
    openrouter,
    fetchedAt,
    stale,
    warning,
  };
}

/**
 * @returns {object}
 */
function buildBrowserSettings() {
  return {
    models: {
      director: 'vendor/model-001',
      composer: 'vendor/model-002',
      main: 'vendor/model-003',
      recurring: 'vendor/model-004',
      scribe: 'vendor/model-005',
    },
    publicOdds: 8,
    privateOdds: 30,
    scribeInterval: 10,
    pedantEnabled: true,
    dailyWarnUsd: null,
    apiKey: { configured: true, source: 'env' },
  };
}

/**
 * @param {Record<string, string | Array<string>>} [overrides]
 * @returns {Record<string, string | Array<string> | Record<string, string>>}
 */
function buildCard(overrides = {}) {
  return {
    age: '',
    hair: '',
    eyes: '',
    height: '',
    body: '',
    face: '',
    features: '',
    traits: '',
    habits: '',
    behavior: '',
    likes: '',
    dislikes: '',
    sexualityOrientation: '',
    sexualityKinks: '',
    sexualityLikes: '',
    sexualityDislikes: '',
    speakingStyle: '',
    speakingQuirks: '',
    personalitySummary: '',
    scenario: '',
    characterNote: '',
    speechExamples: [],
    filedFactIds: {},
    ...overrides,
  };
}

/**
 * @param {{card?: Record<string, string | Array<string>>, bookHints?: Record<string, string>, id?: string, name?: string, slug?: string}} [options]
 * @returns {object}
 */
function buildCharacter({ card = {}, bookHints = {}, id = 'char-1', name = 'Maya', slug = 'maya' } = {}) {
  return {
    id,
    slug,
    name,
    aliases: [],
    tier: 'main',
    isPlayer: false,
    archived: false,
    modelOverride: null,
    avatarToken: 'slate',
    avatarInitials: 'MA',
    card: buildCard(card),
    bookHints,
  };
}

/**
 * @param {Array<object>} items
 * @returns {{items: Array<object>, total: number, nextCursor: null}}
 */
function buildPage(items) {
  return { items, total: items.length, nextCursor: null };
}

const BrowserCampaign = Object.freeze({
  id: 'camp-1',
  title: 'Harbor Nights',
  premise: '',
  playerCharacterId: null,
  sceneState: Object.freeze({
    sceneNumber: 1,
    day: 1,
    timeLabel: 'Morning',
    location: 'Harbor Pier',
    sceneType: 'public',
    presentIds: [],
    remoteIds: [],
    offscreenNotes: {},
    activeWalkOns: [],
  }),
});

const StatusCases = Object.freeze([
  {
    catalog: buildCatalog(2),
    expectedText: 'OpenRouter models: 2 · Cached 2026-11-25T12:00:00.000Z',
  },
  {
    catalog: buildCatalog(2, { stale: true, warning: 'OpenRouter models catalog returned HTTP 503. Showing cached OpenRouter catalog.' }),
    expectedText: 'OpenRouter models: 2 (stale cache · 2026-11-25T12:00:00.000Z)',
  },
  {
    catalog: buildCatalog(0, { fetchedAt: null, stale: true, warning: 'OpenRouter models catalog returned HTTP 503.' }),
    expectedText: 'OpenRouter models: 0 (unavailable)',
  },
]);

/**
 * @param {object} root
 * @returns {Array<string>}
 */
function listMetaTexts(root) {
  return root.querySelectorAll('.item-meta').map((element) => element.textContent);
}

/**
 * @param {object} root
 * @param {string} levelClass
 * @returns {Array<string>}
 */
function listAlertTexts(root, levelClass) {
  return root
    .querySelectorAll('.inline-alert')
    .filter((element) => element.classList.contains(levelClass))
    .map((element) => element.textContent);
}

/**
 * @param {{catalogHandler?: (request: object) => Promise<{status: number, body: object}> | {status: number, body: object}, refreshHandler?: (request: object) => Promise<{status: number, body: object}> | {status: number, body: object}, settingsPutHandler?: (request: object) => {status: number, body: object}, characterHandler?: (request: object) => {status: number, body: object}, characterGetHandler?: (request: object) => Promise<{status: number, body: object}> | {status: number, body: object}, castItems?: Array<object>, secondCampaign?: boolean, secondCastItems?: Array<object>, ignoreAbortForModels?: boolean}} [options]
 * @returns {{app: WorldsApp, shell: object, documentRef: object, requests: Array<object>, unexpected: Array<string>}}
 * @throws {TypeError}
 */
function createBrowserHarness({
  catalogHandler = () => ({ status: 200, body: buildCatalog(2) }),
  refreshHandler = () => ({ status: 200, body: buildCatalog(2) }),
  settingsPutHandler = (request) => ({ status: 200, body: { ...request.body, warnings: [] } }),
  characterHandler = (request) => ({ status: 200, body: { id: 'char-1', slug: 'maya', name: 'Maya', isPlayer: false, warnings: [], ...request.body } }),
  characterGetHandler = () => ({ status: 200, body: buildCharacter() }),
  castItems = [],
  secondCampaign = false,
  secondCastItems = [],
  ignoreAbortForModels = false,
} = {}) {
  const { documentRef, createRootShell } = createFakeDomEnvironment();
  const shell = createRootShell();
  const requests = [];
  const unexpected = [];

  const api = new WorldsApi({
    csrfToken: 'ui-test-csrf',
    /**
     * @param {string} url
     * @param {{method: string, headers: Record<string, string>, body?: string, signal?: AbortSignal}} init
     * @returns {Promise<Response>}
     * @throws {Error}
     */
    fetchImpl: async (url, init) => {
      const parsed = new URL(url, 'http://worlds.example');
      const record = {
        method: init.method,
        url,
        path: parsed.pathname,
        headers: init.headers,
        body: init.body === undefined ? null : JSON.parse(init.body),
      };
      requests.push(record);
      const routeKey = `${record.method} ${record.path}`;
      const modelsSignal = ignoreAbortForModels ? undefined : init.signal;
      if (routeKey === 'GET /api/models') {
        const answer = await awaitUnlessAborted(Promise.resolve(catalogHandler(record)), modelsSignal);
        return jsonResponse(answer.status, answer.body);
      }
      if (routeKey === 'POST /api/models/refresh') {
        const answer = await awaitUnlessAborted(Promise.resolve(refreshHandler(record)), modelsSignal);
        return jsonResponse(answer.status, answer.body);
      }
      if (routeKey === 'GET /api/health') {
        return jsonResponse(200, { status: 'ok', sync: { status: 'local_only', mode: 'local_only' }, dailySpend: { totalUsd: 0, unpricedCount: 0 } });
      }
      if (routeKey === 'GET /api/settings') {
        return jsonResponse(200, buildBrowserSettings());
      }
      if (routeKey === 'PUT /api/settings') {
        const answer = settingsPutHandler(record);
        return jsonResponse(answer.status, answer.body);
      }
      if (routeKey === 'GET /api/campaigns') {
        return jsonResponse(200, buildPage(secondCampaign ? [BrowserCampaign, { ...BrowserCampaign, id: 'camp-2', title: 'Second' }] : [BrowserCampaign]));
      }
      if (routeKey === 'GET /api/campaigns/camp-1/characters') {
        return jsonResponse(200, buildPage(castItems));
      }
      if (secondCampaign && routeKey === 'GET /api/campaigns/camp-2/characters') {
        return jsonResponse(200, buildPage(secondCastItems));
      }
      if (/^GET \/api\/campaigns\/camp-1\/characters\/char-\d+$/.test(routeKey)) {
        const answer = await characterGetHandler(record);
        return jsonResponse(answer.status, answer.body);
      }
      if (/^GET \/api\/campaigns\/camp-[12]\/(turns|findings)$/.test(routeKey)) {
        return jsonResponse(200, buildPage([]));
      }
      if (/^GET \/api\/campaigns\/camp-[12]\/memory$/.test(routeKey)) {
        return jsonResponse(200, {
          ...buildPage([]),
          section: 'subjects',
          dirty: false,
          lastTurnSeq: 0,
          turnsSinceScribe: 0,
          counts: { subjects: 0, facts: 0, relations: 0, threads: 0, rulings: 0 },
        });
      }
      if (routeKey === 'POST /api/campaigns/camp-1/characters' || routeKey === 'PATCH /api/campaigns/camp-1/characters/char-1') {
        const answer = characterHandler(record);
        return jsonResponse(answer.status, answer.body);
      }
      unexpected.push(routeKey);
      return jsonResponse(404, { error: `Unexpected request ${routeKey}` });
    },
  });

  const app = new WorldsApp({ api, rootElement: shell, documentRef });
  return { app, shell, documentRef, requests, unexpected };
}

/**
 * @param {{character?: object | null, catalog?: object}} [options]
 * @returns {{modal: CharacterModal, modalRoot: object, documentRef: object, shell: object, savedPayloads: Array<object>}}
 * @throws {TypeError}
 */
function createModalHarness({ character = null, catalog = buildCatalog(2) } = {}) {
  const { documentRef, createRootShell } = createFakeDomEnvironment();
  const shell = createRootShell();
  const modalRoot = shell.querySelector('#modal-root');
  const savedPayloads = [];
  const modal = new CharacterModal({
    modalRoot,
    documentRef,
    onSave: async (payload) => {
      savedPayloads.push(payload);
    },
  });
  modal.open({ character, modelCatalog: catalog, onRefreshModels: async () => {} });
  return { modal, modalRoot, documentRef, shell, savedPayloads };
}

/**
 * @param {object} root
 * @param {string} selector
 * @returns {Array<string>}
 * @throws {TypeError}
 */
function listOptionValues(root, selector) {
  return root
    .querySelector(selector)
    .querySelectorAll('option')
    .map((option) => option.value)
    .filter((value) => value.length > 0);
}

/**
 * @returns {{drawer: InspectorDrawer, drawerEl: object, documentRef: object, shell: object}}
 * @throws {TypeError}
 */
function createDrawerHarness() {
  const { documentRef, createRootShell } = createFakeDomEnvironment();
  const shell = createRootShell();
  const drawerEl = shell.querySelector('#inspector-drawer');
  const drawer = new InspectorDrawer({
    drawerElement: drawerEl,
    backdropElement: shell.querySelector('#drawer-backdrop'),
    documentRef,
    callbacks: {
      onOpenChange: () => {},
      onTabChange: async () => {},
      onSaveSettings: async () => {},
      onRefreshModels: async () => {},
    },
  });
  drawer.setSettings(buildBrowserSettings());
  drawer.setModelCatalog(buildCatalog(2));
  drawer.setTab('settings');
  return { drawer, drawerEl, documentRef, shell };
}

/**
 * @param {string} styleSource
 * @returns {Array<{selector: string, atRules: Array<string>, body: string}>}
 * @throws {Error}
 */
function parseCssRules(styleSource) {
  const cssText = styleSource.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  const frames = [];
  let preludeStart = 0;
  for (let index = 0; index < cssText.length; index += 1) {
    const character = cssText[index];
    if (character === '{') {
      const prelude = cssText.slice(preludeStart, index).trim().replace(/\s+/g, ' ');
      const atRules = frames.filter((frame) => frame.isAtRule).map((frame) => frame.prelude);
      frames.push({ prelude, isAtRule: prelude.startsWith('@'), atRules, bodyStart: index + 1 });
      preludeStart = index + 1;
    } else if (character === '}') {
      if (frames.length === 0) {
        throw new Error(`Unbalanced closing brace at offset ${index}.`);
      }
      const frame = frames.pop();
      if (!frame.isAtRule) {
        rules.push({ selector: frame.prelude, atRules: frame.atRules, body: cssText.slice(frame.bodyStart, index) });
      }
      preludeStart = index + 1;
    } else if (character === ';') {
      preludeStart = index + 1;
    }
  }
  if (frames.length > 0) {
    throw new Error('Unbalanced opening brace at the end of the stylesheet.');
  }
  return rules;
}

describe('Static Screen-Law, Security, and Code-Law Audit across public/**', () => {
  it('verifies zero inline styles, zero raw colors in html/mjs, zero innerHTML, zero emojis, and complete CSS tokens', () => {
    const publicFiles = listFilesRecursively(PublicDirPath);
    const relativePaths = publicFiles.map((filePath) => path.relative(PublicDirPath, filePath));

    assert.deepEqual(relativePaths, [
      'api.mjs',
      'app.mjs',
      'components/CampaignModal.mjs',
      'components/CharacterModal.mjs',
      'components/ChatView.mjs',
      'components/ComposerBar.mjs',
      'components/ConfirmModal.mjs',
      'components/FocusKeeper.mjs',
      'components/InspectorDrawer.mjs',
      'components/ModelCatalogView.mjs',
      'index.html',
      'styles.css',
    ]);

    const emojiPattern = /\p{Extended_Pictographic}/u;
    const rawHexColorPattern = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/;
    const rawFuncColorPattern = /\b(?:rgba?|hsla?)\s*\(/i;
    const inlineStyleAttrPattern = /\bstyle\s*=/i;
    const domStylePropPattern = /\.style\b/;
    const unsafeDomHtmlPattern = /\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\s*\(|new\s+Function)\b/;

    for (const filePath of publicFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      const relative = path.relative(PublicDirPath, filePath);

      assert.equal(emojiPattern.test(content), false, `Emoji found in ${relative}`);

      if (filePath.endsWith('.html') || filePath.endsWith('.mjs')) {
        assert.equal(inlineStyleAttrPattern.test(content), false, `Inline style= attribute found in ${relative}`);
        assert.equal(domStylePropPattern.test(content), false, `DOM .style property usage found in ${relative}`);
        assert.equal(rawHexColorPattern.test(content), false, `Raw hex color found in ${relative}`);
        assert.equal(rawFuncColorPattern.test(content), false, `Raw rgb/hsl color found in ${relative}`);
      }

      if (filePath.endsWith('.mjs')) {
        assert.equal(unsafeDomHtmlPattern.test(content), false, `Unsafe HTML/eval sink found in ${relative}`);
        assert.equal(/(^|\s)\/\//.test(content), false, `Prose // comment found in ${relative}`);
        const topExports = content.match(/^export\s+/gm) ?? [];
        assert.equal(topExports.length, 1, `Expected exactly 1 top-level export in ${relative}`);
      }
    }

    const indexHtml = fs.readFileSync(path.join(PublicDirPath, 'index.html'), 'utf8');
    assert.ok(indexHtml.includes('<meta name="worlds-csrf" content="__CSRF_TOKEN__">'));
    assert.ok(indexHtml.includes('<link rel="stylesheet" href="/styles.css">'));
    assert.ok(indexHtml.includes('<script type="module" src="/app.mjs"></script>'));

    const stylesCss = fs.readFileSync(path.join(PublicDirPath, 'styles.css'), 'utf8');
    for (const requiredClass of [
      '.avatar-sage',
      '.avatar-rose',
      '.avatar-amber',
      '.avatar-slate',
      '.avatar-plum',
      '.avatar-teal',
      '.avatar-indigo',
      '.avatar-coral',
      '.avatar-narrator',
      '.avatar-player',
      ':focus-visible',
      '@media (prefers-reduced-motion: reduce)',
      '@media (min-width: 960px)',
      '.is-hidden',
      '.is-open',
      '.is-loading',
      '.is-active',
      '.is-warning',
      '.is-danger',
      '.is-dirty',
    ]) {
      assert.ok(stylesCss.includes(requiredClass), `Missing CSS rule ${requiredClass}`);
    }
  });
});

describe('WorldsApi SSE stream parser and CSRF enforcement', () => {
  it('decodes 1-byte split UTF-8, split CRLF, pure CR, multi-line data, and ignores keepalive comments', async () => {
    const rawSsePayload = [
      ': keepalive comment',
      'event: phase',
      'data: {"phase":"composing"}',
      '',
      'event: beat_delta',
      'data: {"beatIndex":0,',
      'data: "speakerType":"character",',
      'data: "slug":"lize",',
      'data: "speakerName":"Lize",',
      'data: "delta":"Caf\u00e9 \u2014 \u4e16\u754c"}',
      '',
      'event: done',
      'data: {"ok":true}',
      '',
    ].join('\r\n');

    const encodedBytes = new TextEncoder().encode(rawSsePayload);
    const stream = new ReadableStream({
      start(controller) {
        for (let byteIndex = 0; byteIndex < encodedBytes.length; byteIndex += 1) {
          controller.enqueue(encodedBytes.slice(byteIndex, byteIndex + 1));
        }
        controller.close();
      },
    });

    const receivedEvents = [];
    await WorldsApi.consumeSseStream(
      { body: stream },
      {
        onEvent(eventPayload) {
          receivedEvents.push(eventPayload);
        },
      },
    );

    assert.equal(receivedEvents.length, 3);
    assert.deepEqual(receivedEvents[0], { event: 'phase', data: { phase: 'composing' } });
    assert.deepEqual(receivedEvents[1], {
      event: 'beat_delta',
      data: {
        beatIndex: 0,
        speakerType: 'character',
        slug: 'lize',
        speakerName: 'Lize',
        delta: 'Caf\u00e9 \u2014 \u4e16\u754c',
      },
    });
    assert.deepEqual(receivedEvents[2], { event: 'done', data: { ok: true } });

    const pureCrPayload = 'event: phase\rdata: {"phase":"directing"}\r\revent: done\rdata: {"ok":true}\r\r';
    const crBytes = new TextEncoder().encode(pureCrPayload);
    const crStream = new ReadableStream({
      start(controller) {
        controller.enqueue(crBytes);
        controller.close();
      },
    });
    const crEvents = [];
    await WorldsApi.consumeSseStream({ body: crStream }, { onEvent: (ev) => crEvents.push(ev) });
    assert.equal(crEvents.length, 2);
    assert.equal(crEvents[0].data.phase, 'directing');
  });

  it('throws loudly on SSE error events and cancels reader immediately on AbortSignal', async () => {
    const errorSse = 'event: error\ndata: {"statusCode":502,"message":"Upstream model failure"}\n\n';
    const errorStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(errorSse));
        controller.close();
      },
    });

    await assert.rejects(
      () => WorldsApi.consumeSseStream({ body: errorStream }, { onEvent: () => {} }),
      (err) => err.message === 'Upstream model failure' && err.statusCode === 502,
    );

    let cancelCalled = false;
    let releaseCalled = false;
    let resolvePendingRead = null;
    const fakeReader = {
      /**
       * @returns {Promise<{done: boolean, value: undefined}>}
       */
      read() {
        return new Promise((resolve) => {
          resolvePendingRead = resolve;
        });
      },
      /**
       * @returns {Promise<void>}
       */
      async cancel() {
        cancelCalled = true;
        if (resolvePendingRead !== null) {
          resolvePendingRead({ done: true, value: undefined });
        }
      },
      /**
       * @returns {void}
       */
      releaseLock() {
        releaseCalled = true;
      },
    };
    const fakeResponse = {
      body: {
        /**
         * @returns {object}
         */
        getReader() {
          return fakeReader;
        },
      },
    };

    const abortController = new AbortController();
    const consumePromise = WorldsApi.consumeSseStream(fakeResponse, {
      onEvent: () => {},
      signal: abortController.signal,
    });
    abortController.abort();

    await assert.rejects(consumePromise, (err) => err.name === 'AbortError');
    assert.equal(cancelCalled, true);
    assert.equal(releaseCalled, true);
  });

  it('enforces X-Worlds-CSRF on mutating requests and rejects missing/placeholder tokens', async () => {
    const uninitApi = new WorldsApi({
      csrfToken: '__CSRF_TOKEN__',
      fetchImpl: async () => new Response('{}', { status: 200 }),
    });
    await assert.rejects(() => uninitApi.createCampaign({ title: 'Test' }), /Missing CSRF token/);

    const observedCalls = [];
    const api = new WorldsApi({
      csrfToken: 'valid-csrf-hex-123',
      fetchImpl: async (url, init) => {
        observedCalls.push({ url, init });
        if (String(url).includes('/turns')) {
          return new Response(JSON.stringify({ error: 'Campaign busy' }), { status: 409 });
        }
        return new Response(JSON.stringify({ id: 'camp-1', title: 'Chronicle' }), { status: 201 });
      },
    });

    const created = await api.createCampaign({ title: 'Chronicle' });
    assert.equal(created.id, 'camp-1');
    assert.equal(observedCalls[0].init.headers['X-Worlds-CSRF'], 'valid-csrf-hex-123');
    assert.equal(observedCalls[0].init.headers['Content-Type'], 'application/json');

    await assert.rejects(
      () => api.runTurn('camp-1', { text: 'Hi', mode: 'normal' }, { onEvent: () => {} }),
      (err) => err.statusCode === 409 && err.message === 'Campaign busy',
    );
  });
});

describe('DOM XSS escaping, Screen-Law button order, and interactive workflows', () => {
  it('renders narration in the pending card as narration-styled text without tags and without HTML injection', () => {
    const { documentRef, createRootShell } = createFakeDomEnvironment();
    const shell = createRootShell();
    const chatContainer = shell.querySelector('#chat-view');
    const chatView = new ChatView({
      container: chatContainer,
      documentRef: /** @type {Document} */ (documentRef),
      onLoadEarlier: async () => {},
      onRegenerate: async () => {},
      onSaveEdit: async () => {},
      onRequestDelete: () => {},
    });
    chatView.setCampaignActive(true);

    /**
     * @param {Record<string, unknown>} options
     * @returns {{lines: string[], narration: string[], whole: string, speaker: string}}
     * @throws {Error}
     */
    const preview = (options) => {
      chatView.startStreaming({ userSpeakerType: 'player', userSpeakerName: 'Frost', ...options });
      const card = chatContainer.querySelector('.turn-streaming');
      const textElement = card.querySelector('.beat-text');
      const result = {
        speaker: card.querySelector('.beat-speaker').textContent,
        lines: textElement.querySelectorAll('span').map((span) => span.textContent),
        narration: textElement.querySelectorAll('.beat-narration').map((span) => span.textContent),
        whole: card.textContent,
      };
      chatView.clearStreaming();
      return result;
    };

    const boxed = preview({ userText: 'I look at her.', narrationText: 'Her hair is dyed black.' });
    assert.deepEqual(boxed.lines, ['I look at her.', 'Her hair is dyed black.']);
    assert.deepEqual(boxed.narration, ['Her hair is dyed black.']);

    const typed = preview({ userText: 'I look at her. <narration>Her hair is dyed black.</narration> Then she waits.' });
    assert.deepEqual(typed.lines, ['I look at her.', 'Her hair is dyed black.', 'Then she waits.']);
    assert.deepEqual(typed.narration, ['Her hair is dyed black.']);
    assert.equal(typed.whole.includes('<narration>'), false);
    assert.equal(typed.whole.includes('</narration>'), false);

    const both = preview({ userText: 'Hi <narration>One.</narration>', narrationText: 'Two.' });
    assert.deepEqual(both.narration, ['One.', 'Two.']);
    assert.equal(both.speaker, 'Frost');

    const encounterBox = preview({ mode: 'encounter', userText: '', narrationText: 'Her hair is dyed black.' });
    assert.equal(encounterBox.speaker, 'Frost');
    assert.deepEqual(encounterBox.lines, ['*(Encounter)*', 'Her hair is dyed black.']);
    assert.deepEqual(encounterBox.narration, ['Her hair is dyed black.']);

    const encounterTag = preview({ mode: 'encounter', userText: '<narration>Her hair is dyed black.</narration>' });
    assert.equal(encounterTag.speaker, 'Frost');
    assert.deepEqual(encounterTag.lines, ['*(Encounter)*', 'Her hair is dyed black.']);
    assert.equal(encounterTag.whole.includes('<narration>'), false);

    const encounterPlain = preview({ mode: 'encounter', userText: 'Someone knocks.', narrationText: 'Rain.' });
    assert.deepEqual(encounterPlain.lines, ['Someone knocks.', 'Rain.']);
    assert.deepEqual(preview({ mode: 'encounter', userText: '' }).lines, ['*(Encounter)*']);

    const tagOnly = preview({ userText: '<narration>Her hair is dyed black.</narration>' });
    assert.equal(tagOnly.speaker, 'Narrator');
    assert.deepEqual(tagOnly.narration, ['Her hair is dyed black.']);
    assert.equal(tagOnly.whole.includes('<narration>'), false);
    assert.equal(preview({ userText: '<narration>One.</narration>', narrationText: 'Two.' }).speaker, 'Narrator');

    const plain = preview({ userText: 'Just talking.' });
    assert.deepEqual(plain.narration, []);
    assert.deepEqual(plain.lines, ['Just talking.']);

    chatView.startStreaming({
      userText: '<u data-probe="1">underlined</u> <narration><script>alert(1)</script></narration>',
      narrationText: '<b>bold</b>',
    });
    assert.equal(chatContainer.querySelectorAll('u').length, 0);
    assert.equal(chatContainer.querySelectorAll('script').length, 0);
    assert.equal(chatContainer.querySelectorAll('b').length, 0);
    assert.ok(chatContainer.textContent.includes('<u data-probe="1">underlined</u>'));
    assert.ok(chatContainer.textContent.includes('<script>alert(1)</script>'));
    assert.ok(chatContainer.textContent.includes('<b>bold</b>'));
    chatView.clearStreaming();
  });

  it('renders malicious HTML/script payloads strictly via textContent in ChatView and InspectorDrawer', async () => {
    const { documentRef, createRootShell } = createFakeDomEnvironment();
    const shell = createRootShell();
    const xssImg = '<img src=x onerror=alert(1)>';
    const xssScript = '<script>alert(1)</script>';

    const savedEdits = [];
    const chatContainer = shell.querySelector('#chat-view');
    const chatView = new ChatView({
      container: chatContainer,
      documentRef,
      onLoadEarlier: async () => {},
      onRegenerate: async () => {},
      onSaveEdit: async (turnId, payload) => {
        savedEdits.push({ turnId, payload });
      },
      onRequestDelete: () => {},
    });

    chatView.setCampaignActive(true);
    chatView.setCharacters([
      {
        id: 'char-1',
        slug: 'lize',
        name: xssImg,
        avatarToken: 'rose',
        avatarInitials: 'LZ',
        isPlayer: false,
        archived: false,
      },
    ]);
    chatView.setTurnsPage({
      total: 2,
      nextCursor: 1,
      items: [
        {
          id: 'turn-2',
          seq: 2,
          role: 'assistant',
          mode: 'normal',
          sceneNumber: 1,
          truncated: true,
          rawText: xssScript,
          beats: [
            { id: 'beat-1', speakerType: 'narrator', characterId: null, speakerName: 'Narrator', text: xssImg },
            { id: 'beat-2', speakerType: 'character', characterId: 'char-1', speakerName: xssImg, text: xssScript },
          ],
        },
        {
          id: 'turn-1',
          seq: 1,
          role: 'user',
          mode: 'normal',
          sceneNumber: 1,
          oocNudge: xssImg,
          rawText: xssScript,
          beats: [
            { id: 'beat-0', speakerType: 'player', characterId: null, speakerName: xssScript, text: xssImg },
          ],
        },
      ],
    });

    const renderedTurns = chatContainer.querySelectorAll('.turn-card');
    assert.equal(renderedTurns.length, 2);
    assert.equal(renderedTurns[0].getAttribute('data-turn-id'), 'turn-1');
    assert.equal(renderedTurns[1].getAttribute('data-turn-id'), 'turn-2');
    assert.equal(chatContainer.querySelectorAll('img').length, 0);
    assert.equal(chatContainer.querySelectorAll('script').length, 0);
    assert.ok(chatContainer.textContent.includes(xssImg));
    assert.ok(chatContainer.textContent.includes(xssScript));
    assert.ok(chatContainer.textContent.includes('Load earlier'));
    assert.ok(chatContainer.textContent.includes('Truncated at model length limit'));

    chatView.startStreaming({ userText: xssImg, userSpeakerName: xssScript, oocNudge: xssImg });
    chatView.appendStreamDelta({
      beatIndex: 0,
      speakerType: 'character',
      slug: 'lize',
      speakerName: xssImg,
      delta: xssScript,
    });
    assert.equal(chatContainer.querySelectorAll('img').length, 0);
    assert.equal(chatContainer.querySelectorAll('script').length, 0);
    assert.ok(chatContainer.textContent.includes(xssScript));
    chatView.clearStreaming();

    const editButtons = chatContainer.querySelectorAll('button').filter((btn) => btn.textContent === 'Edit');
    await editButtons[1].dispatchEvent('click');
    const beatSelect = chatContainer.querySelector('#edit-beat-select-turn-2');
    assert.notEqual(beatSelect, null);
    beatSelect.value = 'beat-2';
    await beatSelect.dispatchEvent('change');
    const editorForm = chatContainer.querySelector('.inline-editor');
    const editorButtons = findAllButtonLabels(editorForm);
    assert.deepEqual(editorButtons, ['Cancel', 'Save']);
    const editArea = editorForm.querySelector('textarea');
    editArea.value = 'Updated prose line.';
    await editArea.dispatchEvent('input');
    await editorForm.dispatchEvent('submit');
    assert.deepEqual(savedEdits, [
      { turnId: 'turn-2', payload: { text: 'Updated prose line.', beatId: 'beat-2' } },
    ]);

    const drawerElement = shell.querySelector('#inspector-drawer');
    const backdropElement = shell.querySelector('#drawer-backdrop');
    const drawer = new InspectorDrawer({
      drawerElement,
      backdropElement,
      documentRef,
      callbacks: {
        onOpenChange: () => {},
        onTabChange: async () => {},
        onSaveScene: async () => {},
        onSetPresence: async () => {},
        onAddWalkOn: async () => {},
        onRemoveWalkOn: async () => {},
        onAddCharacter: () => {},
        onEditCharacter: () => {},
        onToggleArchiveCharacter: async () => {},
        onDeleteCharacter: () => {},
        onReloadCast: async () => {},
        onLoadMoreCast: async () => {},
        onLoadMemory: async () => {},
        onUpdateMemory: async () => {},
        onTellPreview: async () => ({ operations: [], refused: [], changes: [] }),
        onTellCommit: async () => {},
        onMuseSuggest: async () => null,
        onUseMuse: () => {},
        onLoadMoreFindings: async () => {},
        onLoadMoreRulings: async () => {},
        onResolveFinding: async () => {},
        onSaveSettings: async () => {},
      },
    });

    drawer.setCampaign({
      id: 'camp-1',
      title: 'Chronicle',
      sceneState: {
        sceneNumber: 2,
        day: 3,
        timeLabel: 'Night',
        location: xssImg,
        sceneType: 'private',
        presentIds: ['char-1'],
        remoteIds: [],
        offscreenNotes: { [xssScript]: xssImg },
        activeWalkOns: [xssScript],
      },
    });
    drawer.setCastPage({
      total: 1,
      nextCursor: null,
      items: [
        {
          id: 'char-1',
          slug: 'lize',
          name: xssImg,
          tier: 'main',
          card: { personalitySummary: xssScript },
          avatarToken: 'rose',
          avatarInitials: 'LZ',
          isPlayer: false,
          archived: false,
        },
      ],
    });
    drawer.setMemoryPage({
      section: 'facts',
      total: 1,
      nextCursor: null,
      dirty: true,
      lastTurnSeq: 2,
      turnsSinceScribe: 1,
      counts: { subjects: 1, facts: 1, relations: 0, threads: 0, rulings: 0 },
      items: [
        {
          id: 'F1',
          subjectLabel: xssImg,
          category: 'secret',
          text: xssScript,
          hidden: true,
          pinned: false,
          knownByLabels: [xssImg],
        },
      ],
    });
    drawer.setFindingsPage({
      total: 1,
      nextCursor: null,
      items: [
        {
          id: 'find-1',
          kind: 'secret_leak',
          subjectName: xssImg,
          speakerCharacterId: 'char-1',
          factId: 'F1',
          bookText: xssScript,
          summary: xssImg,
          quote: xssScript,
        },
      ],
    });

    for (const tabId of ['scene', 'cast', 'memory', 'findings']) {
      drawer.setTab(tabId);
      assert.equal(drawerElement.querySelectorAll('img').length, 0);
      assert.equal(drawerElement.querySelectorAll('script').length, 0);
      assert.ok(drawerElement.textContent.includes(xssImg) || drawerElement.textContent.includes(xssScript));
    }

    drawer.setOpen(true);
    assert.equal(drawer.isOpen(), true);
    assert.equal(documentRef.getDocumentListenerCount('keydown'), 1);
    await documentRef.dispatchKeydown('Escape');
    assert.equal(drawer.isOpen(), false);
    assert.equal(documentRef.getDocumentListenerCount('keydown'), 0);
  });

  it('sends the typed narration facts with the message and sends nothing the player did not type', async () => {
    const { documentRef, createRootShell } = createFakeDomEnvironment();
    const shell = createRootShell();
    const container = shell.querySelector('#composer-bar');
    const calls = [];
    const composer = new ComposerBar({
      container,
      documentRef: /** @type {Document} */ (documentRef),
      onSend: (payload) => {
        calls.push(payload);
      },
      onStop: () => {},
    });
    composer.setCampaignActive(true);
    const toggle = container.querySelector('#composer-narration-toggle');
    const narrationInput = container.querySelector('#composer-narration-input');
    const textInput = container.querySelector('#composer-text-input');
    const sendBtn = container.querySelectorAll('button').find((button) => button.textContent === 'Send');

    assert.equal(toggle.textContent, 'Add narration facts');
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');
    assert.equal(narrationInput.parentNode.classList.contains('is-hidden'), true);
    await toggle.dispatchEvent('click');
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(narrationInput.parentNode.classList.contains('is-hidden'), false);

    composer.setDraftText('I look at her.');
    await sendBtn.dispatchEvent('click');
    assert.equal(calls[0].narration, null);

    narrationInput.value = '  Her hair is dyed black.  ';
    await sendBtn.dispatchEvent('click');
    assert.equal(calls[1].text, 'I look at her.');
    assert.equal(calls[1].narration, 'Her hair is dyed black.');

    textInput.value = '';
    await sendBtn.dispatchEvent('click');
    assert.equal(calls.length, 3);
    assert.equal(calls[2].text, '');
    assert.equal(calls[2].narration, 'Her hair is dyed black.');

    composer.clearDraft();
    assert.equal(narrationInput.value, '');
    await sendBtn.dispatchEvent('click');
    assert.equal(calls.length, 3);

    textInput.value = 'Hi <narration>Rain.</narration>';
    await sendBtn.dispatchEvent('click');
    assert.equal(calls[3].text, 'Hi <narration>Rain.</narration>');
    assert.equal(calls[3].narration, null);

    composer.setStreaming(true);
    assert.equal(narrationInput.disabled, true);
    composer.setStreaming(false);
    assert.equal(narrationInput.disabled, false);
  });

  it('enforces ComposerBar modes, CharacterModal slug rules without scribeSubjectId, and ConfirmModal error recovery', async () => {
    const { documentRef, createRootShell } = createFakeDomEnvironment();
    const shell = createRootShell();
    const composerCalls = [];
    let stopCount = 0;

    const composer = new ComposerBar({
      container: shell.querySelector('#composer-bar'),
      documentRef,
      onSend: (payload) => composerCalls.push(payload),
      onStop: () => {
        stopCount += 1;
      },
    });
    composer.setCampaignActive(true);
    composer.setDraftText('  *Narrator: Rain begins.*');
    const narratorBadge = shell.querySelector('#composer-bar').querySelector('.tag-pill');
    assert.equal(narratorBadge.classList.contains('is-hidden'), false);
    assert.equal(composerCalls.length, 0);

    const buttons = shell.querySelector('#composer-bar').querySelectorAll('button');
    const encounterBtn = buttons.find((btn) => btn.textContent === 'Encounter');
    const sendBtn = buttons.find((btn) => btn.textContent === 'Send');

    await sendBtn.dispatchEvent('click');
    assert.equal(composerCalls[0].mode, 'narrator');

    composer.clearDraft();
    await encounterBtn.dispatchEvent('click');
    assert.equal(composerCalls[1].mode, 'encounter');

    composer.setStreaming(true);
    assert.equal(sendBtn.textContent, 'Stop');
    await sendBtn.dispatchEvent('click');
    assert.equal(stopCount, 1);

    const modalRoot = shell.querySelector('#modal-root');
    const savedChars = [];
    const charModal = new CharacterModal({
      modalRoot,
      documentRef,
      onSave: async (payload) => {
        savedChars.push(payload);
      },
    });
    charModal.open();
    const nameInput = modalRoot.querySelector('#char-name-input');
    const slugInput = modalRoot.querySelector('#char-slug-input');
    nameInput.value = 'Lady Mirra';
    await nameInput.dispatchEvent('input');
    assert.equal(slugInput.value, 'lady_mirra');

    const charButtons = findAllButtonLabels(modalRoot.querySelector('.modal-footer'));
    assert.deepEqual(charButtons, ['Cancel', 'Save']);

    await modalRoot.querySelector('form').dispatchEvent('submit');
    assert.equal(savedChars.length, 1);
    assert.equal(Object.hasOwn(savedChars[0], 'scribeSubjectId'), false);
    assert.equal(savedChars[0].slug, 'lady_mirra');

    const confirmModal = new ConfirmModal({ modalRoot, documentRef });
    confirmModal.open({
      title: 'Delete character?',
      message: 'Confirm permanent deletion.',
      confirmLabel: 'Delete Character',
      onConfirm: async () => {
        throw new Error('Cannot delete referenced character.');
      },
    });
    const confirmFooterBtns = findAllButtonLabels(modalRoot.querySelector('.modal-footer'));
    assert.deepEqual(confirmFooterBtns, ['Cancel', 'Delete Character']);
    const destructiveBtn = modalRoot.querySelectorAll('button').find((btn) => btn.textContent === 'Delete Character');
    await destructiveBtn.dispatchEvent('click');
    assert.ok(modalRoot.textContent.includes('Cannot delete referenced character.'));
    assert.equal(documentRef.getDocumentListenerCount('keydown'), 1);
    await documentRef.dispatchKeydown('Escape');
    assert.equal(documentRef.getDocumentListenerCount('keydown'), 0);
  });
});

describe('Live WorldsServer static serving and WorldsApp boot integration', () => {
  const cleanups = [];

  after(async () => {
    for (const cleanupFn of cleanups) {
      await cleanupFn();
    }
  });

  it('serves index.html with injected CSRF token, all public ESM assets, and boots WorldsApp', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-ui-server-'));
    const localDir = path.join(tempRoot, 'local');
    fs.mkdirSync(localDir, { recursive: true, mode: 0o700 });
    const config = Object.freeze({
      port: 0,
      rootDir: tempRoot,
      localDir,
      dbPath: path.join(localDir, 'worlds.sqlite'),
      secretsPath: path.join(localDir, 'secrets.json'),
      syncStatePath: path.join(localDir, 'sync-state.json'),
      conflictsDir: path.join(localDir, 'conflicts'),
      envApiKey: null,
      r2: null,
    });

    const store = new SqliteStore(config.dbPath);
    let signalAbortDirectorStarted = null;
    const abortDirectorStartedPromise = new Promise((resolve) => {
      signalAbortDirectorStarted = resolve;
    });
    const scriptedResponses = [
      () => new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                sceneChanged: false,
                location: 'Harbor Pier',
                day: 1,
                timeLabel: 'Dusk',
                sceneType: 'public',
                userInputKind: 'player_in_scene',
                presentSlugs: ['frost', 'lize'],
                remoteSlugs: [],
                offscreenNotes: {},
                walkOnsEnter: [],
                walkOnsLeave: [],
                encounterAccepted: false,
                encounterBrief: '',
                pacing: 'focused_one',
                targetChars: 800,
                responders: [{ slug: 'lize', beatGoal: 'Greet Frost.', length: 'short' }],
                narratorDirective: 'Brief reply.',
              }),
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 40, completion_tokens: 20, cost: 0.002 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
      () => new Response(
        JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                internalThought: 'Stay alert.',
                physicalAction: 'Lize waves.',
                spokenLines: 'Over here, Frost.',
                tone: 'warm',
                knowledgeBoundaries: 'None.',
              }),
            },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 30, completion_tokens: 15, cost: 0.001 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
      () => {
        const encoder = new TextEncoder();
        const streamText = '[[BEAT:narrator]]\nGull cries echoed.\n[[BEAT:lize]]\n*Lize waved.*\nOver here, Frost.';
        const bodyStream = new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: streamText } }] })}\n\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 25, cost: 0.003 } })}\n\n`));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return new Response(bodyStream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      },
      (init) => {
        signalAbortDirectorStarted();
        return new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          }, { once: true });
        });
      },
      ...[0, 1, 2, 3].map(() => (init) => {
        return new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => {
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          }, { once: true });
        });
      }),
    ];
    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-ui-smoke-key',
      retryOptions: { delaysMs: [0], wait: async () => {} },
      fetchImpl: async (url, init) => {
        const nextHandler = scriptedResponses.shift();
        if (nextHandler === undefined) {
          throw new Error(`Unexpected OpenRouter call to ${String(url)}`);
        }
        return await nextHandler(init);
      },
      onSpend: (dto) => store.recordSpend(dto),
    });

    const server = await WorldsServer.create({
      config,
      store,
      client,
      publicDir: PublicDirPath,
      modelCatalog: createFakeModelCatalog({
        modelIds: ['openrouter/dir', 'openrouter/comp', 'openrouter/main', 'openrouter/rec', 'openrouter/scribe'],
      }).catalog,
    });
    const started = await server.start();
    cleanups.push(async () => {
      await server.stop();
      store.close();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    const rootResponse = await fetch(`${started.url}/`);
    assert.equal(rootResponse.status, 200);
    assert.equal(rootResponse.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(rootResponse.headers.get('content-security-policy'), Security.SecurityHeaders['Content-Security-Policy']);
    const rootHtml = await rootResponse.text();
    assert.equal(rootHtml.includes('__CSRF_TOKEN__'), false);
    assert.equal(rootHtml.includes(`<meta name="worlds-csrf" content="${started.csrfToken}">`), true);

    const staticAssets = [
      ['/styles.css', 'text/css; charset=utf-8'],
      ['/app.mjs', 'application/javascript; charset=utf-8'],
      ['/api.mjs', 'application/javascript; charset=utf-8'],
      ['/components/ChatView.mjs', 'application/javascript; charset=utf-8'],
      ['/components/ComposerBar.mjs', 'application/javascript; charset=utf-8'],
      ['/components/InspectorDrawer.mjs', 'application/javascript; charset=utf-8'],
      ['/components/CampaignModal.mjs', 'application/javascript; charset=utf-8'],
      ['/components/CharacterModal.mjs', 'application/javascript; charset=utf-8'],
      ['/components/ConfirmModal.mjs', 'application/javascript; charset=utf-8'],
      ['/components/FocusKeeper.mjs', 'application/javascript; charset=utf-8'],
      ['/components/ModelCatalogView.mjs', 'application/javascript; charset=utf-8'],
    ];
    for (const [assetPath, expectedContentType] of staticAssets) {
      const assetRes = await fetch(`${started.url}${assetPath}`);
      assert.equal(assetRes.status, 200, `Expected 200 for ${assetPath}`);
      assert.equal(assetRes.headers.get('content-type'), expectedContentType);
      assert.equal(assetRes.headers.get('x-content-type-options'), 'nosniff');
    }

    const { documentRef, createRootShell } = createFakeDomEnvironment();
    const shell = createRootShell();
    const liveApi = new WorldsApi({
      baseUrl: started.url,
      csrfToken: started.csrfToken,
      fetchImpl: (url, init) => {
        const mergedInit = {
          ...init,
          headers: {
            ...(init?.headers ?? {}),
            Origin: started.url,
          },
        };
        return fetch(url, mergedInit);
      },
    });

    await liveApi.updateSettings({
      models: {
        director: 'openrouter/dir',
        composer: 'openrouter/comp',
        main: 'openrouter/main',
        recurring: 'openrouter/rec',
        scribe: 'openrouter/scribe',
      },
      publicOdds: 0,
      privateOdds: 0,
      scribeInterval: 0,
      pedantEnabled: false,
      dailyWarnUsd: 0.001,
    });

    const createdCampaign = await liveApi.createCampaign({
      title: 'Harbor Nights',
      premise: 'Testing live UI integration.',
    });
    const frost = await liveApi.createCharacter(createdCampaign.id, {
      slug: 'frost',
      name: 'Frost',
      isPlayer: true,
      tier: 'main',
      avatarToken: 'slate',
    });
    const lize = await liveApi.createCharacter(createdCampaign.id, {
      slug: 'lize',
      name: 'Lize',
      tier: 'main',
      avatarToken: 'rose',
    });
    await liveApi.updateCampaign(createdCampaign.id, {
      sceneState: {
        ...createdCampaign.sceneState,
        location: 'Harbor Pier',
        presentIds: [frost.id, lize.id],
      },
    });

    const app = new WorldsApp({
      api: liveApi,
      rootElement: shell,
      documentRef,
    });
    await app.init();

    const selectEl = shell.querySelector('#campaign-select');
    assert.equal(selectEl.value, createdCampaign.id);
    assert.ok(shell.querySelector('#scene-pill').textContent.includes('Harbor Pier'));
    assert.equal(shell.querySelector('#spend-badge').textContent, '$0.00');
    assert.equal(shell.querySelector('#sync-badge').textContent, 'Local only');
    assert.ok(shell.querySelector('#inspector-drawer').textContent.includes('Frost'));

    const composerInput = shell.querySelector('#composer-text-input');
    const composerBar = shell.querySelector('#composer-bar');
    const sendButton = composerBar.querySelectorAll('button').find((btn) => btn.textContent === 'Send');
    composerInput.value = 'Hello Lize.';
    await composerInput.dispatchEvent('input');
    await sendButton.dispatchEvent('click');

    const deadlineMs = Date.now() + 3000;
    while (
      Date.now() < deadlineMs &&
      (sendButton.textContent !== 'Send' || shell.querySelector('#chat-view').querySelectorAll('.turn-card').length < 2)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(sendButton.textContent, 'Send');
    assert.equal(shell.querySelector('#chat-view').querySelectorAll('.turn-card').length, 2);
    assert.ok(shell.querySelector('#chat-view').textContent.includes('Over here, Frost.'));
    assert.notEqual(shell.querySelector('#spend-badge').textContent, '$0.00');
    assert.equal(shell.querySelector('#spend-warning-banner').classList.contains('is-hidden'), false);

    composerInput.value = '';
    await composerInput.dispatchEvent('input');
    composerBar.querySelector('#composer-narration-input').value = 'Abort this narration please.';
    await sendButton.dispatchEvent('click');
    await abortDirectorStartedPromise;
    assert.equal(sendButton.textContent, 'Stop');
    const pendingCard = shell.querySelector('#chat-view').querySelector('.turn-streaming');
    assert.equal(pendingCard.querySelector('.beat-speaker').textContent, 'Narrator');
    assert.equal(pendingCard.querySelector('.beat-text').textContent, 'Abort this narration please.');
    await sendButton.dispatchEvent('click');

    const abortDeadlineMs = Date.now() + 3000;
    while (Date.now() < abortDeadlineMs && sendButton.textContent !== 'Send') {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(sendButton.textContent, 'Send');
    assert.equal(shell.querySelector('#chat-view').querySelectorAll('.turn-card').length, 2);
    assert.ok(composerBar.textContent.includes('Turn stopped. No changes were committed.'));

    composerInput.value = 'I look at her. <narration>Her eyes are green.</narration>';
    await composerInput.dispatchEvent('input');
    composerBar.querySelector('#composer-narration-input').value = 'Her hair is dyed black.';
    await sendButton.dispatchEvent('click');
    assert.equal(sendButton.textContent, 'Stop');
    const pendingText = shell.querySelector('#chat-view').querySelector('.turn-streaming').querySelector('.beat-text');
    assert.deepEqual(
      pendingText.querySelectorAll('.beat-narration').map((span) => span.textContent),
      ['Her eyes are green.', 'Her hair is dyed black.'],
    );
    assert.equal(pendingText.textContent.includes('<narration>'), false);
    await sendButton.dispatchEvent('click');
    const secondDeadlineMs = Date.now() + 3000;
    while (Date.now() < secondDeadlineMs && sendButton.textContent !== 'Send') {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(sendButton.textContent, 'Send');

    const encounterButton = composerBar.querySelectorAll('button').find((button) => button.textContent === 'Encounter');
    for (const typed of ['', '<narration>Her hair is dyed black.</narration>']) {
      composerInput.value = typed;
      await composerInput.dispatchEvent('input');
      composerBar.querySelector('#composer-narration-input').value = typed === '' ? 'Her hair is dyed black.' : '';
      await encounterButton.dispatchEvent('click');
      assert.equal(sendButton.textContent, 'Stop');
      const pendingCard = shell.querySelector('#chat-view').querySelector('.turn-streaming');
      assert.equal(pendingCard.querySelector('.beat-speaker').textContent, 'Frost');
      assert.deepEqual(
        pendingCard.querySelector('.beat-text').querySelectorAll('span').map((span) => span.textContent),
        ['*(Encounter)*', 'Her hair is dyed black.'],
      );
      assert.equal(pendingCard.textContent.includes('<narration>'), false);
      await sendButton.dispatchEvent('click');
      const encounterDeadlineMs = Date.now() + 3000;
      while (Date.now() < encounterDeadlineMs && sendButton.textContent !== 'Send') {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(sendButton.textContent, 'Send');
    }

    composerInput.value = 'Narrator:';
    await composerInput.dispatchEvent('input');
    composerBar.querySelector('#composer-narration-input').value = 'It is raining.';
    await encounterButton.dispatchEvent('click');
    assert.equal(sendButton.textContent, 'Stop');
    const prefixedCard = shell.querySelector('#chat-view').querySelector('.turn-streaming');
    assert.equal(prefixedCard.querySelector('.beat-speaker').textContent, 'Narrator');
    assert.deepEqual(
      prefixedCard.querySelector('.beat-text').querySelectorAll('span').map((span) => span.textContent),
      ['It is raining.'],
    );
    assert.equal(prefixedCard.textContent.includes('Encounter'), false);
    await sendButton.dispatchEvent('click');
    const prefixedDeadlineMs = Date.now() + 3000;
    while (Date.now() < prefixedDeadlineMs && sendButton.textContent !== 'Send') {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(sendButton.textContent, 'Send');
  });
});

describe('ModelCatalog, /api/models endpoint, default prefill, and OpenRouter catalog picker', () => {
  const cleanups = [];

  after(async () => {
    for (const cleanupFn of cleanups) {
      await cleanupFn();
    }
  });

  it('serves the verified default slots, loads the live catalog once per lifetime, and falls back to the cache on upstream failure', async (testContext) => {
    testContext.mock.method(console, 'error', () => {});
    let fakeNow = 100_000;
    let mode = 'ok';
    const fake = createFakeModelCatalog({
      nowProvider: () => fakeNow,
      cacheTtlMs: 60_000,
      answerList: () => {
        if (mode === 'http_error') {
          return new Response('Upstream down', { status: 503 });
        }
        if (mode === 'bad_json') {
          return new Response('not-json', { status: 200 });
        }
        if (mode === 'bad_shape') {
          return new Response(JSON.stringify({ items: [] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            data: [
              { id: '', name: 'Broken' },
              {
                id: 'sao10k/l3.1-euryale-70b',
                name: 'Euryale 70B',
                context_length: 131072,
                pricing: { prompt: '0.0000007', completion: '0.0000008' },
                top_provider: { is_moderated: false },
                supported_parameters: ['temperature', 'response_format'],
              },
              {
                id: 'custom/alpha-model',
                name: 'Alpha Model',
                context_length: 32768,
                pricing: { prompt: '0', completion: '0' },
                top_provider: { is_moderated: true },
                supported_parameters: ['temperature'],
              },
            ],
          }),
          { status: 200 },
        );
      },
    });
    const catalog = fake.catalog;

    assert.equal(fake.listRequests, 0);
    assert.equal(catalog.getDefaults().director, 'nousresearch/hermes-4-405b');
    assert.equal(catalog.getDefaults().composer, 'sao10k/l3.1-euryale-70b');
    assert.equal(catalog.getRecommended, undefined);

    const loadedFirst = await catalog.listModels();
    assert.equal(fake.listRequests, 1);
    assert.equal(loadedFirst.stale, false);
    assert.equal(loadedFirst.openrouter.length, 2);
    assert.equal('recommended' in loadedFirst, false);
    assert.equal(loadedFirst.openrouter[0].id, 'custom/alpha-model');
    assert.equal(loadedFirst.openrouter[0].isModerated, true);
    assert.equal(loadedFirst.openrouter[1].id, 'sao10k/l3.1-euryale-70b');
    assert.equal(loadedFirst.openrouter[1].promptCostPerMillion, 0.7);
    assert.equal(loadedFirst.openrouter[1].supportsStructuredOutput, true);

    fakeNow += 10_000;
    await catalog.listModels();
    assert.equal(fake.listRequests, 1);

    await catalog.listModels({ refresh: true });
    assert.equal(fake.listRequests, 2);

    for (const [failureMode, expectedWarning] of [
      ['http_error', 'OpenRouter models catalog returned HTTP 503. Showing cached OpenRouter catalog.'],
      ['bad_json', 'OpenRouter models catalog returned malformed JSON. Showing cached OpenRouter catalog.'],
      ['bad_shape', 'OpenRouter models catalog response is missing data array. Showing cached OpenRouter catalog.'],
    ]) {
      mode = failureMode;
      const fallback = await catalog.listModels({ refresh: true });
      assert.equal(fallback.stale, true);
      assert.equal(fallback.warning, expectedWarning);
      assert.equal(fallback.openrouter.length, 2);
    }

    const abortController = new AbortController();
    abortController.abort();
    await assert.rejects(
      () => catalog.listModels({ signal: abortController.signal }),
      (err) => err.name === 'AbortError',
    );
  });

  it('seeds defaults only when all model slots are empty, serves GET /api/models, and wires prefill & full picker in UI', async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'worlds-models-ui-'));
    const localDir = path.join(tempRoot, 'local');
    fs.mkdirSync(localDir, { recursive: true, mode: 0o700 });
    const config = Object.freeze({
      port: 0,
      rootDir: tempRoot,
      localDir,
      dbPath: path.join(localDir, 'worlds.sqlite'),
      secretsPath: path.join(localDir, 'secrets.json'),
      syncStatePath: path.join(localDir, 'sync-state.json'),
      conflictsDir: path.join(localDir, 'conflicts'),
      envApiKey: null,
      r2: null,
    });

    const store = new SqliteStore(config.dbPath);
    const catalog = createFakeModelCatalog({
      modelIds: ['thedrummer/cydonia-24b-v4.1', 'vendor/custom-story-model'],
    }).catalog;

    const seededFirst = WorldsServer.seedDefaultModelsIfEmpty(store, catalog);
    assert.equal(seededFirst, true);
    const seededSecond = WorldsServer.seedDefaultModelsIfEmpty(store, catalog);
    assert.equal(seededSecond, false);
    assert.deepEqual(store.getSettings().models, { ...catalog.getDefaults() });
    assert.equal(store.getSettings().models.composer, 'sao10k/l3.1-euryale-70b');

    store.updateSettings({
      models: { director: '', composer: '', main: '', recurring: '', scribe: '' },
    });

    const client = new OpenRouterClient({
      apiKeyProvider: () => 'sk-models-test-key',
      fetchImpl: async () => new Response('{}', { status: 200 }),
      onSpend: (dto) => store.recordSpend(dto),
    });

    const server = await WorldsServer.create({
      config,
      store,
      client,
      modelCatalog: catalog,
      publicDir: PublicDirPath,
    });
    const started = await server.start();
    cleanups.push(async () => {
      await server.stop();
      store.close();
      fs.rmSync(tempRoot, { recursive: true, force: true });
    });

    const ignoredParamRes = await fetch(`${started.url}/api/models?includeAll=maybe`);
    assert.equal(ignoredParamRes.status, 200);
    const ignoredParamBody = await ignoredParamRes.json();
    assert.equal('recommended' in ignoredParamBody, false);
    assert.ok(ignoredParamBody.openrouter.some((model) => model.id === 'vendor/custom-story-model'));

    const postModelsRes = await fetch(`${started.url}/api/models`, {
      method: 'POST',
      headers: {
        Origin: started.url,
        'X-Worlds-CSRF': started.csrfToken,
      },
    });
    assert.equal(postModelsRes.status, 405);

    const { documentRef, createRootShell } = createFakeDomEnvironment();
    const shell = createRootShell();
    const liveApi = new WorldsApi({
      baseUrl: started.url,
      csrfToken: started.csrfToken,
      fetchImpl: (url, init) => {
        return fetch(url, {
          ...init,
          headers: {
            ...(init?.headers ?? {}),
            Origin: started.url,
          },
        });
      },
    });

    const app = new WorldsApp({
      api: liveApi,
      rootElement: shell,
      documentRef,
    });
    await app.init();

    const drawerEl = shell.querySelector('#inspector-drawer');
    const settingsTabBtn = drawerEl.querySelectorAll('button').find((btn) => btn.textContent === 'Settings');
    await settingsTabBtn.dispatchEvent('click');
    await waitUntil(() => drawerEl.textContent.includes('OpenRouter models: 2 · Cached '));

    assert.equal(drawerEl.querySelector('#settings-model-director').value, 'nousresearch/hermes-4-405b');
    assert.equal(drawerEl.querySelector('#settings-model-composer').value, 'sao10k/l3.1-euryale-70b');
    assert.ok(drawerEl.textContent.includes('Suggested unrestricted defaults are prefilled below'));

    assert.equal(
      drawerEl.querySelectorAll('button').find((btn) => btn.textContent === 'Load all OpenRouter models'),
      undefined,
    );
    const refreshModelsBtn = drawerEl.querySelectorAll('button').find((btn) => btn.textContent === 'Refresh OpenRouter models');
    assert.notEqual(refreshModelsBtn, undefined);
    await refreshModelsBtn.dispatchEvent('click');
    assert.notEqual(
      drawerEl.querySelectorAll('button').find((btn) => btn.textContent === 'Refresh OpenRouter models'),
      undefined,
    );

    const filterInput = drawerEl.querySelector('#settings-model-filter');
    filterInput.value = 'vendor/custom';
    await filterInput.dispatchEvent('input');
    assert.equal(drawerEl.querySelector('#settings-model-filter'), filterInput);

    const mainPicker = drawerEl.querySelector('#settings-model-picker-main');
    const mainOptions = mainPicker.querySelectorAll('option').map((opt) => opt.value);
    assert.ok(mainOptions.includes('vendor/custom-story-model'));

    mainPicker.value = 'vendor/custom-story-model';
    await mainPicker.dispatchEvent('change');
    assert.equal(drawerEl.querySelector('#settings-model-main').value, 'vendor/custom-story-model');

    await drawerEl.querySelector('form').dispatchEvent('submit');
    const savedSettings = await liveApi.getSettings();
    assert.equal(savedSettings.models.main, 'vendor/custom-story-model');
    assert.equal(savedSettings.models.composer, 'sao10k/l3.1-euryale-70b');

    const modalRoot = shell.querySelector('#modal-root');
    const overrideSaves = [];
    const charModal = new CharacterModal({
      modalRoot,
      documentRef,
      onSave: async (payload) => {
        overrideSaves.push(payload);
      },
    });
    const catalogData = await liveApi.getModels();
    charModal.open({
      modelCatalog: catalogData,
      onRefreshModels: async () => {},
    });
    const charNameInput = modalRoot.querySelector('#char-name-input');
    charNameInput.value = 'Maya';
    await charNameInput.dispatchEvent('input');
    const charPicker = modalRoot.querySelector('#char-model-picker');
    charPicker.value = 'vendor/custom-story-model';
    await charPicker.dispatchEvent('change');
    await modalRoot.querySelector('form').dispatchEvent('submit');
    assert.equal(overrideSaves[0].modelOverride, 'vendor/custom-story-model');
  });
});

describe('Browser model catalog: boot, races, dropdowns, status lines, alerts and requests (fake network)', () => {
  it('getModels sends GET /api/models with no query parameters and refreshModels sends POST /api/models/refresh with the CSRF header', async () => {
    const observed = [];
    const api = new WorldsApi({
      csrfToken: 'csrf-token-for-models',
      fetchImpl: async (url, init) => {
        observed.push({ url, init });
        return jsonResponse(200, buildCatalog(1));
      },
    });

    await api.getModels();
    await api.getModels({ includeAll: true, refresh: true });
    await api.refreshModels();

    assert.equal(observed[0].url, '/api/models');
    assert.equal(observed[0].init.method, 'GET');
    assert.equal(observed[1].url, '/api/models');
    assert.equal(observed[1].init.headers['X-Worlds-CSRF'], undefined);
    assert.equal(observed[2].url, '/api/models/refresh');
    assert.equal(observed[2].init.method, 'POST');
    assert.equal(observed[2].init.headers['X-Worlds-CSRF'], 'csrf-token-for-models');
  });

  it('boot does not wait for the model load, and a failing load leaves campaigns working and shows the error as a danger alert in Settings and the Character modal', async () => {
    const modelLoad = createDeferred();
    const harness = createBrowserHarness({ catalogHandler: () => modelLoad.promise });
    const { shell } = harness;

    await harness.app.init();

    assert.equal(shell.querySelector('#campaign-select').value, 'camp-1');
    assert.ok(shell.querySelector('#scene-pill').textContent.includes('Harbor Pier'));
    assert.equal(harness.requests.filter((request) => request.url === '/api/models').length, 1);

    const drawerEl = shell.querySelector('#inspector-drawer');
    await findButton(drawerEl, 'Settings').dispatchEvent('click');
    assert.ok(listMetaTexts(drawerEl).includes('Loading OpenRouter catalog...'));
    assert.equal(findButton(drawerEl, 'Loading catalog...').disabled, true);

    modelLoad.resolve({ status: 502, body: { error: 'OpenRouter is unreachable.' } });
    await waitUntil(() => listAlertTexts(drawerEl, 'is-danger').includes('OpenRouter is unreachable.'));
    assert.equal(findButton(drawerEl, 'Refresh OpenRouter models').disabled, false);
    assert.equal(shell.querySelector('#campaign-select').value, 'camp-1');

    await findButton(drawerEl, 'Cast').dispatchEvent('click');
    await findButton(drawerEl, 'Add Character').dispatchEvent('click');
    const modalRoot = shell.querySelector('#modal-root');
    assert.deepEqual(listAlertTexts(modalRoot, 'is-danger'), ['OpenRouter is unreachable.']);
    assert.deepEqual(harness.unexpected, []);
  });

  it('ignores an older load that succeeds after a newer one, even when a click gets through while loading', async () => {
    const firstLoad = createDeferred();
    const secondLoad = createDeferred();
    const harness = createBrowserHarness({
      ignoreAbortForModels: true,
      catalogHandler: () => firstLoad.promise,
      refreshHandler: () => secondLoad.promise,
    });
    const { shell } = harness;
    await harness.app.init();
    const drawerEl = shell.querySelector('#inspector-drawer');
    await findButton(drawerEl, 'Settings').dispatchEvent('click');

    const pendingRefresh = findButton(drawerEl, 'Loading catalog...').dispatchEvent('click');
    secondLoad.resolve({ status: 200, body: buildCatalog(3) });
    await pendingRefresh;
    await waitUntil(() => listMetaTexts(drawerEl).includes('OpenRouter models: 3 · Cached 2026-11-25T12:00:00.000Z'));

    firstLoad.resolve({ status: 200, body: buildCatalog(1, { fetchedAt: '2026-11-25T08:00:00.000Z' }) });
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.ok(listMetaTexts(drawerEl).includes('OpenRouter models: 3 · Cached 2026-11-25T12:00:00.000Z'));
    const optionValues = drawerEl
      .querySelector('#settings-model-picker-main')
      .querySelectorAll('option')
      .map((option) => option.value)
      .filter((value) => value.length > 0);
    assert.equal(optionValues.length, 3);
    assert.deepEqual(harness.unexpected, []);
  });

  it('ignores an older load that fails after a newer one succeeded', async () => {
    const firstLoad = createDeferred();
    const harness = createBrowserHarness({
      ignoreAbortForModels: true,
      catalogHandler: () => firstLoad.promise,
      refreshHandler: () => ({ status: 200, body: buildCatalog(3) }),
    });
    const { shell } = harness;
    await harness.app.init();
    const drawerEl = shell.querySelector('#inspector-drawer');
    await findButton(drawerEl, 'Settings').dispatchEvent('click');

    await findButton(drawerEl, 'Loading catalog...').dispatchEvent('click');
    await waitUntil(() => listMetaTexts(drawerEl).includes('OpenRouter models: 3 · Cached 2026-11-25T12:00:00.000Z'));
    firstLoad.resolve({ status: 502, body: { error: 'Older load failed late.' } });
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.deepEqual(listAlertTexts(drawerEl, 'is-danger'), []);
    assert.ok(listMetaTexts(drawerEl).includes('OpenRouter models: 3 · Cached 2026-11-25T12:00:00.000Z'));
  });

  it('renders more than 60 models in one group with no Suggested group, a count label equal to the option count, and no undefined prices', () => {
    const { drawer, drawerEl } = createDrawerHarness();
    const catalog = buildCatalog(75);
    delete catalog.openrouter[3].promptCostPerMillion;
    delete catalog.openrouter[3].completionCostPerMillion;
    catalog.openrouter[4].promptCostPerMillion = null;
    catalog.openrouter[5].isModerated = true;
    catalog.recommended = [{ id: 'legacy/recommended-model', name: 'Legacy', recommendedFor: 'old' }];
    drawer.setModelCatalog(catalog);

    for (const slotKey of ['director', 'composer', 'main', 'recurring', 'scribe']) {
      const picker = drawerEl.querySelector(`#settings-model-picker-${slotKey}`);
      const optionValues = picker
        .querySelectorAll('option')
        .map((option) => option.value)
        .filter((value) => value.length > 0);
      assert.equal(optionValues.length, 75);
      assert.equal(new Set(optionValues).size, 75);
      assert.equal(optionValues.includes('legacy/recommended-model'), false);
      const groups = picker.querySelectorAll('optgroup');
      assert.equal(groups.length, 1);
      assert.equal(groups[0].label, 'OpenRouter Catalog (75)');
      assert.equal(picker.querySelectorAll('option')[0].textContent, 'Select an OpenRouter model...');
    }

    const optionTexts = drawerEl
      .querySelector('#settings-model-picker-main')
      .querySelectorAll('option')
      .map((option) => option.textContent);
    assert.equal(optionTexts.some((text) => text.includes('undefined') || text.includes('null')), false);
    assert.ok(optionTexts.includes('vendor/model-000 (33k, $0.3/$0.5)'));
    assert.ok(optionTexts.includes('vendor/model-003 (33k)'));
    assert.ok(optionTexts.includes('vendor/model-004 (33k)'));
    assert.ok(optionTexts.includes('vendor/model-005 (33k, $0.3/$0.5, moderated)'));
    assert.equal(drawerEl.querySelector('#settings-model-filter').placeholder, 'Filter OpenRouter models...');
  });

  it('shows only the filtered matches, a matching count label, an empty select when the filter hides the saved model, and keeps the saved ID in the text field', async () => {
    const { drawer, drawerEl } = createDrawerHarness();
    drawer.setSettings({
      ...buildBrowserSettings(),
      models: {
        director: 'vendor/model-001',
        composer: 'vendor/model-070',
        main: 'vendor/model-003',
        recurring: 'vendor/model-004',
        scribe: 'vendor/model-005',
      },
    });
    drawer.setModelCatalog(buildCatalog(75));

    const directorPicker = drawerEl.querySelector('#settings-model-picker-director');
    assert.equal(directorPicker.value, 'vendor/model-001');

    const filterInput = drawerEl.querySelector('#settings-model-filter');
    filterInput.value = 'model-07';
    await filterInput.dispatchEvent('input');

    const filteredValues = directorPicker
      .querySelectorAll('option')
      .map((option) => option.value)
      .filter((value) => value.length > 0);
    assert.deepEqual(filteredValues, [
      'vendor/model-070',
      'vendor/model-071',
      'vendor/model-072',
      'vendor/model-073',
      'vendor/model-074',
    ]);
    assert.equal(directorPicker.querySelector('optgroup').label, 'OpenRouter Catalog (5 of 75)');
    assert.equal(directorPicker.value, '');
    assert.equal(drawerEl.querySelector('#settings-model-director').value, 'vendor/model-001');
    assert.equal(drawerEl.querySelector('#settings-model-picker-composer').value, 'vendor/model-070');

    filterInput.value = 'no-such-model';
    await filterInput.dispatchEvent('input');
    const emptyGroups = directorPicker.querySelectorAll('optgroup');
    assert.equal(emptyGroups.length, 1);
    assert.equal(emptyGroups[0].label, 'OpenRouter Catalog (0 of 75)');
    assert.equal(emptyGroups[0].querySelectorAll('option').length, 0);
    assert.equal(directorPicker.querySelectorAll('option').length, 1);
    assert.equal(directorPicker.value, '');
  });

  it('renders the six groups in order with Basics open and every card field as the right control with its label', () => {
    const { modalRoot } = createModalHarness();

    const groups = modalRoot.querySelectorAll('details');
    assert.deepEqual(
      groups.map((group) => group.id),
      ['char-section-basics', 'char-section-appearance', 'char-section-personality', 'char-section-intimacy', 'char-section-voice', 'char-section-role'],
    );
    assert.deepEqual(
      groups.map((group) => group.querySelector('summary').textContent),
      ['Basics', 'Appearance', 'Personality', 'Intimacy', 'Voice', 'Role and portrayal'],
    );
    assert.deepEqual(groups.map((group) => group.open), [true, false, false, false, false, false]);

    const expectedFields = [
      ['age', 'Age', 'INPUT'],
      ['hair', 'Hair', 'INPUT'],
      ['eyes', 'Eyes', 'INPUT'],
      ['height', 'Height', 'INPUT'],
      ['body', 'Body', 'TEXTAREA'],
      ['face', 'Face', 'TEXTAREA'],
      ['features', 'Distinguishing features', 'TEXTAREA'],
      ['personalitySummary', 'Personality summary', 'TEXTAREA'],
      ['traits', 'Traits', 'TEXTAREA'],
      ['habits', 'Habits', 'TEXTAREA'],
      ['behavior', 'Behavior', 'TEXTAREA'],
      ['likes', 'Likes', 'TEXTAREA'],
      ['dislikes', 'Dislikes', 'TEXTAREA'],
      ['sexualityOrientation', 'Orientation', 'TEXTAREA'],
      ['sexualityKinks', 'Kinks', 'TEXTAREA'],
      ['sexualityLikes', 'Sexual likes', 'TEXTAREA'],
      ['sexualityDislikes', 'Sexual dislikes', 'TEXTAREA'],
      ['speakingStyle', 'Speaking style', 'TEXTAREA'],
      ['speakingQuirks', 'Speech quirks', 'TEXTAREA'],
      ['scenario', 'Scenario', 'TEXTAREA'],
      ['characterNote', 'Character note', 'TEXTAREA'],
    ];
    const labelsByTarget = new Map(
      modalRoot.querySelectorAll('label').map((label) => [label.getAttribute('for'), label.textContent]),
    );
    for (const [fieldName, labelText, tagName] of expectedFields) {
      const control = modalRoot.querySelector(`#char-card-${fieldName}`);
      assert.notEqual(control, null, fieldName);
      assert.equal(control.tagName, tagName, fieldName);
      assert.equal(labelsByTarget.get(`char-card-${fieldName}`), labelText, fieldName);
    }
    assert.equal(modalRoot.querySelector('#char-section-appearance').querySelector('#char-card-hair') !== null, true);
    assert.equal(modalRoot.querySelector('#char-section-voice').querySelector('#char-card-speakingQuirks') !== null, true);
    assert.equal(modalRoot.querySelector('#char-section-role').querySelector('#char-card-scenario') !== null, true);
    assert.equal(modalRoot.querySelector('#char-section-basics').querySelector('#char-name-input') !== null, true);
    assert.equal(modalRoot.querySelectorAll('.required-marker').length, 2);
    assert.equal(modalRoot.querySelectorAll('.field-hint').filter((hint) => hint.textContent.length > 0).length, 0);
  });

  it('keeps an opened group open across a catalog update and a speech example change', async () => {
    const { modal, modalRoot } = createModalHarness();
    const voiceGroup = modalRoot.querySelector('#char-section-voice');
    voiceGroup.open = true;
    await voiceGroup.dispatchEvent('toggle');

    modal.setModelCatalog(buildCatalog(3));
    assert.equal(modalRoot.querySelector('#char-section-voice').open, true);
    assert.equal(modalRoot.querySelector('#char-section-appearance').open, false);

    await modalRoot.querySelector('#char-example-add').dispatchEvent('click');
    assert.equal(modalRoot.querySelector('#char-section-voice').open, true);

    modalRoot.querySelector('#char-section-voice').open = false;
    await modalRoot.querySelector('#char-section-voice').dispatchEvent('toggle');
    modal.setModelCatalog(buildCatalog(3));
    assert.equal(modalRoot.querySelector('#char-section-voice').open, false);
  });

  it('keeps focus and caret on a speech example and on the add button across a catalog update', async () => {
    const { modal, modalRoot, documentRef } = createModalHarness({
      character: buildCharacter({ card: { speechExamples: ['Well, then.'] } }),
    });
    const exampleInput = modalRoot.querySelector('#char-example-0');
    exampleInput.value = 'Half-typed';
    await exampleInput.dispatchEvent('input');
    exampleInput.focus();
    exampleInput.selectionStart = 2;
    exampleInput.selectionEnd = 5;

    modal.setModelCatalog(buildCatalog(3));
    const restored = modalRoot.querySelector('#char-example-0');
    assert.notEqual(restored, exampleInput);
    assert.equal(documentRef.activeElement, restored);
    assert.equal(restored.value, 'Half-typed');
    assert.equal(restored.selectionStart, 2);
    assert.equal(restored.selectionEnd, 5);

    const addButton = modalRoot.querySelector('#char-example-add');
    addButton.focus();
    modal.setModelCatalogLoading(true);
    assert.equal(documentRef.activeElement, modalRoot.querySelector('#char-example-add'));
  });

  it('shows In the book now from the payload only, with the build line once under Body, and never compares while typing', async () => {
    const { modalRoot } = createModalHarness({
      character: buildCharacter({
        card: { hair: 'red', eyes: 'green', height: "5'6", body: 'slim', age: '30' },
        bookHints: { hair: 'black', build: 'stocky', features: 'a scar' },
      }),
    });
    /**
     * @param {string} bookKey
     * @returns {{text: string, hidden: boolean}}
     */
    const hintOf = (bookKey) => {
      const hint = modalRoot.querySelector(`#char-card-hint-${bookKey}`);
      return { text: hint.textContent, hidden: hint.classList.contains('is-hidden') };
    };

    assert.equal(modalRoot.querySelectorAll('.field-hint').length, 6);
    assert.equal(modalRoot.querySelector('#char-card-hint-height'), null);
    assert.deepEqual(hintOf('hair'), { text: 'In the book now: black', hidden: false });
    assert.deepEqual(hintOf('features'), { text: 'In the book now: a scar', hidden: false });
    assert.deepEqual(hintOf('build'), { text: 'In the book now: stocky', hidden: false });
    assert.deepEqual(hintOf('eyes'), { text: '', hidden: true });
    assert.deepEqual(hintOf('age'), { text: '', hidden: true });
    assert.deepEqual(hintOf('face'), { text: '', hidden: true });
    assert.equal(
      modalRoot.querySelector('#char-card-body').parentNode.querySelector('#char-card-hint-build') !== null,
      true,
    );

    for (const [fieldName, typed] of [['hair', 'black'], ['body', 'stocky'], ['features', 'a scar'], ['eyes', 'blue']]) {
      const input = modalRoot.querySelector(`#char-card-${fieldName}`);
      input.value = typed;
      await input.dispatchEvent('input');
    }
    const heightInput = modalRoot.querySelector('#char-card-height');
    heightInput.value = '';
    await heightInput.dispatchEvent('input');
    assert.deepEqual(hintOf('hair'), { text: 'In the book now: black', hidden: false });
    assert.deepEqual(hintOf('build'), { text: 'In the book now: stocky', hidden: false });
    assert.deepEqual(hintOf('features'), { text: 'In the book now: a scar', hidden: false });
    assert.deepEqual(hintOf('eyes'), { text: '', hidden: true });
  });

  it('shows no hints for a new character', () => {
    const { modalRoot } = createModalHarness();
    assert.equal(modalRoot.querySelectorAll('.field-hint').filter((hint) => hint.textContent.length > 0).length, 0);
  });

  it('adds and removes speech examples, keeps focus on the new row, and drops blank examples on save', async () => {
    const { modalRoot, documentRef, savedPayloads } = createModalHarness({
      character: buildCharacter({ card: { speechExamples: ['Well, then.', 'Hm.'] } }),
    });
    assert.equal(modalRoot.querySelector('#char-example-0').value, 'Well, then.');
    assert.equal(modalRoot.querySelector('#char-example-1').value, 'Hm.');
    assert.equal(modalRoot.querySelector('#char-example-2'), null);

    await modalRoot.querySelector('#char-example-add').dispatchEvent('click');
    const added = modalRoot.querySelector('#char-example-2');
    assert.notEqual(added, null);
    assert.equal(added.value, '');
    assert.equal(documentRef.activeElement, added);
    added.value = '  Fine.  ';
    await added.dispatchEvent('input');

    await modalRoot.querySelector('#char-example-remove-0').dispatchEvent('click');
    assert.equal(modalRoot.querySelector('#char-example-0').value, 'Hm.');
    assert.equal(modalRoot.querySelector('#char-example-1').value, '  Fine.  ');
    assert.equal(modalRoot.querySelector('#char-example-2'), null);

    await modalRoot.querySelector('#char-example-add').dispatchEvent('click');
    await modalRoot.querySelector('form').dispatchEvent('submit');
    assert.deepEqual(savedPayloads[0].card.speechExamples, ['Hm.', 'Fine.']);
  });

  it('submits every card field, trimmed, and never filedFactIds, persona or voiceNotes, on edit', async () => {
    const storedCard = buildCard({
      hair: 'red',
      speechExamples: ['Well, then.'],
      filedFactIds: { hair: 'F1' },
      personalitySummary: 'Old summary.',
      speakingStyle: 'Old style.',
      scenario: 'Harbor pilot.',
    });
    const { modalRoot, savedPayloads } = createModalHarness({
      character: { ...buildCharacter(), card: storedCard },
    });
    assert.equal(modalRoot.querySelector('#char-card-personalitySummary').value, 'Old summary.');
    assert.equal(modalRoot.querySelector('#char-card-speakingStyle').value, 'Old style.');
    assert.equal(modalRoot.querySelector('#char-card-hair').value, 'red');

    const summaryInput = modalRoot.querySelector('#char-card-personalitySummary');
    summaryInput.value = '  New summary.  ';
    await summaryInput.dispatchEvent('input');
    await modalRoot.querySelector('form').dispatchEvent('submit');

    assert.equal(savedPayloads.length, 1);
    const { filedFactIds, ...sentCardFields } = buildCard({
      hair: 'red',
      speechExamples: ['Well, then.'],
      personalitySummary: 'New summary.',
      speakingStyle: 'Old style.',
      scenario: 'Harbor pilot.',
    });
    assert.deepEqual(filedFactIds, {});
    assert.deepEqual(savedPayloads[0].card, sentCardFields);
    assert.equal(Object.hasOwn(savedPayloads[0].card, 'filedFactIds'), false);
    assert.equal(Object.hasOwn(savedPayloads[0], 'persona'), false);
    assert.equal(Object.hasOwn(savedPayloads[0], 'voiceNotes'), false);
    assert.equal(storedCard.personalitySummary, 'Old summary.');
  });

  it('submits an empty card with every field when a new character is created', async () => {
    const { modalRoot, savedPayloads } = createModalHarness();
    const nameInput = modalRoot.querySelector('#char-name-input');
    nameInput.value = 'Newcomer';
    await nameInput.dispatchEvent('input');
    const voiceInput = modalRoot.querySelector('#char-card-speakingStyle');
    voiceInput.value = 'Slow and low.';
    await voiceInput.dispatchEvent('input');
    await modalRoot.querySelector('form').dispatchEvent('submit');

    const { filedFactIds, ...expectedCard } = buildCard({ speakingStyle: 'Slow and low.' });
    assert.deepEqual(filedFactIds, {});
    assert.equal(savedPayloads.length, 1);
    assert.deepEqual(savedPayloads[0].card, expectedCard);
  });

  it('shows the Opening state on Edit, then opens the window with the fetched character and its book hints', async () => {
    const answer = createDeferred();
    const harness = createBrowserHarness({
      castItems: [buildCharacter({ card: { hair: 'stale list value' } })],
      characterGetHandler: () => answer.promise,
    });
    await harness.app.init();
    const drawerEl = harness.shell.querySelector('#inspector-drawer');
    const modalRoot = harness.shell.querySelector('#modal-root');
    await harness.shell.querySelector('#inspector-toggle-btn').dispatchEvent('click');
    await findButton(drawerEl, 'Cast').dispatchEvent('click');

    const pendingClick = findButton(drawerEl, 'Edit').dispatchEvent('click');
    await waitUntil(() => findAllButtonLabels(drawerEl).includes('Opening...'));
    assert.equal(findButton(drawerEl, 'Opening...').disabled, true);
    assert.equal(findButton(drawerEl, 'Opening...').classList.contains('is-loading'), true);
    assert.equal(modalRoot.querySelector('#character-modal-title'), null);

    answer.resolve({
      status: 200,
      body: buildCharacter({ card: { hair: 'red' }, bookHints: { hair: 'black' } }),
    });
    await pendingClick;
    assert.equal(modalRoot.querySelector('#character-modal-title').textContent, 'Edit Character');
    assert.equal(modalRoot.querySelector('#char-card-hair').value, 'red');
    assert.equal(modalRoot.querySelector('#char-card-hint-hair').textContent, 'In the book now: black');
    assert.equal(findAllButtonLabels(drawerEl).includes('Opening...'), false);
    assert.equal(findButton(drawerEl, 'Edit').disabled, false);
    assert.deepEqual(
      harness.requests.filter((request) => request.path === '/api/campaigns/camp-1/characters/char-1').map((request) => request.method),
      ['GET'],
    );
    assert.deepEqual(harness.unexpected, []);
  });

  it('shows an Edit failure next to its own row, returns focus to that Edit button, and gives each Edit button its own ID', async () => {
    const harness = createBrowserHarness({
      castItems: [
        buildCharacter({ id: 'char-1', name: 'Maya', slug: 'maya' }),
        buildCharacter({ id: 'char-2', name: 'Nia', slug: 'nia' }),
      ],
      characterGetHandler: (request) => (
        request.path.endsWith('/char-2')
          ? { status: 404, body: { error: 'Character not found: char-2' } }
          : { status: 200, body: buildCharacter() }
      ),
    });
    await harness.app.init();
    const drawerEl = harness.shell.querySelector('#inspector-drawer');
    const modalRoot = harness.shell.querySelector('#modal-root');
    await harness.shell.querySelector('#inspector-toggle-btn').dispatchEvent('click');
    await findButton(drawerEl, 'Cast').dispatchEvent('click');

    const firstEdit = drawerEl.querySelector('#cast-edit-char-1');
    const secondEdit = drawerEl.querySelector('#cast-edit-char-2');
    assert.notEqual(firstEdit, null);
    assert.notEqual(secondEdit, null);
    assert.equal(drawerEl.querySelectorAll('.item-card').length, 2);

    await secondEdit.dispatchEvent('click');
    const rows = drawerEl.querySelectorAll('.item-card');
    assert.deepEqual(rows[0].querySelectorAll('.inline-alert').map((alert) => alert.textContent), []);
    assert.deepEqual(
      rows[1].querySelectorAll('.inline-alert').map((alert) => alert.textContent),
      ['Character not found: char-2'],
    );
    assert.equal(rows[1].contains(drawerEl.querySelector('#cast-edit-char-2')), true);
    assert.equal(harness.documentRef.activeElement, drawerEl.querySelector('#cast-edit-char-2'));
    assert.equal(modalRoot.querySelector('#character-modal-title'), null);

    await drawerEl.querySelector('#cast-edit-char-1').dispatchEvent('click');
    assert.equal(modalRoot.querySelector('#character-modal-title').textContent, 'Edit Character');
    assert.deepEqual(drawerEl.querySelectorAll('.inline-alert'), []);
  });

  it('drops a character fetch that lands after the active campaign changed', async () => {
    const answer = createDeferred();
    const harness = createBrowserHarness({
      castItems: [buildCharacter()],
      characterGetHandler: () => answer.promise,
    });
    await harness.app.init();
    const drawerEl = harness.shell.querySelector('#inspector-drawer');
    const modalRoot = harness.shell.querySelector('#modal-root');
    await harness.shell.querySelector('#inspector-toggle-btn').dispatchEvent('click');
    await findButton(drawerEl, 'Cast').dispatchEvent('click');

    const pendingClick = drawerEl.querySelector('#cast-edit-char-1').dispatchEvent('click');
    await waitUntil(() => harness.requests.some((request) => request.path.endsWith('/characters/char-1')));
    await harness.app.selectCampaign('camp-gone');
    answer.resolve({ status: 200, body: buildCharacter() });
    await pendingClick;

    assert.equal(modalRoot.querySelector('#character-modal-title'), null);
  });

  it('drops a failed character fetch that lands after the active campaign changed', async () => {
    const answer = createDeferred();
    const harness = createBrowserHarness({
      castItems: [buildCharacter()],
      secondCampaign: true,
      secondCastItems: [buildCharacter()],
      characterGetHandler: () => answer.promise,
    });
    await harness.app.init();
    const drawerEl = harness.shell.querySelector('#inspector-drawer');
    const modalRoot = harness.shell.querySelector('#modal-root');
    await harness.shell.querySelector('#inspector-toggle-btn').dispatchEvent('click');
    await findButton(drawerEl, 'Cast').dispatchEvent('click');

    const pendingClick = drawerEl.querySelector('#cast-edit-char-1').dispatchEvent('click');
    await waitUntil(() => harness.requests.some((request) => request.path.endsWith('/characters/char-1')));
    await harness.app.selectCampaign('camp-2');
    assert.notEqual(drawerEl.querySelector('#cast-edit-char-1'), null);
    answer.resolve({ status: 404, body: { error: 'Character not found: char-1' } });
    await pendingClick;

    assert.equal(modalRoot.querySelector('#character-modal-title'), null);
    assert.deepEqual(listAlertTexts(drawerEl, 'is-danger'), []);
    assert.deepEqual(harness.unexpected, []);
  });

  it('survives a failed character fetch that lands after the drawer tab changed, without moving focus', async () => {
    const answer = createDeferred();
    const harness = createBrowserHarness({
      castItems: [buildCharacter()],
      characterGetHandler: () => answer.promise,
    });
    await harness.app.init();
    const drawerEl = harness.shell.querySelector('#inspector-drawer');
    const modalRoot = harness.shell.querySelector('#modal-root');
    await harness.shell.querySelector('#inspector-toggle-btn').dispatchEvent('click');
    await findButton(drawerEl, 'Cast').dispatchEvent('click');

    const pendingClick = drawerEl.querySelector('#cast-edit-char-1').dispatchEvent('click');
    await waitUntil(() => harness.requests.some((request) => request.path.endsWith('/characters/char-1')));
    await findButton(drawerEl, 'Settings').dispatchEvent('click');
    assert.equal(drawerEl.querySelector('#cast-edit-char-1'), null);
    const focusedBefore = harness.documentRef.activeElement;
    answer.resolve({ status: 404, body: { error: 'Character not found: char-1' } });
    await pendingClick;

    assert.equal(modalRoot.querySelector('#character-modal-title'), null);
    assert.equal(drawerEl.querySelector('#cast-edit-char-1'), null);
    assert.equal(harness.documentRef.activeElement, focusedBefore);
    assert.deepEqual(harness.unexpected, []);
  });

  it('moves focus to the previous example Remove button, or to Add when the first example goes', async () => {
    const { modalRoot, documentRef } = createModalHarness({
      character: buildCharacter({ card: { speechExamples: ['one', 'two', 'three'] } }),
    });
    modalRoot.querySelector('#char-example-remove-1').focus();
    await modalRoot.querySelector('#char-example-remove-1').dispatchEvent('click');
    assert.equal(documentRef.activeElement, modalRoot.querySelector('#char-example-remove-0'));
    assert.equal(modalRoot.querySelector('#char-example-1').value, 'three');

    await modalRoot.querySelector('#char-example-remove-0').dispatchEvent('click');
    assert.equal(documentRef.activeElement, modalRoot.querySelector('#char-example-add'));
    assert.equal(modalRoot.querySelector('#char-example-0').value, 'three');
    assert.equal(modalRoot.querySelector('#char-example-1'), null);
  });

  it('keeps a visible disclosure marker on the group titles and a focus ring on them', () => {
    const rules = parseCssRules(fs.readFileSync(path.join(PublicDirPath, 'styles.css'), 'utf8'));
    const title = rules.find((rule) => rule.selector === '.card-section-title');
    assert.notEqual(title, undefined);
    assert.match(title.body, /display:\s*list-item;/);
    assert.doesNotMatch(title.body, /display:\s*(flex|grid|block|inline-flex);/);
    assert.doesNotMatch(title.body, /list-style(-type)?:\s*none/);
    assert.doesNotMatch(title.body, /(?:#[0-9a-fA-F]{3,8}\b|rgba?\()/);
    assert.equal(rules.some((rule) => rule.selector.split(',').map((part) => part.trim()).includes('summary:focus-visible')), true);
  });

  it('shows no hint for a field the payload leaves out, whatever is typed into it', async () => {
    const { modalRoot } = createModalHarness({
      character: buildCharacter({
        card: { age: '?', hair: 'red', height: '?', body: '?' },
      }),
    });
    /**
     * @param {string} bookKey
     * @returns {object}
     */
    const hint = (bookKey) => modalRoot.querySelector(`#char-card-hint-${bookKey}`);
    for (const bookKey of ['age', 'hair', 'build']) {
      assert.equal(hint(bookKey).textContent, '');
      assert.equal(hint(bookKey).classList.contains('is-hidden'), true);
    }

    const hairInput = modalRoot.querySelector('#char-card-hair');
    hairInput.value = 'reddish';
    await hairInput.dispatchEvent('input');
    assert.equal(hint('hair').textContent, '');
    assert.equal(hint('hair').classList.contains('is-hidden'), true);
  });

  it('shows the error where the Edit click was and does not open the window when the fetch fails', async () => {
    const harness = createBrowserHarness({
      castItems: [buildCharacter()],
      characterGetHandler: () => ({ status: 404, body: { error: 'Character not found: char-1' } }),
    });
    await harness.app.init();
    const drawerEl = harness.shell.querySelector('#inspector-drawer');
    const modalRoot = harness.shell.querySelector('#modal-root');
    await harness.shell.querySelector('#inspector-toggle-btn').dispatchEvent('click');
    await findButton(drawerEl, 'Cast').dispatchEvent('click');

    await findButton(drawerEl, 'Edit').dispatchEvent('click');
    assert.equal(modalRoot.querySelector('#character-modal-title'), null);
    assert.deepEqual(listAlertTexts(drawerEl, 'is-danger'), ['Character not found: char-1']);
    assert.equal(findButton(drawerEl, 'Edit').disabled, false);
    assert.equal(findAllButtonLabels(drawerEl).includes('Opening...'), false);
  });

  it('shows the four status line texts, the loading state, and the warning and danger alerts in Settings and in the Character modal', async () => {
    const { drawer, drawerEl, documentRef, shell } = createDrawerHarness();
    const modalRoot = shell.querySelector('#modal-root');
    const characterModal = new CharacterModal({ modalRoot, documentRef, onSave: async () => {} });
    characterModal.open({ modelCatalog: buildCatalog(2), onRefreshModels: async () => {} });

    drawer.setModelCatalogLoading(true);
    characterModal.setModelCatalogLoading(true);
    for (const surface of [drawerEl, modalRoot]) {
      assert.ok(listMetaTexts(surface).includes('Loading OpenRouter catalog...'));
      const busyButton = findButton(surface, 'Loading catalog...');
      assert.equal(busyButton.disabled, true);
      assert.ok(busyButton.classList.contains('is-loading'));
    }

    for (const statusCase of StatusCases) {
      drawer.setModelCatalog(statusCase.catalog);
      characterModal.setModelCatalog(statusCase.catalog);
      for (const surface of [drawerEl, modalRoot]) {
        assert.ok(listMetaTexts(surface).includes(statusCase.expectedText), statusCase.expectedText);
        assert.equal(listMetaTexts(surface).includes('Loading OpenRouter catalog...'), false);
        assert.equal(findButton(surface, 'Refresh OpenRouter models').disabled, false);
        const expectedWarnings = statusCase.catalog.warning === null ? [] : [statusCase.catalog.warning];
        assert.deepEqual(listAlertTexts(surface, 'is-warning'), expectedWarnings);
        assert.deepEqual(listAlertTexts(surface, 'is-danger'), []);
      }
    }

    const freshWithWarning = buildCatalog(2, { warning: 'Loaded live OpenRouter models, but failed to update local cache: disk full' });
    drawer.setModelCatalog(freshWithWarning);
    characterModal.setModelCatalog(freshWithWarning);
    for (const surface of [drawerEl, modalRoot]) {
      assert.deepEqual(listAlertTexts(surface, 'is-warning'), [freshWithWarning.warning]);
    }

    drawer.setModelCatalogError('OpenRouter is unreachable.');
    characterModal.setModelCatalogError('OpenRouter is unreachable.');
    for (const surface of [drawerEl, modalRoot]) {
      assert.deepEqual(listAlertTexts(surface, 'is-danger'), ['OpenRouter is unreachable.']);
      assert.equal(findButton(surface, 'Refresh OpenRouter models').disabled, false);
    }

    drawer.setModelCatalogLoading(true);
    characterModal.setModelCatalogLoading(true);
    for (const surface of [drawerEl, modalRoot]) {
      assert.deepEqual(listAlertTexts(surface, 'is-danger'), []);
    }
  });

  it('shows a settings save warning in the Settings tab and keeps it when the drawer closes, until the next save', async () => {
    const warningText = 'The director slot model vendor/model-001 could not be checked: timed out after 10 seconds.';
    let putCount = 0;
    const harness = createBrowserHarness({
      settingsPutHandler: (request) => {
        putCount += 1;
        return { status: 200, body: { ...request.body, warnings: putCount === 1 ? [warningText] : [] } };
      },
    });
    const { shell } = harness;
    await harness.app.init();
    const drawerEl = shell.querySelector('#inspector-drawer');
    await findButton(drawerEl, 'Settings').dispatchEvent('click');
    await waitUntil(() => listMetaTexts(drawerEl).includes('OpenRouter models: 2 · Cached 2026-11-25T12:00:00.000Z'));

    await drawerEl.querySelector('form').dispatchEvent('submit');
    assert.deepEqual(listAlertTexts(drawerEl, 'is-warning'), [warningText]);
    assert.ok(drawerEl.textContent.includes('Settings saved.'));
    const firstPut = harness.requests.find((request) => request.method === 'PUT');
    assert.equal(firstPut.headers['X-Worlds-CSRF'], 'ui-test-csrf');

    await drawerEl.querySelector('form').dispatchEvent('submit');
    assert.deepEqual(listAlertTexts(drawerEl, 'is-warning'), []);

    putCount = 0;
    await drawerEl.querySelector('form').dispatchEvent('submit');
    assert.deepEqual(listAlertTexts(drawerEl, 'is-warning'), [warningText]);
    const toggleButton = shell.querySelector('#inspector-toggle-btn');
    await toggleButton.dispatchEvent('click');
    await toggleButton.dispatchEvent('click');
    assert.deepEqual(listAlertTexts(drawerEl, 'is-warning'), [warningText]);

    putCount = 1;
    await drawerEl.querySelector('form').dispatchEvent('submit');
    assert.deepEqual(listAlertTexts(drawerEl, 'is-warning'), []);
    assert.deepEqual(harness.unexpected, []);
  });

  it('keeps settings save warnings when the drawer closes and when Clear saved key runs, and clears them only on the next save', async () => {
    const warningText = 'The director slot model vendor/model-001 could not be checked: HTTP 500.';
    const { drawer, drawerEl } = createDrawerHarness();
    drawer.setSettings({ ...buildBrowserSettings(), apiKey: { configured: true, source: 'secrets' } });
    drawer.setSettingsWarnings([warningText]);
    assert.deepEqual(listAlertTexts(drawerEl, 'is-warning'), [warningText]);

    drawer.setOpen(true);
    drawer.setOpen(false);
    assert.deepEqual(listAlertTexts(drawerEl, 'is-warning'), [warningText]);

    await findButton(drawerEl, 'Clear saved key').dispatchEvent('click');
    assert.deepEqual(listAlertTexts(drawerEl, 'is-warning'), [warningText]);
    assert.ok(drawerEl.textContent.includes('Saved key override cleared.'));

    await drawerEl.querySelector('form').dispatchEvent('submit');
    assert.deepEqual(listAlertTexts(drawerEl, 'is-warning'), []);
  });

  it('keeps the shown Settings warnings through Clear saved key in the real app while the clear still saves and updates the top bar, and clears them only on a Settings Save that returns none', async () => {
    const warningText = 'The director slot model vendor/model-001 could not be checked: HTTP 500.';
    let nextWarnings = [warningText];
    const harness = createBrowserHarness({
      settingsPutHandler: (request) => {
        const isClear = request.body.openRouterApiKey === null;
        return {
          status: 200,
          body: {
            ...buildBrowserSettings(),
            ...request.body,
            apiKey: isClear ? { configured: false, source: 'none' } : { configured: true, source: 'secrets' },
            dailyWarnUsd: isClear ? 0 : null,
            warnings: nextWarnings,
          },
        };
      },
    });
    const { shell } = harness;
    await harness.app.init();
    const drawerEl = shell.querySelector('#inspector-drawer');
    const spendBanner = shell.querySelector('#spend-warning-banner');
    await findButton(drawerEl, 'Settings').dispatchEvent('click');
    await waitUntil(() => listMetaTexts(drawerEl).includes('OpenRouter models: 2 · Cached 2026-11-25T12:00:00.000Z'));

    await drawerEl.querySelector('form').dispatchEvent('submit');
    assert.deepEqual(listAlertTexts(drawerEl, 'is-warning'), [warningText]);
    assert.equal(spendBanner.classList.contains('is-hidden'), true);

    nextWarnings = [];
    await findButton(drawerEl, 'Clear saved key').dispatchEvent('click');
    const putRequests = harness.requests.filter((request) => request.method === 'PUT');
    assert.equal(putRequests.length, 2);
    assert.equal(putRequests[1].body.openRouterApiKey, null);
    assert.deepEqual(listAlertTexts(drawerEl, 'is-warning'), [warningText]);
    assert.ok(drawerEl.textContent.includes('Saved key override cleared.'));
    assert.ok(drawerEl.textContent.includes('Not configured'));
    assert.equal(spendBanner.classList.contains('is-hidden'), false);

    await drawerEl.querySelector('form').dispatchEvent('submit');
    assert.deepEqual(listAlertTexts(drawerEl, 'is-warning'), []);
    assert.deepEqual(harness.unexpected, []);
  });

  it('scrolls the first save warning into view after a warned save in Settings and in the Character modal, and does not scroll after a save without warnings', async () => {
    const settingsWarnings = ['First settings warning.', 'Second settings warning.'];
    const characterWarnings = ['First character warning.', 'Second character warning.'];
    let settingsWarned = true;
    const harness = createBrowserHarness({
      settingsPutHandler: (request) => ({
        status: 200,
        body: { ...request.body, warnings: settingsWarned ? settingsWarnings : [] },
      }),
      characterHandler: (request) => ({
        status: 200,
        body: {
          id: 'char-1',
          slug: 'maya',
          name: 'Maya',
          isPlayer: false,
          bookHints: {},
          ...request.body,
          warnings: request.method === 'POST' ? characterWarnings : [],
        },
      }),
    });
    const { shell, documentRef } = harness;
    await harness.app.init();
    const drawerEl = shell.querySelector('#inspector-drawer');
    const modalRoot = shell.querySelector('#modal-root');
    await findButton(drawerEl, 'Settings').dispatchEvent('click');
    await waitUntil(() => listMetaTexts(drawerEl).includes('OpenRouter models: 2 · Cached 2026-11-25T12:00:00.000Z'));
    assert.deepEqual(documentRef.scrollLog, []);

    await drawerEl.querySelector('form').dispatchEvent('submit');
    assert.equal(documentRef.scrollLog.length, 1);
    assert.equal(documentRef.scrollLog[0].element.textContent, settingsWarnings[0]);
    assert.ok(drawerEl.contains(documentRef.scrollLog[0].element));
    assert.deepEqual(documentRef.scrollLog[0].options, { block: 'nearest' });

    settingsWarned = false;
    await drawerEl.querySelector('form').dispatchEvent('submit');
    assert.deepEqual(listAlertTexts(drawerEl, 'is-warning'), []);
    assert.equal(documentRef.scrollLog.length, 1);

    await findButton(drawerEl, 'Cast').dispatchEvent('click');
    await findButton(drawerEl, 'Add Character').dispatchEvent('click');
    const nameInput = modalRoot.querySelector('#char-name-input');
    nameInput.value = 'Maya';
    await nameInput.dispatchEvent('input');
    await modalRoot.querySelector('form').dispatchEvent('submit');
    assert.equal(documentRef.scrollLog.length, 2);
    assert.equal(documentRef.scrollLog[1].element.textContent, characterWarnings[0]);
    assert.ok(modalRoot.contains(documentRef.scrollLog[1].element));
    assert.deepEqual(documentRef.scrollLog[1].options, { block: 'nearest' });

    await modalRoot.querySelector('form').dispatchEvent('submit');
    assert.equal(modalRoot.querySelector('form'), null);
    assert.equal(documentRef.scrollLog.length, 2);
    assert.deepEqual(harness.unexpected, []);
  });

  it('keeps the Character modal open on the saved character when a save returns warnings, and closes it when there are none', async () => {
    const warningText = "Maya's model override vendor/model-009 could not be checked: HTTP 500.";
    const harness = createBrowserHarness({
      characterHandler: (request) => ({
        status: 200,
        body: {
          id: 'char-1',
          slug: 'maya',
          name: 'Maya',
          isPlayer: false,
          bookHints: { hair: 'black' },
          ...request.body,
          warnings: request.method === 'POST' ? [warningText] : [],
        },
      }),
    });
    const { shell } = harness;
    await harness.app.init();
    const drawerEl = shell.querySelector('#inspector-drawer');
    const modalRoot = shell.querySelector('#modal-root');
    await findButton(drawerEl, 'Cast').dispatchEvent('click');
    await findButton(drawerEl, 'Add Character').dispatchEvent('click');

    const nameInput = modalRoot.querySelector('#char-name-input');
    nameInput.value = 'Maya';
    await nameInput.dispatchEvent('input');
    const modelInput = modalRoot.querySelector('#char-model-input');
    modelInput.value = 'vendor/model-009';
    await modelInput.dispatchEvent('input');
    await modalRoot.querySelector('form').dispatchEvent('submit');

    assert.notEqual(modalRoot.querySelector('form'), null);
    assert.equal(modalRoot.querySelector('#character-modal-title').textContent, 'Edit Character');
    assert.deepEqual(listAlertTexts(modalRoot, 'is-warning'), [warningText]);
    assert.equal(modalRoot.querySelector('#char-name-input').value, 'Maya');
    assert.equal(modalRoot.querySelector('#char-model-input').value, 'vendor/model-009');
    assert.equal(modalRoot.querySelector('#char-card-hint-hair').textContent, 'In the book now: black');
    assert.equal(harness.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/characters')).length, 1);

    await modalRoot.querySelector('form').dispatchEvent('submit');
    assert.equal(modalRoot.querySelector('form'), null);
    const patchRequest = harness.requests.find((request) => request.method === 'PATCH');
    assert.equal(patchRequest.path, '/api/campaigns/camp-1/characters/char-1');
    assert.deepEqual(harness.unexpected, []);
  });

  it('keeps focus and caret in a Settings text field, and only focus on a number field and the Pedant checkbox, across async catalog updates', () => {
    const { drawer, drawerEl, documentRef, shell } = createDrawerHarness();
    const updates = [
      /**
       * @returns {void}
       */
      () => drawer.setModelCatalogLoading(true),
      /**
       * @returns {void}
       */
      () => drawer.setModelCatalog(buildCatalog(2)),
      /**
       * @returns {void}
       */
      () => drawer.setModelCatalogError('OpenRouter is unreachable.'),
    ];

    for (const applyUpdate of updates) {
      const textField = drawerEl.querySelector('#settings-model-director');
      textField.focus();
      textField.selectionStart = 3;
      textField.selectionEnd = 6;
      applyUpdate();
      const restoredText = drawerEl.querySelector('#settings-model-director');
      assert.notEqual(restoredText, textField);
      assert.equal(documentRef.activeElement, restoredText);
      assert.equal(restoredText.selectionStart, 3);
      assert.equal(restoredText.selectionEnd, 6);

      for (const fieldId of ['settings-public-odds', 'settings-pedant-enabled']) {
        const plainField = drawerEl.querySelector(`#${fieldId}`);
        plainField.focus();
        applyUpdate();
        const restoredField = drawerEl.querySelector(`#${fieldId}`);
        assert.notEqual(restoredField, plainField);
        assert.equal(documentRef.activeElement, restoredField);
      }

      const filterField = drawerEl.querySelector('#settings-model-filter');
      filterField.focus();
      filterField.selectionStart = 1;
      filterField.selectionEnd = 1;
      applyUpdate();
      assert.equal(documentRef.activeElement, drawerEl.querySelector('#settings-model-filter'));
      assert.equal(drawerEl.querySelector('#settings-model-filter').selectionStart, 1);
    }

    const outsideField = documentRef.createElement('input');
    outsideField.id = 'outside-field';
    shell.append(outsideField);
    outsideField.focus();
    drawer.setModelCatalog(buildCatalog(2));
    assert.equal(documentRef.activeElement, outsideField);
  });

  it('keeps focus, caret, selection and card scroll on the same field ID across each async catalog update in the Character modal, and focuses the name field only on open', async () => {
    const textFieldIds = [
      'char-name-input',
      'char-aliases-input',
      'char-card-hair',
      'char-card-personalitySummary',
      'char-card-speakingStyle',
      'char-card-scenario',
      'char-model-input',
      'char-model-filter',
    ];
    const focusOnlyFieldIds = ['char-tier-select', 'char-player-checkbox', 'char-model-picker'];
    const catalogUpdates = [
      [
        'setModelCatalogLoading',
        /**
         * @param {CharacterModal} modal
         * @returns {void}
         */
        (modal) => modal.setModelCatalogLoading(true),
      ],
      [
        'setModelCatalog',
        /**
         * @param {CharacterModal} modal
         * @returns {void}
         */
        (modal) => modal.setModelCatalog(buildCatalog(3)),
      ],
      [
        'setModelCatalogError',
        /**
         * @param {CharacterModal} modal
         * @returns {void}
         */
        (modal) => modal.setModelCatalogError('OpenRouter is unreachable.'),
      ],
    ];

    const opened = createModalHarness();
    assert.equal(opened.documentRef.activeElement, opened.modalRoot.querySelector('#char-name-input'));

    for (const [updateName, applyUpdate] of catalogUpdates) {
      for (const fieldId of [...textFieldIds, ...focusOnlyFieldIds]) {
        const { modal, modalRoot, documentRef } = createModalHarness();
        const isTextField = textFieldIds.includes(fieldId);
        const field = modalRoot.querySelector(`#${fieldId}`);
        const label = `${updateName} on ${fieldId}`;
        if (isTextField) {
          field.value = 'Half-typed text';
          await field.dispatchEvent('input');
        }
        field.focus();
        field.selectionStart = 2;
        field.selectionEnd = 6;
        modalRoot.querySelector('.modal-card').scrollTop = 321;

        applyUpdate(modal);

        const restored = modalRoot.querySelector(`#${fieldId}`);
        assert.notEqual(restored, field, label);
        assert.equal(documentRef.activeElement, restored, label);
        assert.equal(modalRoot.querySelector('.modal-card').scrollTop, 321, label);
        if (isTextField) {
          assert.equal(restored.selectionStart, 2, label);
          assert.equal(restored.selectionEnd, 6, label);
          assert.equal(restored.value, 'Half-typed text', label);
        }
      }
    }
  });

  it('leaves focus outside the Character modal untouched on async catalog updates and still keeps the card scroll', () => {
    const { modal, modalRoot, documentRef, shell } = createModalHarness();
    const outsideField = documentRef.createElement('input');
    outsideField.id = 'outside-field';
    shell.append(outsideField);
    outsideField.focus();
    modalRoot.querySelector('.modal-card').scrollTop = 150;

    modal.setModelCatalogLoading(true);
    modal.setModelCatalog(buildCatalog(3));
    modal.setModelCatalogError('OpenRouter is unreachable.');

    assert.equal(documentRef.activeElement, outsideField);
    assert.equal(modalRoot.querySelector('.modal-card').scrollTop, 150);
  });

  it('renders every model in the Character modal dropdown in one group with a count label equal to the option count and no undefined prices', () => {
    const catalog = buildCatalog(75);
    delete catalog.openrouter[3].promptCostPerMillion;
    delete catalog.openrouter[3].completionCostPerMillion;
    catalog.openrouter[5].isModerated = true;
    catalog.recommended = [{ id: 'legacy/recommended-model', name: 'Legacy', recommendedFor: 'old' }];
    const { modalRoot } = createModalHarness({ catalog });

    const picker = modalRoot.querySelector('#char-model-picker');
    const optionValues = listOptionValues(modalRoot, '#char-model-picker');
    assert.equal(optionValues.length, 75);
    assert.equal(new Set(optionValues).size, 75);
    assert.equal(optionValues.includes('legacy/recommended-model'), false);
    const groups = picker.querySelectorAll('optgroup');
    assert.equal(groups.length, 1);
    assert.equal(groups[0].label, 'OpenRouter Catalog (75)');
    assert.equal(groups[0].querySelectorAll('option').length, 75);
    const optionTexts = picker.querySelectorAll('option').map((option) => option.textContent);
    assert.equal(optionTexts.some((text) => text.includes('undefined') || text.includes('null') || text.includes('$undefined')), false);
    assert.ok(optionTexts.includes('vendor/model-000 (33k, $0.3/$0.5)'));
    assert.ok(optionTexts.includes('vendor/model-003 (33k)'));
    assert.ok(optionTexts.includes('vendor/model-005 (33k, $0.3/$0.5, moderated)'));
  });

  it('shows only the filtered matches in the Character modal, selects the empty option and keeps the saved ID when the filter hides it, with the option text of ruling 21', async () => {
    const { modalRoot, savedPayloads } = createModalHarness({
      character: { ...buildCharacter(), modelOverride: 'vendor/model-001' },
      catalog: buildCatalog(75),
    });
    const picker = modalRoot.querySelector('#char-model-picker');
    const filterInput = modalRoot.querySelector('#char-model-filter');
    assert.equal(picker.value, 'vendor/model-001');
    assert.equal(picker.querySelectorAll('option')[0].textContent, 'Use tier default (no override)');

    filterInput.value = 'model-07';
    await filterInput.dispatchEvent('input');
    assert.deepEqual(listOptionValues(modalRoot, '#char-model-picker'), [
      'vendor/model-070',
      'vendor/model-071',
      'vendor/model-072',
      'vendor/model-073',
      'vendor/model-074',
    ]);
    assert.equal(picker.querySelector('optgroup').label, 'OpenRouter Catalog (5 of 75)');
    assert.equal(picker.value, '');
    assert.equal(modalRoot.querySelector('#char-model-input').value, 'vendor/model-001');
    assert.equal(picker.querySelectorAll('option')[0].textContent, 'Select an OpenRouter model...');

    filterInput.value = '';
    await filterInput.dispatchEvent('input');
    assert.equal(picker.value, 'vendor/model-001');
    assert.equal(picker.querySelectorAll('option')[0].textContent, 'Use tier default (no override)');

    filterInput.value = 'model-07';
    await filterInput.dispatchEvent('input');
    picker.value = 'vendor/model-070';
    await picker.dispatchEvent('change');
    assert.equal(modalRoot.querySelector('#char-model-input').value, 'vendor/model-070');
    picker.value = '';
    await picker.dispatchEvent('change');
    assert.equal(modalRoot.querySelector('#char-model-input').value, '');
    await modalRoot.querySelector('form').dispatchEvent('submit');
    assert.equal(savedPayloads[0].modelOverride, null);
  });

  it('keeps the catalog group with zero options and an N of M label when the filter matches nothing, in the Character modal and in Settings', async () => {
    const { modalRoot } = createModalHarness({ catalog: buildCatalog(75) });
    const filterInput = modalRoot.querySelector('#char-model-filter');
    filterInput.value = 'no-such-model';
    await filterInput.dispatchEvent('input');
    const modalPicker = modalRoot.querySelector('#char-model-picker');
    const modalGroups = modalPicker.querySelectorAll('optgroup');
    assert.equal(modalGroups.length, 1);
    assert.equal(modalGroups[0].label, 'OpenRouter Catalog (0 of 75)');
    assert.equal(modalGroups[0].querySelectorAll('option').length, 0);
    assert.equal(modalPicker.querySelectorAll('option').length, 1);

    const { drawer, drawerEl } = createDrawerHarness();
    drawer.setModelCatalog(buildCatalog(75));
    const settingsFilter = drawerEl.querySelector('#settings-model-filter');
    settingsFilter.value = 'no-such-model';
    await settingsFilter.dispatchEvent('input');
    for (const slotKey of ['director', 'composer', 'main', 'recurring', 'scribe']) {
      const settingsPicker = drawerEl.querySelector(`#settings-model-picker-${slotKey}`);
      const settingsGroups = settingsPicker.querySelectorAll('optgroup');
      assert.equal(settingsGroups.length, 1);
      assert.equal(settingsGroups[0].label, 'OpenRouter Catalog (0 of 75)');
      assert.equal(settingsGroups[0].querySelectorAll('option').length, 0);
    }

    const nullCatalog = createModalHarness({ catalog: null });
    const nullFilter = nullCatalog.modalRoot.querySelector('#char-model-filter');
    nullFilter.value = 'no-such-model';
    await nullFilter.dispatchEvent('input');
    const nullPicker = nullCatalog.modalRoot.querySelector('#char-model-picker');
    assert.equal(nullPicker.querySelectorAll('optgroup').length, 0);
    assert.equal(nullPicker.querySelectorAll('option').length, 1);

    const emptyCatalog = createModalHarness({ catalog: buildCatalog(0) });
    const emptyPicker = emptyCatalog.modalRoot.querySelector('#char-model-picker');
    const emptyGroups = emptyPicker.querySelectorAll('optgroup');
    assert.equal(emptyGroups.length, 1);
    assert.equal(emptyGroups[0].label, 'OpenRouter Catalog (0)');
    assert.equal(emptyGroups[0].querySelectorAll('option').length, 0);
  });

  it('does not re-render the Scene and Memory tabs on a catalog update, and shows the new catalog when the Settings tab opens', () => {
    const { drawer, drawerEl, documentRef } = createDrawerHarness();
    drawer.setCampaign(BrowserCampaign);
    drawer.setTab('scene');
    const sceneBody = drawerEl.querySelector('.drawer-body');
    const locationInput = drawerEl.querySelector('#scene-location-input');
    locationInput.focus();
    locationInput.selectionStart = 1;
    locationInput.selectionEnd = 3;
    sceneBody.scrollTop = 500;

    drawer.setModelCatalogLoading(true);
    drawer.setModelCatalog(buildCatalog(7));
    drawer.setModelCatalogError('later error');

    assert.equal(drawerEl.querySelector('.drawer-body'), sceneBody);
    assert.equal(drawerEl.querySelector('#scene-location-input'), locationInput);
    assert.equal(documentRef.activeElement, locationInput);
    assert.equal(locationInput.selectionStart, 1);
    assert.equal(locationInput.selectionEnd, 3);
    assert.equal(sceneBody.scrollTop, 500);

    drawer.setTab('memory');
    const memoryBody = drawerEl.querySelector('.drawer-body');
    memoryBody.scrollTop = 700;
    drawer.setModelCatalogLoading(true);
    drawer.setModelCatalog(buildCatalog(7));
    drawer.setModelCatalogError('later error');
    assert.equal(drawerEl.querySelector('.drawer-body'), memoryBody);
    assert.equal(memoryBody.scrollTop, 700);

    drawer.setTab('settings');
    assert.ok(listMetaTexts(drawerEl).includes('OpenRouter models: 7 · Cached 2026-11-25T12:00:00.000Z'));
    assert.deepEqual(listAlertTexts(drawerEl, 'is-danger'), ['later error']);
    assert.equal(listOptionValues(drawerEl, '#settings-model-picker-main').length, 7);
  });

  it('keeps the drawer body scroll position across a catalog update on the Settings tab', () => {
    const { drawer, drawerEl } = createDrawerHarness();
    const settingsBody = drawerEl.querySelector('.drawer-body');
    settingsBody.scrollTop = 640;

    for (const applyUpdate of [
      /**
       * @returns {void}
       */
      () => drawer.setModelCatalogLoading(true),
      /**
       * @returns {void}
       */
      () => drawer.setModelCatalog(buildCatalog(3)),
      /**
       * @returns {void}
       */
      () => drawer.setModelCatalogError('OpenRouter is unreachable.'),
    ]) {
      applyUpdate();
      const refreshedBody = drawerEl.querySelector('.drawer-body');
      assert.notEqual(refreshedBody, settingsBody);
      assert.equal(refreshedBody.scrollTop, 640);
    }
  });

  /**
   * @returns {Promise<{harness: object, drawerEl: object, toggleButton: object, refreshAnswers: Array<{resolve: (value: any) => void}>}>}
   * @throws {Error}
   */
  async function openSettingsApp() {
    const refreshAnswers = [];
    const harness = createBrowserHarness({
      refreshHandler: () => {
        const answer = createDeferred();
        refreshAnswers.push(answer);
        return answer.promise;
      },
    });
    await harness.app.init();
    const drawerEl = harness.shell.querySelector('#inspector-drawer');
    const toggleButton = harness.shell.querySelector('#inspector-toggle-btn');
    await toggleButton.dispatchEvent('click');
    await findButton(drawerEl, 'Settings').dispatchEvent('click');
    const firstRender = drawerEl.querySelector('#settings-model-filter');
    await waitUntil(() => drawerEl.querySelector('#settings-model-filter') !== firstRender);
    await waitUntil(() => listMetaTexts(drawerEl).includes('OpenRouter models: 2 · Cached 2026-11-25T12:00:00.000Z'));
    return { harness, drawerEl, toggleButton, refreshAnswers };
  }

  it('hides the closed drawer in the stylesheet below 960 px after its slide-out and keeps the docked drawer visible from 960 px', () => {
    const stylesCss = fs.readFileSync(path.join(PublicDirPath, 'styles.css'), 'utf8');
    const wideBlock = '@media (min-width: 960px)';
    const rules = parseCssRules(stylesCss);

    const rootRules = rules.filter((rule) => rule.selector === ':root' && rule.atRules.length === 0);
    assert.equal(rootRules.length, 1);
    const durationDeclaration = /--transition-fast-duration\s*:/;
    const durationRules = rules.filter((rule) => durationDeclaration.test(rule.body));
    assert.deepEqual(durationRules, [rootRules[0]]);
    assert.equal(rootRules[0].body.match(/--transition-fast-duration\s*:/g).length, 1);
    const durationMatch = /--transition-fast-duration:\s*(\d+)ms;/.exec(rootRules[0].body);
    assert.notEqual(durationMatch, null);
    assert.ok(Number(durationMatch[1]) > 0);
    assert.match(rootRules[0].body, /--transition-fast:\s*var\(--transition-fast-duration\) ease;/);

    const hiddenRules = rules.filter((rule) => rule.selector === '.inspector-drawer' && rule.atRules.length === 0);
    assert.equal(hiddenRules.length, 1);
    assert.match(hiddenRules[0].body, /visibility:\s*hidden;/);
    const hiddenTransition = /transition:\s*([^;]+);/.exec(hiddenRules[0].body);
    assert.notEqual(hiddenTransition, null);
    assert.ok(hiddenTransition[1].includes('transform var(--transition-fast)'));
    assert.ok(hiddenTransition[1].includes('visibility 0s linear var(--transition-fast-duration)'));

    const openRules = rules.filter((rule) => rule.selector === '.inspector-drawer.is-open' && rule.atRules.length === 0);
    assert.equal(openRules.length, 1);
    assert.match(openRules[0].body, /visibility:\s*visible;/);
    assert.match(openRules[0].body, /transition:[^;]*visibility 0s linear 0s/);

    const wideRules = rules.filter((rule) => {
      return rule.selector === '.inspector-drawer' && rule.atRules.length === 1 && rule.atRules[0] === wideBlock;
    });
    assert.equal(wideRules.length, 1);
    assert.match(wideRules[0].body, /visibility:\s*visible;/);

    const transitionShorthand = /(^|[\s;])transition\s*:/g;
    const transitionLonghand = /(^|[\s;])transition-[a-z-]+\s*:/;
    for (const topRule of [hiddenRules[0], openRules[0]]) {
      assert.equal(topRule.body.match(transitionShorthand).length, 1, topRule.selector);
      assert.doesNotMatch(topRule.body, transitionLonghand, topRule.selector);
    }

    const allowedDrawerRules = [hiddenRules[0], openRules[0], wideRules[0]];
    const drawerRules = rules.filter((rule) => {
      return rule.selector.includes('.inspector-drawer') || rule.selector.includes('#inspector-drawer');
    });
    const otherDrawerRules = drawerRules.filter((rule) => !allowedDrawerRules.includes(rule));
    assert.ok(otherDrawerRules.length > 0);
    for (const otherRule of otherDrawerRules) {
      assert.doesNotMatch(otherRule.body, /(^|[\s;])(visibility|transition(-[a-z-]+)?)\s*:/, otherRule.selector);
    }

    const reducedRules = rules.filter((rule) => {
      return rule.selector === '*, *::before, *::after'
        && rule.atRules.length === 1
        && rule.atRules[0] === '@media (prefers-reduced-motion: reduce)';
    });
    assert.equal(reducedRules.length, 1);
    assert.match(reducedRules[0].body, /transition-delay:\s*0s !important;/);
  });

  it('keeps focus and caret in the Settings filter when Escape closes the drawer on a wide screen', async () => {
    const { harness, drawerEl, toggleButton } = await openSettingsApp();
    const { documentRef } = harness;
    const filterField = drawerEl.querySelector('#settings-model-filter');
    filterField.focus();
    filterField.selectionStart = 2;
    filterField.selectionEnd = 2;
    assert.equal(toggleButton.getAttribute('aria-expanded'), 'true');
    assert.equal(drawerEl.classList.contains('is-open'), true);

    await documentRef.dispatchKeydown('Escape');

    assert.equal(toggleButton.getAttribute('aria-expanded'), 'false');
    assert.equal(drawerEl.classList.contains('is-open'), false);
    assert.equal(documentRef.activeElement, filterField);
    assert.equal(filterField.selectionStart, 2);
  });

  it('returns focus to Refresh when the load ends after Escape closed the drawer on a wide screen', async () => {
    const { harness, drawerEl, toggleButton, refreshAnswers } = await openSettingsApp();
    const { documentRef } = harness;
    const refreshButton = drawerEl.querySelector('#settings-refresh-models');
    refreshButton.focus();
    const pendingClick = refreshButton.dispatchEvent('click');
    await waitUntil(() => refreshAnswers.length === 1);
    assert.equal(documentRef.activeElement, documentRef.body);

    await documentRef.dispatchKeydown('Escape');
    assert.equal(toggleButton.getAttribute('aria-expanded'), 'false');
    assert.equal(drawerEl.classList.contains('is-open'), false);
    refreshAnswers[0].resolve({ status: 200, body: buildCatalog(3) });
    await pendingClick;

    assert.equal(documentRef.activeElement, drawerEl.querySelector('#settings-refresh-models'));
  });

  it('keeps focus and caret on a catalog update and returns focus to Refresh for a drawer that was never opened, as on a wide screen', async () => {
    const { drawer, drawerEl, documentRef } = createDrawerHarness();
    assert.equal(drawer.isOpen(), false);

    const filterField = drawerEl.querySelector('#settings-model-filter');
    filterField.focus();
    filterField.selectionStart = 2;
    filterField.selectionEnd = 2;
    drawer.setModelCatalog(buildCatalog(3));
    const restoredFilter = drawerEl.querySelector('#settings-model-filter');
    assert.notEqual(restoredFilter, filterField);
    assert.equal(documentRef.activeElement, restoredFilter);
    assert.equal(restoredFilter.selectionStart, 2);

    const refreshButton = drawerEl.querySelector('#settings-refresh-models');
    refreshButton.focus();
    await refreshButton.dispatchEvent('click');
    drawer.setModelCatalogLoading(true);
    drawer.setModelCatalog(buildCatalog(3));
    assert.equal(documentRef.activeElement, drawerEl.querySelector('#settings-refresh-models'));
  });

  it('keeps focus on every Settings drawer button, the header Close, the five tabs, Apply suggested defaults, Clear saved key, Cancel and Save, across each catalog update', () => {
    const tabIds = ['scene', 'cast', 'memory', 'findings', 'settings'];
    const buttonIds = [
      'drawer-close',
      ...tabIds.map((tabId) => `drawer-tab-${tabId}`),
      'settings-apply-defaults',
      'settings-clear-key',
      'settings-cancel',
      'settings-save',
    ];
    const catalogUpdates = [
      [
        'setModelCatalogLoading',
        /**
         * @param {InspectorDrawer} drawer
         * @returns {void}
         */
        (drawer) => drawer.setModelCatalogLoading(true),
      ],
      [
        'setModelCatalog',
        /**
         * @param {InspectorDrawer} drawer
         * @returns {void}
         */
        (drawer) => drawer.setModelCatalog(buildCatalog(3)),
      ],
      [
        'setModelCatalogError',
        /**
         * @param {InspectorDrawer} drawer
         * @returns {void}
         */
        (drawer) => drawer.setModelCatalogError('OpenRouter is unreachable.'),
      ],
    ];
    const { drawer, drawerEl, documentRef } = createDrawerHarness();
    drawer.setSettings({ ...buildBrowserSettings(), apiKey: { configured: true, source: 'secrets' } });

    for (const [updateName, applyUpdate] of catalogUpdates) {
      for (const buttonId of buttonIds) {
        const label = `${updateName} on ${buttonId}`;
        const button = drawerEl.querySelector(`#${buttonId}`);
        assert.notEqual(button, null, label);
        button.focus();
        assert.equal(documentRef.activeElement, button, label);
        applyUpdate(drawer);
        const restored = drawerEl.querySelector(`#${buttonId}`);
        assert.notEqual(restored, button, label);
        assert.equal(documentRef.activeElement, restored, label);
      }
    }
  });

  it('keeps focus on the Character modal Close, Cancel, Save and avatar buttons across each catalog update', () => {
    const avatarTokens = ['sage', 'rose', 'amber', 'slate', 'plum', 'teal', 'indigo', 'coral'];
    const buttonIds = [
      'char-modal-close',
      'char-modal-cancel',
      'char-modal-save',
      ...avatarTokens.map((token) => `char-avatar-${token}`),
    ];
    const catalogUpdates = [
      [
        'setModelCatalogLoading',
        /**
         * @param {CharacterModal} modal
         * @returns {void}
         */
        (modal) => modal.setModelCatalogLoading(true),
      ],
      [
        'setModelCatalog',
        /**
         * @param {CharacterModal} modal
         * @returns {void}
         */
        (modal) => modal.setModelCatalog(buildCatalog(3)),
      ],
      [
        'setModelCatalogError',
        /**
         * @param {CharacterModal} modal
         * @returns {void}
         */
        (modal) => modal.setModelCatalogError('OpenRouter is unreachable.'),
      ],
    ];
    const { modal, modalRoot, documentRef } = createModalHarness();

    for (const [updateName, applyUpdate] of catalogUpdates) {
      for (const buttonId of buttonIds) {
        const label = `${updateName} on ${buttonId}`;
        const button = modalRoot.querySelector(`#${buttonId}`);
        assert.notEqual(button, null, label);
        button.focus();
        assert.equal(documentRef.activeElement, button, label);
        applyUpdate(modal);
        const restored = modalRoot.querySelector(`#${buttonId}`);
        assert.notEqual(restored, button, label);
        assert.equal(documentRef.activeElement, restored, label);
      }
    }
  });

  /**
   * @param {{documentRef: object, shell: object, containerElement: object, refreshSelector: string, setLoading: () => void, setCatalog: () => void, setError: () => void}} options
   * @returns {Promise<void>}
   * @throws {Error}
   */
  async function verifyRefreshReturnFlag({ documentRef, shell, containerElement, refreshSelector, setLoading, setCatalog, setError }) {
    const refreshButton = containerElement.querySelector(refreshSelector);
    refreshButton.focus();
    await refreshButton.dispatchEvent('click');
    setLoading();
    setCatalog();
    assert.equal(documentRef.activeElement, containerElement.querySelector(refreshSelector));
    for (const [endName, endLoad] of [['catalog', setCatalog], ['error', setError]]) {
      setLoading();
      assert.equal(documentRef.activeElement, documentRef.body, endName);
      endLoad();
      assert.equal(documentRef.activeElement, documentRef.body, endName);
    }

    const outsideField = documentRef.createElement('input');
    outsideField.id = 'outside-field';
    shell.append(outsideField);
    for (const [endName, endLoad] of [['catalog', setCatalog], ['error', setError]]) {
      await containerElement.querySelector(refreshSelector).dispatchEvent('click');
      setLoading();
      outsideField.focus();
      endLoad();
      assert.equal(documentRef.activeElement, outsideField, endName);
      assert.equal(containerElement.contains(documentRef.activeElement), false, endName);
    }
  }

  it('never pulls in focus that sits outside the container on a Refresh return, and returns focus once per click, in Settings and in the Character modal', async () => {
    const drawerHarness = createDrawerHarness();
    await verifyRefreshReturnFlag({
      documentRef: drawerHarness.documentRef,
      shell: drawerHarness.shell,
      containerElement: drawerHarness.drawerEl,
      refreshSelector: '#settings-refresh-models',
      setLoading: () => drawerHarness.drawer.setModelCatalogLoading(true),
      setCatalog: () => drawerHarness.drawer.setModelCatalog(buildCatalog(3)),
      setError: () => drawerHarness.drawer.setModelCatalogError('OpenRouter is unreachable.'),
    });

    const modalHarness = createModalHarness();
    await verifyRefreshReturnFlag({
      documentRef: modalHarness.documentRef,
      shell: modalHarness.shell,
      containerElement: modalHarness.modalRoot,
      refreshSelector: '#char-refresh-models',
      setLoading: () => modalHarness.modal.setModelCatalogLoading(true),
      setCatalog: () => modalHarness.modal.setModelCatalog(buildCatalog(3)),
      setError: () => modalHarness.modal.setModelCatalogError('OpenRouter is unreachable.'),
    });
  });

  it('clears the pending Settings Refresh flag when the load ends while another tab is active', async () => {
    const { drawer, drawerEl, documentRef } = createDrawerHarness();
    await drawerEl.querySelector('#settings-refresh-models').dispatchEvent('click');
    drawer.setModelCatalogLoading(true);
    drawer.setTab('scene');
    drawer.setModelCatalog(buildCatalog(3));
    drawer.setTab('settings');
    drawer.setModelCatalogLoading(true);
    drawer.setModelCatalogError('later error');
    assert.equal(documentRef.activeElement, documentRef.body);
    assert.equal(drawerEl.contains(documentRef.activeElement), false);
  });

  /**
   * @param {{harness: {shell: object, documentRef: object}, refreshAnswers: Array<{resolve: (value: any) => void}>, containerElement: object, refreshSelector: string, otherFieldSelector: string}} options
   * @returns {Promise<void>}
   * @throws {Error}
   */
  async function verifyRefreshFocusReturn({ harness, refreshAnswers, containerElement, refreshSelector, otherFieldSelector }) {
    const { documentRef } = harness;
    const outcomes = [
      { status: 200, body: buildCatalog(3) },
      { status: 502, body: { error: 'OpenRouter is unreachable.' } },
    ];
    for (const outcome of outcomes) {
      const answerIndex = refreshAnswers.length;
      const refreshButton = containerElement.querySelector(refreshSelector);
      refreshButton.focus();
      assert.equal(documentRef.activeElement, refreshButton);
      const pendingClick = refreshButton.dispatchEvent('click');
      await waitUntil(() => refreshAnswers.length === answerIndex + 1);
      assert.equal(documentRef.activeElement, documentRef.body);
      refreshAnswers[answerIndex].resolve(outcome);
      await pendingClick;
      assert.equal(documentRef.activeElement, containerElement.querySelector(refreshSelector), `outcome ${outcome.status}`);
      assert.equal(containerElement.querySelector(refreshSelector).disabled, false);
    }

    const otherAnswerIndex = refreshAnswers.length;
    const lastRefreshButton = containerElement.querySelector(refreshSelector);
    lastRefreshButton.focus();
    const lastClick = lastRefreshButton.dispatchEvent('click');
    await waitUntil(() => refreshAnswers.length === otherAnswerIndex + 1);
    const otherField = containerElement.querySelector(otherFieldSelector);
    otherField.focus();
    refreshAnswers[otherAnswerIndex].resolve(outcomes[0]);
    await lastClick;
    assert.equal(documentRef.activeElement, containerElement.querySelector(otherFieldSelector));
    assert.notEqual(documentRef.activeElement, containerElement.querySelector(refreshSelector));
  }

  it('returns focus to the Settings Refresh button when a refresh ends with success or an error, but not when another field was focused meanwhile', async () => {
    const refreshAnswers = [];
    const harness = createBrowserHarness({
      refreshHandler: () => {
        const answer = createDeferred();
        refreshAnswers.push(answer);
        return answer.promise;
      },
    });
    const { shell } = harness;
    await harness.app.init();
    const drawerEl = shell.querySelector('#inspector-drawer');
    await findButton(drawerEl, 'Settings').dispatchEvent('click');
    await waitUntil(() => listMetaTexts(drawerEl).includes('OpenRouter models: 2 · Cached 2026-11-25T12:00:00.000Z'));

    await verifyRefreshFocusReturn({
      harness,
      refreshAnswers,
      containerElement: drawerEl,
      refreshSelector: '#settings-refresh-models',
      otherFieldSelector: '#settings-model-director',
    });
    assert.deepEqual(harness.unexpected, []);
  });

  it('returns focus to the Character modal Refresh button when a refresh ends with success or an error, but not when another field was focused meanwhile', async () => {
    const refreshAnswers = [];
    const harness = createBrowserHarness({
      refreshHandler: () => {
        const answer = createDeferred();
        refreshAnswers.push(answer);
        return answer.promise;
      },
    });
    const { shell } = harness;
    await harness.app.init();
    const drawerEl = shell.querySelector('#inspector-drawer');
    const modalRoot = shell.querySelector('#modal-root');
    await findButton(drawerEl, 'Cast').dispatchEvent('click');
    await findButton(drawerEl, 'Add Character').dispatchEvent('click');
    await waitUntil(() => listMetaTexts(modalRoot).includes('OpenRouter models: 2 · Cached 2026-11-25T12:00:00.000Z'));

    await verifyRefreshFocusReturn({
      harness,
      refreshAnswers,
      containerElement: modalRoot,
      refreshSelector: '#char-refresh-models',
      otherFieldSelector: '#char-card-personalitySummary',
    });
    assert.deepEqual(harness.unexpected, []);
  });

  it('shows the loading state when the Character modal opens during a running load, and updates it when the load lands', async () => {
    const modelLoad = createDeferred();
    const harness = createBrowserHarness({ catalogHandler: () => modelLoad.promise });
    const { shell } = harness;
    await harness.app.init();
    const drawerEl = shell.querySelector('#inspector-drawer');
    const modalRoot = shell.querySelector('#modal-root');
    await findButton(drawerEl, 'Cast').dispatchEvent('click');
    await findButton(drawerEl, 'Add Character').dispatchEvent('click');

    assert.ok(listMetaTexts(modalRoot).includes('Loading OpenRouter catalog...'));
    const busyButton = findButton(modalRoot, 'Loading catalog...');
    assert.equal(busyButton.disabled, true);
    assert.equal(listOptionValues(modalRoot, '#char-model-picker').length, 0);

    modelLoad.resolve({ status: 200, body: buildCatalog(4) });
    await waitUntil(() => listMetaTexts(modalRoot).includes('OpenRouter models: 4 · Cached 2026-11-25T12:00:00.000Z'));
    assert.equal(listMetaTexts(modalRoot).includes('Loading OpenRouter catalog...'), false);
    assert.equal(findButton(modalRoot, 'Refresh OpenRouter models').disabled, false);
    assert.equal(listOptionValues(modalRoot, '#char-model-picker').length, 4);
    assert.deepEqual(harness.unexpected, []);
  });

  it('sends POST /api/models/refresh with the CSRF header from the Settings button and from the Character modal button', async () => {
    const harness = createBrowserHarness();
    const { shell } = harness;
    await harness.app.init();
    const drawerEl = shell.querySelector('#inspector-drawer');
    const modalRoot = shell.querySelector('#modal-root');
    await findButton(drawerEl, 'Settings').dispatchEvent('click');
    await waitUntil(() => listMetaTexts(drawerEl).includes('OpenRouter models: 2 · Cached 2026-11-25T12:00:00.000Z'));
    /**
     * @param {{method: string, path: string}} request
     * @returns {boolean}
     */
    const isRefresh = (request) => request.method === 'POST' && request.path === '/api/models/refresh';
    assert.equal(harness.requests.filter(isRefresh).length, 0);

    await findButton(drawerEl, 'Refresh OpenRouter models').dispatchEvent('click');
    assert.equal(harness.requests.filter(isRefresh).length, 1);

    await findButton(drawerEl, 'Cast').dispatchEvent('click');
    await findButton(drawerEl, 'Add Character').dispatchEvent('click');
    await findButton(modalRoot, 'Refresh OpenRouter models').dispatchEvent('click');

    const refreshRequests = harness.requests.filter(isRefresh);
    assert.equal(refreshRequests.length, 2);
    for (const refreshRequest of refreshRequests) {
      assert.equal(refreshRequest.url, '/api/models/refresh');
      assert.equal(refreshRequest.headers['X-Worlds-CSRF'], 'ui-test-csrf');
    }
    assert.equal(harness.requests.filter((request) => request.method === 'GET' && request.url === '/api/models').length, 1);
    assert.deepEqual(harness.unexpected, []);
  });
});
