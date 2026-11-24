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
      this.type = '';
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
      this.focused = false;
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
      this.focused = true;
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
   */
  function matchesSelector(element, selector) {
    if (selector.startsWith('#')) {
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

  const documentRef = {
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    addEventListener(eventType, handler) {
      const list = docListeners.get(eventType) ?? [];
      list.push(handler);
      docListeners.set(eventType, list);
    },
    removeEventListener(eventType, handler) {
      const list = docListeners.get(eventType) ?? [];
      docListeners.set(
        eventType,
        list.filter((entry) => entry !== handler),
      );
    },
    async dispatchKeydown(keyName) {
      const handlers = [...(docListeners.get('keydown') ?? [])];
      for (const handler of handlers) {
        await handler({ key: keyName, preventDefault() {} });
      }
    },
    getDocumentListenerCount(eventType) {
      return (docListeners.get(eventType) ?? []).length;
    },
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
      'components/InspectorDrawer.mjs',
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
      read() {
        return new Promise((resolve) => {
          resolvePendingRead = resolve;
        });
      },
      async cancel() {
        cancelCalled = true;
        if (resolvePendingRead !== null) {
          resolvePendingRead({ done: true, value: undefined });
        }
      },
      releaseLock() {
        releaseCalled = true;
      },
    };
    const fakeResponse = {
      body: {
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
          persona: xssScript,
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

    composerInput.value = 'Abort this turn please.';
    await composerInput.dispatchEvent('input');
    await sendButton.dispatchEvent('click');
    await abortDirectorStartedPromise;
    assert.equal(sendButton.textContent, 'Stop');
    await sendButton.dispatchEvent('click');

    const abortDeadlineMs = Date.now() + 3000;
    while (Date.now() < abortDeadlineMs && sendButton.textContent !== 'Send') {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(sendButton.textContent, 'Send');
    assert.equal(shell.querySelector('#chat-view').querySelectorAll('.turn-card').length, 2);
    assert.ok(composerBar.textContent.includes('Turn stopped. No changes were committed.'));
  });
});
