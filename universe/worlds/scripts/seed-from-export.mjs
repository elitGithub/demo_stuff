import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorldsConfig } from '../src/config.mjs';
import { ScribeAnswer } from '../src/scribe/ScribeAnswer.mjs';
import { ScribeCategory } from '../src/scribe/ScribeCategory.mjs';
import { ScribeKnowledge } from '../src/scribe/ScribeKnowledge.mjs';
import { ScribeLogCore } from '../src/scribe/ScribeLogCore.mjs';
import { ScribeReplay } from '../src/scribe/ScribeReplay.mjs';
import { ScribeText } from '../src/scribe/ScribeText.mjs';
import { SqliteStore } from '../src/store/SqliteStore.mjs';
import { AvatarToken } from '../src/store/enums/AvatarToken.mjs';
import { CharacterTier } from '../src/store/enums/CharacterTier.mjs';
import { SceneType } from '../src/store/enums/SceneType.mjs';

const DEFAULT_EXPORT_PATH = '/var/www/demo_stuff/zeta-dm-memory/scribe/private/hero_gone_latest.json';
const DEFAULT_ALLOWED_ROOT = '/var/www';
const DEFAULT_TITLE = 'Seeded Campaign';
const DEFAULT_LOCATION = 'Opening Scene';
const DEFAULT_TIME_LABEL = 'Daytime';
const FIRST_DAY = 1;
const MAX_TITLE_LENGTH = 120;
const MAX_BASE_SLUG_LENGTH = 42;
const MAX_SLUG_LENGTH = 48;
const TOP_MENTIONED_MAIN_COUNT = 3;
const PERSONA_FACT_COUNT = 4;
const BLOCKING_DAMAGE = Object.freeze(['book', 'campaign']);
const VALUE_FLAGS = Object.freeze(['--title', '--db', '--main', '--player']);
const HELP_FLAGS = Object.freeze(['--help', '-h']);
const KNOWN_FLAGS = Object.freeze([...VALUE_FLAGS, '--dry-run', '--force', ...HELP_FLAGS]);
const TRAILING_HIGH_SURROGATE = /[\uD800-\uDBFF]$/;
const SUBJECT_ID_PATTERN = /^S(\d+)$/;
const USAGE = 'Usage: node scripts/seed-from-export.mjs [exportPath] [--title <title>] [--db <sqlitePath>] '
  + '[--main <slugNameAliasOrSubjectId,...>] [--player <slugNameAliasOrSubjectId>] [--dry-run] [--force]\n';
const AVATAR_TOKENS = Object.freeze([
  AvatarToken.Sage,
  AvatarToken.Rose,
  AvatarToken.Amber,
  AvatarToken.Slate,
  AvatarToken.Plum,
  AvatarToken.Teal,
  AvatarToken.Indigo,
  AvatarToken.Coral,
]);

export class ZetaSeeder {
  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  static isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  /**
   * @param {unknown} value
   * @returns {boolean}
   */
  static isText(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  /**
   * @param {string} text
   * @param {number} limit
   * @returns {string}
   */
  static clampText(text, limit) {
    return text.trim().slice(0, limit).replace(TRAILING_HIGH_SURROGATE, '').trim();
  }

  /**
   * @param {string[]} argv
   * @returns {{exportPath: string, dbPath: string | null, title: string | null, dryRun: boolean, force: boolean, mainRefs: string[], playerRef: string | null, help: boolean}}
   * @throws {Error}
   */
  static parseCliArgs(argv) {
    if (!Array.isArray(argv)) {
      throw new TypeError('argv must be an array.');
    }
    for (const item of argv) {
      if (typeof item !== 'string') {
        throw new TypeError('All argv elements must be strings.');
      }
    }
    let positionalPath = null;
    let dbPath = null;
    let title = null;
    let dryRun = false;
    let force = false;
    let help = false;
    let playerRef = null;
    let mainRefs = [];
    const seenFlags = new Set();

    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index];
      if (KNOWN_FLAGS.includes(arg)) {
        const flagName = HELP_FLAGS.includes(arg) ? HELP_FLAGS[0] : arg;
        if (seenFlags.has(flagName)) {
          throw new Error(`Flag ${flagName} was given more than once.`);
        }
        seenFlags.add(flagName);
      }
      if (HELP_FLAGS.includes(arg)) {
        help = true;
      } else if (arg === '--dry-run') {
        dryRun = true;
      } else if (arg === '--force') {
        force = true;
      } else if (VALUE_FLAGS.includes(arg)) {
        const nextValue = argv[index + 1];
        if (typeof nextValue !== 'string' || nextValue.trim().length === 0 || KNOWN_FLAGS.includes(nextValue.trim())) {
          throw new Error(`Flag ${arg} requires a non-empty value.`);
        }
        index += 1;
        const value = nextValue.trim();
        if (arg === '--title') {
          title = value;
        } else if (arg === '--db') {
          dbPath = value;
        } else if (arg === '--player') {
          playerRef = value;
        } else {
          mainRefs = value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
          if (mainRefs.length === 0) {
            throw new Error('Flag --main requires at least one non-empty reference.');
          }
        }
      } else if (arg.startsWith('-')) {
        throw new Error(`Unknown CLI flag: ${arg}`);
      } else if (positionalPath === null) {
        positionalPath = arg;
      } else {
        throw new Error(`Unexpected extra positional argument: ${arg}`);
      }
    }

    return {
      exportPath: positionalPath ?? DEFAULT_EXPORT_PATH,
      dbPath,
      title,
      dryRun,
      force,
      mainRefs,
      playerRef,
      help,
    };
  }

  /**
   * @param {string} rawPath
   * @param {string[]} allowedRoots
   * @returns {string}
   * @throws {Error}
   */
  static resolveSafeExportPath(rawPath, allowedRoots = [DEFAULT_ALLOWED_ROOT]) {
    if (typeof rawPath !== 'string' || rawPath.trim().length === 0 || rawPath.includes('\0')) {
      throw new Error('Export file path must be a non-empty valid filesystem path.');
    }
    if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
      throw new Error('allowedRoots must contain at least one directory.');
    }
    const candidatePath = path.resolve(rawPath.trim());
    let realCandidate;
    try {
      realCandidate = fs.realpathSync(candidatePath);
    } catch (error) {
      throw new Error(`Cannot read export file at "${candidatePath}": ${error.message}`, { cause: error });
    }
    const candidateStats = fs.statSync(realCandidate);
    if (!candidateStats.isFile()) {
      throw new Error(`Export path is not a regular file: "${realCandidate}".`);
    }
    for (const root of allowedRoots) {
      let realRoot;
      try {
        realRoot = fs.realpathSync(path.resolve(root));
      } catch (error) {
        throw new Error(`Cannot resolve allowed root "${root}": ${error.message}`, { cause: error });
      }
      if (realCandidate === realRoot || realCandidate.startsWith(`${realRoot}${path.sep}`)) {
        return realCandidate;
      }
    }
    throw new Error(`Security check failed: export path "${realCandidate}" resolves outside allowed root directories.`);
  }

  /**
   * @param {object[]} characters
   * @param {string} ref
   * @param {string} role
   * @returns {object}
   * @throws {Error}
   */
  static matchCharacter(characters, ref, role) {
    const loweredRef = ref.toLowerCase();
    const normalizedRef = ScribeText.normaliseName(ref);
    if (normalizedRef.length === 0) {
      throw new Error(`${role} "${ref}" normalizes to an empty name.`);
    }
    const matchers = [
      /**
       * @param {object} character
       * @returns {boolean}
       */
      (character) => character.slug === loweredRef,
      /**
       * @param {object} character
       * @returns {boolean}
       */
      (character) => ScribeText.normaliseName(character.name) === normalizedRef,
      /**
       * @param {object} character
       * @returns {boolean}
       */
      (character) => character.aliases.some((alias) => ScribeText.normaliseName(alias) === normalizedRef),
      /**
       * @param {object} character
       * @returns {boolean}
       */
      (character) => character.subjectId.toLowerCase() === loweredRef,
    ];
    for (const matcher of matchers) {
      const matches = characters.filter(matcher);
      if (matches.length > 1) {
        const candidateList = matches.map((match) => `${match.name} (${match.slug})`).join(', ');
        throw new Error(`${role} "${ref}" is ambiguous and matches multiple characters: ${candidateList}.`);
      }
      if (matches.length === 1) {
        return matches[0];
      }
    }
    throw new Error(`${role} "${ref}" did not match any character in the export.`);
  }

  /**
   * @param {string} rawJsonText
   * @param {{titleOverride?: string | null, mainRefs?: string[], playerRef?: string | null}} options
   * @returns {{title: string, subjects: object[], characters: object[], facts: object[], threads: object[], initialScene: object, readThrough: number, chatMessages: number}}
   * @throws {Error}
   */
  static parseExport(rawJsonText, { titleOverride = null, mainRefs = [], playerRef = null } = {}) {
    let normalizedPlayerRef = null;
    if (playerRef !== null) {
      if (typeof playerRef !== 'string') {
        throw new TypeError('playerRef must be a string or null.');
      }
      if (playerRef.trim().length === 0) {
        throw new Error('playerRef cannot be empty.');
      }
      normalizedPlayerRef = playerRef.trim();
    }
    if (!Array.isArray(mainRefs) || !mainRefs.every((ref) => typeof ref === 'string')) {
      throw new TypeError('mainRefs must be an array of strings.');
    }
    if (mainRefs.some((ref) => ref.trim().length === 0)) {
      throw new Error('mainRefs cannot contain empty references.');
    }
    let campaignTitle = DEFAULT_TITLE;
    if (titleOverride !== null) {
      if (typeof titleOverride !== 'string') {
        throw new TypeError('titleOverride must be a string or null.');
      }
      campaignTitle = ZetaSeeder.clampText(titleOverride, MAX_TITLE_LENGTH);
      if (campaignTitle.length === 0) {
        throw new Error('Campaign title cannot be empty.');
      }
    }

    if (typeof rawJsonText !== 'string' || rawJsonText.trim().length === 0) {
      throw new Error('Export file is empty.');
    }
    let parsed;
    try {
      parsed = JSON.parse(rawJsonText);
    } catch (error) {
      throw new Error(`Export file contains invalid JSON: ${error.message}`, { cause: error });
    }
    if (!ZetaSeeder.isRecord(parsed)) {
      throw new Error('Export must be the JSON object written by the Zeta Scribe export.');
    }
    if (!Array.isArray(parsed.damaged)) {
      throw new Error('Export damaged list must be an array.');
    }
    const blockingDamage = parsed.damaged.filter((kind) => BLOCKING_DAMAGE.includes(kind));
    if (blockingDamage.length > 0) {
      throw new Error(`Export bundle marks ${blockingDamage.map((kind) => JSON.stringify(kind)).join(', ')} as damaged.`);
    }
    const book = parsed.book;
    if (!ZetaSeeder.isRecord(book)) {
      throw new Error('Export book must be an object.');
    }
    const log = book.log;
    const entriesValid = ZetaSeeder.isRecord(log)
      && Array.isArray(log.entries)
      && log.entries.every(
        (entry) => ZetaSeeder.isRecord(entry)
          && Array.isArray(entry.operations)
          && entry.operations.every((operation) => ZetaSeeder.isRecord(operation)),
      );
    if (!entriesValid) {
      throw new Error('Export book.log.entries must be an array of entry objects, each with an operations array of objects.');
    }
    const messages = parsed.campaign?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Export campaign.messages must be a non-empty array.');
    }
    if (!messages.every((message) => ZetaSeeder.isRecord(message) && typeof message.id === 'string')) {
      throw new Error('Export campaign.messages entries must be objects with a string id.');
    }
    if (parsed.campaign.completeHistory !== true) {
      throw new Error('Export campaign history is incomplete (completeHistory is not true).');
    }
    if (parsed.campaign.needsHistory === true) {
      throw new Error('Export campaign still needs history (needsHistory is true).');
    }
    if (!ZetaSeeder.isRecord(log.read)) {
      throw new Error('Export book.log.read must be an object.');
    }
    let readThrough = 0;
    while (readThrough < messages.length && Object.hasOwn(log.read, messages[readThrough].id)) {
      readThrough += 1;
    }
    const messageIds = new Set(messages.map((message) => message.id));
    for (const entry of log.entries) {
      const citesMissing = !Array.isArray(entry.messageIds) || entry.messageIds.some((messageId) => !messageIds.has(messageId));
      if (!entry.withdrawn && entry.origin === ScribeLogCore.Origin.Story && citesMissing) {
        throw new Error(`Scribe log Story entry ${JSON.stringify(entry.sequence)} cites messages missing from campaign.messages.`);
      }
    }
    let state;
    try {
      state = ScribeReplay.run(log, messages);
    } catch (error) {
      throw new Error(`Scribe log could not be replayed: ${error.message}`, { cause: error });
    }

    const maxLabel = ScribeAnswer.Settings.MaxLabel;
    const survivorOf = new Map();
    for (const subject of state.subjects) {
      survivorOf.set(subject.id, subject.mergedInto ?? subject.id);
    }
    /**
     * @param {string} subjectId
     * @returns {string}
     */
    const survivor = (subjectId) => survivorOf.get(subjectId) ?? subjectId;

    const subjects = [];
    for (const subject of state.subjects) {
      if (subject.mergedInto !== null) {
        continue;
      }
      const name = typeof subject.label === 'string' ? ZetaSeeder.clampText(subject.label, maxLabel) : '';
      if (name.length === 0) {
        throw new Error(`Subject ${subject.id} has no usable label.`);
      }
      const nameForm = ScribeText.normaliseName(name);
      if (nameForm === ScribeAnswer.Settings.NarratorName) {
        continue;
      }
      const recordedNames = state.aliases.filter((record) => record.subject === subject.id).map((record) => record.name);
      const aliases = [];
      for (const alias of [...recordedNames, ...subject.aka]) {
        if (!ZetaSeeder.isText(alias)) {
          throw new Error(`Subject ${subject.id} has an alias that is not text.`);
        }
        const clampedAlias = ZetaSeeder.clampText(alias, maxLabel);
        if (!aliases.includes(clampedAlias)) {
          aliases.push(clampedAlias);
        }
      }
      subjects.push({ id: subject.id, name, kind: subject.kind, assumed: subject.assumed, aliases });
    }
    const seededSubjectIds = new Set(subjects.map((subject) => subject.id));

    const facts = [];
    const mentionCounts = new Map();
    for (const fact of state.facts) {
      const reported = fact.status === ScribeReplay.Status.Reported;
      if (!ScribeReplay.live(fact) && !reported) {
        continue;
      }
      if (fact.pinned) {
        throw new Error(`Fact ${fact.id} is pinned in the export, which the seed cannot copy.`);
      }
      if (fact.status === ScribeReplay.Status.Disputed) {
        throw new Error(`Fact ${fact.id} is disputed in the export, which the seed cannot copy.`);
      }
      if (fact.form || fact.dimension) {
        throw new Error(`Fact ${fact.id} carries a form or dimension, which the seed cannot copy.`);
      }
      if (fact.category === ScribeCategory.Settings.RelationCategory && fact.target === null) {
        throw new Error(`Relation fact ${fact.id} has no target subject, which the seed cannot copy.`);
      }
      const subjectId = survivor(fact.subject);
      const targetId = fact.target === null ? null : survivor(fact.target);
      for (const mentionedId of [subjectId, targetId]) {
        if (mentionedId !== null) {
          mentionCounts.set(mentionedId, (mentionCounts.get(mentionedId) ?? 0) + 1);
        }
      }
      const zetaAudience = ScribeKnowledge.audience(state, fact);
      let audience = null;
      if (Array.isArray(zetaAudience)) {
        audience = [];
        for (const listenerId of zetaAudience) {
          const resolvedListener = survivor(listenerId);
          if (seededSubjectIds.has(resolvedListener) && !audience.includes(resolvedListener)) {
            audience.push(resolvedListener);
          }
        }
      }
      const evidence = fact.evidence;
      const attested = ZetaSeeder.isRecord(evidence) && ZetaSeeder.isText(evidence.attribution) && ZetaSeeder.isText(evidence.speaker);
      facts.push({
        id: fact.id,
        subject: subjectId,
        category: fact.category,
        target: targetId,
        text: fact.text,
        hidden: fact.hidden,
        reported,
        audience,
        widenedToEveryone: fact.widened === ScribeLogCore.Settings.Everyone,
        evidence: attested ? { attribution: evidence.attribution, speaker: evidence.speaker } : null,
      });
    }

    const threads = [];
    for (const thread of state.threads) {
      if (thread.closed !== null) {
        continue;
      }
      if (!ZetaSeeder.isText(thread.text)) {
        throw new Error(`Open thread ${thread.id} has no text.`);
      }
      const threadSubject = typeof thread.subject === 'string' ? survivor(thread.subject) : null;
      threads.push({
        text: thread.text.trim(),
        subject: threadSubject !== null && seededSubjectIds.has(threadSubject) ? threadSubject : null,
      });
    }

    const characters = [];
    const usedSlugs = new Set();
    for (const subject of subjects) {
      if (subject.kind !== ScribeCategory.SubjectKinds.Character) {
        continue;
      }
      let baseSlug = subject.name
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '');
      if (!/^[a-z0-9]/.test(baseSlug)) {
        baseSlug = `char-${baseSlug}`.replace(/-+$/g, '');
      }
      baseSlug = baseSlug.slice(0, MAX_BASE_SLUG_LENGTH);
      let uniqueSlug = baseSlug;
      let slugSuffix = 2;
      while (usedSlugs.has(uniqueSlug)) {
        const suffixTail = `-${slugSuffix}`;
        uniqueSlug = `${baseSlug.slice(0, MAX_SLUG_LENGTH - suffixTail.length)}${suffixTail}`;
        slugSuffix += 1;
      }
      usedSlugs.add(uniqueSlug);
      const persona = facts
        .filter((fact) => {
          return fact.subject === subject.id
            && !fact.reported
            && !fact.hidden
            && fact.category !== ScribeCategory.Settings.RelationCategory;
        })
        .slice(0, PERSONA_FACT_COUNT)
        .map((fact) => `${fact.category}: ${fact.text}`)
        .join('; ');
      characters.push({
        subjectId: subject.id,
        name: subject.name,
        aliases: subject.aliases,
        slug: uniqueSlug,
        avatarToken: AVATAR_TOKENS[characters.length % AVATAR_TOKENS.length],
        persona,
        isPlayer: false,
        tier: CharacterTier.Recurring,
      });
    }

    const player = normalizedPlayerRef === null
      ? null
      : ZetaSeeder.matchCharacter(characters, normalizedPlayerRef, 'Player character');
    const mainCharacters = new Set(mainRefs.map((ref) => ZetaSeeder.matchCharacter(characters, ref.trim(), 'Main character')));
    const rankedByMentions = [...characters].sort((first, second) => {
      return (mentionCounts.get(second.subjectId) ?? 0) - (mentionCounts.get(first.subjectId) ?? 0);
    });
    for (const character of rankedByMentions.slice(0, TOP_MENTIONED_MAIN_COUNT)) {
      mainCharacters.add(character);
    }
    for (const character of characters) {
      character.isPlayer = character === player;
      character.tier = character.isPlayer || mainCharacters.has(character) ? CharacterTier.Main : CharacterTier.Recurring;
    }

    let initialScene = {
      day: FIRST_DAY,
      timeLabel: DEFAULT_TIME_LABEL,
      location: DEFAULT_LOCATION,
      sceneType: SceneType.Public,
      presentSubjectIds: [],
    };
    const lastScene = state.scenes.at(-1) ?? null;
    if (lastScene !== null) {
      const presentSubjectIds = [];
      for (const attendee of lastScene.present) {
        if (attendee.until !== null) {
          continue;
        }
        const presentId = survivor(attendee.subject);
        if (!presentSubjectIds.includes(presentId)) {
          presentSubjectIds.push(presentId);
        }
      }
      const sceneTime = lastScene.evidence?.time;
      initialScene = {
        day: Number.isSafeInteger(lastScene.day) && lastScene.day >= FIRST_DAY ? lastScene.day : FIRST_DAY,
        timeLabel: ZetaSeeder.isText(sceneTime) ? sceneTime.trim() : DEFAULT_TIME_LABEL,
        location: ZetaSeeder.isText(lastScene.place) ? lastScene.place.trim() : DEFAULT_LOCATION,
        sceneType: lastScene.reach === ScribeAnswer.Reach.Private || lastScene.narrowed === true
          ? SceneType.Private
          : SceneType.Public,
        presentSubjectIds,
      };
    }

    return {
      title: campaignTitle,
      subjects,
      characters,
      facts,
      threads,
      initialScene,
      readThrough,
      chatMessages: messages.length,
    };
  }

  /**
   * @param {{subjects: object[], facts: object[], threads: object[]}} parsedExport
   * @returns {{log: object, state: object}}
   * @throws {Error}
   */
  static materializeScribeLog(parsedExport) {
    const log = ScribeLogCore.create();
    let state = ScribeReplay.run(log, []);

    if (parsedExport.subjects.length > 0) {
      const subjectOperations = [];
      for (const subject of parsedExport.subjects) {
        subjectOperations.push({
          type: ScribeAnswer.Type.Subject,
          subject: subject.id,
          label: subject.name,
          kind: subject.assumed ? null : subject.kind,
        });
        for (const alias of subject.aliases) {
          subjectOperations.push({
            type: ScribeAnswer.Type.Alias,
            subject: subject.id,
            name: alias,
            cite: null,
            position: 0,
            other: null,
          });
        }
        const numbered = SUBJECT_ID_PATTERN.exec(subject.id);
        if (numbered !== null && Number(numbered[1]) >= log.nextSubject) {
          log.nextSubject = Number(numbered[1]) + 1;
        }
      }
      log.entries.push({
        sequence: log.nextSequence,
        kind: ScribeLogCore.Kind.Operator,
        origin: ScribeLogCore.Origin.Operator,
        messageIds: [],
        operations: subjectOperations,
        withdrawn: false,
      });
      log.nextSequence += 1;
      log.revision += 1;
      state = ScribeReplay.run(log, []);
    }

    const view = ScribeLogCore.view(state);
    const counters = { nextFact: log.nextFact };
    const factOperations = [];
    const widenedFactIds = [];
    for (const fact of parsedExport.facts) {
      const outcome = { counters, stored: null };
      const reason = ScribeLogCore.Rulers.AddFact({
        type: ScribeLogCore.Ruling.AddFact,
        subject: fact.subject,
        category: fact.category,
        target: fact.target,
        text: fact.text,
        hidden: fact.hidden,
        cite: null,
        position: ScribeLogCore.Settings.LeastPosition,
        ...(fact.evidence === null ? {} : { evidence: fact.evidence }),
        ...(fact.reported ? { reported: true } : {}),
        ...(fact.audience === null ? {} : { audience: fact.audience }),
      }, view, outcome);
      if (reason !== null) {
        throw new Error(`Seeded fact ${fact.id} ("${fact.text}") was refused: ${reason}.`);
      }
      factOperations.push(outcome.stored);
      if (fact.widenedToEveryone) {
        widenedFactIds.push(outcome.stored.fact);
      }
    }
    log.nextFact = counters.nextFact;

    if (factOperations.length > 0) {
      log.entries.push({
        sequence: log.nextSequence,
        kind: ScribeLogCore.Kind.Operator,
        origin: ScribeLogCore.Origin.Operator,
        messageIds: [],
        operations: factOperations,
        withdrawn: false,
      });
      log.nextSequence += 1;
      log.revision += 1;
      state = ScribeReplay.run(log, []);
    }

    for (const factId of widenedFactIds) {
      ScribeLogCore.rule(log, state, {
        type: ScribeLogCore.Ruling.Widen,
        fact: factId,
        to: ScribeLogCore.Settings.Everyone,
      });
      state = ScribeReplay.run(log, []);
    }

    if (parsedExport.threads.length > 0) {
      const threadOperations = [];
      for (const thread of parsedExport.threads) {
        threadOperations.push({
          type: ScribeAnswer.Type.ThreadOpen,
          thread: `${ScribeLogCore.Settings.ThreadPrefix}${log.nextThread}`,
          text: thread.text,
          cite: null,
          position: ScribeLogCore.Settings.LeastPosition,
          ...(thread.subject !== null ? { subject: thread.subject } : {}),
        });
        log.nextThread += 1;
      }
      log.entries.push({
        sequence: log.nextSequence,
        kind: ScribeLogCore.Kind.Operator,
        origin: ScribeLogCore.Origin.Operator,
        messageIds: [],
        operations: threadOperations,
        withdrawn: false,
      });
      log.nextSequence += 1;
      log.revision += 1;
      state = ScribeReplay.run(log, []);
    }

    return { log, state };
  }

  /**
   * @param {{exportPath?: string, dbPath?: string | null, title?: string | null, dryRun?: boolean, force?: boolean, mainRefs?: string[], playerRef?: string | null, allowedRoots?: string[]}} options
   * @returns {object}
   * @throws {Error}
   */
  static run({
    exportPath = DEFAULT_EXPORT_PATH,
    dbPath = null,
    title = null,
    dryRun = false,
    force = false,
    mainRefs = [],
    playerRef = null,
    allowedRoots = [DEFAULT_ALLOWED_ROOT],
  } = {}) {
    const safeExportPath = ZetaSeeder.resolveSafeExportPath(exportPath, allowedRoots);
    const rawJsonText = fs.readFileSync(safeExportPath, 'utf8');
    const parsedExport = ZetaSeeder.parseExport(rawJsonText, { titleOverride: title, mainRefs, playerRef });
    const materialized = ZetaSeeder.materializeScribeLog(parsedExport);
    const bookJson = JSON.stringify(materialized.log);
    const liveFacts = materialized.state.facts.filter((fact) => ScribeReplay.live(fact));
    const relationCount = liveFacts.filter((fact) => fact.category === ScribeCategory.Settings.RelationCategory).length;
    const selectedPlayer = parsedExport.characters.find((character) => character.isPlayer) ?? null;

    const summary = {
      exportPath: safeExportPath,
      title: parsedExport.title,
      player: selectedPlayer !== null ? selectedPlayer.name : null,
      characters: parsedExport.characters.length,
      subjects: materialized.state.subjects.filter((subject) => subject.mergedInto === null).length,
      facts: liveFacts.length - relationCount,
      relations: relationCount,
      claims: materialized.state.facts.filter((fact) => fact.status === ScribeReplay.Status.Reported).length,
      threads: materialized.state.threads.filter((thread) => thread.closed === null).length,
      readThrough: parsedExport.readThrough,
      chatMessages: parsedExport.chatMessages,
      dryRun: Boolean(dryRun),
    };

    if (dryRun) {
      return summary;
    }

    const resolvedDbPath = dbPath !== null && dbPath.trim().length > 0
      ? path.resolve(dbPath.trim())
      : WorldsConfig.load().dbPath;
    if (resolvedDbPath.includes('\0')) {
      throw new Error('Invalid SQLite database path.');
    }
    fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });

    const store = new SqliteStore(resolvedDbPath);
    try {
      const seeded = store.runTransaction(() => {
        let existingMatch = null;
        let afterCursor = null;
        do {
          const campaignPage = store.listCampaigns({ limit: 50, after: afterCursor });
          const foundCampaign = campaignPage.items.find((item) => item.title === parsedExport.title);
          if (foundCampaign) {
            existingMatch = foundCampaign;
            break;
          }
          afterCursor = campaignPage.nextCursor;
        } while (afterCursor !== null);

        if (existingMatch !== null) {
          if (!force) {
            throw new Error(`Campaign "${parsedExport.title}" already exists in database; pass --force to replace it or --title for a distinct name.`);
          }
          store.deleteCampaign(existingMatch.id);
        }

        const openingScene = {
          sceneNumber: 1,
          day: parsedExport.initialScene.day,
          timeLabel: parsedExport.initialScene.timeLabel,
          location: parsedExport.initialScene.location,
          sceneType: parsedExport.initialScene.sceneType,
          presentIds: [],
          remoteIds: [],
          offscreenNotes: {},
          activeWalkOns: [],
        };
        const campaign = store.createCampaign({
          title: parsedExport.title,
          sceneState: openingScene,
        });

        let playerCharacterId = null;
        const presentSubjectIds = new Set(parsedExport.initialScene.presentSubjectIds);
        const createdCharacters = [];
        for (const character of parsedExport.characters) {
          const created = store.createCharacter(campaign.id, {
            slug: character.slug,
            scribeSubjectId: character.subjectId,
            name: character.name,
            aliases: character.aliases,
            isPlayer: character.isPlayer,
            tier: character.tier,
            avatarToken: character.avatarToken,
            persona: character.persona,
          });
          createdCharacters.push(created);
          if (created.isPlayer) {
            playerCharacterId = created.id;
          }
        }

        let presentCharacterIds = createdCharacters
          .filter((created) => presentSubjectIds.has(created.scribeSubjectId))
          .map((created) => created.id);
        if (presentCharacterIds.length === 0) {
          presentCharacterIds = createdCharacters
            .filter((created) => created.tier === CharacterTier.Main)
            .map((created) => created.id);
        }

        if (playerCharacterId !== null || presentCharacterIds.length > 0) {
          store.updateCampaign(campaign.id, {
            ...(playerCharacterId !== null ? { playerCharacterId } : {}),
            sceneState: { ...openingScene, presentIds: presentCharacterIds },
          });
        }

        store.saveScribeBook(campaign.id, {
          bookJson,
          lastTurnSeq: 0,
          dirty: false,
        });

        return { campaign, replacedExisting: existingMatch !== null };
      });

      return {
        ...summary,
        dbPath: resolvedDbPath,
        campaignId: seeded.campaign.id,
        replacedExisting: seeded.replacedExisting,
      };
    } finally {
      store.close();
    }
  }
}

const currentFilePath = path.resolve(fileURLToPath(import.meta.url));
if (process.argv[1] && path.resolve(process.argv[1]) === currentFilePath) {
  try {
    const cliOptions = ZetaSeeder.parseCliArgs(process.argv.slice(2));
    if (cliOptions.help) {
      process.stdout.write(USAGE);
      process.exit(0);
    }
    const result = ZetaSeeder.run({
      exportPath: cliOptions.exportPath,
      dbPath: cliOptions.dbPath,
      title: cliOptions.title,
      dryRun: cliOptions.dryRun,
      force: cliOptions.force,
      mainRefs: cliOptions.mainRefs,
      playerRef: cliOptions.playerRef,
    });
    if (result.readThrough < result.chatMessages) {
      process.stderr.write(
        `Scribe book read through message ${result.readThrough} of ${result.chatMessages}.\n`,
      );
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Seed failed: ${error.message}\n`);
    process.exit(1);
  }
}
