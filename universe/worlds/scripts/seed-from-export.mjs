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
import { SpeakerType } from '../src/store/enums/SpeakerType.mjs';
import { TurnMode } from '../src/store/enums/TurnMode.mjs';
import { TurnRole } from '../src/store/enums/TurnRole.mjs';

const DEFAULT_EXPORT_PATH = '/var/www/demo_stuff/zeta-dm-memory/scribe/private/hero_gone_latest_updated.json';
const DEFAULT_ALLOWED_ROOT = '/var/www';
const DEFAULT_TITLE = 'Seeded Campaign';
const DEFAULT_LOCATION = 'Opening Scene';
const DEFAULT_TIME_LABEL = 'Daytime';
const NARRATOR_SPEAKER_NAME = 'Narrator';
const USER_SENDER_TYPE = 'USER';
const NARRATOR_POSITION = 'NARRATOR';
const PLAYER_POSITION = 'RIGHT';
const FLAG_PREFIX = '-';
const CHARACTER_SLUG_PREFIX = 'char-';
const NUL_CHARACTER = '\0';
const FIRST_DAY = 1;
const MAX_TITLE_LENGTH = 120;
const MAX_BASE_SLUG_LENGTH = 42;
const MAX_SLUG_LENGTH = 48;
const TOP_MENTIONED_MAIN_COUNT = 3;
const PERSONA_FACT_COUNT = 4;
const BLOCKING_DAMAGE = Object.freeze(['book', 'campaign']);
const CAMPAIGN_PAGE_LIMIT = 50;
const Flag = Object.freeze({
  Title: '--title',
  Db: '--db',
  Main: '--main',
  Player: '--player',
  DryRun: '--dry-run',
  Force: '--force',
  Help: '--help',
  HelpShort: '-h',
});
const VALUE_FLAGS = Object.freeze([Flag.Title, Flag.Db, Flag.Main, Flag.Player]);
const HELP_FLAGS = Object.freeze([Flag.Help, Flag.HelpShort]);
const KNOWN_FLAGS = Object.freeze([...VALUE_FLAGS, Flag.DryRun, Flag.Force, ...HELP_FLAGS]);
const TRAILING_HIGH_SURROGATE = /[\uD800-\uDBFF]$/;
const SUBJECT_ID_PATTERN = /^S(\d+)$/;
const USAGE = `Usage: node scripts/seed-from-export.mjs [exportPath] [${Flag.Title} <title>] [${Flag.Db} <sqlitePath>] `
  + `[${Flag.Main} <slugNameAliasOrSubjectId,...>] [${Flag.Player} <slugNameAliasOrSubjectId>] [${Flag.DryRun}] [${Flag.Force}]\n`;
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
      } else if (arg === Flag.DryRun) {
        dryRun = true;
      } else if (arg === Flag.Force) {
        force = true;
      } else if (VALUE_FLAGS.includes(arg)) {
        const nextValue = argv[index + 1];
        if (typeof nextValue !== 'string' || nextValue.trim().length === 0 || KNOWN_FLAGS.includes(nextValue.trim())) {
          throw new Error(`Flag ${arg} requires a non-empty value.`);
        }
        index += 1;
        const value = nextValue.trim();
        if (arg === Flag.Title) {
          title = value;
        } else if (arg === Flag.Db) {
          dbPath = value;
        } else if (arg === Flag.Player) {
          playerRef = value;
        } else {
          mainRefs = value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
          if (mainRefs.length === 0) {
            throw new Error(`Flag ${Flag.Main} requires at least one non-empty reference.`);
          }
        }
      } else if (arg.startsWith(FLAG_PREFIX)) {
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
    if (typeof rawPath !== 'string' || rawPath.trim().length === 0 || rawPath.includes(NUL_CHARACTER)) {
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
    if (state.lookAlikes.length > 0) {
      const [pair] = state.lookAlikes;
      throw new Error(`Subjects ${pair.first} and ${pair.second} are look-alikes in the export, which the seed cannot copy.`);
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

    const akaFactTexts = new Map();
    for (const fact of state.facts) {
      if (fact.category === ScribeLogCore.Settings.AkaCategory && fact.status === ScribeReplay.Status.InForce) {
        const owner = survivor(fact.subject);
        const texts = akaFactTexts.get(owner) ?? new Set();
        texts.add(fact.text);
        akaFactTexts.set(owner, texts);
      }
    }
    const mergedNames = new Map();
    for (const subject of state.subjects) {
      if (subject.mergedInto !== null) {
        const names = mergedNames.get(subject.mergedInto) ?? new Set();
        names.add(subject.label);
        names.add(subject.name);
        mergedNames.set(subject.mergedInto, names);
      }
    }

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
      const recordAliases = [];
      for (const alias of [...recordedNames, ...subject.aka]) {
        if (!ZetaSeeder.isText(alias)) {
          throw new Error(`Subject ${subject.id} has an alias that is not text.`);
        }
        const clampedAlias = ZetaSeeder.clampText(alias, maxLabel);
        const akaFactGivesAlias = akaFactTexts.get(subject.id)?.has(alias) === true;
        const characterAlias = akaFactGivesAlias ? alias.trim() : clampedAlias;
        if (!aliases.includes(characterAlias)) {
          aliases.push(characterAlias);
        }
        const givenByAkaFact = akaFactGivesAlias
          && !recordedNames.includes(alias)
          && !mergedNames.get(subject.id)?.has(alias);
        if (!givenByAkaFact && !recordAliases.includes(clampedAlias)) {
          recordAliases.push(clampedAlias);
        }
      }
      subjects.push({ id: subject.id, name, kind: subject.kind, assumed: subject.assumed, aliases, recordAliases });
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
        baseSlug = `${CHARACTER_SLUG_PREFIX}${baseSlug}`.replace(/-+$/g, '');
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

    const sceneTimeline = state.scenes.map((scene, sceneIndex) => {
      const sceneTime = scene.evidence?.time;
      return {
        sceneNumber: sceneIndex + 1,
        firstPosition: Number.isSafeInteger(scene.firstPosition) ? scene.firstPosition : 1,
        day: Number.isSafeInteger(scene.day) && scene.day >= FIRST_DAY ? scene.day : FIRST_DAY,
        timeLabel: ZetaSeeder.isText(sceneTime) ? sceneTime.trim() : DEFAULT_TIME_LABEL,
        location: ZetaSeeder.isText(scene.place) ? scene.place.trim() : DEFAULT_LOCATION,
        sceneType: scene.reach === ScribeAnswer.Reach.Private || scene.narrowed === true
          ? SceneType.Private
          : SceneType.Public,
        present: Array.isArray(scene.present) ? scene.present : [],
      };
    });

    let initialScene = {
      day: FIRST_DAY,
      timeLabel: DEFAULT_TIME_LABEL,
      location: DEFAULT_LOCATION,
      sceneType: SceneType.Public,
      presentSubjectIds: [],
    };
    const lastScene = sceneTimeline.at(-1) ?? null;
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
      initialScene = {
        day: lastScene.day,
        timeLabel: lastScene.timeLabel,
        location: lastScene.location,
        sceneType: lastScene.sceneType,
        presentSubjectIds,
      };
    }

    const turns = [];
    for (let messageIndex = 0; messageIndex < messages.length; messageIndex += 1) {
      const message = messages[messageIndex];
      const messagePosition = messageIndex + 1;
      const rawContents = Array.isArray(message.contents) ? message.contents : [];
      const mergedBeats = [];
      for (const contentEntry of rawContents) {
        if (!ZetaSeeder.isRecord(contentEntry) || typeof contentEntry.text !== 'string') {
          continue;
        }
        const positionTag = typeof contentEntry.position === 'string' ? contentEntry.position.trim().toUpperCase() : '';
        const speakerName = typeof contentEntry.speakerName === 'string' ? contentEntry.speakerName.trim() : '';
        const previousBeat = mergedBeats.at(-1) ?? null;
        if (
          previousBeat !== null
          && previousBeat.positionTag === positionTag
          && previousBeat.speakerName === speakerName
        ) {
          const needsSeparator = previousBeat.text.length > 0
            && !previousBeat.text.endsWith('\n')
            && !contentEntry.text.startsWith('\n');
          previousBeat.text = needsSeparator
            ? `${previousBeat.text}\n${contentEntry.text}`
            : `${previousBeat.text}${contentEntry.text}`;
        } else {
          mergedBeats.push({ positionTag, speakerName, text: contentEntry.text });
        }
      }
      const cleanedBeats = mergedBeats
        .map((beat) => ({
          positionTag: beat.positionTag,
          speakerName: beat.speakerName,
          text: beat.text.trim(),
        }))
        .filter((beat) => beat.text.length > 0);
      if (cleanedBeats.length === 0) {
        continue;
      }

      let activeScene = null;
      for (const scene of sceneTimeline) {
        if (scene.firstPosition <= messagePosition) {
          activeScene = scene;
        } else {
          break;
        }
      }
      if (activeScene === null) {
        activeScene = sceneTimeline[0] ?? null;
      }

      const presentSubjectIds = [];
      if (activeScene !== null) {
        for (const attendee of activeScene.present) {
          const started = attendee.from === null || attendee.from <= messagePosition;
          const active = attendee.until === null || attendee.until >= messagePosition;
          if (!started || !active) {
            continue;
          }
          const resolvedId = survivor(attendee.subject);
          if (!presentSubjectIds.includes(resolvedId)) {
            presentSubjectIds.push(resolvedId);
          }
        }
      }
      if (presentSubjectIds.length === 0) {
        presentSubjectIds.push(...initialScene.presentSubjectIds);
      }

      const senderType = ZetaSeeder.isRecord(message.sender) && typeof message.sender.type === 'string'
        ? message.sender.type.trim().toUpperCase()
        : '';
      const role = senderType === USER_SENDER_TYPE ? TurnRole.User : TurnRole.Assistant;
      const createdAt = typeof message.messageTime === 'string' && !Number.isNaN(Date.parse(message.messageTime))
        ? new Date(message.messageTime).toISOString()
        : null;

      turns.push({
        role,
        rawText: cleanedBeats.map((beat) => beat.text).join('\n\n'),
        sceneNumber: activeScene !== null ? activeScene.sceneNumber : 1,
        day: activeScene !== null ? activeScene.day : initialScene.day,
        timeLabel: activeScene !== null ? activeScene.timeLabel : initialScene.timeLabel,
        location: activeScene !== null ? activeScene.location : initialScene.location,
        sceneType: activeScene !== null ? activeScene.sceneType : initialScene.sceneType,
        presentSubjectIds,
        createdAt,
        wasRead: Object.hasOwn(log.read, message.id),
        beats: cleanedBeats,
      });
    }

    return {
      title: campaignTitle,
      subjects,
      characters,
      facts,
      threads,
      initialScene,
      sceneCount: sceneTimeline.length,
      turns,
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
        for (const alias of subject.recordAliases) {
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
    const widenings = [];
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
        widenings.push(outcome.stored.fact);
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

    for (const wideningFact of widenings) {
      ScribeLogCore.rule(log, state, {
        type: ScribeLogCore.Ruling.Widen,
        fact: wideningFact,
        to: ScribeLogCore.Settings.Everyone,
        exact: true,
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
      turns: parsedExport.turns.length,
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
    if (resolvedDbPath.includes(NUL_CHARACTER)) {
      throw new Error('Invalid SQLite database path.');
    }
    fs.mkdirSync(path.dirname(resolvedDbPath), { recursive: true });

    const store = new SqliteStore(resolvedDbPath);
    try {
      const seeded = store.runTransaction(() => {
        let existingMatch = null;
        let afterCursor = null;
        do {
          const campaignPage = store.listCampaigns({ limit: CAMPAIGN_PAGE_LIMIT, after: afterCursor });
          const foundCampaign = campaignPage.items.find((item) => item.title === parsedExport.title);
          if (foundCampaign) {
            existingMatch = foundCampaign;
            break;
          }
          afterCursor = campaignPage.nextCursor;
        } while (afterCursor !== null);

        if (existingMatch !== null) {
          if (!force) {
            throw new Error(`Campaign "${parsedExport.title}" already exists in database; pass ${Flag.Force} to replace it or ${Flag.Title} for a distinct name.`);
          }
          store.deleteCampaign(existingMatch.id);
        }

        const openingScene = {
          sceneNumber: Math.max(1, parsedExport.sceneCount ?? 1),
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

        let playerCharacter = null;
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
            playerCharacter = created;
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

        const finalOpeningScene = { ...openingScene, presentIds: presentCharacterIds };
        if (playerCharacter !== null || presentCharacterIds.length > 0) {
          store.updateCampaign(campaign.id, {
            ...(playerCharacter !== null ? { playerCharacterId: playerCharacter.id } : {}),
            sceneState: finalOpeningScene,
          });
        }

        const characterBySubjectId = new Map();
        const characterByName = new Map();
        const characterByAlias = new Map();
        const characterBySlug = new Map();
        for (const created of createdCharacters) {
          if (created.scribeSubjectId !== null) {
            characterBySubjectId.set(created.scribeSubjectId, created);
          }
          const normalizedName = ScribeText.normaliseName(created.name);
          if (normalizedName.length > 0 && !characterByName.has(normalizedName)) {
            characterByName.set(normalizedName, created);
          }
          characterBySlug.set(created.slug.toLowerCase(), created);
          for (const alias of created.aliases) {
            const normalizedAlias = ScribeText.normaliseName(alias);
            if (normalizedAlias.length > 0 && !characterByAlias.has(normalizedAlias)) {
              characterByAlias.set(normalizedAlias, created);
            }
          }
        }

        let lastTurnSeq = 0;
        if (parsedExport.turns.length > 0) {
          const turnPayloads = parsedExport.turns.map((parsedTurn) => {
            const witnessSet = new Set();
            for (const subjectId of parsedTurn.presentSubjectIds) {
              const witness = characterBySubjectId.get(subjectId);
              if (witness !== undefined) {
                witnessSet.add(witness.id);
              }
            }
            const mappedBeats = parsedTurn.beats.map((beat) => {
              const normalizedSpeaker = ScribeText.normaliseName(beat.speakerName);
              const isNarrator = beat.positionTag === NARRATOR_POSITION
                || normalizedSpeaker.length === 0
                || normalizedSpeaker === ScribeAnswer.Settings.NarratorName;
              if (isNarrator) {
                return {
                  speakerType: SpeakerType.Narrator,
                  characterId: null,
                  speakerName: NARRATOR_SPEAKER_NAME,
                  text: beat.text,
                };
              }
              if (parsedTurn.role === TurnRole.User && beat.positionTag === PLAYER_POSITION && playerCharacter !== null) {
                witnessSet.add(playerCharacter.id);
                return {
                  speakerType: SpeakerType.Player,
                  characterId: playerCharacter.id,
                  speakerName: playerCharacter.name,
                  text: beat.text,
                };
              }
              const matched = characterByName.get(normalizedSpeaker)
                ?? characterByAlias.get(normalizedSpeaker)
                ?? characterBySlug.get(beat.speakerName.toLowerCase())
                ?? null;
              if (matched !== null) {
                witnessSet.add(matched.id);
                return {
                  speakerType: matched.isPlayer ? SpeakerType.Player : SpeakerType.Character,
                  characterId: matched.id,
                  speakerName: matched.name,
                  text: beat.text,
                };
              }
              return {
                speakerType: SpeakerType.Narrator,
                characterId: null,
                speakerName: beat.speakerName,
                text: beat.text,
              };
            });
            const witnessIds = [...witnessSet];
            const turnSceneState = {
              sceneNumber: parsedTurn.sceneNumber,
              day: parsedTurn.day,
              timeLabel: parsedTurn.timeLabel,
              location: parsedTurn.location,
              sceneType: parsedTurn.sceneType,
              presentIds: witnessIds,
              remoteIds: [],
              offscreenNotes: {},
              activeWalkOns: [],
            };
            return {
              role: parsedTurn.role,
              mode: TurnMode.Normal,
              rawText: parsedTurn.rawText,
              sceneNumber: parsedTurn.sceneNumber,
              witnessIds,
              sceneStateBefore: turnSceneState,
              sceneStateAfter: turnSceneState,
              createdAt: parsedTurn.createdAt,
              beats: mappedBeats.map((beat) => ({ ...beat, witnessIds })),
            };
          });

          const insertedTurns = store.importTurns(campaign.id, turnPayloads);
          for (let turnIndex = 0; turnIndex < insertedTurns.length; turnIndex += 1) {
            if (parsedExport.turns[turnIndex].wasRead) {
              materialized.log.read[insertedTurns[turnIndex].id] = 1;
              lastTurnSeq = insertedTurns[turnIndex].seq;
            }
          }
        }

        store.saveScribeBook(campaign.id, {
          bookJson: JSON.stringify(materialized.log),
          lastTurnSeq,
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
