import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorldsConfig } from '../src/config.mjs';
import { ScribeAnswer } from '../src/scribe/ScribeAnswer.mjs';
import { ScribeCategory } from '../src/scribe/ScribeCategory.mjs';
import { ScribeLogCore } from '../src/scribe/ScribeLogCore.mjs';
import { ScribeReplay } from '../src/scribe/ScribeReplay.mjs';
import { ScribeText } from '../src/scribe/ScribeText.mjs';
import { SqliteStore } from '../src/store/SqliteStore.mjs';
import { AvatarToken } from '../src/store/enums/AvatarToken.mjs';
import { CharacterTier } from '../src/store/enums/CharacterTier.mjs';
import { SceneType } from '../src/store/enums/SceneType.mjs';

const DEFAULT_EXPORT_PATH = '/var/www/demo_stuff/zeta-dm-memory/scribe/private/hero_gone_latest.json';
const DEFAULT_ALLOWED_ROOT = '/var/www';
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
   * @param {string[]} argv
   * @returns {{exportPath: string, dbPath: string | null, title: string | null, dryRun: boolean, force: boolean, mainRefs: string[], help: boolean}}
   * @throws {Error}
   */
  static parseCliArgs(argv) {
    if (!Array.isArray(argv)) {
      throw new TypeError('argv must be an array.');
    }
    let positionalPath = null;
    let dbPath = null;
    let title = null;
    let dryRun = false;
    let force = false;
    let help = false;
    const mainRefs = [];

    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index];
      if (arg === '--help' || arg === '-h') {
        help = true;
      } else if (arg === '--dry-run') {
        dryRun = true;
      } else if (arg === '--force') {
        force = true;
      } else if (arg === '--title' || arg === '--db' || arg === '--main') {
        const nextValue = argv[index + 1];
        if (typeof nextValue !== 'string' || nextValue.trim().length === 0 || nextValue.startsWith('--')) {
          throw new Error(`Flag ${arg} requires a non-empty value.`);
        }
        index += 1;
        if (arg === '--title') {
          title = nextValue.trim();
        } else if (arg === '--db') {
          dbPath = nextValue.trim();
        } else {
          for (const entry of nextValue.split(',')) {
            const trimmedEntry = entry.trim();
            if (trimmedEntry.length > 0) {
              mainRefs.push(trimmedEntry.toLowerCase());
            }
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
      } catch {
        continue;
      }
      if (realCandidate === realRoot || realCandidate.startsWith(`${realRoot}${path.sep}`)) {
        return realCandidate;
      }
    }
    throw new Error(`Security check failed: export path "${realCandidate}" resolves outside allowed root directories.`);
  }

  /**
   * @param {string} rawJsonText
   * @param {{titleOverride?: string | null, mainRefs?: string[]}} options
   * @returns {object}
   * @throws {Error}
   */
  static parseExport(rawJsonText, { titleOverride = null, mainRefs = [] } = {}) {
    if (typeof rawJsonText !== 'string' || rawJsonText.trim().length === 0) {
      throw new Error('Export file is empty.');
    }
    let parsed;
    try {
      parsed = JSON.parse(rawJsonText);
    } catch (error) {
      throw new Error(`Export file contains invalid JSON: ${error.message}`, { cause: error });
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Export payload must be a JSON object.');
    }

    let rawLog = null;
    if (parsed.scribe?.log && typeof parsed.scribe.log === 'object') {
      rawLog = parsed.scribe.log;
    } else if (parsed.log && typeof parsed.log === 'object') {
      rawLog = parsed.log;
    } else if (Array.isArray(parsed.entries) && Number.isInteger(parsed.nextSubject)) {
      rawLog = parsed;
    }

    let bookSource = parsed.scribe?.state ?? parsed.book ?? parsed.state ?? null;
    if (bookSource === null && rawLog !== null) {
      const replayMessages = Array.isArray(parsed.messages) ? parsed.messages : [];
      bookSource = ScribeReplay.run(rawLog, replayMessages);
    }
    if (bookSource === null) {
      bookSource = parsed;
    }
    if (bookSource === null || typeof bookSource !== 'object' || Array.isArray(bookSource)) {
      throw new Error('Export book/state payload must be an object.');
    }

    const explicitCharacters = Array.isArray(parsed.characters)
      ? parsed.characters
      : Array.isArray(parsed.cast)
        ? parsed.cast
        : [];
    const rawSubjects = Array.isArray(bookSource.subjects) ? bookSource.subjects : [];
    const rawFacts = Array.isArray(bookSource.facts) ? bookSource.facts : [];
    const rawRelations = Array.isArray(bookSource.relations) ? bookSource.relations : [];
    const rawThreads = Array.isArray(bookSource.threads) ? bookSource.threads : [];
    const rawScenes = Array.isArray(bookSource.scenes) ? bookSource.scenes : [];
    const rawAliases = Array.isArray(bookSource.aliases) ? bookSource.aliases : [];

    if (
      explicitCharacters.length === 0
      && rawSubjects.length === 0
      && rawFacts.length === 0
      && rawRelations.length === 0
      && rawThreads.length === 0
    ) {
      throw new Error('Export payload does not contain recognizable Zeta characters, subjects, facts, relations, or threads.');
    }

    const rawTitleCandidate = titleOverride
      ?? [parsed.title, parsed.campaignTitle, parsed.name, parsed.worldName, bookSource.title].find(
        (candidate) => typeof candidate === 'string' && candidate.trim().length > 0,
      )
      ?? 'Seeded Campaign';
    const campaignTitle = String(rawTitleCandidate).trim().slice(0, 120);
    if (campaignTitle.length === 0) {
      throw new Error('Campaign title cannot be empty.');
    }

    const premiseCandidate = [parsed.premise, parsed.description, parsed.summary, parsed.worldSetting, bookSource.premise].find(
      (candidate) => typeof candidate === 'string' && candidate.trim().length > 0,
    ) ?? '';
    const styleCandidate = [parsed.styleNotes, parsed.toneRules, parsed.narratorStyle, parsed.style].find(
      (candidate) => typeof candidate === 'string' && candidate.trim().length > 0,
    ) ?? '';

    const normalizedSubjects = [];
    const mergedAliasesBySurvivor = new Map();
    const survivorByOldId = new Map();

    for (const rawSubject of rawSubjects) {
      if (rawSubject === null || typeof rawSubject !== 'object' || Array.isArray(rawSubject)) {
        throw new Error('Invalid subject entry in export.');
      }
      const subjectId = typeof rawSubject.id === 'string' ? rawSubject.id.trim() : '';
      const rawName = rawSubject.label ?? rawSubject.name ?? '';
      if (typeof rawName !== 'string' || rawName.trim().length === 0) {
        throw new Error(`Subject ${subjectId || '(unknown)'} is missing a label or name.`);
      }
      const clampedName = rawName.trim().slice(0, ScribeAnswer.Settings.MaxLabel);
      const mergedInto = typeof rawSubject.mergedInto === 'string' && rawSubject.mergedInto.trim().length > 0
        ? rawSubject.mergedInto.trim()
        : null;
      const akaList = Array.isArray(rawSubject.aka)
        ? rawSubject.aka.filter((entry) => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
        : [];
      if (mergedInto !== null) {
        if (subjectId) {
          survivorByOldId.set(subjectId, mergedInto);
        }
        const mergedAliases = mergedAliasesBySurvivor.get(mergedInto) ?? [];
        mergedAliases.push(clampedName, ...akaList);
        mergedAliasesBySurvivor.set(mergedInto, mergedAliases);
        continue;
      }

      let normalizedKind = ScribeCategory.SubjectKinds.Character;
      if (rawSubject.kind !== null && rawSubject.kind !== undefined) {
        if (typeof rawSubject.kind !== 'string') {
          throw new Error(`Invalid subject kind: ${String(rawSubject.kind)}`);
        }
        const loweredKind = rawSubject.kind.trim().toLowerCase();
        if (['character', 'npc', 'pc', 'person'].includes(loweredKind)) {
          normalizedKind = ScribeCategory.SubjectKinds.Character;
        } else if (['group', 'faction', 'organization', 'organisation'].includes(loweredKind)) {
          normalizedKind = ScribeCategory.SubjectKinds.Group;
        } else if (['place', 'location', 'setting', 'area'].includes(loweredKind)) {
          normalizedKind = ScribeCategory.SubjectKinds.Place;
        } else if (['item', 'object', 'artifact', 'artefact'].includes(loweredKind)) {
          normalizedKind = ScribeCategory.SubjectKinds.Item;
        } else if (['world', 'lore', 'rule', 'concept'].includes(loweredKind)) {
          normalizedKind = ScribeCategory.SubjectKinds.World;
        } else {
          throw new Error(`Unsupported subject kind: ${rawSubject.kind}`);
        }
      }

      normalizedSubjects.push({
        oldId: subjectId || null,
        name: clampedName,
        kind: normalizedKind,
        aliases: akaList,
        isNarrator: ScribeText.normaliseName(clampedName) === ScribeAnswer.Settings.NarratorName,
      });
      if (subjectId) {
        survivorByOldId.set(subjectId, subjectId);
      }
    }

    for (const aliasEntry of rawAliases) {
      if (aliasEntry === null || typeof aliasEntry !== 'object') {
        continue;
      }
      const targetSubject = typeof aliasEntry.subject === 'string' ? aliasEntry.subject.trim() : '';
      const aliasName = typeof aliasEntry.name === 'string' ? aliasEntry.name.trim() : '';
      if (!targetSubject || !aliasName) {
        continue;
      }
      const survivorId = survivorByOldId.get(targetSubject) ?? targetSubject;
      const existing = mergedAliasesBySurvivor.get(survivorId) ?? [];
      existing.push(aliasName);
      mergedAliasesBySurvivor.set(survivorId, existing);
    }

    for (const subject of normalizedSubjects) {
      const extraAliases = subject.oldId ? (mergedAliasesBySurvivor.get(subject.oldId) ?? []) : [];
      const uniqueAliases = [];
      const seenForms = new Set([ScribeText.normaliseName(subject.name)]);
      for (const alias of [...subject.aliases, ...extraAliases]) {
        const form = ScribeText.normaliseName(alias);
        if (form.length > 0 && !seenForms.has(form)) {
          seenForms.add(form);
          uniqueAliases.push(alias);
        }
      }
      subject.aliases = uniqueAliases;
    }

    const activeCharacters = [];
    const matchedSubjectIndices = new Set();
    const explicitPlayerName = typeof parsed.playerName === 'string' && parsed.playerName.trim().length > 0
      ? parsed.playerName.trim()
      : typeof parsed.playerCharacter === 'string' && parsed.playerCharacter.trim().length > 0
        ? parsed.playerCharacter.trim()
        : null;
    const explicitPlayerSlug = typeof parsed.playerSlug === 'string' && parsed.playerSlug.trim().length > 0
      ? parsed.playerSlug.trim().toLowerCase()
      : null;

    for (const rawChar of explicitCharacters) {
      if (rawChar === null || typeof rawChar !== 'object' || Array.isArray(rawChar)) {
        throw new Error('Invalid character entry in export.');
      }
      const rawCharName = rawChar.name ?? rawChar.label ?? '';
      if (typeof rawCharName !== 'string' || rawCharName.trim().length === 0) {
        throw new Error('Character entry is missing a non-empty name.');
      }
      const name = rawCharName.trim().slice(0, ScribeAnswer.Settings.MaxLabel);
      if (ScribeText.normaliseName(name) === ScribeAnswer.Settings.NarratorName) {
        continue;
      }
      const explicitSubjectId = typeof rawChar.subjectId === 'string' && rawChar.subjectId.trim().length > 0
        ? rawChar.subjectId.trim()
        : typeof rawChar.scribeSubjectId === 'string' && rawChar.scribeSubjectId.trim().length > 0
          ? rawChar.scribeSubjectId.trim()
          : null;
      let subjectMatchIndex = -1;
      if (explicitSubjectId !== null) {
        subjectMatchIndex = normalizedSubjects.findIndex((subject) => subject.oldId === explicitSubjectId);
      }
      if (subjectMatchIndex === -1) {
        const normName = ScribeText.normaliseName(name);
        subjectMatchIndex = normalizedSubjects.findIndex(
          (subject) => subject.kind === ScribeCategory.SubjectKinds.Character && ScribeText.normaliseName(subject.name) === normName,
        );
      }
      let subjectAliases = [];
      let matchedOldId = explicitSubjectId;
      if (subjectMatchIndex >= 0) {
        matchedSubjectIndices.add(subjectMatchIndex);
        subjectAliases = normalizedSubjects[subjectMatchIndex].aliases;
        matchedOldId = normalizedSubjects[subjectMatchIndex].oldId ?? matchedOldId;
      } else {
        normalizedSubjects.push({
          oldId: matchedOldId,
          name,
          kind: ScribeCategory.SubjectKinds.Character,
          aliases: [],
          isNarrator: false,
        });
        matchedSubjectIndices.add(normalizedSubjects.length - 1);
      }
      const charAliases = Array.isArray(rawChar.aliases)
        ? rawChar.aliases.filter((entry) => typeof entry === 'string' && entry.trim().length > 0).map((entry) => entry.trim())
        : [];
      const mergedAliases = [];
      const seenCharAliasForms = new Set([ScribeText.normaliseName(name)]);
      for (const aliasCandidate of [...subjectAliases, ...charAliases]) {
        const aliasForm = ScribeText.normaliseName(aliasCandidate);
        if (aliasForm.length > 0 && !seenCharAliasForms.has(aliasForm)) {
          seenCharAliasForms.add(aliasForm);
          mergedAliases.push(aliasCandidate);
        }
      }
      const persona = [rawChar.persona, rawChar.description, rawChar.notes, rawChar.prompt]
        .find((entry) => typeof entry === 'string' && entry.trim().length > 0)?.trim() ?? '';
      const rawTier = rawChar.tier ?? rawChar.role ?? rawChar.importance;
      const normalizedTier = typeof rawTier === 'string' && rawTier.trim().toLowerCase() === CharacterTier.Main
        ? CharacterTier.Main
        : typeof rawTier === 'string' && rawTier.trim().toLowerCase() === CharacterTier.Recurring
          ? CharacterTier.Recurring
          : null;

      activeCharacters.push({
        name,
        oldSubjectId: matchedOldId,
        rawSlug: typeof rawChar.slug === 'string' ? rawChar.slug.trim() : null,
        aliases: mergedAliases,
        persona,
        explicitTier: normalizedTier,
        explicitAvatar: Object.values(AvatarToken).includes(rawChar.avatarToken) ? rawChar.avatarToken : null,
        isPlayer: rawChar.isPlayer === true,
        archived: rawChar.archived === true || rawChar.status === 'archived',
      });
    }

    for (const [subjectIndex, subject] of normalizedSubjects.entries()) {
      if (matchedSubjectIndices.has(subjectIndex) || subject.kind !== ScribeCategory.SubjectKinds.Character || subject.isNarrator) {
        continue;
      }
      activeCharacters.push({
        name: subject.name,
        oldSubjectId: subject.oldId,
        rawSlug: null,
        aliases: subject.aliases,
        persona: '',
        explicitTier: null,
        explicitAvatar: null,
        isPlayer: false,
        archived: false,
      });
    }

    const combinedFacts = [...rawFacts];
    for (const relation of rawRelations) {
      if (relation === null || typeof relation !== 'object') {
        throw new Error('Invalid relation entry in export.');
      }
      combinedFacts.push({
        ...relation,
        category: ScribeCategory.Settings.RelationCategory,
      });
    }

    const knownSubjectOldIds = new Set(normalizedSubjects.map((subject) => subject.oldId).filter(Boolean));
    const normalizedFacts = [];
    const factMentionCounts = new Map();
    for (const rawFact of combinedFacts) {
      if (rawFact === null || typeof rawFact !== 'object' || Array.isArray(rawFact)) {
        throw new Error('Invalid fact entry in export.');
      }
      const status = rawFact.status ?? ScribeReplay.Status.InForce;
      if (
        status === ScribeReplay.Status.Removed
        || status === ScribeReplay.Status.Replaced
        || status === ScribeReplay.Status.Ended
      ) {
        continue;
      }
      const subjectId = typeof rawFact.subject === 'string' ? rawFact.subject.trim() : '';
      const category = typeof rawFact.category === 'string' ? rawFact.category.trim() : '';
      const text = typeof rawFact.text === 'string' ? rawFact.text.trim() : '';
      if (!subjectId || !category || !ScribeCategory.parse(category) || !ScribeAnswer.Settings.HasContent.test(text)) {
        throw new Error(`Fact ${rawFact.id ?? '(unknown)'} is missing valid subject, category, or text.`);
      }
      const resolvedSubject = survivorByOldId.get(subjectId) ?? subjectId;
      if (!knownSubjectOldIds.has(resolvedSubject)) {
        throw new Error(`Fact ${rawFact.id ?? '(unknown)'} references unknown subject "${subjectId}".`);
      }
      factMentionCounts.set(resolvedSubject, (factMentionCounts.get(resolvedSubject) ?? 0) + 1);
      const isRelation = category.toLowerCase() === ScribeCategory.Settings.RelationCategory;
      let targetId = typeof rawFact.target === 'string' && rawFact.target.trim().length > 0
        ? (survivorByOldId.get(rawFact.target.trim()) ?? rawFact.target.trim())
        : null;
      const targetText = typeof rawFact.targetText === 'string' && rawFact.targetText.trim().length > 0
        ? rawFact.targetText.trim()
        : null;
      if (!isRelation) {
        targetId = null;
      } else if (targetId === null && targetText === null) {
        throw new Error(`Relation fact ${rawFact.id ?? '(unknown)'} must provide a valid target or targetText.`);
      } else if (targetId !== null && !knownSubjectOldIds.has(targetId) && targetText === null) {
        throw new Error(`Relation fact ${rawFact.id ?? '(unknown)'} references unknown target "${targetId}".`);
      }
      if (targetId !== null) {
        factMentionCounts.set(targetId, (factMentionCounts.get(targetId) ?? 0) + 1);
      }

      const widened = rawFact.widened === ScribeLogCore.Settings.Everyone
        ? ScribeLogCore.Settings.Everyone
        : Array.isArray(rawFact.widened)
          ? rawFact.widened.filter((id) => typeof id === 'string' && id.trim().length > 0).map((id) => survivorByOldId.get(id.trim()) ?? id.trim())
          : null;
      const told = Array.isArray(rawFact.told)
        ? rawFact.told.filter((id) => typeof id === 'string' && id.trim().length > 0).map((id) => survivorByOldId.get(id.trim()) ?? id.trim())
        : [];

      normalizedFacts.push({
        subject: resolvedSubject,
        category: isRelation ? ScribeCategory.Settings.RelationCategory : category,
        target: targetId,
        targetText,
        text,
        hidden: Boolean(rawFact.hidden),
        widened,
        told,
      });
    }

    const normalizedThreads = [];
    for (const rawThread of rawThreads) {
      if (rawThread === null || typeof rawThread !== 'object' || Array.isArray(rawThread)) {
        throw new Error('Invalid thread entry in export.');
      }
      if (rawThread.closed !== null && rawThread.closed !== undefined) {
        continue;
      }
      const text = typeof rawThread.text === 'string' ? rawThread.text.trim() : '';
      if (!text) {
        throw new Error(`Open thread ${rawThread.id ?? '(unknown)'} is missing text.`);
      }
      const subjectRef = typeof rawThread.subject === 'string' && rawThread.subject.trim().length > 0
        ? (survivorByOldId.get(rawThread.subject.trim()) ?? rawThread.subject.trim())
        : null;
      normalizedThreads.push({ text, subject: subjectRef });
    }

    const mainRefSet = new Set(mainRefs.map((entry) => entry.toLowerCase()));
    const rankedByMentions = [...activeCharacters].sort((first, second) => {
      const countFirst = first.oldSubjectId ? (factMentionCounts.get(first.oldSubjectId) ?? 0) : 0;
      const countSecond = second.oldSubjectId ? (factMentionCounts.get(second.oldSubjectId) ?? 0) : 0;
      return countSecond - countFirst;
    });
    const topMentionedNames = new Set(rankedByMentions.slice(0, 3).map((entry) => entry.name));

    const usedSlugs = new Set();
    let assignedPlayer = false;
    for (const [charIndex, character] of activeCharacters.entries()) {
      let baseSlug = String(character.rawSlug ?? character.name)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^[-_]+|[-_]+$/g, '');
      if (!/^[a-z0-9]/.test(baseSlug)) {
        baseSlug = `char-${baseSlug}`.replace(/-+$/g, '');
      }
      baseSlug = baseSlug.slice(0, 42);
      if (baseSlug.length === 0) {
        baseSlug = 'character';
      }
      let uniqueSlug = baseSlug;
      let slugSuffix = 2;
      while (usedSlugs.has(uniqueSlug)) {
        const suffixTail = `-${slugSuffix}`;
        uniqueSlug = `${baseSlug.slice(0, 48 - suffixTail.length)}${suffixTail}`;
        slugSuffix += 1;
      }
      usedSlugs.add(uniqueSlug);
      character.slug = uniqueSlug;
      character.avatarToken = character.explicitAvatar ?? AVATAR_TOKENS[charIndex % AVATAR_TOKENS.length];

      const matchesPlayer = character.isPlayer
        || (explicitPlayerSlug !== null && uniqueSlug === explicitPlayerSlug)
        || (explicitPlayerName !== null && ScribeText.normaliseName(character.name) === ScribeText.normaliseName(explicitPlayerName));
      if (matchesPlayer && !assignedPlayer) {
        character.isPlayer = true;
        assignedPlayer = true;
      } else {
        character.isPlayer = false;
      }

      const matchesMainFlag = mainRefSet.has(uniqueSlug)
        || mainRefSet.has(character.name.toLowerCase())
        || (character.oldSubjectId !== null && mainRefSet.has(character.oldSubjectId.toLowerCase()));
      if (matchesMainFlag) {
        character.tier = CharacterTier.Main;
      } else if (character.explicitTier !== null) {
        character.tier = character.explicitTier;
      } else if (character.isPlayer || topMentionedNames.has(character.name)) {
        character.tier = CharacterTier.Main;
      } else {
        character.tier = CharacterTier.Recurring;
      }

      if (!character.persona && character.oldSubjectId !== null) {
        const publicCharFacts = normalizedFacts
          .filter((fact) => fact.subject === character.oldSubjectId && !fact.hidden && fact.category !== ScribeCategory.Settings.RelationCategory)
          .slice(0, 4)
          .map((fact) => `${fact.category}: ${fact.text}`);
        if (publicCharFacts.length > 0) {
          character.persona = publicCharFacts.join('; ');
        }
      }
    }

    const latestScene = rawScenes.length > 0 ? rawScenes[rawScenes.length - 1] : null;
    const rawSceneState = parsed.sceneState && typeof parsed.sceneState === 'object' ? parsed.sceneState : null;
    const initialLocation = rawSceneState?.location ?? latestScene?.place ?? latestScene?.location ?? 'Opening Scene';
    const initialDay = Number.isInteger(rawSceneState?.day) && rawSceneState.day >= 1
      ? rawSceneState.day
      : Number.isInteger(latestScene?.day) && latestScene.day >= 1
        ? latestScene.day
        : 1;
    const initialTimeLabel = typeof rawSceneState?.timeLabel === 'string' && rawSceneState.timeLabel.trim().length > 0
      ? rawSceneState.timeLabel.trim()
      : 'Daytime';
    const initialReach = (rawSceneState?.sceneType ?? latestScene?.reach) === SceneType.Private
      ? SceneType.Private
      : SceneType.Public;

    return {
      title: campaignTitle,
      premise: premiseCandidate.trim(),
      styleNotes: styleCandidate.trim(),
      subjects: normalizedSubjects.filter((subject) => !subject.isNarrator),
      characters: activeCharacters,
      facts: normalizedFacts,
      threads: normalizedThreads,
      initialScene: {
        day: initialDay,
        timeLabel: initialTimeLabel,
        location: typeof initialLocation === 'string' && initialLocation.trim().length > 0
          ? initialLocation.trim()
          : 'Opening Scene',
        sceneType: initialReach,
        presentOldSubjectIds: Array.isArray(latestScene?.present)
          ? latestScene.present.map((attendee) => attendee.subject).filter((id) => typeof id === 'string')
          : [],
      },
    };
  }

  /**
   * @param {object} parsedExport
   * @returns {{log: object, state: object, oldToNewSubjectId: Map<string, string>, characters: object[]}}
   * @throws {Error}
   */
  static materializeScribeLog(parsedExport) {
    const log = ScribeLogCore.create();
    let state = ScribeReplay.run(log, []);
    const oldToNewSubjectId = new Map();
    const normNameToNewSubjectId = new Map();

    const orderedSubjects = [
      ...parsedExport.subjects.filter((subject) => subject.kind === ScribeCategory.SubjectKinds.Character),
      ...parsedExport.subjects.filter((subject) => subject.kind !== ScribeCategory.SubjectKinds.Character),
    ];

    for (const subject of orderedSubjects) {
      const existingByName = normNameToNewSubjectId.get(ScribeText.normaliseName(subject.name));
      if (existingByName !== undefined) {
        if (subject.oldId) {
          oldToNewSubjectId.set(subject.oldId, existingByName);
        }
        continue;
      }
      const synced = ScribeLogCore.syncCharacterSubject(log, state, {
        subjectId: null,
        name: subject.name,
        aliases: subject.aliases,
        kind: subject.kind,
      });
      state = ScribeReplay.run(log, []);
      if (subject.oldId) {
        oldToNewSubjectId.set(subject.oldId, synced.subjectId);
      }
      normNameToNewSubjectId.set(ScribeText.normaliseName(subject.name), synced.subjectId);
      for (const alias of subject.aliases) {
        normNameToNewSubjectId.set(ScribeText.normaliseName(alias), synced.subjectId);
      }
    }

    const resolveSubjectId = (refId, fallbackName = null) => {
      if (typeof refId === 'string' && oldToNewSubjectId.has(refId)) {
        return oldToNewSubjectId.get(refId);
      }
      if (typeof refId === 'string' && ScribeLogCore.lookup(state.subjects, refId) !== undefined && oldToNewSubjectId.size === 0) {
        return refId;
      }
      if (typeof fallbackName === 'string' && fallbackName.trim().length > 0) {
        const normFallback = ScribeText.normaliseName(fallbackName);
        if (normNameToNewSubjectId.has(normFallback)) {
          return normNameToNewSubjectId.get(normFallback);
        }
        const created = ScribeLogCore.syncCharacterSubject(log, state, {
          subjectId: null,
          name: fallbackName.trim().slice(0, ScribeAnswer.Settings.MaxLabel),
          aliases: [],
          kind: ScribeCategory.SubjectKinds.Character,
        });
        state = ScribeReplay.run(log, []);
        normNameToNewSubjectId.set(normFallback, created.subjectId);
        if (typeof refId === 'string' && refId.length > 0) {
          oldToNewSubjectId.set(refId, created.subjectId);
        }
        return created.subjectId;
      }
      return null;
    };

    const validatedFactOperations = [];
    const widenPending = [];
    const factCounters = { nextFact: log.nextFact };

    for (const fact of parsedExport.facts) {
      const mappedSubject = resolveSubjectId(fact.subject);
      if (mappedSubject === null) {
        throw new Error(`Cannot resolve subject "${fact.subject}" for fact "${fact.text}".`);
      }
      let mappedTarget = null;
      if (fact.category === ScribeCategory.Settings.RelationCategory) {
        mappedTarget = resolveSubjectId(fact.target, fact.targetText);
        if (mappedTarget === null) {
          throw new Error(`Cannot resolve relation target for "${fact.text}".`);
        }
      }
      const viewWithResolved = ScribeLogCore.view(state);
      const outcome = { counters: factCounters, stored: null };
      const reason = ScribeLogCore.Rulers.AddFact({
        type: ScribeLogCore.Ruling.AddFact,
        subject: mappedSubject,
        category: fact.category,
        target: mappedTarget,
        text: fact.text,
        hidden: fact.hidden,
        cite: null,
        position: 0,
      }, viewWithResolved, outcome);
      if (reason !== null || outcome.stored === null) {
        throw new Error(`Failed to validate seeded fact "${fact.text}": ${reason ?? 'unknown error'}`);
      }
      validatedFactOperations.push(outcome.stored);

      if (fact.widened === ScribeLogCore.Settings.Everyone) {
        widenPending.push({ factId: outcome.stored.fact, to: ScribeLogCore.Settings.Everyone });
      } else {
        const audienceIds = [];
        for (const recipientId of [...(Array.isArray(fact.widened) ? fact.widened : []), ...fact.told]) {
          const resolvedRecipient = resolveSubjectId(recipientId);
          if (resolvedRecipient !== null && !audienceIds.includes(resolvedRecipient)) {
            audienceIds.push(resolvedRecipient);
          }
        }
        if (audienceIds.length > 0) {
          widenPending.push({ factId: outcome.stored.fact, to: audienceIds });
        }
      }
    }

    log.nextFact = factCounters.nextFact;

    if (validatedFactOperations.length > 0) {
      log.entries.push({
        sequence: log.nextSequence,
        kind: ScribeLogCore.Kind.Operator,
        origin: ScribeLogCore.Origin.Operator,
        messageIds: [],
        operations: validatedFactOperations,
        withdrawn: false,
      });
      log.nextSequence += 1;
      log.revision += 1;
      state = ScribeReplay.run(log, []);
    }

    for (const widenSpec of widenPending) {
      ScribeLogCore.rule(log, state, {
        type: ScribeLogCore.Ruling.Widen,
        fact: widenSpec.factId,
        to: widenSpec.to,
      });
      state = ScribeReplay.run(log, []);
    }

    if (parsedExport.threads.length > 0) {
      const threadOps = [];
      for (const thread of parsedExport.threads) {
        const threadSubject = thread.subject ? resolveSubjectId(thread.subject) : null;
        threadOps.push({
          type: ScribeAnswer.Type.ThreadOpen,
          thread: `${ScribeLogCore.Settings.ThreadPrefix}${log.nextThread}`,
          text: thread.text,
          cite: null,
          position: 0,
          ...(threadSubject !== null ? { subject: threadSubject } : {}),
        });
        log.nextThread += 1;
      }
      log.entries.push({
        sequence: log.nextSequence,
        kind: ScribeLogCore.Kind.Operator,
        origin: ScribeLogCore.Origin.Operator,
        messageIds: [],
        operations: threadOps,
        withdrawn: false,
      });
      log.nextSequence += 1;
      log.revision += 1;
      state = ScribeReplay.run(log, []);
    }

    const enrichedCharacters = parsedExport.characters.map((character) => {
      const assignedSubjectId = resolveSubjectId(character.oldSubjectId, character.name);
      return {
        ...character,
        scribeSubjectId: assignedSubjectId,
      };
    });

    return {
      log,
      state,
      oldToNewSubjectId,
      characters: enrichedCharacters,
    };
  }

  /**
   * @param {{exportPath?: string, dbPath?: string | null, title?: string | null, dryRun?: boolean, force?: boolean, mainRefs?: string[], allowedRoots?: string[]}} options
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
    allowedRoots = [DEFAULT_ALLOWED_ROOT],
  } = {}) {
    const safeExportPath = ZetaSeeder.resolveSafeExportPath(exportPath, allowedRoots);
    const rawJsonText = fs.readFileSync(safeExportPath, 'utf8');
    const parsedExport = ZetaSeeder.parseExport(rawJsonText, { titleOverride: title, mainRefs });
    const materialized = ZetaSeeder.materializeScribeLog(parsedExport);
    const bookJson = JSON.stringify(materialized.log);
    const relations = materialized.state.facts.filter((fact) => ScribeReplay.live(fact) && fact.category === ScribeCategory.Settings.RelationCategory);

    const summary = {
      exportPath: safeExportPath,
      title: parsedExport.title,
      characters: materialized.characters.length,
      subjects: materialized.state.subjects.filter((subject) => subject.mergedInto === null).length,
      facts: materialized.state.facts.filter((fact) => ScribeReplay.live(fact) && fact.category !== ScribeCategory.Settings.RelationCategory).length,
      relations: relations.length,
      threads: materialized.state.threads.filter((thread) => thread.closed === null).length,
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
      const campaignRecord = store.runTransaction(() => {
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

        const campaign = store.createCampaign({
          title: parsedExport.title,
          premise: parsedExport.premise,
          styleNotes: parsedExport.styleNotes,
          sceneState: {
            sceneNumber: 1,
            day: parsedExport.initialScene.day,
            timeLabel: parsedExport.initialScene.timeLabel,
            location: parsedExport.initialScene.location,
            sceneType: parsedExport.initialScene.sceneType,
            presentIds: [],
            remoteIds: [],
            offscreenNotes: {},
            activeWalkOns: [],
          },
        });

        let playerCharacterId = null;
        const presentCharacterIds = [];
        const presentOldSet = new Set(parsedExport.initialScene.presentOldSubjectIds);
        const createdCharacters = [];

        for (const charSpec of materialized.characters) {
          let created = store.createCharacter(campaign.id, {
            slug: charSpec.slug,
            scribeSubjectId: charSpec.scribeSubjectId,
            name: charSpec.name,
            aliases: charSpec.aliases,
            isPlayer: charSpec.isPlayer,
            tier: charSpec.tier,
            avatarToken: charSpec.avatarToken,
            persona: charSpec.persona,
          });
          if (charSpec.archived) {
            created = store.updateCharacter(campaign.id, created.id, { archived: true });
          }
          createdCharacters.push(created);
          if (created.isPlayer) {
            playerCharacterId = created.id;
          }
          if (!created.archived && (presentOldSet.has(charSpec.oldSubjectId) || (presentOldSet.size === 0 && created.tier === CharacterTier.Main))) {
            presentCharacterIds.push(created.id);
          }
        }

        if (playerCharacterId !== null || presentCharacterIds.length > 0) {
          store.updateCampaign(campaign.id, {
            ...(playerCharacterId !== null ? { playerCharacterId } : {}),
            sceneState: {
              sceneNumber: 1,
              day: parsedExport.initialScene.day,
              timeLabel: parsedExport.initialScene.timeLabel,
              location: parsedExport.initialScene.location,
              sceneType: parsedExport.initialScene.sceneType,
              presentIds: presentCharacterIds,
              remoteIds: [],
              offscreenNotes: {},
              activeWalkOns: [],
            },
          });
        }

        store.saveScribeBook(campaign.id, {
          bookJson,
          lastTurnSeq: 0,
          dirty: false,
        });

        return { campaign, createdCharacters };
      });

      return {
        ...summary,
        dbPath: resolvedDbPath,
        campaignId: campaignRecord.campaign.id,
        replacedExisting: Boolean(force),
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
      process.stdout.write(
        'Usage: node scripts/seed-from-export.mjs [exportPath] [--title <title>] [--db <sqlitePath>] [--main <slugOrName,...>] [--dry-run] [--force]\n',
      );
      process.exit(0);
    }
    const result = ZetaSeeder.run({
      exportPath: cliOptions.exportPath,
      dbPath: cliOptions.dbPath,
      title: cliOptions.title,
      dryRun: cliOptions.dryRun,
      force: cliOptions.force,
      mainRefs: cliOptions.mainRefs,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`Seed failed: ${error.message}\n`);
    process.exit(1);
  }
}
