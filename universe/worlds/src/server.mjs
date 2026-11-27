import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorldsConfig } from './config.mjs';
import { RateLimiter } from './http/RateLimiter.mjs';
import { Router } from './http/Router.mjs';
import { Security } from './http/Security.mjs';
import { ModelAvailabilityService } from './openrouter/ModelAvailabilityService.mjs';
import { ModelCatalog } from './openrouter/ModelCatalog.mjs';
import { OpenRouterClient } from './openrouter/OpenRouterClient.mjs';
import { ReplyLog } from './openrouter/ReplyLog.mjs';
import { MuseService } from './scribe/MuseService.mjs';
import { PedantService } from './scribe/PedantService.mjs';
import { ScribeService } from './scribe/ScribeService.mjs';
import { TurnEngine } from './engine/TurnEngine.mjs';
import { SqliteStore } from './store/SqliteStore.mjs';
import { R2Transport } from './sync/R2Transport.mjs';
import { WorldSync } from './sync/WorldSync.mjs';

export class WorldsServer {
  #config;
  #store;
  #ownsStore;
  #syncService;
  #router;
  #modelCatalog;
  #httpServer;
  #activeControllers;
  #csrfToken;
  #boundPort = null;
  #closed = false;
  #stopPromise = null;

  /**
   * @param {{config: object, store: object, ownsStore: boolean, syncService: object | null, router: Router, modelCatalog: ModelCatalog, httpServer: import('node:http').Server, activeControllers: Set<AbortController>, csrfToken: string}} options
   */
  constructor({
    config,
    store,
    ownsStore,
    syncService,
    router,
    modelCatalog,
    httpServer,
    activeControllers,
    csrfToken,
  }) {
    this.#config = config;
    this.#store = store;
    this.#ownsStore = ownsStore;
    this.#syncService = syncService;
    this.#router = router;
    this.#modelCatalog = modelCatalog;
    this.#httpServer = httpServer;
    this.#activeControllers = activeControllers;
    this.#csrfToken = csrfToken;
  }

  /**
   * @param {{config?: object | null, store?: object | null, client?: object | null, syncService?: object | null, publicDir?: string, csrfToken?: string, rateLimiter?: RateLimiter, modelCatalog?: ModelCatalog}} [options]
   * @returns {Promise<WorldsServer>}
   * @throws {Error}
   */
  static async create(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('WorldsServer.create options must be a plain object.');
    }

    const {
      config = null,
      store = null,
      client = null,
      syncService = null,
      publicDir = path.resolve(import.meta.dirname, '..', 'public'),
      csrfToken = Security.generateCsrfToken(),
      rateLimiter = new RateLimiter(),
      modelCatalog = null,
    } = options;

    const resolvedConfig = config ?? WorldsConfig.load();
    if (resolvedConfig === null || typeof resolvedConfig !== 'object') {
      throw new TypeError('config must be a valid WorldsConfig object.');
    }
    if (syncService !== null) {
      if (
        typeof syncService !== 'object' ||
        typeof syncService.pullOnStartup !== 'function' ||
        typeof syncService.pushSnapshot !== 'function'
      ) {
        throw new TypeError('syncService must be null or provide pullOnStartup() and pushSnapshot().');
      }
    }
    if (typeof publicDir !== 'string' || publicDir.trim().length === 0) {
      throw new RangeError('publicDir must be a non-empty string.');
    }
    if (typeof csrfToken !== 'string' || csrfToken.length === 0) {
      throw new RangeError('csrfToken must be a non-empty string.');
    }

    const ownsStore = store === null;
    if (ownsStore) {
      fs.mkdirSync(resolvedConfig.localDir, { recursive: true, mode: 0o700 });
    }

    let syncStatus = {
      mode: resolvedConfig.r2 ? 'configured' : 'local_only',
      status: resolvedConfig.r2 ? 'ready' : 'local_only',
    };

    if (syncService !== null && ownsStore) {
      const pullResult = await syncService.pullOnStartup({
        dbPath: resolvedConfig.dbPath,
        syncStatePath: resolvedConfig.syncStatePath,
        conflictsDir: resolvedConfig.conflictsDir,
      });
      syncStatus = pullResult !== null && typeof pullResult === 'object'
        ? { mode: 'r2', ...pullResult }
        : { mode: 'r2', status: 'ready' };
    } else if (syncService !== null) {
      syncStatus = typeof syncService.getStatus === 'function'
        ? syncService.getStatus()
        : { mode: 'r2', status: 'ready' };
    }

    const activeStore = ownsStore ? new SqliteStore(resolvedConfig.dbPath) : store;
    try {
      /**
       * @returns {string[]}
       */
      const configuredIdsProvider = () => {
        const slotModels = Object.values(activeStore.getSettings().models).filter((slotModel) => {
          return slotModel.length > 0;
        });
        return [...new Set([...slotModels, ...activeStore.listModelOverrides()])];
      };
      const activeModelCatalog = modelCatalog ?? new ModelCatalog({
        cachePath: resolvedConfig.modelCachePath,
        configuredIdsProvider,
      });

      const activeClient = client ?? new OpenRouterClient({
        apiKeyProvider: () => WorldsConfig.resolveApiKey(resolvedConfig).key,
        onSpend: (spendDto) => activeStore.recordSpend(spendDto),
        replyLog: resolvedConfig.logReplies ? new ReplyLog(resolvedConfig.replyLogPath) : null,
      });

      const scribeService = new ScribeService({
        store: activeStore,
        client: activeClient,
      });
      const modelAvailability = new ModelAvailabilityService({
        modelCatalog: activeModelCatalog,
        store: activeStore,
        scribeService,
      });
      const pedantService = new PedantService({
        store: activeStore,
        client: activeClient,
        scribeService,
      });
      const museService = new MuseService({
        store: activeStore,
        client: activeClient,
        scribeService,
      });
      const turnEngine = new TurnEngine({
        store: activeStore,
        client: activeClient,
        scribeService,
        pedantService,
        modelCatalog: activeModelCatalog,
      });

      const activeControllers = new Set();
      const getSyncStatus = () => {
        if (syncService !== null && typeof syncService.getStatus === 'function') {
          return syncService.getStatus();
        }
        return syncStatus;
      };

      const router = new Router({
        config: resolvedConfig,
        store: activeStore,
        scribeService,
        pedantService,
        museService,
        turnEngine,
        syncService,
        publicDir,
        csrfToken,
        port: resolvedConfig.port,
        rateLimiter,
        activeControllers,
        getSyncStatus,
        modelCatalog: activeModelCatalog,
        modelAvailability,
      });

      const httpServer = http.createServer((request, response) => {
        void router.handle(request, response);
      });

      return new WorldsServer({
        config: resolvedConfig,
        store: activeStore,
        ownsStore,
        syncService,
        router,
        modelCatalog: activeModelCatalog,
        httpServer,
        activeControllers,
        csrfToken,
      });
    } catch (initError) {
      if (ownsStore) {
        activeStore.close();
      }
      throw initError;
    }
  }

  /**
   * @param {object} store
   * @param {ModelCatalog} modelCatalog
   * @returns {boolean}
   */
  static seedDefaultModelsIfEmpty(store, modelCatalog) {
    const currentSettings = store.getSettings();
    const models = currentSettings.models ?? {};
    const allBlank = ['director', 'composer', 'main', 'recurring', 'scribe'].every((slotKey) => {
      return typeof models[slotKey] !== 'string' || models[slotKey].trim().length === 0;
    });
    if (!allBlank) {
      return false;
    }
    store.updateSettings({ models: modelCatalog.getDefaults() });
    return true;
  }

  /**
   * @returns {Promise<void>}
   * @throws {Error}
   */
  static async runCli() {
    const config = WorldsConfig.load();
    const syncService = config.r2 !== null
      ? new WorldSync({
          transport: new R2Transport(config.r2),
          bucket: config.r2.bucket,
        })
      : null;
    const server = await WorldsServer.create({ config, syncService });
    try {
      if (syncService !== null) {
        const syncStatus = syncService.getStatus();
        if (syncStatus.warning) {
          process.stderr.write(`Worlds sync warning: ${syncStatus.warning}\n`);
        }
      }
      WorldsServer.seedDefaultModelsIfEmpty(server.store, server.modelCatalog);
      const started = await server.start();
      process.stdout.write(`Worlds listening on ${started.url}\n`);

      await new Promise((resolve, reject) => {
        let shuttingDown = false;

        /**
         * @returns {void}
         */
        const cleanupSignals = () => {
          process.off('SIGINT', onSignal);
          process.off('SIGTERM', onSignal);
        };

        /**
         * @returns {void}
         */
        const onSignal = () => {
          if (shuttingDown) {
            return;
          }
          shuttingDown = true;
          cleanupSignals();
          server.stop().then(resolve, reject);
        };

        process.on('SIGINT', onSignal);
        process.on('SIGTERM', onSignal);
      });
    } catch (cliError) {
      await server.stop();
      throw cliError;
    }
  }

  /**
   * @returns {number | null}
   */
  get port() {
    return this.#boundPort;
  }

  /**
   * @returns {string | null}
   */
  get url() {
    return this.#boundPort === null ? null : `http://127.0.0.1:${this.#boundPort}`;
  }

  /**
   * @returns {string}
   */
  get csrfToken() {
    return this.#csrfToken;
  }

  /**
   * @returns {object}
   */
  get store() {
    return this.#store;
  }

  /**
   * @returns {Router}
   */
  get router() {
    return this.#router;
  }

  /**
   * @returns {ModelCatalog}
   */
  get modelCatalog() {
    return this.#modelCatalog;
  }

  /**
   * @returns {Promise<Readonly<{host: string, port: number, url: string, csrfToken: string}>>}
   * @throws {Error}
   */
  async start() {
    if (this.#closed || this.#stopPromise !== null) {
      throw new Error('Cannot start WorldsServer after stop() has been initiated.');
    }
    if (this.#httpServer.listening && this.#boundPort !== null) {
      return Object.freeze({
        host: '127.0.0.1',
        port: this.#boundPort,
        url: `http://127.0.0.1:${this.#boundPort}`,
        csrfToken: this.#csrfToken,
      });
    }

    await new Promise((resolve, reject) => {
      /**
       * @param {Error} listenError
       * @returns {void}
       */
      const onError = (listenError) => {
        this.#httpServer.off('listening', onListening);
        reject(listenError);
      };

      /**
       * @returns {void}
       */
      const onListening = () => {
        this.#httpServer.off('error', onError);
        resolve();
      };

      this.#httpServer.once('error', onError);
      this.#httpServer.once('listening', onListening);
      this.#httpServer.listen(this.#config.port, '127.0.0.1');
    });

    const address = this.#httpServer.address();
    if (address === null || typeof address !== 'object' || !Number.isInteger(address.port)) {
      throw new Error('Failed to determine bound HTTP server port.');
    }
    this.#boundPort = address.port;
    this.#router.setPort(this.#boundPort);

    this.#modelCatalog.listModels({ refresh: false }).catch((checkError) => {
      if (checkError instanceof Error && checkError.name === 'AbortError') {
        return;
      }
      console.error(`Model availability check failed: ${checkError instanceof Error ? checkError.message : String(checkError)}`);
    });

    return Object.freeze({
      host: '127.0.0.1',
      port: this.#boundPort,
      url: `http://127.0.0.1:${this.#boundPort}`,
      csrfToken: this.#csrfToken,
    });
  }

  /**
   * @param {{timeoutMs?: number}} [options]
   * @returns {Promise<void>}
   * @throws {Error}
   */
  stop({ timeoutMs = 30_000 } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new RangeError('timeoutMs must be a positive integer.'));
    }
    if (this.#stopPromise !== null) {
      return this.#stopPromise;
    }

    this.#stopPromise = (async () => {
      try {
        for (const controller of this.#activeControllers) {
          if (!controller.signal.aborted) {
            controller.abort(new Error('WorldsServer shutting down.'));
          }
        }

        this.#modelCatalog.close();

        if (this.#httpServer.listening) {
          await new Promise((resolve, reject) => {
            this.#httpServer.close((closeError) => {
              if (closeError) {
                reject(closeError);
              } else {
                resolve();
              }
            });
            if (typeof this.#httpServer.closeIdleConnections === 'function') {
              this.#httpServer.closeIdleConnections();
            }
          });
        }

        if (this.#syncService !== null) {
          const syncController = new AbortController();
          const timeoutHandle = setTimeout(() => {
            syncController.abort(new Error('Shutdown cloud sync timed out.'));
          }, timeoutMs);
          try {
            await this.#syncService.pushSnapshot({
              store: this.#store,
              syncStatePath: this.#config.syncStatePath,
              signal: syncController.signal,
            });
          } finally {
            clearTimeout(timeoutHandle);
          }
        }
      } finally {
        if (this.#ownsStore) {
          this.#store.close();
        }
        this.#closed = true;
      }
    })();

    return this.#stopPromise;
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (entryPath !== null && entryPath === fileURLToPath(import.meta.url)) {
  WorldsServer.runCli().catch((bootError) => {
    process.stderr.write(`${bootError instanceof Error ? bootError.message : String(bootError)}\n`);
    process.exitCode = 1;
  });
}
