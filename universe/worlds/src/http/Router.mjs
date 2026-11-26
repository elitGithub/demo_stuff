import fs from 'node:fs';
import { WorldsConfig } from '../config.mjs';
import { NarrationParts } from '../engine/NarrationParts.mjs';
import { CardFiling } from '../scribe/CardFiling.mjs';
import { ScribeAnalyzer } from '../scribe/ScribeAnalyzer.mjs';
import { ScribeAnswer } from '../scribe/ScribeAnswer.mjs';
import { ScribeCategory } from '../scribe/ScribeCategory.mjs';
import { ScribeKnowledge } from '../scribe/ScribeKnowledge.mjs';
import { ScribeLogCore } from '../scribe/ScribeLogCore.mjs';
import { ScribeReplay } from '../scribe/ScribeReplay.mjs';
import { ScribeText } from '../scribe/ScribeText.mjs';
import { CharacterCard } from '../store/CharacterCard.mjs';
import { FindingStatus } from '../store/enums/FindingStatus.mjs';
import { TurnMode } from '../store/enums/TurnMode.mjs';
import { RateLimiter } from './RateLimiter.mjs';
import { Security } from './Security.mjs';
import { SseStream } from './SseStream.mjs';

export class Router {
  static #AllowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  static #MutatingMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  static #MemorySections = new Set(['subjects', 'facts', 'relations', 'threads', 'rulings']);
  static #ModelSlots = new Set(['director', 'composer', 'main', 'recurring', 'scribe']);
  static #NewCharacterName = 'The new character';

  #config;
  #store;
  #scribeService;
  #pedantService;
  #museService;
  #turnEngine;
  #syncService;
  #publicDir;
  #csrfToken;
  #port;
  #rateLimiter;
  #activeControllers;
  #getSyncStatus;
  #modelCatalog;
  #modelAvailability;
  #exclusiveCampaignOps = new Set();
  #activeCampaignLlmCounts = new Map();

  /**
   * @param {{config: object, store: object, scribeService: object, pedantService: object, museService: object, turnEngine: object, syncService?: object | null, publicDir: string, csrfToken: string, port: number, rateLimiter?: RateLimiter, activeControllers?: Set<AbortController>, getSyncStatus?: (() => object) | null, modelCatalog: object, modelAvailability: object}} options
   * @throws {TypeError | RangeError}
   */
  constructor(options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Router options must be a plain object.');
    }

    const {
      config,
      store,
      scribeService,
      pedantService,
      museService,
      turnEngine,
      syncService = null,
      publicDir,
      csrfToken,
      port,
      rateLimiter = new RateLimiter(),
      activeControllers = new Set(),
      getSyncStatus = null,
      modelCatalog,
      modelAvailability,
    } = options;

    if (config === null || typeof config !== 'object') {
      throw new TypeError('config must be an object.');
    }
    if (store === null || typeof store !== 'object') {
      throw new TypeError('store must be a StoryStore instance.');
    }
    if (scribeService === null || typeof scribeService !== 'object') {
      throw new TypeError('scribeService must be a ScribeService instance.');
    }
    if (pedantService === null || typeof pedantService !== 'object') {
      throw new TypeError('pedantService must be a PedantService instance.');
    }
    if (museService === null || typeof museService !== 'object') {
      throw new TypeError('museService must be a MuseService instance.');
    }
    if (turnEngine === null || typeof turnEngine !== 'object' || typeof turnEngine.isInFlight !== 'function') {
      throw new TypeError('turnEngine must be a TurnEngine instance.');
    }
    if (syncService !== null && (typeof syncService !== 'object' || typeof syncService.pushSnapshot !== 'function')) {
      throw new TypeError('syncService must be null or provide pushSnapshot().');
    }
    if (typeof publicDir !== 'string' || publicDir.trim().length === 0) {
      throw new RangeError('publicDir must be a non-empty string.');
    }
    if (typeof csrfToken !== 'string' || csrfToken.length === 0) {
      throw new RangeError('csrfToken must be a non-empty string.');
    }
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new RangeError(`port must be an integer between 0 and 65535: ${String(port)}`);
    }
    if (rateLimiter === null || typeof rateLimiter !== 'object' || typeof rateLimiter.consume !== 'function') {
      throw new TypeError('rateLimiter must provide consume().');
    }
    if (!(activeControllers instanceof Set)) {
      throw new TypeError('activeControllers must be a Set.');
    }
    if (getSyncStatus !== null && typeof getSyncStatus !== 'function') {
      throw new TypeError('getSyncStatus must be null or a function.');
    }
    if (modelCatalog === null || typeof modelCatalog !== 'object' || typeof modelCatalog.listModels !== 'function') {
      throw new TypeError('modelCatalog must provide listModels().');
    }
    if (
      modelAvailability === null ||
      typeof modelAvailability !== 'object' ||
      typeof modelAvailability.checkSlotChanges !== 'function' ||
      typeof modelAvailability.checkOverrideChange !== 'function' ||
      typeof modelAvailability.blockingMessage !== 'function'
    ) {
      throw new TypeError(
        'modelAvailability must provide checkSlotChanges(), checkOverrideChange() and blockingMessage().',
      );
    }

    this.#config = config;
    this.#store = store;
    this.#scribeService = scribeService;
    this.#pedantService = pedantService;
    this.#museService = museService;
    this.#turnEngine = turnEngine;
    this.#syncService = syncService;
    this.#publicDir = publicDir;
    this.#csrfToken = csrfToken;
    this.#port = port;
    this.#rateLimiter = rateLimiter;
    this.#activeControllers = activeControllers;
    this.#getSyncStatus = getSyncStatus;
    this.#modelCatalog = modelCatalog;
    this.#modelAvailability = modelAvailability;
  }

  /**
   * @param {number} port
   * @returns {void}
   * @throws {RangeError}
   */
  setPort(port) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new RangeError(`port must be an integer between 1 and 65535: ${String(port)}`);
    }
    this.#port = port;
  }

  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @returns {Promise<void>}
   */
  async handle(request, response) {
    const extraSecrets = [];
    try {
      if (!Security.isValidLoopbackHost(request.headers?.host, this.#port)) {
        this.#sendJson(response, 403, { error: 'Forbidden: invalid Host header.' });
        return;
      }

      const rawUrl = request.url;
      if (
        typeof rawUrl !== 'string' ||
        !rawUrl.startsWith('/') ||
        rawUrl.startsWith('//') ||
        rawUrl.includes('\\') ||
        /[\r\n\0]/.test(rawUrl)
      ) {
        this.#sendJson(response, 400, { error: 'Bad request URL.' });
        return;
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(rawUrl, `http://127.0.0.1:${this.#port}`);
      } catch {
        this.#sendJson(response, 400, { error: 'Malformed request URL.' });
        return;
      }

      const method = typeof request.method === 'string' ? request.method.toUpperCase() : '';
      if (!Router.#AllowedMethods.has(method)) {
        this.#sendJson(response, 405, { error: 'Method not allowed.' });
        return;
      }

      if (Router.#MutatingMethods.has(method)) {
        const validOrigin = Security.isValidLoopbackOrigin(request.headers?.origin, this.#port);
        const validCsrf = Security.isValidCsrfToken(request.headers?.['x-worlds-csrf'], this.#csrfToken);
        if (!validOrigin || !validCsrf) {
          this.#sendJson(response, 403, { error: 'Forbidden: invalid Origin or CSRF token.' });
          return;
        }
      }

      const pathname = parsedUrl.pathname;
      const isApiRoute = pathname === '/api' || pathname.startsWith('/api/');

      if (!isApiRoute) {
        if (method !== 'GET') {
          this.#sendJson(response, 405, { error: 'Method not allowed.' });
          return;
        }
        const indexResolved = Security.resolveStaticFile(this.#publicDir, '/index.html');
        if (pathname === '/' || pathname === '/index.html') {
          let html;
          if (indexResolved !== null) {
            html = fs.readFileSync(indexResolved.filePath, 'utf8').replaceAll('__CSRF_TOKEN__', this.#csrfToken);
          } else {
            html = [
              '<!DOCTYPE html>',
              '<html lang="en">',
              '<head>',
              '  <meta charset="utf-8">',
              '  <meta name="viewport" content="width=device-width, initial-scale=1">',
              `  <meta name="worlds-csrf" content="${this.#csrfToken}">`,
              '  <title>Worlds</title>',
              '</head>',
              '<body>',
              '  <main id="app"><h1>Worlds</h1></main>',
              '</body>',
              '</html>',
              '',
            ].join('\n');
          }
          response.writeHead(200, {
            ...Security.SecurityHeaders,
            'Content-Type': 'text/html; charset=utf-8',
          });
          response.end(html);
          return;
        }

        const staticResolved = Security.resolveStaticFile(this.#publicDir, pathname);
        if (
          staticResolved === null ||
          (indexResolved !== null && staticResolved.filePath === indexResolved.filePath)
        ) {
          this.#sendJson(response, 404, { error: 'Not found.' });
          return;
        }
        const fileBuffer = fs.readFileSync(staticResolved.filePath);
        response.writeHead(200, {
          ...Security.SecurityHeaders,
          'Content-Type': staticResolved.contentType,
        });
        response.end(fileBuffer);
        return;
      }

      const rawSegments = pathname.split('/').slice(1);
      const segments = [];
      for (const rawSegment of rawSegments) {
        let decodedSegment;
        try {
          decodedSegment = decodeURIComponent(rawSegment);
        } catch {
          this.#sendJson(response, 400, { error: 'Malformed URL path encoding.' });
          return;
        }
        if (decodedSegment.includes('\0')) {
          this.#sendJson(response, 400, { error: 'Invalid URL path segment.' });
          return;
        }
        segments.push(decodedSegment);
      }

      const isLlmRoute =
        method === 'POST' &&
        segments.length >= 4 &&
        segments[1] === 'campaigns' &&
        segments[2].length > 0 &&
        (
          (segments.length === 4 && segments[3] === 'turns') ||
          (segments.length === 5 && segments[3] === 'turns' && segments[4] === 'regenerate') ||
          (segments.length === 5 &&
            segments[3] === 'memory' &&
            (segments[4] === 'update' || segments[4] === 'tell' || segments[4] === 'muse'))
        );

      const clientKey = typeof request.socket?.remoteAddress === 'string' && request.socket.remoteAddress.length > 0
        ? request.socket.remoteAddress
        : '127.0.0.1';
      const limitBucket = isLlmRoute ? RateLimiter.Bucket.Llm : RateLimiter.Bucket.Api;
      const limitResult = this.#rateLimiter.consume(limitBucket, clientKey);
      if (!limitResult.allowed) {
        this.#sendJson(
          response,
          429,
          { error: 'Rate limit exceeded. Try again shortly.' },
          { 'Retry-After': String(limitResult.retryAfterSeconds) },
        );
        return;
      }

      const searchParams = parsedUrl.searchParams;

      if (segments.length === 2 && segments[1] === 'health') {
        if (method !== 'GET') {
          this.#sendJson(response, 405, { error: 'Method not allowed.' });
          return;
        }
        const todayUtc = new Date().toISOString().slice(0, 10);
        const sync = this.#getSyncStatus !== null
          ? this.#getSyncStatus()
          : this.#syncService !== null && typeof this.#syncService.getStatus === 'function'
            ? this.#syncService.getStatus()
            : {
                mode: this.#config.r2 ? 'configured' : 'local_only',
                status: 'local_only',
              };
        this.#sendJson(response, 200, {
          status: 'ok',
          sync,
          dailySpend: this.#store.getDailySpend(todayUtc),
        });
        return;
      }

      if (segments.length === 2 && segments[1] === 'settings') {
        if (method === 'GET') {
          const settings = this.#store.getSettings();
          const resolved = WorldsConfig.resolveApiKey(this.#config);
          this.#sendJson(response, 200, {
            ...settings,
            apiKey: {
              configured: resolved.key !== null,
              source: resolved.source,
            },
          });
          return;
        }
        if (method === 'PUT') {
          await this.#runWithAbortController(request, response, async (signal) => {
            const body = await Security.readJsonBody(request);
            this.#assertAllowedKeys(
              body,
              [
                'models',
                'publicOdds',
                'privateOdds',
                'scribeInterval',
                'pedantEnabled',
                'dailyWarnUsd',
                'maxRepliesPerCharacter',
                'replyReserve',
                'openRouterApiKey',
              ],
              'settings',
            );

            const hasApiKeyField = Object.hasOwn(body, 'openRouterApiKey');
            if (hasApiKeyField) {
              const candidateKey = body.openRouterApiKey;
              if (candidateKey !== null && typeof candidateKey !== 'string') {
                throw this.#createHttpError(400, 'openRouterApiKey must be a string or null.');
              }
              if (typeof candidateKey === 'string') {
                extraSecrets.push(candidateKey);
                if (/[\u0000-\u001f\u007f]|[^\u0000-\u00ff]/.test(candidateKey)) {
                  throw this.#createHttpError(400, 'openRouterApiKey contains invalid control or non-ByteString characters.');
                }
                const trimmedKey = candidateKey.trim();
                if (trimmedKey.length > 0 && /\s/.test(trimmedKey)) {
                  throw this.#createHttpError(400, 'openRouterApiKey must not contain whitespace.');
                }
              }
            }

            let warnings = [];
            if (body.models !== undefined) {
              if (body.models === null || typeof body.models !== 'object' || Array.isArray(body.models)) {
                throw this.#createHttpError(400, 'models must be an object.');
              }
              for (const [slotName, slotModel] of Object.entries(body.models)) {
                if (!Router.#ModelSlots.has(slotName)) {
                  throw this.#createHttpError(400, `models.${slotName} is not a model slot.`);
                }
                if (typeof slotModel !== 'string') {
                  throw this.#createHttpError(400, `models.${slotName} must be a string.`);
                }
              }
              const slotChecks = await this.#modelAvailability.checkSlotChanges(body.models, { signal });
              if (slotChecks.refusals.length > 0) {
                throw this.#createHttpError(400, slotChecks.refusals.join(' '));
              }
              warnings = slotChecks.warnings;
            }

            const settingsPatch = {};
            for (const [patchKey, patchValue] of Object.entries(body)) {
              if (patchKey !== 'openRouterApiKey') {
                settingsPatch[patchKey] = patchValue;
              }
            }

            const updatedSettings = this.#store.runTransaction(() => {
              const nextSettings = this.#store.updateSettings(settingsPatch);
              if (hasApiKeyField) {
                WorldsConfig.writeSecrets(this.#config.secretsPath, {
                  openRouterApiKey: body.openRouterApiKey,
                });
              }
              return nextSettings;
            });

            const resolved = WorldsConfig.resolveApiKey(this.#config);
            this.#sendJson(response, 200, {
              ...updatedSettings,
              apiKey: {
                configured: resolved.key !== null,
                source: resolved.source,
              },
              warnings,
            });
          });
          return;
        }
        this.#sendJson(response, 405, { error: 'Method not allowed.' });
        return;
      }

      if (segments.length === 2 && segments[1] === 'models') {
        if (method !== 'GET') {
          this.#sendJson(response, 405, { error: 'Method not allowed.' });
          return;
        }
        const catalogResult = await this.#runWithAbortController(request, response, async (signal) => {
          return await this.#modelCatalog.listModels({ refresh: false, signal });
        });
        this.#sendJson(response, 200, catalogResult);
        return;
      }

      if (segments.length === 3 && segments[1] === 'models' && segments[2] === 'refresh') {
        if (method !== 'POST') {
          this.#sendJson(response, 405, { error: 'Method not allowed.' });
          return;
        }
        await Security.readJsonBody(request, { allowEmpty: true });
        const refreshResult = await this.#runWithAbortController(request, response, async (signal) => {
          return await this.#modelCatalog.listModels({ refresh: true, signal });
        });
        this.#sendJson(response, 200, refreshResult);
        return;
      }

      if (segments.length === 3 && segments[1] === 'sync' && segments[2] === 'save') {
        if (method !== 'POST') {
          this.#sendJson(response, 405, { error: 'Method not allowed.' });
          return;
        }
        await Security.readJsonBody(request, { allowEmpty: true });
        if (this.#syncService === null) {
          this.#sendJson(response, 200, {
            status: 'local_only',
            saved: false,
            message: 'Cloud sync is not configured.',
          });
          return;
        }

        const syncResult = await this.#runWithAbortController(request, response, async (signal) => {
          return await this.#syncService.pushSnapshot({
            store: this.#store,
            syncStatePath: this.#config.syncStatePath,
            signal,
          });
        });

        if (syncResult?.status === 'conflict') {
          this.#sendJson(response, 409, {
            status: 'conflict',
            saved: false,
            error: syncResult.message ?? 'The other PC saved newer changes.',
            ...syncResult,
          });
          return;
        }

        this.#sendJson(response, 200, {
          saved: typeof syncResult?.saved === 'boolean' ? syncResult.saved : true,
          ...syncResult,
        });
        return;
      }

      if (segments.length === 2 && segments[1] === 'campaigns') {
        if (method === 'GET') {
          const limit = this.#parseIntParam(searchParams.get('limit'), {
            name: 'limit',
            min: 1,
            max: 50,
            defaultValue: 25,
          });
          const after = this.#parseCursorParam(searchParams);
          this.#sendJson(response, 200, this.#store.listCampaigns({ limit, after }));
          return;
        }
        if (method === 'POST') {
          const body = await Security.readJsonBody(request);
          this.#assertAllowedKeys(
            body,
            ['title', 'premise', 'styleNotes', 'encounterPublicOdds', 'encounterPrivateOdds', 'scribeInterval', 'sceneState'],
            'campaign',
          );
          if (body.sceneState !== undefined) {
            if (body.sceneState === null || typeof body.sceneState !== 'object' || Array.isArray(body.sceneState)) {
              throw this.#createHttpError(400, 'sceneState must be a plain object.');
            }
            if (
              (Array.isArray(body.sceneState.presentIds) && body.sceneState.presentIds.length > 0) ||
              (Array.isArray(body.sceneState.remoteIds) && body.sceneState.remoteIds.length > 0)
            ) {
              throw this.#createHttpError(400, 'New campaign sceneState cannot reference characters before creation.');
            }
          }
          const created = this.#store.createCampaign(body);
          this.#sendJson(response, 201, created);
          return;
        }
        this.#sendJson(response, 405, { error: 'Method not allowed.' });
        return;
      }

      if (segments.length >= 3 && segments[1] === 'campaigns' && segments[2].length > 0) {
        const campaignId = segments[2];

        if (segments.length === 3) {
          if (method === 'PATCH') {
            const body = await Security.readJsonBody(request);
            this.#requireCampaign(campaignId);
            if (body.sceneState !== undefined || body.playerCharacterId !== undefined) {
              this.#requireIdleCampaign(campaignId);
            }
            if (body.sceneState !== undefined) {
              if (body.sceneState === null || typeof body.sceneState !== 'object' || Array.isArray(body.sceneState)) {
                throw this.#createHttpError(400, 'sceneState must be a plain object.');
              }
              const idsToCheck = [];
              if (Array.isArray(body.sceneState.presentIds)) {
                idsToCheck.push(...body.sceneState.presentIds);
              }
              if (Array.isArray(body.sceneState.remoteIds)) {
                idsToCheck.push(...body.sceneState.remoteIds);
              }
              for (const charId of idsToCheck) {
                if (typeof charId !== 'string' || charId.trim().length === 0) {
                  throw this.#createHttpError(400, 'sceneState character IDs must be non-empty strings.');
                }
                const character = this.#store.getCharacter(campaignId, charId);
                if (character === null) {
                  throw this.#createHttpError(400, `Character does not belong to campaign: ${charId}`);
                }
              }
            }
            if (body.playerCharacterId !== undefined) {
              if (
                body.playerCharacterId !== null &&
                (typeof body.playerCharacterId !== 'string' || body.playerCharacterId.trim().length === 0)
              ) {
                throw this.#createHttpError(400, 'playerCharacterId must be null or a non-empty string.');
              }
            }
            const updated = body.playerCharacterId === undefined
              ? this.#store.updateCampaign(campaignId, body)
              : this.#store.runTransaction(() => {
                  const allCharacters = this.#scribeService.listAllCharacters(campaignId);
                  if (body.playerCharacterId !== null) {
                    const targetCharacter = this.#store.getCharacter(campaignId, body.playerCharacterId);
                    if (targetCharacter === null) {
                      throw this.#createHttpError(400, `Character does not belong to campaign: ${body.playerCharacterId}`);
                    }
                    if (targetCharacter.archived === true) {
                      throw this.#createHttpError(400, 'Cannot set archived character as playerCharacterId.');
                    }
                    for (const character of allCharacters) {
                      if (character.isPlayer === true && character.id !== targetCharacter.id) {
                        this.#store.updateCharacter(campaignId, character.id, { isPlayer: false });
                      }
                    }
                    if (!targetCharacter.isPlayer) {
                      this.#store.updateCharacter(campaignId, targetCharacter.id, { isPlayer: true });
                    }
                  } else {
                    for (const character of allCharacters) {
                      if (character.isPlayer === true) {
                        this.#store.updateCharacter(campaignId, character.id, { isPlayer: false });
                      }
                    }
                  }
                  return this.#store.updateCampaign(campaignId, body);
                });
            if (updated === null) {
              throw this.#createHttpError(404, `Campaign not found: ${campaignId}`);
            }
            this.#sendJson(response, 200, updated);
            return;
          }
          if (method === 'DELETE') {
            this.#requireCampaign(campaignId);
            this.#requireIdleCampaign(campaignId);
            if ((this.#activeCampaignLlmCounts.get(campaignId) ?? 0) > 0) {
              throw this.#createHttpError(409, `An LLM operation is currently active for campaign ${campaignId}.`);
            }
            const deleted = this.#store.deleteCampaign(campaignId);
            if (!deleted) {
              throw this.#createHttpError(404, `Campaign not found: ${campaignId}`);
            }
            this.#sendJson(response, 200, { deleted: true });
            return;
          }
          this.#sendJson(response, 405, { error: 'Method not allowed.' });
          return;
        }

        if (segments.length === 4 && segments[3] === 'characters') {
          if (method === 'GET') {
            this.#requireCampaign(campaignId);
            let includeArchived = false;
            if (searchParams.has('includeArchived')) {
              const rawInclude = searchParams.get('includeArchived');
              if (rawInclude === 'true') {
                includeArchived = true;
              } else if (rawInclude === 'false') {
                includeArchived = false;
              } else {
                throw this.#createHttpError(400, 'includeArchived must be true or false.');
              }
            }
            const limit = this.#parseIntParam(searchParams.get('limit'), {
              name: 'limit',
              min: 1,
              max: 50,
              defaultValue: 25,
            });
            const after = this.#parseCursorParam(searchParams);
            this.#sendJson(response, 200, this.#store.listCharacters(campaignId, { includeArchived, limit, after }));
            return;
          }
          if (method === 'POST') {
            this.#requireCampaign(campaignId);
            const body = await Security.readJsonBody(request);
            this.#assertAllowedKeys(
              body,
              [
                'slug',
                'name',
                'aliases',
                'isPlayer',
                'tier',
                'modelOverride',
                'card',
                'avatarToken',
                'avatarInitials',
                'archived',
              ],
              'character',
            );
            this.#assertClientCard(body.card);
            if (body.slug === 'narrator') {
              throw this.#createHttpError(400, 'Character slug "narrator" is reserved.');
            }
            if (typeof body.name === 'string') {
              const trimmedName = body.name.trim();
              if (trimmedName.length > ScribeAnswer.Settings.MaxLabel) {
                throw this.#createHttpError(400, `Character name exceeds maximum length (${ScribeAnswer.Settings.MaxLabel}).`);
              }
              if (ScribeText.normaliseName(trimmedName) === 'narrator') {
                throw this.#createHttpError(400, 'Character name "Narrator" is reserved.');
              }
            }
            if (body.isPlayer === true && body.archived === true) {
              throw this.#createHttpError(400, 'Archived character cannot be marked as active player.');
            }
            const createWarnings = await this.#checkModelOverride(request, response, {
              characterName: typeof body.name === 'string' && body.name.trim().length > 0
                ? body.name.trim()
                : Router.#NewCharacterName,
              storedOverride: null,
              body,
            });
            this.#requireIdleCampaign(campaignId);

            const created = this.#store.runTransaction(() => {
              let character = this.#store.createCharacter(campaignId, body);
              const latestCampaign = this.#store.getCampaign(campaignId);
              if (character.isPlayer && latestCampaign !== null) {
                if (
                  latestCampaign.playerCharacterId !== null &&
                  latestCampaign.playerCharacterId !== character.id
                ) {
                  this.#store.updateCharacter(campaignId, latestCampaign.playerCharacterId, { isPlayer: false });
                }
                this.#store.updateCampaign(campaignId, { playerCharacterId: character.id });
              }
              character = this.#syncCharacterInBook(campaignId, character, CharacterCard.empty());
              return { ...character, bookHints: this.#bookHints(campaignId, character) };
            });

            this.#sendJson(response, 201, { ...created, warnings: createWarnings });
            return;
          }
          this.#sendJson(response, 405, { error: 'Method not allowed.' });
          return;
        }

        if (segments.length === 5 && segments[3] === 'characters' && segments[4].length > 0) {
          const characterId = segments[4];
          if (method === 'GET') {
            this.#requireCampaign(campaignId);
            const character = this.#store.getCharacter(campaignId, characterId);
            if (character === null) {
              throw this.#createHttpError(404, `Character not found: ${characterId}`);
            }
            this.#sendJson(response, 200, { ...character, bookHints: this.#bookHints(campaignId, character) });
            return;
          }
          if (method === 'PATCH') {
            this.#requireCampaign(campaignId);
            const existingCharacter = this.#store.getCharacter(campaignId, characterId);
            if (existingCharacter === null) {
              throw this.#createHttpError(404, `Character not found: ${characterId}`);
            }
            const body = await Security.readJsonBody(request);
            this.#assertAllowedKeys(
              body,
              [
                'slug',
                'name',
                'aliases',
                'isPlayer',
                'tier',
                'modelOverride',
                'card',
                'avatarToken',
                'avatarInitials',
                'archived',
              ],
              'character',
            );
            this.#assertClientCard(body.card);
            if (body.slug === 'narrator') {
              throw this.#createHttpError(400, 'Character slug "narrator" is reserved.');
            }
            if (typeof body.name === 'string') {
              const trimmedName = body.name.trim();
              if (trimmedName.length > ScribeAnswer.Settings.MaxLabel) {
                throw this.#createHttpError(400, `Character name exceeds maximum length (${ScribeAnswer.Settings.MaxLabel}).`);
              }
              if (ScribeText.normaliseName(trimmedName) === 'narrator') {
                throw this.#createHttpError(400, 'Character name "Narrator" is reserved.');
              }
            }
            if (body.isPlayer !== undefined && typeof body.isPlayer !== 'boolean') {
              throw this.#createHttpError(400, 'isPlayer must be a boolean.');
            }
            if (body.archived !== undefined && typeof body.archived !== 'boolean') {
              throw this.#createHttpError(400, 'archived must be a boolean.');
            }
            const updateWarnings = await this.#checkModelOverride(request, response, {
              characterName: typeof body.name === 'string' && body.name.trim().length > 0
                ? body.name.trim()
                : existingCharacter.name,
              storedOverride: existingCharacter.modelOverride,
              body,
            });
            this.#requireIdleCampaign(campaignId);

            const updated = this.#store.runTransaction(() => {
              const freshExisting = this.#store.getCharacter(campaignId, characterId);
              if (freshExisting === null) {
                throw this.#createHttpError(404, `Character not found: ${characterId}`);
              }
              const willBeArchived =
                body.archived === true || (freshExisting.archived === true && body.archived !== false);
              if (body.isPlayer === true && willBeArchived) {
                throw this.#createHttpError(400, 'Archived character cannot be marked as active player.');
              }
              const effectivePatch = body.archived === true && freshExisting.isPlayer === true
                ? { ...body, isPlayer: false }
                : body;

              let character = this.#store.updateCharacter(campaignId, characterId, effectivePatch);
              if (character === null) {
                throw this.#createHttpError(404, `Character not found: ${characterId}`);
              }
              const latestCampaign = this.#store.getCampaign(campaignId);
              if (character.isPlayer && latestCampaign !== null) {
                if (
                  latestCampaign.playerCharacterId !== null &&
                  latestCampaign.playerCharacterId !== character.id
                ) {
                  this.#store.updateCharacter(campaignId, latestCampaign.playerCharacterId, { isPlayer: false });
                }
                if (latestCampaign.playerCharacterId !== character.id) {
                  this.#store.updateCampaign(campaignId, { playerCharacterId: character.id });
                }
              } else if (!character.isPlayer && latestCampaign !== null && latestCampaign.playerCharacterId === character.id) {
                this.#store.updateCampaign(campaignId, { playerCharacterId: null });
              }
              character = this.#syncCharacterInBook(campaignId, character, freshExisting.card);
              return { ...character, bookHints: this.#bookHints(campaignId, character) };
            });

            this.#sendJson(response, 200, { ...updated, warnings: updateWarnings });
            return;
          }
          if (method === 'DELETE') {
            this.#requireCampaign(campaignId);
            const existingCharacter = this.#store.getCharacter(campaignId, characterId);
            if (existingCharacter === null) {
              throw this.#createHttpError(404, `Character not found: ${characterId}`);
            }
            this.#requireIdleCampaign(campaignId);
            const deleted = this.#store.deleteCharacter(campaignId, characterId);
            if (!deleted) {
              throw this.#createHttpError(404, `Character not found: ${characterId}`);
            }
            this.#sendJson(response, 200, { deleted: true });
            return;
          }
          this.#sendJson(response, 405, { error: 'Method not allowed.' });
          return;
        }

        if (segments.length === 4 && segments[3] === 'turns') {
          if (method === 'GET') {
            this.#requireCampaign(campaignId);
            const limit = this.#parseIntParam(searchParams.get('limit'), {
              name: 'limit',
              min: 1,
              max: 50,
              defaultValue: 50,
            });
            const beforeSeq = this.#parseIntParam(searchParams.get('beforeSeq'), {
              name: 'beforeSeq',
              min: 1,
              max: Number.MAX_SAFE_INTEGER,
              defaultValue: null,
            });
            this.#sendJson(response, 200, this.#store.listTurns(campaignId, { limit, beforeSeq }));
            return;
          }
          if (method === 'POST') {
            this.#requireCampaign(campaignId);
            const body = await Security.readJsonBody(request);
            this.#assertAllowedKeys(body, ['text', 'mode', 'oocNudge', 'narration'], 'turn');

            const mode = body.mode === undefined ? TurnMode.Normal : body.mode;
            TurnMode.label(mode);
            const rawText = body.text === undefined && mode === TurnMode.Encounter ? '' : body.text;
            if (typeof rawText !== 'string') {
              throw this.#createHttpError(400, 'text must be a string.');
            }
            const oocNudge = body.oocNudge === undefined ? null : body.oocNudge;
            if (oocNudge !== null && typeof oocNudge !== 'string') {
              throw this.#createHttpError(400, 'oocNudge must be null or a string.');
            }
            const narration = body.narration === undefined ? null : body.narration;
            if (narration !== null && typeof narration !== 'string') {
              throw this.#createHttpError(400, 'narration must be null or a string.');
            }
            const parts = NarrationParts.split(rawText, narration);
            const narratorPrefixPattern = /^[\s*_]*narrator:\s*/i;
            const hasNarratorPrefix = narratorPrefixPattern.test(parts.text);
            const effectiveMode = hasNarratorPrefix ? TurnMode.Narrator : mode;
            const strippedText = hasNarratorPrefix
              ? parts.text.replace(narratorPrefixPattern, '').trim()
              : parts.text;
            if (
              (effectiveMode === TurnMode.Normal || effectiveMode === TurnMode.Narrator) &&
              strippedText.length === 0 &&
              parts.narration.length === 0
            ) {
              throw this.#createHttpError(400, 'Turn text must not be empty.');
            }

            this.#assertModelsAvailable(campaignId);
            this.#requireIdleCampaign(campaignId);

            await this.#withCampaignLock(campaignId, { exclusive: true }, async () => {
              await this.#runSseTurnPipeline(request, response, async (signal, emit) => {
                return await this.#turnEngine.runTurn({
                  campaignId,
                  text: rawText,
                  narration,
                  mode,
                  oocNudge,
                  signal,
                  emit,
                });
              });
            });
            return;
          }
          this.#sendJson(response, 405, { error: 'Method not allowed.' });
          return;
        }

        if (segments.length === 5 && segments[3] === 'turns' && segments[4] === 'regenerate') {
          if (method !== 'POST') {
            this.#sendJson(response, 405, { error: 'Method not allowed.' });
            return;
          }
          this.#requireCampaign(campaignId);
          await Security.readJsonBody(request, { allowEmpty: true });
          const latestPair = this.#store.getLatestTurnPair(campaignId);
          if (latestPair === null || latestPair.userTurn === null || latestPair.assistantTurn === null) {
            throw this.#createHttpError(404, 'No latest turn pair available to regenerate.');
          }
          this.#assertModelsAvailable(campaignId);
          this.#requireIdleCampaign(campaignId);

          await this.#withCampaignLock(campaignId, { exclusive: true }, async () => {
            await this.#runSseTurnPipeline(request, response, async (signal, emit) => {
              return await this.#turnEngine.regenerateLastTurn({
                campaignId,
                signal,
                emit,
              });
            });
          });
          return;
        }

        if (segments.length === 5 && segments[3] === 'turns' && segments[4] === 'last') {
          if (method !== 'DELETE') {
            this.#sendJson(response, 405, { error: 'Method not allowed.' });
            return;
          }
          this.#requireCampaign(campaignId);
          const latestPair = this.#store.getLatestTurnPair(campaignId);
          if (latestPair === null || latestPair.userTurn === null || latestPair.assistantTurn === null) {
            throw this.#createHttpError(404, 'No latest turn pair available to delete.');
          }
          this.#requireIdleCampaign(campaignId);
          const deleted = this.#turnEngine.deleteLastTurnPair({ campaignId });
          this.#sendJson(response, 200, deleted);
          return;
        }

        if (segments.length === 5 && segments[3] === 'turns' && segments[4].length > 0) {
          const turnId = segments[4];
          if (method !== 'PATCH') {
            this.#sendJson(response, 405, { error: 'Method not allowed.' });
            return;
          }
          this.#requireCampaign(campaignId);
          const existingTurn = this.#store.getTurn(campaignId, turnId);
          if (existingTurn === null) {
            throw this.#createHttpError(404, `Turn not found: ${turnId}`);
          }
          const body = await Security.readJsonBody(request);
          this.#assertAllowedKeys(body, ['text', 'beatId'], 'editTurn');
          if (typeof body.text !== 'string' || body.text.trim().length === 0) {
            throw this.#createHttpError(400, 'text must be a non-empty string.');
          }
          if (body.beatId !== undefined && body.beatId !== null && (typeof body.beatId !== 'string' || body.beatId.trim().length === 0)) {
            throw this.#createHttpError(400, 'beatId must be null or a non-empty string.');
          }
          this.#requireIdleCampaign(campaignId);
          const updatedTurn = this.#turnEngine.editTurn({
            campaignId,
            turnId,
            text: body.text,
            beatId: body.beatId ?? null,
          });
          this.#sendJson(response, 200, updatedTurn);
          return;
        }

        if (segments.length === 4 && segments[3] === 'memory') {
          if (method !== 'GET') {
            this.#sendJson(response, 405, { error: 'Method not allowed.' });
            return;
          }
          this.#requireCampaign(campaignId);
          let section = 'subjects';
          if (searchParams.has('section')) {
            const requestedSection = searchParams.get('section');
            if (!Router.#MemorySections.has(requestedSection)) {
              throw this.#createHttpError(400, `Invalid memory section: ${String(requestedSection)}`);
            }
            section = requestedSection;
          }
          const limit = this.#parseIntParam(searchParams.get('limit'), {
            name: 'limit',
            min: 1,
            max: 50,
            defaultValue: 25,
          });
          const afterOffset = this.#parseIntParam(searchParams.get('after'), {
            name: 'after',
            min: 0,
            max: Number.MAX_SAFE_INTEGER,
            defaultValue: 0,
          });
          const rawQuery = searchParams.get('query') ?? '';
          const normalizedQuery = rawQuery.trim().toLowerCase();

          const loaded = this.#scribeService.loadState(campaignId);
          const state = loaded.state;
          const subjectLabels = ScribeAnalyzer.labels(state);

          const allSubjects = state.subjects
            .filter((subject) => subject.mergedInto === null)
            .map((subject) => ({
              id: subject.id,
              label: subject.label,
              name: subject.name,
              kind: subject.kind,
              aka: subject.aka,
            }));

          const inForceFacts = state.facts.filter((fact) => fact.status === ScribeReplay.Status.InForce);

          /**
           * @param {object} fact
           * @returns {object}
           */
          const enrichFact = (fact) => {
            const audience = ScribeKnowledge.audience(state, fact);
            const knownBy = audience === ScribeKnowledge.Everyone ? ScribeKnowledge.Everyone : [...audience];
            const knownByLabels = audience === ScribeKnowledge.Everyone
              ? ScribeKnowledge.Everyone
              : audience.map((subjectId) => subjectLabels.get(subjectId) ?? subjectId);
            const targetLabel = fact.target !== null
              ? (subjectLabels.get(fact.target) ?? fact.target)
              : (fact.targetText ?? null);
            return {
              id: fact.id,
              subjectId: fact.subject,
              subjectLabel: subjectLabels.get(fact.subject) ?? fact.subject,
              category: fact.category,
              text: fact.text,
              targetId: fact.target,
              targetLabel,
              status: fact.status,
              hidden: Boolean(fact.hidden),
              pinned: Boolean(fact.pinned || fact.made),
              origin: fact.origin,
              position: fact.position,
              knownBy,
              knownByLabels,
            };
          };

          const allFacts = [];
          const allRelations = [];
          const allRulings = [];
          for (const fact of inForceFacts) {
            const enriched = enrichFact(fact);
            if (fact.category === ScribeCategory.Settings.RelationCategory) {
              allRelations.push(enriched);
            } else {
              allFacts.push(enriched);
            }
            if (
              fact.pinned === true ||
              fact.made === true ||
              fact.origin === ScribeLogCore.Origin.Operator ||
              fact.origin === ScribeLogCore.Origin.Notes ||
              Boolean(state.editOrigins?.[fact.id])
            ) {
              allRulings.push(enriched);
            }
          }

          const allThreads = state.threads.map((threadEntry) => ({
            id: threadEntry.id,
            text: threadEntry.text,
            subjectId: threadEntry.subject ?? null,
            subjectLabel: threadEntry.subject ? (subjectLabels.get(threadEntry.subject) ?? threadEntry.subject) : null,
            position: threadEntry.position,
            origin: threadEntry.origin,
            closed: threadEntry.closed,
          }));

          const sectionMap = {
            subjects: allSubjects,
            facts: allFacts,
            relations: allRelations,
            threads: allThreads,
            rulings: allRulings,
          };

          const fullItems = sectionMap[section];
          const filteredItems = normalizedQuery.length === 0
            ? fullItems
            : fullItems.filter((item) => {
                if (section === 'subjects') {
                  return [item.label, item.name, item.kind, ...item.aka].some((field) => {
                    return field.toLowerCase().includes(normalizedQuery);
                  });
                }
                if (section === 'threads') {
                  return [item.text, item.subjectLabel ?? '', item.closed?.how ?? ''].some((field) => {
                    return field.toLowerCase().includes(normalizedQuery);
                  });
                }
                const knownText = Array.isArray(item.knownByLabels)
                  ? item.knownByLabels.join(' ')
                  : item.knownByLabels;
                return [item.subjectLabel, item.category, item.text, item.targetLabel ?? '', knownText].some((field) => {
                  return field.toLowerCase().includes(normalizedQuery);
                });
              });

          const pageItems = filteredItems.slice(afterOffset, afterOffset + limit);
          const nextCursor = afterOffset + pageItems.length < filteredItems.length
            ? String(afterOffset + pageItems.length)
            : null;

          this.#sendJson(response, 200, {
            section,
            items: pageItems,
            total: filteredItems.length,
            nextCursor,
            dirty: loaded.dirty,
            lastTurnSeq: loaded.lastTurnSeq,
            turnsSinceScribe: this.#store.countTurnsSinceScribe(campaignId),
            counts: {
              subjects: allSubjects.length,
              facts: allFacts.length,
              relations: allRelations.length,
              threads: allThreads.length,
              rulings: allRulings.length,
            },
          });
          return;
        }

        if (segments.length === 5 && segments[3] === 'memory' && segments[4] === 'update') {
          if (method !== 'POST') {
            this.#sendJson(response, 405, { error: 'Method not allowed.' });
            return;
          }
          this.#requireCampaign(campaignId);
          await Security.readJsonBody(request, { allowEmpty: true });
          this.#assertModelsAvailable(campaignId);
          this.#requireIdleCampaign(campaignId);

          const memoryResult = await this.#withCampaignLock(campaignId, { exclusive: true }, async () => {
            return await this.#runWithAbortController(request, response, async (signal) => {
              return await this.#scribeService.updateMemory({ campaignId, signal });
            });
          });

          this.#sendJson(response, 200, {
            updated: memoryResult.updated,
            lastTurnSeq: memoryResult.lastTurnSeq,
            scenesAdded: memoryResult.scenesAdded,
            operationsAdded: memoryResult.operationsAdded,
            dirty: false,
          });
          return;
        }

        if (segments.length === 5 && segments[3] === 'memory' && segments[4] === 'tell') {
          if (method !== 'POST') {
            this.#sendJson(response, 405, { error: 'Method not allowed.' });
            return;
          }
          this.#requireCampaign(campaignId);
          const body = await Security.readJsonBody(request);
          if (body.action !== 'preview' && body.action !== 'commit') {
            throw this.#createHttpError(400, 'tell action must be "preview" or "commit".');
          }
          if (body.action === 'preview') {
            this.#assertAllowedKeys(body, ['action', 'instruction'], 'tellPreview');
            if (typeof body.instruction !== 'string' || body.instruction.trim().length === 0) {
              throw this.#createHttpError(400, 'instruction must be a non-empty string.');
            }
          } else {
            this.#assertAllowedKeys(body, ['action', 'operations'], 'tellCommit');
            if (!Array.isArray(body.operations)) {
              throw this.#createHttpError(400, 'operations must be an array.');
            }
          }
          this.#assertModelsAvailable(campaignId);
          this.#requireIdleCampaign(campaignId);

          if (body.action === 'preview') {
            const preview = await this.#withCampaignLock(campaignId, { exclusive: true }, async () => {
              return await this.#runWithAbortController(request, response, async (signal) => {
                return await this.#scribeService.tellPreview({
                  campaignId,
                  instruction: body.instruction,
                  signal,
                });
              });
            });
            this.#sendJson(response, 200, preview);
            return;
          }

          try {
            const committed = this.#scribeService.tellCommit({
              campaignId,
              operations: body.operations,
            });
            this.#sendJson(response, 200, committed);
          } catch (tellError) {
            if (tellError instanceof Error) {
              if (
                tellError.message === ScribeLogCore.Settings.StaleState ||
                tellError.message.includes(ScribeLogCore.Settings.StaleState)
              ) {
                throw this.#createHttpError(409, tellError.message);
              }
              if (
                tellError.message.startsWith('Tell operation refused') ||
                tellError.message.includes(ScribeLogCore.Settings.InvalidOperation) ||
                tellError.message.includes(ScribeLogCore.Settings.UnknownOperation) ||
                tellError.message.includes('combine two facts') ||
                Object.values(ScribeLogCore.Reason).includes(tellError.message) ||
                tellError instanceof TypeError ||
                tellError instanceof RangeError
              ) {
                throw this.#createHttpError(400, tellError.message);
              }
            }
            throw tellError;
          }
          return;
        }

        if (segments.length === 5 && segments[3] === 'memory' && segments[4] === 'muse') {
          if (method !== 'POST') {
            this.#sendJson(response, 405, { error: 'Method not allowed.' });
            return;
          }
          this.#requireCampaign(campaignId);
          const body = await Security.readJsonBody(request, { allowEmpty: true });
          this.#assertAllowedKeys(body, ['excludeThreadIds'], 'muse');
          const excludeThreadIds = body.excludeThreadIds === undefined ? [] : body.excludeThreadIds;
          if (!Array.isArray(excludeThreadIds)) {
            throw this.#createHttpError(400, 'excludeThreadIds must be an array.');
          }
          for (const threadId of excludeThreadIds) {
            if (typeof threadId !== 'string' || threadId.trim().length === 0) {
              throw this.#createHttpError(400, 'excludeThreadIds must contain non-empty strings.');
            }
          }
          this.#assertModelsAvailable(campaignId);

          const suggestion = await this.#withCampaignLock(campaignId, { exclusive: false }, async () => {
            return await this.#runWithAbortController(request, response, async (signal) => {
              return await this.#museService.suggestDevelopment({
                campaignId,
                excludeThreadIds,
                signal,
              });
            });
          });
          this.#sendJson(response, 200, { suggestion });
          return;
        }

        if (segments.length === 4 && segments[3] === 'findings') {
          if (method !== 'GET') {
            this.#sendJson(response, 405, { error: 'Method not allowed.' });
            return;
          }
          this.#requireCampaign(campaignId);
          let status = null;
          if (searchParams.has('status')) {
            const requestedStatus = searchParams.get('status');
            FindingStatus.label(requestedStatus);
            status = requestedStatus;
          }
          const limit = this.#parseIntParam(searchParams.get('limit'), {
            name: 'limit',
            min: 1,
            max: 50,
            defaultValue: 25,
          });
          const after = this.#parseCursorParam(searchParams);
          this.#sendJson(response, 200, this.#store.listFindings(campaignId, { status, limit, after }));
          return;
        }

        if (segments.length === 6 && segments[3] === 'findings' && segments[4].length > 0 && segments[5] === 'resolve') {
          if (method !== 'POST') {
            this.#sendJson(response, 405, { error: 'Method not allowed.' });
            return;
          }
          this.#requireCampaign(campaignId);
          const findingId = segments[4];
          const body = await Security.readJsonBody(request);
          this.#assertAllowedKeys(body, ['action', 'replacementText'], 'resolveFinding');
          if (
            body.action !== FindingStatus.Ruled &&
            body.action !== FindingStatus.Told &&
            body.action !== FindingStatus.Dismissed
          ) {
            throw this.#createHttpError(400, `Invalid finding resolution action: ${String(body.action)}`);
          }
          if (
            body.replacementText !== undefined &&
            body.replacementText !== null &&
            typeof body.replacementText !== 'string'
          ) {
            throw this.#createHttpError(400, 'replacementText must be null or a string.');
          }
          this.#requireIdleCampaign(campaignId);

          try {
            const resolvedFinding = this.#pedantService.resolveFinding({
              campaignId,
              findingId,
              action: body.action,
              replacementText: body.replacementText ?? null,
            });
            this.#sendJson(response, 200, resolvedFinding);
          } catch (resolveError) {
            if (resolveError instanceof Error && /^Finding not found:/i.test(resolveError.message)) {
              throw this.#createHttpError(404, resolveError.message);
            }
            if (resolveError instanceof Error && /^Finding is already resolved/i.test(resolveError.message)) {
              throw this.#createHttpError(409, resolveError.message);
            }
            if (resolveError instanceof Error && !Number.isInteger(resolveError.statusCode)) {
              resolveError.statusCode = 400;
            }
            throw resolveError;
          }
          return;
        }
      }

      this.#sendJson(response, 404, { error: 'Not found.' });
    } catch (error) {
      if (!response.headersSent && !response.writableEnded && !response.destroyed) {
        const statusCode = this.#mapErrorStatusCode(error, 500);
        const rawMessage = error instanceof Error ? error.message : String(error);
        const safeMessage = this.#redactMessage(rawMessage, extraSecrets);
        const extraHeaders = statusCode === 413 ? { Connection: 'close' } : {};
        this.#sendJson(response, statusCode, { error: safeMessage }, extraHeaders);
        return;
      }
      if (!response.writableEnded && !response.destroyed) {
        response.end();
      }
    }
  }

  /**
   * @param {number} statusCode
   * @param {string} message
   * @returns {Error}
   */
  #createHttpError(statusCode, message) {
    const httpError = new Error(message);
    httpError.statusCode = statusCode;
    return httpError;
  }

  /**
   * @param {string} campaignId
   * @returns {object}
   * @throws {Error}
   */
  #requireCampaign(campaignId) {
    const campaign = this.#store.getCampaign(campaignId);
    if (campaign === null) {
      throw this.#createHttpError(404, `Campaign not found: ${campaignId}`);
    }
    return campaign;
  }

  /**
   * @param {string} campaignId
   * @returns {void}
   * @throws {Error}
   */
  #requireIdleCampaign(campaignId) {
    if (this.#turnEngine.isInFlight(campaignId) || this.#exclusiveCampaignOps.has(campaignId)) {
      throw this.#createHttpError(409, `A campaign operation is already in flight for campaign ${campaignId}.`);
    }
  }

  /**
   * @template ResultType
   * @param {string} campaignId
   * @param {{exclusive: boolean}} options
   * @param {() => Promise<ResultType>} action
   * @returns {Promise<ResultType>}
   * @throws {Error}
   */
  async #withCampaignLock(campaignId, { exclusive }, action) {
    if (exclusive) {
      this.#requireIdleCampaign(campaignId);
      this.#exclusiveCampaignOps.add(campaignId);
    }
    this.#activeCampaignLlmCounts.set(
      campaignId,
      (this.#activeCampaignLlmCounts.get(campaignId) ?? 0) + 1,
    );
    try {
      return await action();
    } finally {
      const nextCount = (this.#activeCampaignLlmCounts.get(campaignId) ?? 1) - 1;
      if (nextCount <= 0) {
        this.#activeCampaignLlmCounts.delete(campaignId);
      } else {
        this.#activeCampaignLlmCounts.set(campaignId, nextCount);
      }
      if (exclusive) {
        this.#exclusiveCampaignOps.delete(campaignId);
      }
    }
  }

  /**
   * @param {Record<string, unknown>} body
   * @param {readonly string[]} allowedKeys
   * @param {string} contextLabel
   * @returns {void}
   * @throws {Error}
   */
  #assertAllowedKeys(body, allowedKeys, contextLabel) {
    const allowedSet = new Set(allowedKeys);
    for (const key of Object.keys(body)) {
      if (!allowedSet.has(key)) {
        throw this.#createHttpError(400, `Unsupported ${contextLabel} field: ${key}`);
      }
    }
  }

  /**
   * @param {unknown} card
   * @returns {void}
   * @throws {Error}
   */
  #assertClientCard(card) {
    if (card === undefined) {
      return;
    }
    CharacterCard.fromObject(card);
    if (Object.hasOwn(card, 'filedFactIds')) {
      throw this.#createHttpError(400, 'card.filedFactIds is not accepted from clients.');
    }
  }

  /**
   * @param {string | null} rawValue
   * @param {{name: string, min: number, max: number, defaultValue: number | null}} options
   * @returns {number | null}
   * @throws {Error}
   */
  #parseIntParam(rawValue, { name, min, max, defaultValue }) {
    if (rawValue === null) {
      return defaultValue;
    }
    if (typeof rawValue !== 'string' || !/^\d+$/.test(rawValue)) {
      throw this.#createHttpError(400, `${name} must be an integer between ${min} and ${max}.`);
    }
    const parsedValue = Number.parseInt(rawValue, 10);
    if (!Number.isSafeInteger(parsedValue) || parsedValue < min || parsedValue > max) {
      throw this.#createHttpError(400, `${name} must be an integer between ${min} and ${max}.`);
    }
    return parsedValue;
  }

  /**
   * @param {URLSearchParams} searchParams
   * @returns {string | null}
   * @throws {Error}
   */
  #parseCursorParam(searchParams) {
    if (!searchParams.has('after')) {
      return null;
    }
    const cursorValue = searchParams.get('after');
    if (typeof cursorValue !== 'string' || cursorValue.length === 0) {
      throw this.#createHttpError(400, 'after cursor must not be empty.');
    }
    return cursorValue;
  }

  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @param {{characterName: string, storedOverride: string | null, body: Record<string, unknown>}} options
   * @returns {Promise<string[]>}
   * @throws {Error}
   */
  async #checkModelOverride(request, response, { characterName, storedOverride, body }) {
    if (body.modelOverride === undefined) {
      return [];
    }
    if (body.modelOverride !== null && typeof body.modelOverride !== 'string') {
      throw this.#createHttpError(400, 'modelOverride must be a string or null.');
    }
    const overrideChecks = await this.#runWithAbortController(request, response, async (signal) => {
      return await this.#modelAvailability.checkOverrideChange(
        characterName,
        storedOverride,
        body.modelOverride,
        { signal },
      );
    });
    if (overrideChecks.refusals.length > 0) {
      throw this.#createHttpError(400, overrideChecks.refusals.join(' '));
    }
    return overrideChecks.warnings;
  }

  /**
   * @param {string} campaignId
   * @returns {void}
   * @throws {Error}
   */
  #assertModelsAvailable(campaignId) {
    const blockingMessage = this.#modelAvailability.blockingMessage(campaignId);
    if (blockingMessage !== null) {
      throw this.#createHttpError(409, blockingMessage);
    }
  }

  /**
   * @param {string} campaignId
   * @param {object} character
   * @param {CharacterCard} before
   * @returns {object}
   * @throws {Error}
   */
  #syncCharacterInBook(campaignId, character, before) {
    const bookRow = this.#store.getScribeBook(campaignId);
    const baseline = character.scribeSubjectId === null ? CharacterCard.empty() : before;
    const appearanceChanged = CardFiling.changedFields(baseline, character.card).length > 0;
    if (bookRow === null && !appearanceChanged) {
      return character;
    }
    if (character.archived && character.scribeSubjectId === null) {
      return character;
    }
    const loaded = this.#scribeService.loadState(campaignId);
    const excludeSubjectIds = new Set();
    for (const otherCharacter of this.#scribeService.listAllCharacters(campaignId)) {
      if (
        otherCharacter.id !== character.id &&
        typeof otherCharacter.scribeSubjectId === 'string' &&
        otherCharacter.scribeSubjectId.trim().length > 0
      ) {
        const trimmedId = otherCharacter.scribeSubjectId.trim();
        excludeSubjectIds.add(trimmedId);
        excludeSubjectIds.add(ScribeKnowledge.survivor(loaded.state, trimmedId));
      }
    }
    const synced = ScribeLogCore.syncCharacterSubject(loaded.log, loaded.state, {
      subjectId: character.scribeSubjectId,
      name: character.name,
      aliases: character.aliases,
      kind: ScribeCategory.SubjectKinds.Character,
      excludeSubjectIds,
    });
    if (synced.changed) {
      this.#store.saveScribeBook(campaignId, {
        bookJson: JSON.stringify(loaded.log),
        lastTurnSeq: loaded.lastTurnSeq,
        dirty: loaded.dirty,
      });
    }
    let synchronized = character;
    if (character.scribeSubjectId !== synced.subjectId) {
      const updated = this.#store.updateCharacter(campaignId, character.id, {
        scribeSubjectId: synced.subjectId,
      });
      if (updated !== null) {
        synchronized = updated;
      }
    }
    if (!appearanceChanged) {
      return synchronized;
    }
    const filedCard = this.#scribeService.fileCardAppearance({
      campaignId,
      subjectId: synced.subjectId,
      before: baseline,
      after: synchronized.card,
    });
    return this.#store.setCardFiledFactIds(campaignId, synchronized.id, filedCard.filedFactIds);
  }

  /**
   * @param {string} campaignId
   * @param {object} character
   * @returns {Readonly<Record<string, string>>}
   * @throws {Error}
   */
  #bookHints(campaignId, character) {
    if (character.scribeSubjectId === null || this.#store.getScribeBook(campaignId) === null) {
      return Object.freeze({});
    }
    const { state } = this.#scribeService.loadState(campaignId);
    return this.#scribeService.bookHints({ state, subjectId: character.scribeSubjectId, card: character.card });
  }

  /**
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @param {(signal: AbortSignal, emit: (payload: {event: string, data: unknown}) => Promise<void>) => Promise<object>} executor
   * @returns {Promise<void>}
   */
  async #runSseTurnPipeline(request, response, executor) {
    const sse = new SseStream({ request, response });
    const requestController = new AbortController();
    this.#activeControllers.add(requestController);

    /**
     * @returns {void}
     */
    const abortOnDisconnect = () => {
      if (!requestController.signal.aborted) {
        requestController.abort(new Error('Client disconnected'));
      }
    };

    /**
     * @returns {void}
     */
    const abortOnShutdown = () => {
      sse.abort();
    };
    sse.signal.addEventListener('abort', abortOnDisconnect, { once: true });
    requestController.signal.addEventListener('abort', abortOnShutdown, { once: true });

    let findings = [];
    let memoryUpdated = null;

    try {
      sse.open();
      const result = await executor(requestController.signal, async ({ event, data }) => {
        if (event === 'findings' && Array.isArray(data)) {
          findings = data;
        } else if (event === 'memory_updated') {
          memoryUpdated = data;
        }
        if (event === 'warning' && data !== null && typeof data === 'object' && typeof data.message === 'string') {
          sse.send(event, {
            ...data,
            message: this.#redactMessage(data.message),
          });
          return;
        }
        sse.send(event, data);
      });

      sse.send('done', {
        userTurn: result.userTurn,
        assistantTurn: result.assistantTurn,
        sceneState: result.sceneState,
        findings,
        memoryUpdated,
      });
    } catch (turnError) {
      if (!sse.signal.aborted && !requestController.signal.aborted) {
        const statusCode = this.#mapErrorStatusCode(turnError, 500);
        const rawMessage = turnError instanceof Error ? turnError.message : String(turnError);
        sse.send('error', {
          statusCode,
          message: this.#redactMessage(rawMessage),
        });
      }
    } finally {
      sse.signal.removeEventListener('abort', abortOnDisconnect);
      requestController.signal.removeEventListener('abort', abortOnShutdown);
      this.#activeControllers.delete(requestController);
      sse.end();
    }
  }

  /**
   * @template ResultType
   * @param {import('node:http').IncomingMessage} request
   * @param {import('node:http').ServerResponse} response
   * @param {(signal: AbortSignal) => Promise<ResultType>} task
   * @returns {Promise<ResultType>}
   */
  async #runWithAbortController(request, response, task) {
    const requestController = new AbortController();
    this.#activeControllers.add(requestController);

    /**
     * @returns {void}
     */
    const onRequestAborted = () => {
      if (!requestController.signal.aborted) {
        requestController.abort(new Error('Client aborted request'));
      }
    };

    /**
     * @returns {void}
     */
    const onResponseClose = () => {
      if (!response.writableEnded && !requestController.signal.aborted) {
        requestController.abort(new Error('Client closed connection'));
      }
    };

    request.on('aborted', onRequestAborted);
    response.on('close', onResponseClose);
    try {
      return await task(requestController.signal);
    } finally {
      request.off('aborted', onRequestAborted);
      response.off('close', onResponseClose);
      this.#activeControllers.delete(requestController);
    }
  }

  /**
   * @param {unknown} error
   * @param {number} [fallbackStatus]
   * @returns {number}
   */
  #mapErrorStatusCode(error, fallbackStatus = 500) {
    if (error !== null && typeof error === 'object' && Number.isInteger(error.statusCode)) {
      return error.statusCode;
    }
    if (error instanceof Error) {
      if (error.name === 'ConflictError') {
        return 409;
      }
      if (
        /Cannot delete referenced character/i.test(error.message) ||
        /UNIQUE constraint failed/i.test(error.message)
      ) {
        return 409;
      }
      if (error instanceof TypeError || error instanceof RangeError) {
        return 400;
      }
    }
    return fallbackStatus;
  }

  /**
   * @param {unknown} message
   * @param {ReadonlyArray<string>} [extraSecrets]
   * @returns {string}
   */
  #redactMessage(message, extraSecrets = []) {
    let safeText = typeof message === 'string' ? message : String(message ?? '');
    const secretsToRedact = [...extraSecrets];
    try {
      const resolved = WorldsConfig.resolveApiKey(this.#config);
      if (typeof resolved.key === 'string' && resolved.key.length > 0) {
        secretsToRedact.push(resolved.key);
      }
    } catch {
      if (typeof this.#config.envApiKey === 'string' && this.#config.envApiKey.length > 0) {
        secretsToRedact.push(this.#config.envApiKey);
      }
    }
    if (typeof this.#config.envApiKey === 'string' && this.#config.envApiKey.length > 0) {
      secretsToRedact.push(this.#config.envApiKey);
    }
    if (this.#config.r2 !== null && this.#config.r2 !== undefined) {
      if (typeof this.#config.r2.secret === 'string' && this.#config.r2.secret.length > 0) {
        secretsToRedact.push(this.#config.r2.secret);
      }
      if (typeof this.#config.r2.accessKey === 'string' && this.#config.r2.accessKey.length > 0) {
        secretsToRedact.push(this.#config.r2.accessKey);
      }
    }
    for (const secretValue of secretsToRedact) {
      safeText = Security.redactSecret(safeText, secretValue);
    }
    return safeText;
  }

  /**
   * @param {import('node:http').ServerResponse} response
   * @param {number} statusCode
   * @param {unknown} payload
   * @param {Record<string, string>} [extraHeaders]
   * @returns {void}
   */
  #sendJson(response, statusCode, payload, extraHeaders = {}) {
    if (response.headersSent || response.writableEnded || response.destroyed) {
      return;
    }
    response.writeHead(statusCode, {
      ...Security.SecurityHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    });
    response.end(JSON.stringify(payload));
  }
}
