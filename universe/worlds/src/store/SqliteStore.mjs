import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AvatarToken } from './enums/AvatarToken.mjs';
import { CharacterTier } from './enums/CharacterTier.mjs';
import { FindingKind } from './enums/FindingKind.mjs';
import { FindingStatus } from './enums/FindingStatus.mjs';
import { SceneType } from './enums/SceneType.mjs';
import { SpeakerType } from './enums/SpeakerType.mjs';
import { SpendStage } from './enums/SpendStage.mjs';
import { TurnMode } from './enums/TurnMode.mjs';
import { TurnRole } from './enums/TurnRole.mjs';

export class SqliteStore {
  #db;
  #closed = false;

  /**
   * @param {string} dbPath
   * @throws {Error}
   */
  constructor(dbPath) {
    if (typeof dbPath !== 'string' || dbPath.trim().length === 0) {
      throw new TypeError('Database path must be a non-empty string.');
    }
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }
    this.#db = new DatabaseSync(dbPath);
    this.#db.exec('PRAGMA journal_mode = WAL;');
    this.#db.exec('PRAGMA foreign_keys = ON;');
    this.#db.exec('PRAGMA busy_timeout = 5000;');
    const schemaPath = new URL('./schema.sql', import.meta.url);
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    this.#db.exec(schemaSql);
  }

  /**
   * @returns {void}
   */
  close() {
    if (!this.#closed) {
      this.#db.close();
      this.#closed = true;
    }
  }

  /**
   * @param {string} targetPath
   * @returns {string}
   * @throws {Error}
   */
  vacuumInto(targetPath) {
    this.#validateNonEmptyString(targetPath, 'targetPath');
    if (targetPath.includes('\0')) {
      throw new RangeError('targetPath must not contain NUL bytes.');
    }
    const resolvedTarget = path.resolve(targetPath);
    if (fs.existsSync(resolvedTarget)) {
      throw new Error(`Snapshot target already exists: ${resolvedTarget}`);
    }
    const escapedTarget = resolvedTarget.replaceAll("'", "''");
    this.#db.exec(`VACUUM INTO '${escapedTarget}'`);
    return resolvedTarget;
  }

  /**
   * @returns {number}
   */
  getLocalChangeSeq() {
    const row = this.#db.prepare('SELECT local_change_seq FROM sync_meta WHERE id = 1').get();
    return Number(row.local_change_seq);
  }

  /**
   * @returns {{models: {director: string, composer: string, main: string, recurring: string, scribe: string}, publicOdds: number, privateOdds: number, scribeInterval: number, pedantEnabled: boolean, dailyWarnUsd: number | null}}
   */
  getSettings() {
    const defaults = {
      models: {
        director: '',
        composer: '',
        main: '',
        recurring: '',
        scribe: '',
      },
      publicOdds: 8,
      privateOdds: 30,
      scribeInterval: 10,
      pedantEnabled: true,
      dailyWarnUsd: null,
    };
    const rows = this.#db.prepare('SELECT key, value_json FROM settings').all();
    for (const row of rows) {
      const parsedValue = JSON.parse(row.value_json);
      if (row.key === 'models' && parsedValue !== null && typeof parsedValue === 'object' && !Array.isArray(parsedValue)) {
        defaults.models = {
          director: typeof parsedValue.director === 'string' ? parsedValue.director : '',
          composer: typeof parsedValue.composer === 'string' ? parsedValue.composer : '',
          main: typeof parsedValue.main === 'string' ? parsedValue.main : '',
          recurring: typeof parsedValue.recurring === 'string' ? parsedValue.recurring : '',
          scribe: typeof parsedValue.scribe === 'string' ? parsedValue.scribe : '',
        };
      } else if (Object.hasOwn(defaults, row.key)) {
        defaults[row.key] = parsedValue;
      }
    }
    return defaults;
  }

  /**
   * @param {Record<string, unknown>} patch
   * @returns {{models: {director: string, composer: string, main: string, recurring: string, scribe: string}, publicOdds: number, privateOdds: number, scribeInterval: number, pedantEnabled: boolean, dailyWarnUsd: number | null}}
   * @throws {Error}
   */
  updateSettings(patch) {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new TypeError('Settings patch must be a plain object.');
    }
    const allowedKeys = new Set([
      'models',
      'publicOdds',
      'privateOdds',
      'scribeInterval',
      'pedantEnabled',
      'dailyWarnUsd',
    ]);
    const allowedModelSlots = new Set(['director', 'composer', 'main', 'recurring', 'scribe']);
    const patchEntries = Object.entries(patch);
    for (const [patchKey] of patchEntries) {
      if (!allowedKeys.has(patchKey)) {
        throw new RangeError(`Unsupported settings key: ${patchKey}`);
      }
    }

    return this.#runTransaction(() => {
      const current = this.getSettings();
      const updates = [];
      for (const [patchKey, patchValue] of patchEntries) {
        if (patchValue === undefined) {
          continue;
        }
        if (patchKey === 'models') {
          if (patchValue === null || typeof patchValue !== 'object' || Array.isArray(patchValue)) {
            throw new TypeError('models must be a plain object.');
          }
          const nextModels = { ...current.models };
          let modelsChanged = false;
          for (const [slotName, slotModel] of Object.entries(patchValue)) {
            if (!allowedModelSlots.has(slotName)) {
              throw new RangeError(`Unsupported model slot: ${slotName}`);
            }
            if (slotModel === undefined) {
              continue;
            }
            if (typeof slotModel !== 'string') {
              throw new TypeError(`Model slot ${slotName} must be a string.`);
            }
            nextModels[slotName] = slotModel.trim();
            modelsChanged = true;
          }
          if (modelsChanged) {
            updates.push(['models', JSON.stringify(nextModels)]);
          }
        } else if (patchKey === 'publicOdds' || patchKey === 'privateOdds' || patchKey === 'scribeInterval') {
          this.#validateNonNegativeInt(patchValue, patchKey);
          updates.push([patchKey, JSON.stringify(patchValue)]);
        } else if (patchKey === 'pedantEnabled') {
          if (typeof patchValue !== 'boolean') {
            throw new TypeError('pedantEnabled must be a boolean.');
          }
          updates.push([patchKey, JSON.stringify(patchValue)]);
        } else if (patchKey === 'dailyWarnUsd') {
          if (patchValue !== null && (typeof patchValue !== 'number' || !Number.isFinite(patchValue) || patchValue < 0)) {
            throw new RangeError('dailyWarnUsd must be null or a non-negative finite number.');
          }
          updates.push([patchKey, JSON.stringify(patchValue)]);
        }
      }

      if (updates.length > 0) {
        const upsertStmt = this.#db.prepare(
          'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json',
        );
        for (const [settingKey, settingJson] of updates) {
          upsertStmt.run(settingKey, settingJson);
        }
        this.#bumpChangeSeq();
      }
      return this.getSettings();
    });
  }

  /**
   * @param {{limit?: number, after?: string | null}} options
   * @returns {{items: Array<object>, total: number, nextCursor: string | null}}
   * @throws {RangeError}
   */
  listCampaigns({ limit = 25, after = null } = {}) {
    const validLimit = this.#validateLimit(limit);
    const totalRow = this.#db.prepare('SELECT COUNT(*) AS total FROM campaigns').get();
    let rows;
    if (after !== null) {
      const cursor = this.#decodeCursor(after, ['updatedAt', 'id']);
      rows = this.#db.prepare(
        `SELECT * FROM campaigns
         WHERE (updated_at < ? OR (updated_at = ? AND id < ?))
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`,
      ).all(cursor.updatedAt, cursor.updatedAt, cursor.id, validLimit + 1);
    } else {
      rows = this.#db.prepare(
        'SELECT * FROM campaigns ORDER BY updated_at DESC, id DESC LIMIT ?',
      ).all(validLimit + 1);
    }

    const hasMore = rows.length > validLimit;
    const pageRows = hasMore ? rows.slice(0, validLimit) : rows;
    const items = pageRows.map((row) => this.#mapCampaign(row));
    const nextCursor = hasMore
      ? this.#encodeCursor({
          updatedAt: items[items.length - 1].updatedAt,
          id: items[items.length - 1].id,
        })
      : null;
    return { items, total: Number(totalRow.total), nextCursor };
  }

  /**
   * @param {string} campaignId
   * @returns {object | null}
   * @throws {RangeError}
   */
  getCampaign(campaignId) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    const row = this.#db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    if (row === undefined) {
      return null;
    }
    return this.#mapCampaign(row);
  }

  /**
   * @param {Record<string, unknown>} dto
   * @returns {object}
   * @throws {Error}
   */
  createCampaign(dto) {
    if (dto === null || typeof dto !== 'object' || Array.isArray(dto)) {
      throw new TypeError('Campaign payload must be an object.');
    }
    this.#validateNonEmptyString(dto.title, 'title');
    const title = dto.title.trim();
    const premise = dto.premise === undefined ? '' : dto.premise;
    if (typeof premise !== 'string') {
      throw new TypeError('premise must be a string.');
    }
    const styleNotes = dto.styleNotes === undefined ? '' : dto.styleNotes;
    if (typeof styleNotes !== 'string') {
      throw new TypeError('styleNotes must be a string.');
    }

    const settings = this.getSettings();
    const encounterPublicOdds = dto.encounterPublicOdds === undefined
      ? settings.publicOdds
      : dto.encounterPublicOdds;
    this.#validateNonNegativeInt(encounterPublicOdds, 'encounterPublicOdds');

    const encounterPrivateOdds = dto.encounterPrivateOdds === undefined
      ? settings.privateOdds
      : dto.encounterPrivateOdds;
    this.#validateNonNegativeInt(encounterPrivateOdds, 'encounterPrivateOdds');

    const scribeInterval = dto.scribeInterval === undefined
      ? settings.scribeInterval
      : dto.scribeInterval;
    this.#validateNonNegativeInt(scribeInterval, 'scribeInterval');

    const defaultSceneState = {
      sceneNumber: 1,
      day: 1,
      timeLabel: 'Morning',
      location: '',
      sceneType: SceneType.Public,
      presentIds: [],
      remoteIds: [],
      offscreenNotes: {},
      activeWalkOns: [],
    };
    const sceneState = dto.sceneState === undefined
      ? defaultSceneState
      : this.#normalizeSceneState(dto.sceneState, defaultSceneState);

    const campaignId = randomUUID();
    const now = new Date().toISOString();

    return this.#runTransaction(() => {
      this.#db.prepare(
        `INSERT INTO campaigns (
          id, title, premise, style_notes, player_character_id, scene_state_json,
          encounter_public_odds, encounter_private_odds, scribe_interval, created_at, updated_at
        ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      ).run(
        campaignId,
        title,
        premise,
        styleNotes,
        JSON.stringify(sceneState),
        encounterPublicOdds,
        encounterPrivateOdds,
        scribeInterval,
        now,
        now,
      );
      this.#bumpChangeSeq();
      const insertedRow = this.#db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
      return this.#mapCampaign(insertedRow);
    });
  }

  /**
   * @param {string} campaignId
   * @param {Record<string, unknown>} patch
   * @returns {object | null}
   * @throws {Error}
   */
  updateCampaign(campaignId, patch) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new TypeError('Campaign patch must be an object.');
    }
    const allowedKeys = new Set([
      'title',
      'premise',
      'styleNotes',
      'playerCharacterId',
      'sceneState',
      'encounterPublicOdds',
      'encounterPrivateOdds',
      'scribeInterval',
    ]);
    for (const patchKey of Object.keys(patch)) {
      if (!allowedKeys.has(patchKey)) {
        throw new RangeError(`Unsupported campaign field: ${patchKey}`);
      }
    }

    return this.#runTransaction(() => {
      const existingRow = this.#db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
      if (existingRow === undefined) {
        return null;
      }
      const existing = this.#mapCampaign(existingRow);

      let title = existing.title;
      if (patch.title !== undefined) {
        this.#validateNonEmptyString(patch.title, 'title');
        title = patch.title.trim();
      }
      let premise = existing.premise;
      if (patch.premise !== undefined) {
        if (typeof patch.premise !== 'string') {
          throw new TypeError('premise must be a string.');
        }
        premise = patch.premise;
      }
      let styleNotes = existing.styleNotes;
      if (patch.styleNotes !== undefined) {
        if (typeof patch.styleNotes !== 'string') {
          throw new TypeError('styleNotes must be a string.');
        }
        styleNotes = patch.styleNotes;
      }
      let playerCharacterId = existing.playerCharacterId;
      if (patch.playerCharacterId !== undefined) {
        if (patch.playerCharacterId !== null) {
          this.#validateNonEmptyString(patch.playerCharacterId, 'playerCharacterId');
          const charRow = this.#db.prepare(
            'SELECT id FROM characters WHERE id = ? AND campaign_id = ?',
          ).get(patch.playerCharacterId, campaignId);
          if (charRow === undefined) {
            throw new RangeError(`Player character does not belong to campaign: ${patch.playerCharacterId}`);
          }
        }
        playerCharacterId = patch.playerCharacterId;
      }
      let sceneState = existing.sceneState;
      if (patch.sceneState !== undefined) {
        sceneState = this.#normalizeSceneState(patch.sceneState, existing.sceneState);
      }
      let encounterPublicOdds = existing.encounterPublicOdds;
      if (patch.encounterPublicOdds !== undefined) {
        this.#validateNonNegativeInt(patch.encounterPublicOdds, 'encounterPublicOdds');
        encounterPublicOdds = patch.encounterPublicOdds;
      }
      let encounterPrivateOdds = existing.encounterPrivateOdds;
      if (patch.encounterPrivateOdds !== undefined) {
        this.#validateNonNegativeInt(patch.encounterPrivateOdds, 'encounterPrivateOdds');
        encounterPrivateOdds = patch.encounterPrivateOdds;
      }
      let scribeInterval = existing.scribeInterval;
      if (patch.scribeInterval !== undefined) {
        this.#validateNonNegativeInt(patch.scribeInterval, 'scribeInterval');
        scribeInterval = patch.scribeInterval;
      }

      const now = new Date().toISOString();
      this.#db.prepare(
        `UPDATE campaigns
         SET title = ?, premise = ?, style_notes = ?, player_character_id = ?,
             scene_state_json = ?, encounter_public_odds = ?, encounter_private_odds = ?,
             scribe_interval = ?, updated_at = ?
         WHERE id = ?`,
      ).run(
        title,
        premise,
        styleNotes,
        playerCharacterId,
        JSON.stringify(sceneState),
        encounterPublicOdds,
        encounterPrivateOdds,
        scribeInterval,
        now,
        campaignId,
      );
      this.#bumpChangeSeq();
      const updatedRow = this.#db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
      return this.#mapCampaign(updatedRow);
    });
  }

  /**
   * @param {string} campaignId
   * @returns {boolean}
   * @throws {Error}
   */
  deleteCampaign(campaignId) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    return this.#runTransaction(() => {
      const existingRow = this.#db.prepare('SELECT id FROM campaigns WHERE id = ?').get(campaignId);
      if (existingRow === undefined) {
        return false;
      }
      this.#db.prepare('DELETE FROM turns WHERE campaign_id = ?').run(campaignId);
      this.#db.prepare('UPDATE campaigns SET player_character_id = NULL WHERE id = ?').run(campaignId);
      this.#db.prepare('DELETE FROM campaigns WHERE id = ?').run(campaignId);
      this.#bumpChangeSeq();
      return true;
    });
  }

  /**
   * @param {string} campaignId
   * @param {{includeArchived?: boolean, limit?: number, after?: string | null}} options
   * @returns {{items: Array<object>, total: number, nextCursor: string | null}}
   * @throws {Error}
   */
  listCharacters(campaignId, { includeArchived = false, limit = 25, after = null } = {}) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    if (typeof includeArchived !== 'boolean') {
      throw new TypeError('includeArchived must be a boolean.');
    }
    const validLimit = this.#validateLimit(limit);
    const archivedClause = includeArchived ? '' : ' AND archived = 0';
    const totalRow = this.#db.prepare(
      `SELECT COUNT(*) AS total FROM characters WHERE campaign_id = ?${archivedClause}`,
    ).get(campaignId);

    let rows;
    if (after !== null) {
      const cursor = this.#decodeCursor(after, ['name', 'id']);
      rows = this.#db.prepare(
        `SELECT * FROM characters
         WHERE campaign_id = ?${archivedClause}
           AND (name > ? OR (name = ? AND id > ?))
         ORDER BY name ASC, id ASC
         LIMIT ?`,
      ).all(campaignId, cursor.name, cursor.name, cursor.id, validLimit + 1);
    } else {
      rows = this.#db.prepare(
        `SELECT * FROM characters
         WHERE campaign_id = ?${archivedClause}
         ORDER BY name ASC, id ASC
         LIMIT ?`,
      ).all(campaignId, validLimit + 1);
    }

    const hasMore = rows.length > validLimit;
    const pageRows = hasMore ? rows.slice(0, validLimit) : rows;
    const items = pageRows.map((row) => this.#mapCharacter(row));
    const nextCursor = hasMore
      ? this.#encodeCursor({
          name: items[items.length - 1].name,
          id: items[items.length - 1].id,
        })
      : null;
    return { items, total: Number(totalRow.total), nextCursor };
  }

  /**
   * @param {string} campaignId
   * @param {string} characterId
   * @returns {object | null}
   * @throws {RangeError}
   */
  getCharacter(campaignId, characterId) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    this.#validateNonEmptyString(characterId, 'characterId');
    const row = this.#db.prepare(
      'SELECT * FROM characters WHERE campaign_id = ? AND id = ?',
    ).get(campaignId, characterId);
    if (row === undefined) {
      return null;
    }
    return this.#mapCharacter(row);
  }

  /**
   * @param {string} campaignId
   * @param {Record<string, unknown>} dto
   * @returns {object}
   * @throws {Error}
   */
  createCharacter(campaignId, dto) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    if (dto === null || typeof dto !== 'object' || Array.isArray(dto)) {
      throw new TypeError('Character payload must be an object.');
    }
    this.#validateSlug(dto.slug);
    this.#validateNonEmptyString(dto.name, 'name');
    const name = dto.name.trim();
    const tier = dto.tier === undefined ? CharacterTier.Main : dto.tier;
    CharacterTier.label(tier);
    const avatarToken = dto.avatarToken === undefined ? AvatarToken.Slate : dto.avatarToken;
    AvatarToken.label(avatarToken);

    let avatarInitials;
    if (dto.avatarInitials !== undefined) {
      this.#validateNonEmptyString(dto.avatarInitials, 'avatarInitials');
      avatarInitials = dto.avatarInitials.trim().slice(0, 4);
    } else {
      const nameParts = name.split(/\s+/);
      avatarInitials = nameParts.length >= 2
        ? `${nameParts[0][0]}${nameParts[1][0]}`.toUpperCase()
        : nameParts[0].slice(0, 2).toUpperCase();
    }

    const aliases = dto.aliases === undefined ? [] : this.#validateStringArray(dto.aliases, 'aliases');
    const isPlayer = dto.isPlayer === undefined ? false : dto.isPlayer;
    if (typeof isPlayer !== 'boolean') {
      throw new TypeError('isPlayer must be a boolean.');
    }
    const archived = dto.archived === undefined ? false : dto.archived;
    if (typeof archived !== 'boolean') {
      throw new TypeError('archived must be a boolean.');
    }
    const persona = dto.persona === undefined ? '' : dto.persona;
    if (typeof persona !== 'string') {
      throw new TypeError('persona must be a string.');
    }
    const voiceNotes = dto.voiceNotes === undefined ? '' : dto.voiceNotes;
    if (typeof voiceNotes !== 'string') {
      throw new TypeError('voiceNotes must be a string.');
    }
    let modelOverride = null;
    if (dto.modelOverride !== undefined && dto.modelOverride !== null) {
      if (typeof dto.modelOverride !== 'string') {
        throw new TypeError('modelOverride must be a string or null.');
      }
      const trimmedOverride = dto.modelOverride.trim();
      modelOverride = trimmedOverride.length > 0 ? trimmedOverride : null;
    }
    let scribeSubjectId = null;
    if (dto.scribeSubjectId !== undefined && dto.scribeSubjectId !== null) {
      this.#validateNonEmptyString(dto.scribeSubjectId, 'scribeSubjectId');
      scribeSubjectId = dto.scribeSubjectId.trim();
    }

    const characterId = randomUUID();
    const now = new Date().toISOString();

    return this.#runTransaction(() => {
      this.#db.prepare(
        `INSERT INTO characters (
          id, campaign_id, slug, scribe_subject_id, name, aliases_json, is_player,
          tier, model_override, persona, voice_notes, avatar_token, avatar_initials,
          archived, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        characterId,
        campaignId,
        dto.slug,
        scribeSubjectId,
        name,
        JSON.stringify(aliases),
        isPlayer ? 1 : 0,
        tier,
        modelOverride,
        persona,
        voiceNotes,
        avatarToken,
        avatarInitials,
        archived ? 1 : 0,
        now,
        now,
      );
      this.#bumpChangeSeq();
      const insertedRow = this.#db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
      return this.#mapCharacter(insertedRow);
    });
  }

  /**
   * @param {string} campaignId
   * @param {string} characterId
   * @param {Record<string, unknown>} patch
   * @returns {object | null}
   * @throws {Error}
   */
  updateCharacter(campaignId, characterId, patch) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    this.#validateNonEmptyString(characterId, 'characterId');
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new TypeError('Character patch must be an object.');
    }
    const allowedKeys = new Set([
      'slug',
      'scribeSubjectId',
      'name',
      'aliases',
      'isPlayer',
      'tier',
      'modelOverride',
      'persona',
      'voiceNotes',
      'avatarToken',
      'avatarInitials',
      'archived',
    ]);
    for (const patchKey of Object.keys(patch)) {
      if (!allowedKeys.has(patchKey)) {
        throw new RangeError(`Unsupported character field: ${patchKey}`);
      }
    }

    return this.#runTransaction(() => {
      const existingRow = this.#db.prepare(
        'SELECT * FROM characters WHERE campaign_id = ? AND id = ?',
      ).get(campaignId, characterId);
      if (existingRow === undefined) {
        return null;
      }
      const existing = this.#mapCharacter(existingRow);

      let slug = existing.slug;
      if (patch.slug !== undefined) {
        this.#validateSlug(patch.slug);
        slug = patch.slug;
      }
      let scribeSubjectId = existing.scribeSubjectId;
      if (patch.scribeSubjectId !== undefined) {
        if (patch.scribeSubjectId === null) {
          scribeSubjectId = null;
        } else {
          this.#validateNonEmptyString(patch.scribeSubjectId, 'scribeSubjectId');
          scribeSubjectId = patch.scribeSubjectId.trim();
        }
      }
      let name = existing.name;
      if (patch.name !== undefined) {
        this.#validateNonEmptyString(patch.name, 'name');
        name = patch.name.trim();
      }
      let aliases = existing.aliases;
      if (patch.aliases !== undefined) {
        aliases = this.#validateStringArray(patch.aliases, 'aliases');
      }
      let isPlayer = existing.isPlayer;
      if (patch.isPlayer !== undefined) {
        if (typeof patch.isPlayer !== 'boolean') {
          throw new TypeError('isPlayer must be a boolean.');
        }
        isPlayer = patch.isPlayer;
      }
      let tier = existing.tier;
      if (patch.tier !== undefined) {
        CharacterTier.label(patch.tier);
        tier = patch.tier;
      }
      let modelOverride = existing.modelOverride;
      if (patch.modelOverride !== undefined) {
        if (patch.modelOverride === null) {
          modelOverride = null;
        } else if (typeof patch.modelOverride === 'string') {
          const trimmedOverride = patch.modelOverride.trim();
          modelOverride = trimmedOverride.length > 0 ? trimmedOverride : null;
        } else {
          throw new TypeError('modelOverride must be a string or null.');
        }
      }
      let persona = existing.persona;
      if (patch.persona !== undefined) {
        if (typeof patch.persona !== 'string') {
          throw new TypeError('persona must be a string.');
        }
        persona = patch.persona;
      }
      let voiceNotes = existing.voiceNotes;
      if (patch.voiceNotes !== undefined) {
        if (typeof patch.voiceNotes !== 'string') {
          throw new TypeError('voiceNotes must be a string.');
        }
        voiceNotes = patch.voiceNotes;
      }
      let avatarToken = existing.avatarToken;
      if (patch.avatarToken !== undefined) {
        AvatarToken.label(patch.avatarToken);
        avatarToken = patch.avatarToken;
      }
      let avatarInitials = existing.avatarInitials;
      if (patch.avatarInitials !== undefined) {
        this.#validateNonEmptyString(patch.avatarInitials, 'avatarInitials');
        avatarInitials = patch.avatarInitials.trim().slice(0, 4);
      }
      let archived = existing.archived;
      if (patch.archived !== undefined) {
        if (typeof patch.archived !== 'boolean') {
          throw new TypeError('archived must be a boolean.');
        }
        archived = patch.archived;
      }

      const now = new Date().toISOString();
      this.#db.prepare(
        `UPDATE characters
         SET slug = ?, scribe_subject_id = ?, name = ?, aliases_json = ?, is_player = ?,
             tier = ?, model_override = ?, persona = ?, voice_notes = ?, avatar_token = ?,
             avatar_initials = ?, archived = ?, updated_at = ?
         WHERE campaign_id = ? AND id = ?`,
      ).run(
        slug,
        scribeSubjectId,
        name,
        JSON.stringify(aliases),
        isPlayer ? 1 : 0,
        tier,
        modelOverride,
        persona,
        voiceNotes,
        avatarToken,
        avatarInitials,
        archived ? 1 : 0,
        now,
        campaignId,
        characterId,
      );
      this.#bumpChangeSeq();
      const updatedRow = this.#db.prepare(
        'SELECT * FROM characters WHERE campaign_id = ? AND id = ?',
      ).get(campaignId, characterId);
      return this.#mapCharacter(updatedRow);
    });
  }

  /**
   * @param {string} campaignId
   * @param {string} characterId
   * @returns {boolean}
   * @throws {Error}
   */
  deleteCharacter(campaignId, characterId) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    this.#validateNonEmptyString(characterId, 'characterId');
    return this.#runTransaction(() => {
      const existingRow = this.#db.prepare(
        'SELECT id FROM characters WHERE campaign_id = ? AND id = ?',
      ).get(campaignId, characterId);
      if (existingRow === undefined) {
        return false;
      }
      const refRow = this.#db.prepare(
        `SELECT (
           EXISTS (SELECT 1 FROM beats WHERE character_id = ?)
           OR EXISTS (SELECT 1 FROM findings WHERE speaker_character_id = ?)
           OR EXISTS (
             SELECT 1 FROM campaigns
             WHERE id = ?
               AND (
                 EXISTS (SELECT 1 FROM json_each(campaigns.scene_state_json, '$.presentIds') WHERE value = ?)
                 OR EXISTS (SELECT 1 FROM json_each(campaigns.scene_state_json, '$.remoteIds') WHERE value = ?)
               )
           )
           OR EXISTS (
             SELECT 1 FROM turns, json_each(turns.witness_ids_json)
             WHERE turns.campaign_id = ? AND json_each.value = ?
           )
           OR EXISTS (
             SELECT 1 FROM beats
             JOIN turns ON turns.id = beats.turn_id
             JOIN json_each(beats.witness_ids_json)
             WHERE turns.campaign_id = ? AND json_each.value = ?
           )
         ) AS is_referenced`,
      ).get(
        characterId,
        characterId,
        campaignId,
        characterId,
        characterId,
        campaignId,
        characterId,
        campaignId,
        characterId,
      );
      if (Number(refRow.is_referenced) === 1) {
        throw new Error(`Cannot delete referenced character ${characterId}; archive it instead.`);
      }
      this.#db.prepare('DELETE FROM characters WHERE campaign_id = ? AND id = ?').run(campaignId, characterId);
      this.#bumpChangeSeq();
      return true;
    });
  }

  /**
   * @param {string} campaignId
   * @param {{limit?: number, beforeSeq?: number | null}} options
   * @returns {{items: Array<object>, total: number, nextCursor: number | null}}
   * @throws {RangeError}
   */
  listTurns(campaignId, { limit = 50, beforeSeq = null } = {}) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    const validLimit = this.#validateLimit(limit);
    if (beforeSeq !== null && (!Number.isInteger(beforeSeq) || beforeSeq <= 0)) {
      throw new RangeError(`beforeSeq must be a positive integer: ${String(beforeSeq)}`);
    }

    const totalRow = this.#db.prepare(
      'SELECT COUNT(*) AS total FROM turns WHERE campaign_id = ?',
    ).get(campaignId);

    let rows;
    if (beforeSeq !== null) {
      rows = this.#db.prepare(
        `SELECT * FROM turns
         WHERE campaign_id = ? AND seq < ?
         ORDER BY seq DESC
         LIMIT ?`,
      ).all(campaignId, beforeSeq, validLimit + 1);
    } else {
      rows = this.#db.prepare(
        `SELECT * FROM turns
         WHERE campaign_id = ?
         ORDER BY seq DESC
         LIMIT ?`,
      ).all(campaignId, validLimit + 1);
    }

    const hasMore = rows.length > validLimit;
    const pageRows = hasMore ? rows.slice(0, validLimit) : rows;
    const turnIds = pageRows.map((row) => row.id);
    const beatsByTurnId = this.#loadBeatsForTurnIds(turnIds);
    const items = pageRows.map((row) => this.#mapTurn(row, beatsByTurnId.get(row.id)));
    const nextCursor = hasMore ? items[items.length - 1].seq : null;
    return { items, total: Number(totalRow.total), nextCursor };
  }

  /**
   * @param {string} campaignId
   * @param {string} turnId
   * @returns {object | null}
   * @throws {RangeError}
   */
  getTurn(campaignId, turnId) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    this.#validateNonEmptyString(turnId, 'turnId');
    const row = this.#db.prepare(
      'SELECT * FROM turns WHERE campaign_id = ? AND id = ?',
    ).get(campaignId, turnId);
    if (row === undefined) {
      return null;
    }
    const beatsByTurnId = this.#loadBeatsForTurnIds([row.id]);
    return this.#mapTurn(row, beatsByTurnId.get(row.id));
  }

  /**
   * @param {string} campaignId
   * @returns {{userTurn: object | null, assistantTurn: object | null} | null}
   * @throws {RangeError}
   */
  getLatestTurnPair(campaignId) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    const rows = this.#db.prepare(
      'SELECT * FROM turns WHERE campaign_id = ? ORDER BY seq DESC LIMIT 2',
    ).all(campaignId);
    if (rows.length === 0) {
      return null;
    }
    const beatsByTurnId = this.#loadBeatsForTurnIds(rows.map((row) => row.id));
    const latestRow = rows[0];
    const latestTurn = this.#mapTurn(latestRow, beatsByTurnId.get(latestRow.id));
    if (latestTurn.role === TurnRole.Assistant) {
      const previousRow = rows[1];
      const userTurn = previousRow !== undefined && previousRow.role === TurnRole.User
        ? this.#mapTurn(previousRow, beatsByTurnId.get(previousRow.id))
        : null;
      return { userTurn, assistantTurn: latestTurn };
    }
    return { userTurn: latestTurn, assistantTurn: null };
  }

  /**
   * @param {string} campaignId
   * @returns {number}
   * @throws {RangeError}
   */
  countTurnsSinceScribe(campaignId) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    const row = this.#db.prepare(
      `SELECT COUNT(*) AS turn_count
       FROM turns
       WHERE campaign_id = ?
         AND role = ?
         AND seq > COALESCE(
           (SELECT last_turn_seq FROM scribe_books WHERE campaign_id = ?),
           0
         )`,
    ).get(campaignId, TurnRole.Assistant, campaignId);
    return Number(row.turn_count);
  }

  /**
   * @param {{campaignId: string, userTurn: Record<string, unknown>, userBeat: Record<string, unknown>, assistantTurn: Record<string, unknown>, assistantBeats: Array<Record<string, unknown>>, nextSceneState: Record<string, unknown>, spendIds?: Array<string>}} payload
   * @returns {{userTurn: object, assistantTurn: object}}
   * @throws {Error}
   */
  commitTurnPair({
    campaignId,
    userTurn,
    userBeat,
    assistantTurn,
    assistantBeats,
    nextSceneState,
    spendIds = [],
  }) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    if (userTurn === null || typeof userTurn !== 'object') {
      throw new TypeError('userTurn must be an object.');
    }
    if (userBeat === null || typeof userBeat !== 'object') {
      throw new TypeError('userBeat must be an object.');
    }
    if (assistantTurn === null || typeof assistantTurn !== 'object') {
      throw new TypeError('assistantTurn must be an object.');
    }
    if (!Array.isArray(assistantBeats) || assistantBeats.length === 0) {
      throw new RangeError('assistantBeats must be a non-empty array.');
    }

    const normalizedNextSceneState = this.#normalizeSceneState(nextSceneState, null);
    const validSpendIds = this.#validateStringArray(spendIds, 'spendIds');

    TurnMode.label(userTurn.mode);
    if (typeof userTurn.rawText !== 'string') {
      throw new TypeError('userTurn.rawText must be a string.');
    }
    const oocNudge = userTurn.oocNudge === undefined ? null : userTurn.oocNudge;
    if (oocNudge !== null && typeof oocNudge !== 'string') {
      throw new TypeError('userTurn.oocNudge must be a string or null.');
    }
    const userSceneNumber = userTurn.sceneNumber === undefined
      ? normalizedNextSceneState.sceneNumber
      : userTurn.sceneNumber;
    if (!Number.isInteger(userSceneNumber) || userSceneNumber < 1) {
      throw new RangeError('userTurn.sceneNumber must be a positive integer.');
    }
    const userWitnessIds = userTurn.witnessIds === undefined
      ? []
      : this.#validateStringArray(userTurn.witnessIds, 'userTurn.witnessIds');

    SpeakerType.label(userBeat.speakerType);
    if (userBeat.characterId !== undefined && userBeat.characterId !== null) {
      this.#validateNonEmptyString(userBeat.characterId, 'userBeat.characterId');
    }
    this.#validateNonEmptyString(userBeat.speakerName, 'userBeat.speakerName');
    if (typeof userBeat.text !== 'string') {
      throw new TypeError('userBeat.text must be a string.');
    }
    const userBeatWitnessIds = userBeat.witnessIds === undefined
      ? userWitnessIds
      : this.#validateStringArray(userBeat.witnessIds, 'userBeat.witnessIds');
    const userBeatMindPacket = userBeat.mindPacket === undefined ? null : userBeat.mindPacket;

    const assistantMode = assistantTurn.mode === undefined ? userTurn.mode : assistantTurn.mode;
    TurnMode.label(assistantMode);
    if (typeof assistantTurn.rawText !== 'string') {
      throw new TypeError('assistantTurn.rawText must be a string.');
    }
    const assistantSceneNumber = assistantTurn.sceneNumber === undefined
      ? normalizedNextSceneState.sceneNumber
      : assistantTurn.sceneNumber;
    if (!Number.isInteger(assistantSceneNumber) || assistantSceneNumber < 1) {
      throw new RangeError('assistantTurn.sceneNumber must be a positive integer.');
    }
    const assistantWitnessIds = assistantTurn.witnessIds === undefined
      ? []
      : this.#validateStringArray(assistantTurn.witnessIds, 'assistantTurn.witnessIds');
    const directorPlan = assistantTurn.directorPlan === undefined ? null : assistantTurn.directorPlan;
    const truncated = assistantTurn.truncated === undefined ? false : assistantTurn.truncated;
    if (typeof truncated !== 'boolean') {
      throw new TypeError('assistantTurn.truncated must be a boolean.');
    }

    const validatedAssistantBeats = assistantBeats.map((beat) => {
      if (beat === null || typeof beat !== 'object') {
        throw new TypeError('Each assistant beat must be an object.');
      }
      SpeakerType.label(beat.speakerType);
      if (beat.characterId !== undefined && beat.characterId !== null) {
        this.#validateNonEmptyString(beat.characterId, 'beat.characterId');
      }
      this.#validateNonEmptyString(beat.speakerName, 'beat.speakerName');
      if (typeof beat.text !== 'string') {
        throw new TypeError('beat.text must be a string.');
      }
      const beatWitnessIds = beat.witnessIds === undefined
        ? assistantWitnessIds
        : this.#validateStringArray(beat.witnessIds, 'beat.witnessIds');
      const beatMindPacket = beat.mindPacket === undefined ? null : beat.mindPacket;
      return {
        speakerType: beat.speakerType,
        characterId: beat.characterId === undefined ? null : beat.characterId,
        speakerName: beat.speakerName.trim(),
        text: beat.text,
        witnessIds: beatWitnessIds,
        mindPacket: beatMindPacket,
      };
    });

    return this.#runTransaction(() => {
      const campaignRow = this.#db.prepare(
        'SELECT scene_state_json FROM campaigns WHERE id = ?',
      ).get(campaignId);
      if (campaignRow === undefined) {
        throw new Error(`Campaign not found: ${campaignId}`);
      }

      const maxRow = this.#db.prepare(
        'SELECT COALESCE(MAX(seq), 0) AS max_seq FROM turns WHERE campaign_id = ?',
      ).get(campaignId);
      const userSeq = Number(maxRow.max_seq) + 1;
      const assistantSeq = userSeq + 1;

      const userTurnId = randomUUID();
      const assistantTurnId = randomUUID();
      const now = new Date().toISOString();
      const beforeJson = campaignRow.scene_state_json;
      const afterJson = JSON.stringify(normalizedNextSceneState);

      const insertTurnStmt = this.#db.prepare(
        `INSERT INTO turns (
          id, campaign_id, seq, role, mode, raw_text, ooc_nudge, scene_number,
          witness_ids_json, scene_state_before_json, scene_state_after_json,
          director_plan_json, truncated, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertBeatStmt = this.#db.prepare(
        `INSERT INTO beats (
          id, turn_id, seq, speaker_type, character_id, speaker_name,
          text, witness_ids_json, mind_packet_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );

      insertTurnStmt.run(
        userTurnId,
        campaignId,
        userSeq,
        TurnRole.User,
        userTurn.mode,
        userTurn.rawText,
        oocNudge,
        userSceneNumber,
        JSON.stringify(userWitnessIds),
        beforeJson,
        afterJson,
        null,
        0,
        now,
      );

      const checkCharCampaignStmt = this.#db.prepare(
        'SELECT campaign_id FROM characters WHERE id = ?',
      );
      if (userBeat.characterId !== undefined && userBeat.characterId !== null) {
        const userCharRow = checkCharCampaignStmt.get(userBeat.characterId);
        if (userCharRow !== undefined && userCharRow.campaign_id !== campaignId) {
          throw new RangeError(`Character does not belong to campaign: ${userBeat.characterId}`);
        }
      }

      insertBeatStmt.run(
        randomUUID(),
        userTurnId,
        1,
        userBeat.speakerType,
        userBeat.characterId === undefined ? null : userBeat.characterId,
        userBeat.speakerName.trim(),
        userBeat.text,
        JSON.stringify(userBeatWitnessIds),
        userBeatMindPacket === null ? null : JSON.stringify(userBeatMindPacket),
      );

      insertTurnStmt.run(
        assistantTurnId,
        campaignId,
        assistantSeq,
        TurnRole.Assistant,
        assistantMode,
        assistantTurn.rawText,
        null,
        assistantSceneNumber,
        JSON.stringify(assistantWitnessIds),
        beforeJson,
        afterJson,
        directorPlan === null ? null : JSON.stringify(directorPlan),
        truncated ? 1 : 0,
        now,
      );

      for (let beatIndex = 0; beatIndex < validatedAssistantBeats.length; beatIndex += 1) {
        const beat = validatedAssistantBeats[beatIndex];
        if (beat.characterId !== null) {
          const beatCharRow = checkCharCampaignStmt.get(beat.characterId);
          if (beatCharRow !== undefined && beatCharRow.campaign_id !== campaignId) {
            throw new RangeError(`Character does not belong to campaign: ${beat.characterId}`);
          }
        }
        insertBeatStmt.run(
          randomUUID(),
          assistantTurnId,
          beatIndex + 1,
          beat.speakerType,
          beat.characterId,
          beat.speakerName,
          beat.text,
          JSON.stringify(beat.witnessIds),
          beat.mindPacket === null ? null : JSON.stringify(beat.mindPacket),
        );
      }

      this.#db.prepare(
        'UPDATE campaigns SET scene_state_json = ?, updated_at = ? WHERE id = ?',
      ).run(afterJson, now, campaignId);

      if (validSpendIds.length > 0) {
        const linkSpendStmt = this.#db.prepare(
          `UPDATE spend_log
           SET turn_id = ?, campaign_id = COALESCE(campaign_id, ?)
           WHERE id = ? AND turn_id IS NULL AND (campaign_id = ? OR campaign_id IS NULL)`,
        );
        for (const spendId of validSpendIds) {
          const linkResult = linkSpendStmt.run(assistantTurnId, campaignId, spendId, campaignId);
          if (Number(linkResult.changes) !== 1) {
            throw new RangeError(`Unable to link spend entry: ${spendId}`);
          }
        }
      }

      this.#bumpChangeSeq();

      const insertedTurns = this.#db.prepare(
        'SELECT * FROM turns WHERE id IN (?, ?) ORDER BY seq ASC',
      ).all(userTurnId, assistantTurnId);
      const beatsByTurnId = this.#loadBeatsForTurnIds([userTurnId, assistantTurnId]);
      return {
        userTurn: this.#mapTurn(insertedTurns[0], beatsByTurnId.get(userTurnId)),
        assistantTurn: this.#mapTurn(insertedTurns[1], beatsByTurnId.get(assistantTurnId)),
      };
    });
  }

  /**
   * @param {string} campaignId
   * @param {string} beatId
   * @param {string} newText
   * @returns {object | null}
   * @throws {Error}
   */
  updateBeatText(campaignId, beatId, newText) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    this.#validateNonEmptyString(beatId, 'beatId');
    if (typeof newText !== 'string') {
      throw new TypeError('newText must be a string.');
    }
    return this.#runTransaction(() => {
      const beatRow = this.#db.prepare(
        `SELECT beats.id, beats.turn_id
         FROM beats
         JOIN turns ON turns.id = beats.turn_id
         WHERE beats.id = ? AND turns.campaign_id = ?`,
      ).get(beatId, campaignId);
      if (beatRow === undefined) {
        return null;
      }
      this.#db.prepare('UPDATE beats SET text = ? WHERE id = ?').run(newText, beatId);

      const orderedBeats = this.#db.prepare(
        'SELECT text FROM beats WHERE turn_id = ? ORDER BY seq ASC',
      ).all(beatRow.turn_id);
      const recomputedRawText = orderedBeats.map((entry) => entry.text).join('\n\n');
      this.#db.prepare(
        'UPDATE turns SET raw_text = ? WHERE id = ? AND campaign_id = ?',
      ).run(recomputedRawText, beatRow.turn_id, campaignId);

      this.#bumpChangeSeq();
      const updatedTurnRow = this.#db.prepare(
        'SELECT * FROM turns WHERE campaign_id = ? AND id = ?',
      ).get(campaignId, beatRow.turn_id);
      const beatsByTurnId = this.#loadBeatsForTurnIds([beatRow.turn_id]);
      return this.#mapTurn(updatedTurnRow, beatsByTurnId.get(beatRow.turn_id));
    });
  }

  /**
   * @param {string} campaignId
   * @returns {{deletedTurnId: string, deletedSeq: number, restoredSceneState: object} | null}
   * @throws {Error}
   */
  deleteLastAssistantTurn(campaignId) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    return this.#runTransaction(() => {
      const rows = this.#db.prepare(
        'SELECT * FROM turns WHERE campaign_id = ? ORDER BY seq DESC LIMIT 2',
      ).all(campaignId);
      if (rows.length === 0) {
        return null;
      }
      const latestRow = rows[0];
      if (latestRow.role !== TurnRole.Assistant) {
        throw new Error('Latest turn is not an assistant turn.');
      }
      const previousRow = rows[1];
      const restoreStateJson = latestRow.scene_state_before_json !== null
        ? latestRow.scene_state_before_json
        : previousRow !== undefined
          ? previousRow.scene_state_before_json
          : null;
      if (restoreStateJson === null) {
        throw new Error('Cannot restore scene state: scene_state_before_json is missing.');
      }

      const now = new Date().toISOString();
      this.#db.prepare('DELETE FROM turns WHERE id = ?').run(latestRow.id);
      this.#db.prepare(
        `UPDATE scribe_books
         SET last_turn_seq = MIN(
           last_turn_seq,
           COALESCE((SELECT MAX(seq) FROM turns WHERE campaign_id = ?), 0)
         ),
         updated_at = ?
         WHERE campaign_id = ?`,
      ).run(campaignId, now, campaignId);
      this.#db.prepare(
        'UPDATE campaigns SET scene_state_json = ?, updated_at = ? WHERE id = ?',
      ).run(restoreStateJson, now, campaignId);
      this.#bumpChangeSeq();
      return {
        deletedTurnId: latestRow.id,
        deletedSeq: Number(latestRow.seq),
        restoredSceneState: JSON.parse(restoreStateJson),
      };
    });
  }

  /**
   * @param {string} campaignId
   * @returns {{deletedUserTurnId: string, deletedAssistantTurnId: string, deletedSeqs: [number, number], restoredSceneState: object} | null}
   * @throws {Error}
   */
  deleteLastTurnPair(campaignId) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    return this.#runTransaction(() => {
      const rows = this.#db.prepare(
        'SELECT * FROM turns WHERE campaign_id = ? ORDER BY seq DESC LIMIT 2',
      ).all(campaignId);
      if (rows.length === 0) {
        return null;
      }
      if (rows.length < 2 || rows[0].role !== TurnRole.Assistant || rows[1].role !== TurnRole.User) {
        throw new Error('Latest turns do not form a complete user and assistant pair.');
      }
      const assistantRow = rows[0];
      const userRow = rows[1];
      const restoreStateJson = userRow.scene_state_before_json !== null
        ? userRow.scene_state_before_json
        : assistantRow.scene_state_before_json;
      if (restoreStateJson === null) {
        throw new Error('Cannot restore scene state: scene_state_before_json is missing.');
      }

      const now = new Date().toISOString();
      this.#db.prepare('DELETE FROM turns WHERE id IN (?, ?)').run(assistantRow.id, userRow.id);
      this.#db.prepare(
        `UPDATE scribe_books
         SET last_turn_seq = MIN(
           last_turn_seq,
           COALESCE((SELECT MAX(seq) FROM turns WHERE campaign_id = ?), 0)
         ),
         updated_at = ?
         WHERE campaign_id = ?`,
      ).run(campaignId, now, campaignId);
      this.#db.prepare(
        'UPDATE campaigns SET scene_state_json = ?, updated_at = ? WHERE id = ?',
      ).run(restoreStateJson, now, campaignId);
      this.#bumpChangeSeq();
      return {
        deletedUserTurnId: userRow.id,
        deletedAssistantTurnId: assistantRow.id,
        deletedSeqs: [Number(userRow.seq), Number(assistantRow.seq)],
        restoredSceneState: JSON.parse(restoreStateJson),
      };
    });
  }

  /**
   * @param {string} campaignId
   * @returns {{campaignId: string, bookJson: string, lastTurnSeq: number, dirty: boolean, updatedAt: string} | null}
   * @throws {RangeError}
   */
  getScribeBook(campaignId) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    const row = this.#db.prepare(
      'SELECT * FROM scribe_books WHERE campaign_id = ?',
    ).get(campaignId);
    if (row === undefined) {
      return null;
    }
    return {
      campaignId: row.campaign_id,
      bookJson: row.book_json,
      lastTurnSeq: Number(row.last_turn_seq),
      dirty: row.dirty === 1,
      updatedAt: row.updated_at,
    };
  }

  /**
   * @param {string} campaignId
   * @param {{bookJson: string, lastTurnSeq: number, dirty?: boolean}} payload
   * @returns {{campaignId: string, bookJson: string, lastTurnSeq: number, dirty: boolean, updatedAt: string}}
   * @throws {Error}
   */
  saveScribeBook(campaignId, { bookJson, lastTurnSeq, dirty = false }) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    if (typeof bookJson !== 'string') {
      throw new TypeError('bookJson must be a JSON string.');
    }
    const parsedBook = JSON.parse(bookJson);
    if (parsedBook === null || typeof parsedBook !== 'object' || Array.isArray(parsedBook)) {
      throw new TypeError('bookJson must serialize a JSON object.');
    }
    this.#validateNonNegativeInt(lastTurnSeq, 'lastTurnSeq');
    if (typeof dirty !== 'boolean') {
      throw new TypeError('dirty must be a boolean.');
    }

    const now = new Date().toISOString();
    return this.#runTransaction(() => {
      this.#db.prepare(
        `INSERT INTO scribe_books (campaign_id, book_json, last_turn_seq, dirty, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(campaign_id) DO UPDATE SET
           book_json = excluded.book_json,
           last_turn_seq = excluded.last_turn_seq,
           dirty = excluded.dirty,
           updated_at = excluded.updated_at`,
      ).run(campaignId, bookJson, lastTurnSeq, dirty ? 1 : 0, now);
      this.#bumpChangeSeq();
      return {
        campaignId,
        bookJson,
        lastTurnSeq,
        dirty,
        updatedAt: now,
      };
    });
  }

  /**
   * @param {string} campaignId
   * @returns {boolean}
   * @throws {RangeError}
   */
  markScribeDirty(campaignId) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    const now = new Date().toISOString();
    return this.#runTransaction(() => {
      const result = this.#db.prepare(
        'UPDATE scribe_books SET dirty = 1, updated_at = ? WHERE campaign_id = ?',
      ).run(now, campaignId);
      if (Number(result.changes) > 0) {
        this.#bumpChangeSeq();
        return true;
      }
      return false;
    });
  }

  /**
   * @param {string} campaignId
   * @param {{status?: string | null, limit?: number, after?: string | null}} options
   * @returns {{items: Array<object>, total: number, nextCursor: string | null}}
   * @throws {RangeError}
   */
  listFindings(campaignId, { status = null, limit = 25, after = null } = {}) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    if (status !== null) {
      FindingStatus.label(status);
    }
    const validLimit = this.#validateLimit(limit);

    const statusClause = status === null ? '' : ' AND status = ?';
    const baseParams = status === null ? [campaignId] : [campaignId, status];
    const totalRow = this.#db.prepare(
      `SELECT COUNT(*) AS total FROM findings WHERE campaign_id = ?${statusClause}`,
    ).get(...baseParams);

    let rows;
    if (after !== null) {
      const cursor = this.#decodeCursor(after, ['createdAt', 'id']);
      rows = this.#db.prepare(
        `SELECT * FROM findings
         WHERE campaign_id = ?${statusClause}
           AND (created_at < ? OR (created_at = ? AND id < ?))
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      ).all(...baseParams, cursor.createdAt, cursor.createdAt, cursor.id, validLimit + 1);
    } else {
      rows = this.#db.prepare(
        `SELECT * FROM findings
         WHERE campaign_id = ?${statusClause}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      ).all(...baseParams, validLimit + 1);
    }

    const hasMore = rows.length > validLimit;
    const pageRows = hasMore ? rows.slice(0, validLimit) : rows;
    const items = pageRows.map((row) => this.#mapFinding(row));
    const nextCursor = hasMore
      ? this.#encodeCursor({
          createdAt: items[items.length - 1].createdAt,
          id: items[items.length - 1].id,
        })
      : null;
    return { items, total: Number(totalRow.total), nextCursor };
  }

  /**
   * @param {string} campaignId
   * @param {string} turnId
   * @param {Array<Record<string, unknown>>} items
   * @returns {Array<object>}
   * @throws {Error}
   */
  insertFindings(campaignId, turnId, items) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    this.#validateNonEmptyString(turnId, 'turnId');
    if (!Array.isArray(items)) {
      throw new TypeError('Findings items must be an array.');
    }
    if (items.length === 0) {
      return [];
    }

    const validatedItems = items.map((item) => {
      if (item === null || typeof item !== 'object') {
        throw new TypeError('Each finding must be an object.');
      }
      FindingKind.label(item.kind);
      const status = item.status === undefined ? FindingStatus.Open : item.status;
      FindingStatus.label(status);
      this.#validateNonEmptyString(item.summary, 'summary');
      const subjectId = item.subjectId === undefined ? null : item.subjectId;
      if (subjectId !== null && typeof subjectId !== 'string') {
        throw new TypeError('subjectId must be a string or null.');
      }
      const subjectName = item.subjectName === undefined ? '' : item.subjectName;
      if (typeof subjectName !== 'string') {
        throw new TypeError('subjectName must be a string.');
      }
      const speakerCharacterId = item.speakerCharacterId === undefined ? null : item.speakerCharacterId;
      if (speakerCharacterId !== null) {
        this.#validateNonEmptyString(speakerCharacterId, 'speakerCharacterId');
      }
      const factId = item.factId === undefined ? null : item.factId;
      if (factId !== null && typeof factId !== 'string') {
        throw new TypeError('factId must be a string or null.');
      }
      const category = item.category === undefined ? null : item.category;
      if (category !== null && typeof category !== 'string') {
        throw new TypeError('category must be a string or null.');
      }
      const bookText = item.bookText === undefined ? '' : item.bookText;
      if (typeof bookText !== 'string') {
        throw new TypeError('bookText must be a string.');
      }
      const quote = item.quote === undefined ? '' : item.quote;
      if (typeof quote !== 'string') {
        throw new TypeError('quote must be a string.');
      }
      return {
        id: randomUUID(),
        kind: item.kind,
        subjectId,
        subjectName,
        speakerCharacterId,
        factId,
        category,
        bookText,
        summary: item.summary.trim(),
        quote,
        status,
      };
    });

    const now = new Date().toISOString();
    return this.#runTransaction(() => {
      const turnRow = this.#db.prepare(
        'SELECT id FROM turns WHERE id = ? AND campaign_id = ?',
      ).get(turnId, campaignId);
      if (turnRow === undefined) {
        throw new RangeError(`Turn does not belong to campaign: ${turnId}`);
      }
      const checkSpeakerStmt = this.#db.prepare(
        'SELECT id FROM characters WHERE id = ? AND campaign_id = ?',
      );
      const insertStmt = this.#db.prepare(
        `INSERT INTO findings (
          id, campaign_id, turn_id, kind, subject_id, subject_name,
          speaker_character_id, fact_id, category, book_text, summary,
          quote, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const inserted = [];
      for (const item of validatedItems) {
        if (item.speakerCharacterId !== null) {
          const speakerRow = checkSpeakerStmt.get(item.speakerCharacterId, campaignId);
          if (speakerRow === undefined) {
            throw new RangeError(`Speaker character does not belong to campaign: ${item.speakerCharacterId}`);
          }
        }
        insertStmt.run(
          item.id,
          campaignId,
          turnId,
          item.kind,
          item.subjectId,
          item.subjectName,
          item.speakerCharacterId,
          item.factId,
          item.category,
          item.bookText,
          item.summary,
          item.quote,
          item.status,
          now,
        );
        const row = this.#db.prepare('SELECT * FROM findings WHERE id = ?').get(item.id);
        inserted.push(this.#mapFinding(row));
      }
      this.#bumpChangeSeq();
      return inserted;
    });
  }

  /**
   * @param {string} campaignId
   * @param {string} findingId
   * @param {string} status
   * @returns {object | null}
   * @throws {RangeError}
   */
  resolveFinding(campaignId, findingId, status) {
    this.#validateNonEmptyString(campaignId, 'campaignId');
    this.#validateNonEmptyString(findingId, 'findingId');
    FindingStatus.label(status);
    return this.#runTransaction(() => {
      const result = this.#db.prepare(
        'UPDATE findings SET status = ? WHERE campaign_id = ? AND id = ?',
      ).run(status, campaignId, findingId);
      if (Number(result.changes) === 0) {
        return null;
      }
      this.#bumpChangeSeq();
      const updatedRow = this.#db.prepare(
        'SELECT * FROM findings WHERE campaign_id = ? AND id = ?',
      ).get(campaignId, findingId);
      return this.#mapFinding(updatedRow);
    });
  }

  /**
   * @param {{campaignId?: string | null, turnId?: string | null, stage: string, model: string, promptTokens?: number, completionTokens?: number, costUsd?: number | null, createdAt?: string}} dto
   * @returns {{id: string, campaignId: string | null, turnId: string | null, stage: string, model: string, promptTokens: number, completionTokens: number, costUsd: number | null, createdAt: string}}
   * @throws {Error}
   */
  recordSpend(dto) {
    if (dto === null || typeof dto !== 'object' || Array.isArray(dto)) {
      throw new TypeError('Spend payload must be an object.');
    }
    const campaignId = dto.campaignId === undefined ? null : dto.campaignId;
    if (campaignId !== null) {
      this.#validateNonEmptyString(campaignId, 'campaignId');
    }
    const turnId = dto.turnId === undefined ? null : dto.turnId;
    if (turnId !== null) {
      this.#validateNonEmptyString(turnId, 'turnId');
    }
    SpendStage.label(dto.stage);
    this.#validateNonEmptyString(dto.model, 'model');
    const model = dto.model.trim();
    const promptTokens = dto.promptTokens === undefined ? 0 : dto.promptTokens;
    this.#validateNonNegativeInt(promptTokens, 'promptTokens');
    const completionTokens = dto.completionTokens === undefined ? 0 : dto.completionTokens;
    this.#validateNonNegativeInt(completionTokens, 'completionTokens');

    const costUsd = dto.costUsd === undefined ? null : dto.costUsd;
    if (costUsd !== null && (typeof costUsd !== 'number' || !Number.isFinite(costUsd) || costUsd < 0)) {
      throw new RangeError('costUsd must be null or a non-negative finite number.');
    }

    let createdAt = new Date().toISOString();
    if (dto.createdAt !== undefined) {
      if (typeof dto.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(dto.createdAt)) {
        throw new RangeError(`createdAt must be an ISO-8601 UTC timestamp: ${String(dto.createdAt)}`);
      }
      const parsedTimestamp = new Date(dto.createdAt);
      if (Number.isNaN(parsedTimestamp.getTime()) || parsedTimestamp.toISOString().slice(0, 19) !== dto.createdAt.slice(0, 19)) {
        throw new RangeError(`Invalid calendar timestamp for createdAt: ${dto.createdAt}`);
      }
      createdAt = parsedTimestamp.toISOString();
    }

    const spendId = randomUUID();
    return this.#runTransaction(() => {
      if (turnId !== null) {
        const turnRow = this.#db.prepare('SELECT campaign_id FROM turns WHERE id = ?').get(turnId);
        if (turnRow === undefined) {
          throw new RangeError(`Turn not found: ${turnId}`);
        }
        if (campaignId !== null && turnRow.campaign_id !== campaignId) {
          throw new RangeError(`Turn does not belong to campaign: ${turnId}`);
        }
      }
      this.#db.prepare(
        `INSERT INTO spend_log (
          id, campaign_id, turn_id, stage, model, prompt_tokens,
          completion_tokens, cost_usd, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        spendId,
        campaignId,
        turnId,
        dto.stage,
        model,
        promptTokens,
        completionTokens,
        costUsd,
        createdAt,
      );
      this.#bumpChangeSeq();
      return {
        id: spendId,
        campaignId,
        turnId,
        stage: dto.stage,
        model,
        promptTokens,
        completionTokens,
        costUsd,
        createdAt,
      };
    });
  }

  /**
   * @param {string} utcDateString
   * @returns {{totalUsd: number, unpricedCount: number, callCount: number}}
   * @throws {RangeError}
   */
  getDailySpend(utcDateString) {
    if (typeof utcDateString !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(utcDateString)) {
      throw new RangeError(`utcDateString must be YYYY-MM-DD: ${String(utcDateString)}`);
    }
    const [yearPart, monthPart, dayPart] = utcDateString.split('-').map((segment) => Number.parseInt(segment, 10));
    const dayStart = new Date(Date.UTC(yearPart, monthPart - 1, dayPart));
    if (
      dayStart.getUTCFullYear() !== yearPart ||
      dayStart.getUTCMonth() !== monthPart - 1 ||
      dayStart.getUTCDate() !== dayPart
    ) {
      throw new RangeError(`Invalid UTC calendar date: ${utcDateString}`);
    }

    const row = this.#db.prepare(
      `SELECT
         COALESCE(SUM(cost_usd), 0) AS total_usd,
         COALESCE(SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS unpriced_count,
         COUNT(*) AS call_count
       FROM spend_log
       WHERE created_at >= ? AND created_at <= ?`,
    ).get(`${utcDateString}T00:00:00`, `${utcDateString}T23:59:59Z`);

    return {
      totalUsd: Number(row.total_usd),
      unpricedCount: Number(row.unpriced_count),
      callCount: Number(row.call_count),
    };
  }

  /**
   * @template ResultType
   * @param {() => ResultType} operation
   * @returns {ResultType}
   * @throws {Error}
   */
  #runTransaction(operation) {
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.#db.exec('COMMIT');
      return result;
    } catch (error) {
      this.#db.exec('ROLLBACK');
      throw error;
    }
  }

  /**
   * @returns {void}
   */
  #bumpChangeSeq() {
    this.#db.prepare(
      'UPDATE sync_meta SET local_change_seq = local_change_seq + 1 WHERE id = 1',
    ).run();
  }

  /**
   * @param {unknown} value
   * @param {string} fieldName
   * @returns {void}
   * @throws {RangeError}
   */
  #validateNonEmptyString(value, fieldName) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new RangeError(`${fieldName} must be a non-empty string.`);
    }
  }

  /**
   * @param {unknown} value
   * @param {string} fieldName
   * @returns {void}
   * @throws {RangeError}
   */
  #validateNonNegativeInt(value, fieldName) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`${fieldName} must be a non-negative integer.`);
    }
  }

  /**
   * @param {unknown} slug
   * @returns {void}
   * @throws {RangeError}
   */
  #validateSlug(slug) {
    if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(slug)) {
      throw new RangeError(`Invalid character slug: ${String(slug)}`);
    }
  }

  /**
   * @param {unknown} value
   * @param {string} fieldName
   * @returns {Array<string>}
   * @throws {TypeError}
   */
  #validateStringArray(value, fieldName) {
    if (!Array.isArray(value)) {
      throw new TypeError(`${fieldName} must be an array of strings.`);
    }
    const result = [];
    for (const entry of value) {
      if (typeof entry !== 'string') {
        throw new TypeError(`${fieldName} must contain only strings.`);
      }
      result.push(entry);
    }
    return result;
  }

  /**
   * @param {unknown} limit
   * @returns {number}
   * @throws {RangeError}
   */
  #validateLimit(limit) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new RangeError(`limit must be an integer between 1 and 50: ${String(limit)}`);
    }
    return limit;
  }

  /**
   * @param {Record<string, string>} payload
   * @returns {string}
   */
  #encodeCursor(payload) {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  /**
   * @param {string} cursor
   * @param {Array<string>} requiredKeys
   * @returns {Record<string, string>}
   * @throws {RangeError}
   */
  #decodeCursor(cursor, requiredKeys) {
    if (typeof cursor !== 'string' || cursor.length === 0) {
      throw new RangeError('Cursor must be a non-empty string.');
    }
    let decoded;
    try {
      decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    } catch {
      throw new RangeError('Invalid pagination cursor.');
    }
    if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new RangeError('Invalid pagination cursor.');
    }
    for (const requiredKey of requiredKeys) {
      if (typeof decoded[requiredKey] !== 'string') {
        throw new RangeError(`Invalid pagination cursor field: ${requiredKey}`);
      }
    }
    return decoded;
  }

  /**
   * @param {unknown} input
   * @param {Record<string, unknown> | null} baseState
   * @returns {{sceneNumber: number, day: number, timeLabel: string, location: string, sceneType: string, presentIds: Array<string>, remoteIds: Array<string>, offscreenNotes: Record<string, string>, activeWalkOns: Array<string>}}
   * @throws {Error}
   */
  #normalizeSceneState(input, baseState) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      throw new TypeError('sceneState must be a plain object.');
    }
    const merged = baseState === null ? input : { ...baseState, ...input };
    if (!Number.isInteger(merged.sceneNumber) || merged.sceneNumber < 1) {
      throw new RangeError('sceneState.sceneNumber must be a positive integer.');
    }
    if (!Number.isInteger(merged.day) || merged.day < 1) {
      throw new RangeError('sceneState.day must be a positive integer.');
    }
    if (typeof merged.timeLabel !== 'string') {
      throw new TypeError('sceneState.timeLabel must be a string.');
    }
    if (typeof merged.location !== 'string') {
      throw new TypeError('sceneState.location must be a string.');
    }
    SceneType.label(merged.sceneType);

    const presentIds = this.#validateStringArray(merged.presentIds, 'sceneState.presentIds');
    const remoteIds = this.#validateStringArray(merged.remoteIds, 'sceneState.remoteIds');
    const activeWalkOns = this.#validateStringArray(merged.activeWalkOns, 'sceneState.activeWalkOns');

    const checkedLists = [
      ['sceneState.presentIds', presentIds],
      ['sceneState.remoteIds', remoteIds],
      ['sceneState.activeWalkOns', activeWalkOns],
    ];
    for (const [listName, listValues] of checkedLists) {
      const seenValues = new Set();
      for (const listItem of listValues) {
        if (listItem.trim().length === 0) {
          throw new RangeError(`${listName} must contain non-empty strings.`);
        }
        if (seenValues.has(listItem)) {
          throw new RangeError(`${listName} must not contain duplicate entry: ${listItem}`);
        }
        seenValues.add(listItem);
      }
    }

    const presentSet = new Set(presentIds);
    for (const remoteId of remoteIds) {
      if (presentSet.has(remoteId)) {
        throw new RangeError(`Character cannot be both present and remote: ${remoteId}`);
      }
    }

    if (merged.offscreenNotes === null || typeof merged.offscreenNotes !== 'object' || Array.isArray(merged.offscreenNotes)) {
      throw new TypeError('sceneState.offscreenNotes must be a plain object.');
    }
    const offscreenNotes = {};
    for (const [noteKey, noteValue] of Object.entries(merged.offscreenNotes)) {
      if (typeof noteValue !== 'string') {
        throw new TypeError(`sceneState.offscreenNotes.${noteKey} must be a string.`);
      }
      offscreenNotes[noteKey] = noteValue;
    }

    return {
      sceneNumber: merged.sceneNumber,
      day: merged.day,
      timeLabel: merged.timeLabel,
      location: merged.location,
      sceneType: merged.sceneType,
      presentIds,
      remoteIds,
      offscreenNotes,
      activeWalkOns,
    };
  }

  /**
   * @param {Array<string>} turnIds
   * @returns {Map<string, Array<object>>}
   */
  #loadBeatsForTurnIds(turnIds) {
    const beatsByTurnId = new Map();
    if (turnIds.length === 0) {
      return beatsByTurnId;
    }
    for (const turnId of turnIds) {
      beatsByTurnId.set(turnId, []);
    }
    const placeholders = turnIds.map(() => '?').join(', ');
    const rows = this.#db.prepare(
      `SELECT * FROM beats WHERE turn_id IN (${placeholders}) ORDER BY turn_id ASC, seq ASC`,
    ).all(...turnIds);
    for (const row of rows) {
      const mappedBeat = {
        id: row.id,
        turnId: row.turn_id,
        seq: Number(row.seq),
        speakerType: row.speaker_type,
        characterId: row.character_id,
        speakerName: row.speaker_name,
        text: row.text,
        witnessIds: JSON.parse(row.witness_ids_json),
        mindPacket: row.mind_packet_json === null ? null : JSON.parse(row.mind_packet_json),
      };
      beatsByTurnId.get(row.turn_id).push(mappedBeat);
    }
    return beatsByTurnId;
  }

  /**
   * @param {Record<string, unknown>} row
   * @returns {object}
   */
  #mapCampaign(row) {
    return {
      id: row.id,
      title: row.title,
      premise: row.premise,
      styleNotes: row.style_notes,
      playerCharacterId: row.player_character_id,
      sceneState: JSON.parse(row.scene_state_json),
      encounterPublicOdds: Number(row.encounter_public_odds),
      encounterPrivateOdds: Number(row.encounter_private_odds),
      scribeInterval: Number(row.scribe_interval),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * @param {Record<string, unknown>} row
   * @returns {object}
   */
  #mapCharacter(row) {
    return {
      id: row.id,
      campaignId: row.campaign_id,
      slug: row.slug,
      scribeSubjectId: row.scribe_subject_id,
      name: row.name,
      aliases: JSON.parse(row.aliases_json),
      isPlayer: row.is_player === 1,
      tier: row.tier,
      modelOverride: row.model_override,
      persona: row.persona,
      voiceNotes: row.voice_notes,
      avatarToken: row.avatar_token,
      avatarInitials: row.avatar_initials,
      archived: row.archived === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * @param {Record<string, unknown>} row
   * @param {Array<object>} beats
   * @returns {object}
   */
  #mapTurn(row, beats) {
    return {
      id: row.id,
      campaignId: row.campaign_id,
      seq: Number(row.seq),
      role: row.role,
      mode: row.mode,
      rawText: row.raw_text,
      oocNudge: row.ooc_nudge,
      sceneNumber: Number(row.scene_number),
      witnessIds: JSON.parse(row.witness_ids_json),
      sceneStateBefore: row.scene_state_before_json === null ? null : JSON.parse(row.scene_state_before_json),
      sceneStateAfter: row.scene_state_after_json === null ? null : JSON.parse(row.scene_state_after_json),
      directorPlan: row.director_plan_json === null ? null : JSON.parse(row.director_plan_json),
      truncated: row.truncated === 1,
      createdAt: row.created_at,
      beats,
    };
  }

  /**
   * @param {Record<string, unknown>} row
   * @returns {object}
   */
  #mapFinding(row) {
    return {
      id: row.id,
      campaignId: row.campaign_id,
      turnId: row.turn_id,
      kind: row.kind,
      subjectId: row.subject_id,
      subjectName: row.subject_name,
      speakerCharacterId: row.speaker_character_id,
      factId: row.fact_id,
      category: row.category,
      bookText: row.book_text,
      summary: row.summary,
      quote: row.quote,
      status: row.status,
      createdAt: row.created_at,
    };
  }
}
