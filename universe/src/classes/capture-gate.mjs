import { randomUUID } from 'node:crypto';
import { isId } from './cloud-save.mjs';

export class CaptureGate {
  tabs = new Map();
  writers = 0;
  request = null;
  retry = false;
  onIdle;
  unknownBrowser = false;
  loreWrites = new Map();
  removedLore = new Set();
  flushes = new Set();

  /**
   * @param {Function} onIdle
   */
  constructor(onIdle = () => {}) {
    this.onIdle = onIdle;
  }

  /**
   * @param {string} id
   * @param {number} timeout
   * @returns {Promise<string>}
   */
  acquire(id, timeout = 60_000) {
    if (this.unknownBrowser) {
      return Promise.resolve('unavailable');
    }
    if (!isId(id) || this.request || [...this.tabs.values()].some(tab => tab.lost)) {
      this.retry = true;
      return Promise.resolve('pending');
    }
    const ready = Promise.withResolvers();
    const released = Promise.withResolvers();
    this.request = { id, epoch: randomUUID(), ready, released, held: false, timer: setTimeout(() => this.release(id), timeout) };
    this.check();
    return ready.promise;
  }

  /**
   * @returns {void}
   */
  check() {
    const request = this.request;
    if (request && !request.held && !this.writers &&
        [...this.tabs.values()].every(tab => !tab.lost && (!tab.admitted || tab.ack === request.epoch))) {
      try {
        for (const flush of this.flushes) {
          flush();
        }
      } catch (error) {
        console.warn('[universe] Could not drain profile backups:', error.message);
        this.release(request.id);
        return;
      }
      request.held = true;
      clearTimeout(request.timer);
      request.ready.resolve('held');
    }
  }

  /**
   * @param {Function} work
   * @returns {Promise<unknown>}
   */
  async background(work) {
    while (this.request?.held) {
      await this.request.released.promise;
    }
    this.writers++;
    try {
      return await work();
    } finally {
      this.writers--;
      this.check();
    }
  }

  /**
   * @param {string} id
   * @returns {void}
   */
  release(id) {
    const request = this.request;
    if (request && request.id === id) {
      clearTimeout(request.timer);
      this.request = null;
      this.retry = !request.held;
      request.ready.resolve('pending');
      request.released.resolve();
      for (const tab of this.tabs.values()) {
        tab.ack = null;
      }
    }
  }

  /**
   * @param {string} owner
   * @param {object} body
   * @returns {object}
   */
  control(owner, body) {
    if (!owner || !body || !isId(body.tab)) {
      return { status: 400 };
    }
    const now = Date.now();
    for (const [id, entry] of this.tabs) {
      if (!entry.admitted && !entry.lost && now >= entry.expires) {
        this.tabs.delete(id);
      }
    }
    let tab = this.tabs.get(body.tab);
    const unreportedLoss = body.command === 'leave' && body.clean === false;
    if (!tab && (body.command === 'join' || unreportedLoss) && this.tabs.size < 128) {
      tab = { owner, ack: null, admitted: false, expires: now + 60_000, lost: false, window: now, count: 0 };
      this.tabs.set(body.tab, tab);
    }
    if (!tab || tab.owner !== owner) {
      return { status: body.command === 'join' ? 429 : 404 };
    }
    if (now - tab.window >= 1000) {
      tab.window = now;
      tab.count = 0;
    }
    if (++tab.count > 50) {
      return { status: 429 };
    }
    const request = this.request;
    if (!tab.admitted && !['join', 'admit', 'leave'].includes(body.command)) {
      return { status: 409 };
    }
    switch (body.command) {
      case 'lore-begin': {
        if (!isId(body.operation) || !Array.isArray(body.names) || !body.names.length || body.names.length > 2 ||
            body.names.some(name => typeof name !== 'string' || !name || name.length > 1024) ||
            !Array.isArray(body.allowMissing) || body.allowMissing.some(name => !body.names.includes(name))) {
          return { status: 400 };
        }
        const keys = body.names.map(name => JSON.stringify([owner, name.normalize('NFC')]));
        const allowed = new Set(body.allowMissing.map(name => JSON.stringify([owner, name.normalize('NFC')])));
        let entry = this.loreWrites.get(body.operation);
        if (!entry) {
          if (this.loreWrites.size >= 128) {
            return { status: 429 };
          }
          entry = { tab, keys, granted: false, invalid: keys.some(key => this.removedLore.has(key) && !allowed.has(key)) };
          this.loreWrites.set(body.operation, entry);
        }
        if (entry.tab !== tab || JSON.stringify(keys) !== JSON.stringify(entry.keys)) {
          return { status: 409 };
        }
        if (entry.invalid) {
          this.loreWrites.delete(body.operation);
          return { status: 200, lore: 'removed' };
        }
        for (const prior of this.loreWrites.values()) {
          if (prior === entry) {
            break;
          }
          if (prior.keys.some(key => keys.includes(key))) {
            return { status: 200, lore: 'waiting' };
          }
        }
        entry.granted = true;
        return { status: 200, lore: 'ready' };
      }
      case 'lore-end': {
        const entry = this.loreWrites.get(body.operation);
        if (!isId(body.operation) || (entry && entry.tab !== tab)) {
          return { status: 400 };
        }
        if (entry?.granted) {
          for (const [name, removed] of [[body.saved, false], [body.removed, true]]) {
            if (name == null) {
              continue;
            }
            if (typeof name !== 'string') {
              return { status: 400 };
            }
            const key = JSON.stringify([owner, name.normalize('NFC')]);
            if (!entry.keys.includes(key)) {
              return { status: 400 };
            }
            if (removed) {
              this.removedLore.add(key);
              for (const other of this.loreWrites.values()) {
                if (other !== entry && other.keys.includes(key)) {
                  other.invalid = true;
                }
              }
            } else {
              this.removedLore.delete(key);
            }
          }
        }
        this.loreWrites.delete(body.operation);
        return { status: 200 };
      }
      case 'join':
        break;
      case 'admit':
        if (!request?.held && !tab.lost) {
          tab.admitted = true;
        }
        break;
      case 'poll':
        break;
      case 'idle':
        if (this.retry && !this.request) {
          this.retry = false;
          this.onIdle();
        }
        break;
      case 'ack':
      case 'failed':
        if (!isId(body.epoch)) {
          return { status: 400 };
        }
        if (request && body.epoch === request.epoch && !request.held) {
          if (body.command === 'failed') {
            this.release(request.id);
          } else {
            tab.ack = request.epoch;
            this.check();
          }
        }
        break;
      case 'leave':
        if (typeof body.clean !== 'boolean') {
          return { status: 400 };
        }
        if (request && !request.held && (tab.admitted || !body.clean) && tab.ack !== request.epoch) {
          this.release(request.id);
        }
        if (body.clean) {
          this.tabs.delete(body.tab);
        } else {
          tab.lost = true;
        }
        for (const [id, entry] of this.loreWrites) {
          if (entry.tab === tab) {
            this.loreWrites.delete(id);
          }
        }
        break;
      default:
        return { status: 400 };
    }
    return { status: 200, admitted: tab.admitted, epoch: this.request?.epoch ?? null, acknowledged: Boolean(this.request && tab.ack === this.request.epoch) };
  }

  /**
   * @param {object} request
   * @param {object} response
   * @param {Function} next
   * @returns {Promise<void>}
   */
  async guard(request, response, next) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !/^\/api(?:\/|$)/i.test(request.path ?? '')) {
      next();
      return;
    }
    while (this.request?.held) {
      await this.request.released.promise;
    }
    if (response.destroyed) {
      return;
    }
    const browser = request.headers?.['sec-fetch-site'] || request.headers?.origin || request.headers?.referer;
    const tab = this.tabs.get(request.headers?.['x-universe-tab']);
    const editor = !request.path || /^\/api\/(?:chats|characters|groups|worldinfo)\/(?!get|all|list|search)/i.test(request.path);
    if (editor && browser && (!tab?.admitted || tab.owner !== request.user?.profile?.handle)) {
      if (!this.unknownBrowser) {
        console.warn('[universe] Live checkpoints unavailable: an unregistered browser used the story API. Reload all chats when restarting Universe.');
      }
      this.unknownBrowser = true;
      if (this.request && !this.request.held) {
        this.release(this.request.id);
      }
    }
    this.writers++;
    const end = response.end;
    response.end = (...args) => {
      response.end = end;
      try {
        return end.apply(response, args);
      } finally {
        this.writers--;
        this.check();
      }
    };
    next();
  }
}
