import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInContext } from 'node:vm';
import { VocaliaSandbox } from './support/VocaliaSandbox.mjs';

const [narrator, collette, lize, viola] = VocaliaSandbox.Members;
const absent = VocaliaSandbox.Absent;
const present = VocaliaSandbox.Present;
const narratorAvatar = narrator.avatar;
const messageId = 4;
const tailMessageId = 9;
const tailWindow = Object.freeze({ start: 10, end: 10, generationId: 10, count: 1 });
const castAbsent = Object.freeze(['Collette', 'Lize', 'Viola']);
const withoutNarrator = Object.freeze([Object.freeze({ narrator: false }), Object.freeze({ muted: true })]);
const overrides = Object.freeze([
  'findMentionedPresentMembers', 'getRouteEligibleMembersCompat', 'isMemberRouteEligibleCompat', 'applyUserDepartureBootstrap',
  'detectUserSummonBootstrap', 'selectTargetsForLatestUnansweredUserMessageRecovery', 'selectTargetsForEmptySendContinuation',
  'selectFirstSpeakerForOpeningUserMessage', 'validTargetsFromBlock', 'applyOwnerBlockToState', 'getControlledActionFallbackTarget',
  'resolveContinueTarget', 'selectContinuationTargetsForUserMessage',
]);
const pickers = Object.freeze({
  selectFirstSpeakerForOpeningUserMessage: Object.freeze({ args: [messageId], fallback: true, alone: null, shape: null }),
  selectContinuationTargetsForUserMessage: Object.freeze({
    args: [messageId, {}], fallback: true, alone: 'universe-narrator-alone', shape: { reason: 'no-continuation-target' },
  }),
  selectTargetsForLatestUnansweredUserMessageRecovery: Object.freeze({
    args: [], fallback: false, alone: null,
    shape: { hasLatestUserMessage: true, reason: 'empty-send-latest-user-no-continuation-target', sourceMessageId: messageId },
  }),
  selectTargetsForEmptySendContinuation: Object.freeze({
    args: [], fallback: true, alone: 'empty-send-universe-narrator-alone', shape: { reason: 'empty-send-no-continuation-target' },
  }),
  getControlledActionFallbackTarget: Object.freeze({
    args: ['continue', 0, null], fallback: true, alone: 'controlled-continue-universe-narrator-alone', single: true,
    options: { unanswered: tailMessageId },
    shape: {
      messageId: 0, message: null, source: 'no_controlled_action_target', reason: 'controlled-continue-no-target',
      rejectedMessageCandidate: null,
    },
  }),
});
const selectors = Object.freeze([
  'selectFirstSpeakerForOpeningUserMessage', 'selectContinuationTargetsForUserMessage',
  'selectTargetsForLatestUnansweredUserMessageRecovery', 'getControlledActionFallbackTarget',
]);

/**
 * @param {*} value
 * @returns {*}
 * @throws {Error}
 */
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {Array<object>} members
 * @returns {string[]}
 * @throws {TypeError}
 */
function names(members) {
  return Array.from(members, member => member.name);
}

/**
 * @param {*} value
 * @returns {function(): *}
 */
function returns(value) {
  /**
   * @returns {*}
   */
  const answer = () => value;
  return answer;
}

/**
 * @param {{shape: ?object, single: ?boolean}} picker
 * @param {Array<object>} targets
 * @returns {*}
 * @throws {TypeError}
 */
function baseResult(picker, targets) {
  if (!picker.shape) {
    return targets;
  }
  if (picker.single) {
    return { ...picker.shape, member: targets[0] ?? null };
  }
  return { ...picker.shape, targets };
}

/**
 * @param {*} result
 * @returns {Array<object>}
 * @throws {TypeError}
 */
function picked(result) {
  if (Array.isArray(result)) {
    return Array.from(result);
  }
  if (Object.hasOwn(result, 'member')) {
    return result.member ? [result.member] : [];
  }
  return Array.from(result.targets);
}

/**
 * @param {string} name
 * @param {object} parameters
 * @param {boolean} [routingMalformed]
 * @param {string} [participationNextTurn]
 * @returns {{name: string, routingMalformed: boolean, parameters: object, participationNextTurn: string}}
 */
function reply(name, parameters, routingMalformed = false, participationNextTurn = 'idle') {
  return { name, routingMalformed, parameters, participationNextTurn };
}

/**
 * @param {object} block
 * @param {?object} owner
 * @param {boolean} [ownerEligible]
 * @returns {VocaliaSandbox}
 * @throws {*}
 */
function applyBlock(block, owner, ownerEligible = true) {
  const targets = [lize];
  const sandbox = VocaliaSandbox.stubbed({ ownerEligible, bases: { applyOwnerBlockToState: returns(targets) } });
  assert.equal(sandbox.context.applyOwnerBlockToState(block, owner, 9, false), targets);
  const [[, receivedOwner, receivedId, first]] = sandbox.called('vocaliaBase_applyOwnerBlockToState');
  assert.deepEqual([receivedOwner, receivedId, first], [owner, 9, false]);
  return sandbox;
}

/**
 * @param {string} mes
 * @returns {{name: string, is_user: boolean, mes: string}}
 */
function said(mes) {
  return { name: 'Frost', is_user: true, mes };
}

/**
 * @param {string} name
 * @param {string} [parameters]
 * @param {string} [content]
 * @returns {{name: string, is_user: boolean, mes: string}}
 */
function spoke(name, parameters = 'speakingTo=user, participationNextTurn=idle, arriving=none', content = '[dialogue]Hello.[end dialogue]') {
  return { name, is_user: false, mes: `[character=${name}]${content}[parameters]${parameters}[end parameters][end character]` };
}

/**
 * @param {string} name
 * @returns {{name: string, is_user: boolean, mes: string}}
 */
function greeted(name) {
  return { name, is_user: false, mes: `${name} waves from the doorway.` };
}

/**
 * @param {string} name
 * @returns {{name: string, is_user: boolean, mes: string}}
 */
function blankReply(name) {
  return { name, is_user: false, mes: '' };
}

/**
 * @param {Array<object>} chat
 * @returns {Array<object>}
 * @throws {TypeError}
 */
function generated(chat) {
  return chat.map((message, index) => (message.is_user ? message : { ...message, extra: { gen_id: VocaliaSandbox.Now + index } }));
}

/**
 * @param {VocaliaSandbox} sandbox
 * @param {number} messageId
 * @returns {object}
 * @throws {*}
 */
function clickedOn(sandbox, messageId) {
  const button = new sandbox.context.Element();
  /**
   * @returns {{id: string, getAttribute: function(string): ?string}}
   */
  button.closest = () => ({
    id: '',
    /**
     * @param {string} attribute
     * @returns {?string}
     */
    getAttribute: attribute => (attribute === 'mesid' ? String(messageId) : null),
  });
  return button;
}

/**
 * @param {VocaliaSandbox} sandbox
 * @param {number} tailId
 * @param {string} source
 * @returns {Promise<{member: ?string, sourceMessageId: ?number, reason: string}>}
 * @throws {*}
 */
async function regenerated(sandbox, tailId, source) {
  await sandbox.context.handleVocaliaControlledGeneration('regenerate', clickedOn(sandbox, tailId), source);
  const session = runInContext('vocaliaControlledGenerationSession', sandbox.context);
  const resolved = runInContext('vocaliaDebugEntries', sandbox.context)
    .findLast(entry => entry.type === 'controlled_generation.target_after_regenerate_source_summon_recovery');
  return { member: session?.targetName ?? null, sourceMessageId: session?.sourceMessageId ?? null, reason: resolved.details.reason };
}

/**
 * @param {VocaliaSandbox} sandbox
 * @param {number} index
 * @returns {object}
 * @throws {*}
 */
function applyReply(sandbox, index) {
  const [block] = sandbox.context.parseStructuredMessage(sandbox.tavern.chat[index].mes);
  sandbox.context.applyOwnerBlockToState(block, sandbox.member(block.name), index, true);
  return block;
}

/**
 * @param {number} userMessageId
 * @returns {function(VocaliaSandbox): Array<object>}
 */
function opening(userMessageId) {
  /**
   * @param {VocaliaSandbox} sandbox
   * @returns {Array<object>}
   * @throws {*}
   */
  const run = sandbox => sandbox.context.selectFirstSpeakerForOpeningUserMessage(userMessageId);
  return run;
}

/**
 * @param {number} userMessageId
 * @returns {function(VocaliaSandbox): {reason: string, targets: Array<object>}}
 */
function continuation(userMessageId) {
  /**
   * @param {VocaliaSandbox} sandbox
   * @returns {{reason: string, targets: Array<object>}}
   * @throws {*}
   */
  const run = sandbox => sandbox.context.selectContinuationTargetsForUserMessage(userMessageId, sandbox.state());
  return run;
}

/**
 * @param {VocaliaSandbox} sandbox
 * @returns {{reason: string, targets: Array<object>}}
 * @throws {*}
 */
function emptySend(sandbox) {
  return sandbox.context.selectTargetsForEmptySendContinuation();
}

/**
 * @param {VocaliaSandbox} sandbox
 * @returns {{member: ?object, reason: string}}
 * @throws {*}
 */
function continueTail(sandbox) {
  return sandbox.context.resolveControlledGenerationTarget('continue', null);
}

/**
 * @param {object} options
 * @param {function(VocaliaSandbox): *} run
 * @param {string} [label]
 * @returns {{result: *, sandbox: VocaliaSandbox}}
 * @throws {*}
 */
function sameAsVocalia(options, run, label = '') {
  const original = VocaliaSandbox.vocalia({ ...options, built: false, universe: false });
  const built = VocaliaSandbox.vocalia({ ...options, built: true });
  const result = run(original);
  assert.deepEqual(plain(run(built)), plain(result), label);
  assert.deepEqual(plain(built.state()), plain(original.state()), label);
  assert.deepEqual(built.calls, [], label);
  return { result, sandbox: original };
}

/**
 * @param {object} options
 * @param {function(VocaliaSandbox): *} run
 * @returns {{original: *, originalSandbox: VocaliaSandbox, result: *, sandbox: VocaliaSandbox}}
 * @throws {*}
 */
function variants(options, run) {
  const original = sameAsVocalia({ ...options, universe: false }, run);
  const sandbox = VocaliaSandbox.vocalia({ ...options, universe: true });
  return { original: original.result, originalSandbox: original.sandbox, result: run(sandbox), sandbox };
}

test('every override returns its base result for the same arguments and does nothing else, without universeNarrator, without a narrator in the group, or with the narrator muted', () => {
  for (const options of [{ universe: false }, { universe: true, narrator: false }, { universe: true, muted: true }]) {
    for (const name of overrides) {
      const sentinel = { base: name };
      const sandbox = VocaliaSandbox.stubbed({ ...options, unanswered: tailMessageId, bases: { [name]: returns(sentinel) } });
      const override = sandbox.context[name];
      const args = [];
      for (let index = 0; index < override.length; index++) {
        args.push({ argument: index });
      }
      const label = `${name} ${JSON.stringify(options)}`;
      assert.equal(override(...args), sentinel, label);
      assert.deepEqual(sandbox.calls.filter(([callee]) => callee !== 'getGroupMembers'), [[`vocaliaBase_${name}`, args]], label);
    }
  }
});

test('the summon detection keeps its evidence and empties physical, remote and targets', () => {
  const evidence = [{ type: 'present', alias: 'Viola', reason: 'explicit_summon' }];
  const detection = { physical: [viola], remote: [lize], targets: [lize, viola], evidence };
  const sandbox = VocaliaSandbox.stubbed({ bases: { detectUserSummonBootstrap: returns(detection) } });
  const result = sandbox.context.detectUserSummonBootstrap('need to get vegetables to Viola');
  assert.deepEqual(plain(result), { physical: [], remote: [], targets: [], evidence: plain(evidence) });
  assert.equal(result.evidence, evidence);
  assert.deepEqual(sandbox.called('vocaliaBase_detectUserSummonBootstrap'), [['need to get vegetables to Viola']]);
});

test('a player departure changes nothing and never runs the base', () => {
  const sandbox = VocaliaSandbox.stubbed();
  const result = sandbox.context.applyUserDepartureBootstrap(messageId, 'I leave Collette behind and walk out alone.');
  assert.deepEqual(plain(result), []);
  assert.deepEqual(sandbox.calls.filter(([callee]) => callee !== 'getGroupMembers'), []);
});

test('firstSpeaker wins in the three selectors and the Continue fallback, and the recovery and the fallback keep their other fields', () => {
  const recoveryBase = { hasLatestUserMessage: true, reason: 'empty-send-latest-user-most-recent', targets: [collette], sourceMessageId: 7 };
  const fallbackBase = { ...pickers.getControlledActionFallbackTarget.shape, member: collette, source: 'last_speaker' };
  const sandbox = VocaliaSandbox.stubbed({
    speaker: narratorAvatar,
    unanswered: tailMessageId,
    bases: {
      selectTargetsForLatestUnansweredUserMessageRecovery: returns(recoveryBase),
      getControlledActionFallbackTarget: returns(fallbackBase),
      isMemberRouteEligibleCompat: returns(true),
    },
  });
  const first = sandbox.context.selectFirstSpeakerForOpeningUserMessage(messageId);
  assert.deepEqual(names(first), ['Narrator']);
  assert.equal(first[0], narrator);
  const later = sandbox.context.selectContinuationTargetsForUserMessage(messageId, {});
  assert.deepEqual(plain(later), plain({ reason: 'universe-narrator', targets: [narrator] }));
  const recovery = sandbox.context.selectTargetsForLatestUnansweredUserMessageRecovery();
  assert.deepEqual(plain(recovery), plain({ ...recoveryBase, reason: 'empty-send-latest-user-universe-narrator', targets: [narrator] }));
  const fallback = sandbox.context.getControlledActionFallbackTarget('continue', 0, null);
  assert.deepEqual(plain(fallback), plain({ ...fallbackBase, reason: 'controlled-continue-universe-narrator', member: narrator }));
  assert.deepEqual(sandbox.called('firstSpeaker'), [[messageId], [messageId], [7], [tailMessageId]]);
  assert.deepEqual(sandbox.called('vocaliaBase_selectFirstSpeakerForOpeningUserMessage'), []);
  assert.deepEqual(sandbox.called('vocaliaBase_selectContinuationTargetsForUserMessage'), []);
  assert.deepEqual(sandbox.called('setPresence'), []);
});

test('a narrator named by firstSpeaker while neither present nor remote is set present, and the prompt refreshed, before it is returned', () => {
  for (const name of selectors) {
    const picker = pickers[name];
    const sandbox = VocaliaSandbox.stubbed({
      ...picker.options,
      speaker: narratorAvatar,
      bases: { [name]: returns(baseResult(picker, [collette])), isMemberRouteEligibleCompat: returns(false) },
    });
    assert.deepEqual(names(picked(sandbox.context[name](...picker.args))), ['Narrator'], name);
    assert.deepEqual(sandbox.called('setPresence'), [[narratorAvatar, present]], name);
    assert.deepEqual(sandbox.called('vocaliaBase_isMemberRouteEligibleCompat'), [[narrator]], name);
    const callees = sandbox.calls.map(([callee]) => callee);
    const marked = callees.indexOf('setPresence');
    assert.ok(marked > callees.indexOf('vocaliaBase_isMemberRouteEligibleCompat'), name);
    assert.deepEqual(
      callees.slice(marked, marked + 4), ['setPresence', 'updateExtensionPrompt', 'updateDiagnosticsPanel', 'saveMetadata'], name,
    );
  }
  const member = VocaliaSandbox.stubbed({ speaker: 'Collette.png', bases: { isMemberRouteEligibleCompat: returns(false) } });
  assert.deepEqual(names(member.context.selectFirstSpeakerForOpeningUserMessage(messageId)), ['Collette']);
  assert.deepEqual(member.called('setPresence'), []);
  assert.deepEqual(member.called('updateExtensionPrompt'), []);
});

test('no avatar, or an avatar that is not a group member, from firstSpeaker counts as no decision', () => {
  for (const speaker of [null, 'Stranger.png']) {
    for (const name of selectors) {
      const picker = pickers[name];
      const base = baseResult(picker, [collette]);
      const sandbox = VocaliaSandbox.stubbed({ ...picker.options, speaker, bases: { [name]: returns(base) } });
      assert.equal(sandbox.context[name](...picker.args), base, `${name} ${speaker}`);
      assert.deepEqual(sandbox.called('getMemberByAvatar'), [[speaker]], name);
    }
  }
  const unanswered = { hasLatestUserMessage: false, reason: 'empty-send-no-latest-unanswered-user-message', targets: [], sourceMessageId: 3 };
  const sandbox = VocaliaSandbox.stubbed({
    speaker: narratorAvatar,
    bases: {
      selectTargetsForLatestUnansweredUserMessageRecovery: returns(unanswered),
      getRouteEligibleMembersCompat: returns([narrator]),
    },
  });
  assert.equal(sandbox.context.selectTargetsForLatestUnansweredUserMessageRecovery(), unanswered);
  assert.deepEqual(sandbox.called('firstSpeaker'), []);
});

test('the controlled fallback hides the narrator for Continue and Regenerate, and asks no one without a player message to answer', () => {
  const cases = [
    { action: 'continue', unanswered: null, lastReply: null },
    { action: 'continue', unanswered: tailMessageId, lastReply: tailMessageId + 1 },
    { action: 'regenerate', unanswered: null, lastReply: null },
  ];
  for (const { action, unanswered, lastReply } of cases) {
    const label = JSON.stringify({ action, unanswered, lastReply });
    const flags = [];
    const fallback = { ...pickers.getControlledActionFallbackTarget.shape, member: lize, source: 'last_speaker' };
    const sandbox = VocaliaSandbox.stubbed({
      speaker: narratorAvatar,
      unanswered,
      lastReply,
      bases: {
        /**
         * @returns {object}
         * @throws {*}
         */
        getControlledActionFallbackTarget: () => {
          flags.push(sandbox.picking);
          return fallback;
        },
      },
    });
    assert.equal(sandbox.context.getControlledActionFallbackTarget(action, 8, null), fallback, label);
    assert.deepEqual(flags, [true], label);
    assert.deepEqual(sandbox.called('firstSpeaker'), [], label);
  }
  for (const [action, lastReply, reason] of [
    ['continue', tailMessageId - 1, 'controlled-continue-universe-narrator'],
    ['regenerate', tailMessageId + 1, 'controlled-regenerate-universe-narrator'],
  ]) {
    const answering = VocaliaSandbox.stubbed({
      speaker: narratorAvatar,
      unanswered: tailMessageId,
      lastReply,
      tailWindow,
      bases: {
        getControlledActionFallbackTarget: returns({ ...pickers.getControlledActionFallbackTarget.shape, member: collette }),
        isMemberRouteEligibleCompat: returns(true),
      },
    });
    const target = answering.context.getControlledActionFallbackTarget(action, 10, null);
    assert.deepEqual([target.member, target.reason], [narrator, reason], action);
    assert.deepEqual(answering.called('firstSpeaker'), [[tailMessageId]], action);
    assert.equal(answering.called('getTailRegenerateDeleteWindow').length, action === 'regenerate' ? 1 : 0, action);
  }
  const answered = VocaliaSandbox.stubbed({
    unanswered: tailMessageId,
    tailWindow,
    bases: {
      getControlledActionFallbackTarget: returns({ ...pickers.getControlledActionFallbackTarget.shape, member: collette }),
    },
  });
  answered.context.getControlledActionFallbackTarget('regenerate', 10, null);
  assert.deepEqual(answered.called('findLatestUserMessageBefore'), [[10]]);
  assert.deepEqual(answered.called('firstSpeaker'), [[tailMessageId]]);
});

test('the recovery answers a player message that only a blank reply follows, in Vocalia\'s found-message shape', () => {
  const unfound = { hasLatestUserMessage: false, reason: 'empty-send-no-latest-unanswered-user-message', targets: [], sourceMessageId: 7 };
  const directed = VocaliaSandbox.stubbed({
    speaker: narratorAvatar,
    unanswered: 6,
    lastReply: 5,
    bases: {
      selectTargetsForLatestUnansweredUserMessageRecovery: returns(unfound),
      isMemberRouteEligibleCompat: returns(true),
    },
  });
  assert.deepEqual(plain(directed.context.selectTargetsForLatestUnansweredUserMessageRecovery()), plain({
    hasLatestUserMessage: true, reason: 'empty-send-latest-user-universe-narrator', targets: [narrator], sourceMessageId: 6,
  }));
  assert.deepEqual(directed.called('firstSpeaker'), [[6]]);
  for (const [speaker, unanswered] of [[null, 6], [narratorAvatar, null]]) {
    const undirected = VocaliaSandbox.stubbed({
      speaker,
      unanswered,
      lastReply: 5,
      bases: { selectTargetsForLatestUnansweredUserMessageRecovery: returns(unfound) },
    });
    assert.equal(undirected.context.selectTargetsForLatestUnansweredUserMessageRecovery(), unfound, `${speaker} ${unanswered}`);
    assert.deepEqual(undirected.called('firstSpeaker'), unanswered === null ? [] : [[6]], `${speaker} ${unanswered}`);
  }
});

test('each picker hides the narrator from the eligibility checks only while its base runs', () => {
  const outside = { eligible: ['Narrator', 'Collette'], narrator: true, collette: true, viola: false, mentioned: ['Narrator', 'Lize'] };
  const inside = { eligible: ['Collette'], narrator: false, collette: true, viola: false, mentioned: ['Lize'] };
  for (const [name, picker] of Object.entries(pickers)) {
    const seen = [];
    const base = baseResult(picker, [collette]);
    const sandbox = VocaliaSandbox.stubbed({
      ...picker.options,
      bases: {
        /**
         * @returns {*}
         * @throws {*}
         */
        [name]: () => {
          seen.push(eligibility());
          return base;
        },
        getRouteEligibleMembersCompat: returns([narrator, collette]),
        /**
         * @param {object} member
         * @returns {boolean}
         */
        isMemberRouteEligibleCompat: member => member !== viola,
        findMentionedPresentMembers: returns([narrator, lize]),
      },
    });
    /**
     * @returns {{eligible: string[], narrator: boolean, collette: boolean, viola: boolean, mentioned: string[]}}
     * @throws {*}
     */
    const eligibility = () => ({
      eligible: names(sandbox.context.getRouteEligibleMembersCompat()),
      narrator: sandbox.context.isMemberRouteEligibleCompat(narrator),
      collette: sandbox.context.isMemberRouteEligibleCompat(collette),
      viola: sandbox.context.isMemberRouteEligibleCompat(viola),
      mentioned: names(sandbox.context.findMentionedPresentMembers('I ask the narrator and Lize about it')),
    });
    assert.deepEqual(eligibility(), outside, name);
    assert.equal(sandbox.context[name](...picker.args), base, name);
    assert.deepEqual(seen, [inside], name);
    assert.deepEqual(eligibility(), outside, name);
  }
});

test('the opening, continuation, empty-Send and Continue pickers fall back to the narrator only when their base finds no one and the narrator is the only eligible member; the recovery leaves that to the empty-Send picker', () => {
  for (const [name, picker] of Object.entries(pickers)) {
    const base = baseResult(picker, []);
    const sandbox = VocaliaSandbox.stubbed({
      ...picker.options, bases: { [name]: returns(base), getRouteEligibleMembersCompat: returns([narrator]) },
    });
    const result = sandbox.context[name](...picker.args);
    if (!picker.fallback) {
      assert.equal(result, base, name);
      continue;
    }
    assert.deepEqual(names(picked(result)), ['Narrator'], name);
    assert.equal(picked(result)[0], narrator, name);
    if (picker.alone) {
      assert.equal(result.reason, picker.alone, name);
    }
    if (picker.shape) {
      assert.deepEqual(plain({ ...result, reason: base.reason, targets: base.targets, member: base.member }), plain(base), name);
    }
    for (const [targets, eligible] of [[[], [narrator, collette]], [[], [collette]], [[collette], [narrator]]]) {
      const kept = baseResult(picker, targets);
      const crowded = VocaliaSandbox.stubbed({
        ...picker.options, bases: { [name]: returns(kept), getRouteEligibleMembersCompat: returns(eligible) },
      });
      assert.equal(crowded.context[name](...picker.args), kept, `${name} ${names(eligible)}`);
    }
  }
});

test('the first selector answering a player message asks firstSpeaker once with its id, also under the empty-Send picker and the Continue fallback', () => {
  for (const selector of ['selectFirstSpeakerForOpeningUserMessage', 'selectContinuationTargetsForUserMessage']) {
    for (const speaker of [narratorAvatar, null]) {
      const label = `${selector} ${speaker}`;
      const sandbox = VocaliaSandbox.stubbed({
        speaker,
        bases: {
          /**
           * @returns {*}
           * @throws {*}
           */
          selectTargetsForEmptySendContinuation: () => sandbox.context.selectTargetsForLatestUnansweredUserMessageRecovery(),
          /**
           * @returns {*}
           * @throws {*}
           */
          selectTargetsForLatestUnansweredUserMessageRecovery: () => ({
            hasLatestUserMessage: true,
            reason: 'empty-send-latest-user-most-recent',
            targets: picked(sandbox.context[selector](6, {})),
            sourceMessageId: 6,
          }),
          [selector]: returns(baseResult(pickers[selector], [collette])),
          getRouteEligibleMembersCompat: returns([narrator, collette]),
          isMemberRouteEligibleCompat: returns(true),
        },
      });
      const result = sandbox.context.selectTargetsForEmptySendContinuation();
      assert.deepEqual(sandbox.called('firstSpeaker'), [[6]], label);
      assert.deepEqual(names(result.targets), [speaker ? 'Narrator' : 'Collette'], label);
      assert.equal(sandbox.called(`vocaliaBase_${selector}`).length, 1, label);
      const controlled = VocaliaSandbox.stubbed({
        speaker,
        unanswered: tailMessageId,
        bases: {
          /**
           * @returns {object}
           * @throws {*}
           */
          getControlledActionFallbackTarget: () => ({
            ...pickers.getControlledActionFallbackTarget.shape,
            member: picked(controlled.context[selector](6, {}))[0],
          }),
          [selector]: returns(baseResult(pickers[selector], [collette])),
          isMemberRouteEligibleCompat: returns(true),
        },
      });
      assert.equal(controlled.context.getControlledActionFallbackTarget('continue', 0, null).member, speaker ? narrator : collette, label);
      assert.deepEqual(controlled.called('firstSpeaker'), [[tailMessageId]], label);
    }
    const direct = VocaliaSandbox.stubbed({
      speaker: narratorAvatar,
      bases: {
        /**
         * @returns {{reason: string, targets: Array<object>}}
         * @throws {*}
         */
        selectTargetsForEmptySendContinuation: () => ({
          reason: 'empty-send-most-recent', targets: picked(direct.context[selector](8, {})),
        }),
        isMemberRouteEligibleCompat: returns(true),
      },
    });
    assert.deepEqual(names(direct.context.selectTargetsForEmptySendContinuation().targets), ['Narrator'], selector);
    assert.deepEqual(direct.called('firstSpeaker'), [[8]], selector);
  }
  const outer = VocaliaSandbox.stubbed({
    bases: {
      /**
       * @returns {Array<object>}
       * @throws {*}
       */
      selectFirstSpeakerForOpeningUserMessage: () => outer.context.selectContinuationTargetsForUserMessage(5, {}).targets,
      selectContinuationTargetsForUserMessage: returns({ reason: 'most-recent', targets: [lize] }),
    },
  });
  assert.deepEqual(names(outer.context.selectFirstSpeakerForOpeningUserMessage(messageId)), ['Lize']);
  assert.deepEqual(outer.called('firstSpeaker'), [[messageId]]);
});

test('a throw inside a picking run, from the base or from universeNarrator, leaves both flags cleared', () => {
  for (const [name, picker] of Object.entries(pickers)) {
    for (const source of ['base', 'isNarrator', 'firstSpeaker']) {
      if (source === 'firstSpeaker' && !['selectFirstSpeakerForOpeningUserMessage', 'selectContinuationTargetsForUserMessage'].includes(name)) {
        continue;
      }
      const label = `${name} ${source}`;
      const failure = new Error(`${source} failed`);
      const flags = [];
      const sandbox = VocaliaSandbox.stubbed({
        ...picker.options,
        bases: {
          /**
           * @returns {*}
           * @throws {Error}
           */
          [name]: () => {
            flags.push(sandbox.picking);
            sandbox.context.getRouteEligibleMembersCompat();
            throw failure;
          },
          getRouteEligibleMembersCompat: returns([narrator, collette]),
        },
      });
      const universe = sandbox.context.universeNarrator;
      const isNarrator = universe.isNarrator;
      if (source !== 'base') {
        /**
         * @returns {never}
         * @throws {Error}
         */
        universe[source] = () => {
          throw failure;
        };
      }
      assert.throws(() => sandbox.context[name](...picker.args), error => error === failure, label);
      assert.deepEqual(flags, source === 'base' ? [true] : [], label);
      assert.equal(sandbox.picking, false, label);
      assert.equal(runInContext('universeAnswering', sandbox.context), false, label);
      universe.isNarrator = isNarrator;
      assert.deepEqual(names(sandbox.context.getRouteEligibleMembersCompat()), ['Narrator', 'Collette'], label);
    }
  }
});

test('validTargetsFromBlock gives Vocalia a copy of the block without the names that resolve to the narrator', () => {
  const targets = [lize];
  const block = { name: 'Collette', routingMalformed: false, speakingTo: ['Narrator', 'Lize', 'user', 'Stranger', ' narrator '] };
  const sandbox = VocaliaSandbox.stubbed({ bases: { validTargetsFromBlock: returns(targets) } });
  assert.equal(sandbox.context.validTargetsFromBlock(block, collette), targets);
  const [[copy, owner]] = sandbox.called('vocaliaBase_validTargetsFromBlock');
  assert.notEqual(copy, block);
  assert.deepEqual(plain(copy), { ...block, speakingTo: ['Lize', 'user', 'Stranger'] });
  assert.equal(owner, collette);
  assert.deepEqual(block.speakingTo, ['Narrator', 'Lize', 'user', 'Stranger', ' narrator ']);
  assert.deepEqual(sandbox.called('getMemberByName').map(([name]) => name), ['Narrator', 'Lize', 'Stranger', ' narrator ']);
});

test('leaving=Collette|Lize from the narrator sets both absent after the base and before onReplyBlock', () => {
  for (const leaving of ['Collette|Lize', ' collette | LIZE ']) {
    const block = reply('Narrator', { leaving });
    const sandbox = applyBlock(block, narrator);
    assert.deepEqual(sandbox.called('setPresence'), [['Collette.png', absent], ['Lize.png', absent]], leaving);
    assert.deepEqual(sandbox.calls.map(([callee]) => callee), [
      'getGroupMembers', 'isOwnerEligibleForStateTransitions', 'vocaliaBase_applyOwnerBlockToState', 'getGroupMembers',
      'setPresence', 'setPresence', 'onReplyBlock',
    ], leaving);
  }
});

test('leaving=Col, names not split on |, no leaving key and leaving from another member set nothing', () => {
  const cases = [
    [reply('Narrator', { leaving: 'Col' }), narrator],
    [reply('Narrator', { leaving: 'Collette, Lize' }), narrator],
    [reply('Narrator', { leaving: 'Collette and Lize' }), narrator],
    [reply('Narrator', {}), narrator],
    [reply('Collette', { leaving: 'Lize' }), collette],
    [reply('Colette', { leaving: 'Lize' }), null],
  ];
  for (const [block, owner] of cases) {
    assert.deepEqual(applyBlock(block, owner).called('setPresence'), [], JSON.stringify(block));
  }
});

test('a malformed narrator block sets nothing', () => {
  const sandbox = applyBlock(reply('Narrator', { leaving: 'Collette|Lize' }, true), narrator);
  assert.deepEqual(sandbox.called('setPresence'), []);
});

test('leaving= sets nothing when Vocalia refused the narrator block, and never marks the narrator itself absent', () => {
  const refused = applyBlock(reply('Narrator', { leaving: 'Collette|Lize' }), narrator, false);
  assert.deepEqual(refused.called('isOwnerEligibleForStateTransitions'), [[narrator]]);
  assert.deepEqual(refused.called('setPresence'), []);
  assert.equal(refused.called('onReplyBlock').length, 1);
  const itself = applyBlock(reply('Narrator', { leaving: 'Narrator|Collette' }), narrator);
  assert.deepEqual(itself.called('setPresence'), [['Collette.png', absent]]);
});

test('an accepted narrator block that departs reaches Vocalia as an idle copy, while onReplyBlock gets the original', () => {
  const block = reply('Narrator', { leaving: 'Viola' }, false, 'departing');
  const departing = applyBlock(block, narrator);
  const [[copy]] = departing.called('vocaliaBase_applyOwnerBlockToState');
  assert.notEqual(copy, block);
  assert.deepEqual(plain(copy), plain({ ...block, participationNextTurn: 'idle' }));
  assert.equal(block.participationNextTurn, 'departing');
  assert.deepEqual(departing.called('onReplyBlock'), [[block, narratorAvatar, 9]]);
  assert.deepEqual(departing.called('setPresence'), [['Viola.png', absent]]);
  const cases = [
    [reply('Narrator', {}, false, 'departing'), narrator, false],
    [reply('Narrator', {}, true, 'departing'), narrator, true],
    [reply('Collette', {}, false, 'departing'), collette, true],
    [reply('Narrator', {}, false, 'idle'), narrator, true],
  ];
  for (const [untouched, owner, ownerEligible] of cases) {
    const sandbox = applyBlock(untouched, owner, ownerEligible);
    assert.equal(sandbox.called('vocaliaBase_applyOwnerBlockToState')[0][0], untouched, JSON.stringify(untouched));
    assert.deepEqual(sandbox.called('setPresence'), [], JSON.stringify(untouched));
  }
});

test('with a narrator in the group, onReplyBlock receives the owner block of every reply Vocalia does not refuse, malformed and ownerless ones included', () => {
  const cases = [
    [reply('Narrator', { leaving: 'Viola' }), narrator, narratorAvatar],
    [reply('Narrator', { leaving: 'Viola' }, true), narrator, narratorAvatar],
    [reply('Collette', { scene: 'private' }), collette, 'Collette.png'],
    [reply('Colette', { scene: 'public' }, true), null, null],
  ];
  for (const [block, owner, ownerAvatar] of cases) {
    assert.deepEqual(applyBlock(block, owner).called('onReplyBlock'), [[block, ownerAvatar, 9]], block.name);
  }
});

test('the build renames each override declared once in the installed Vocalia and appends the fragment', () => {
  assert.deepEqual([...VocaliaSandbox.overriddenNames()].sort(), [...overrides].sort());
  const built = VocaliaSandbox.built();
  for (const name of overrides) {
    assert.equal(VocaliaSandbox.Vocalia.split(`function ${name}(`).length - 1, 1, name);
    assert.equal(built.split(`function vocaliaBase_${name}(`).length - 1, 1, name);
    assert.equal(built.split(`function ${name}(`).length - 1, 1, name);
  }
  assert.ok(built.endsWith(`\n${VocaliaSandbox.Fragment}`));
});

test('every top-level name in the fragment is an override or starts with universe, and none collides with Vocalia', () => {
  const vocaliaNames = new Set([...VocaliaSandbox.Vocalia.matchAll(
    /^(?:export )?(?:async )?function ([\w$]+)\(|^(?:const|let|var|class) ([\w$]+)/gm,
  )].map(match => match[1] ?? match[2]));
  const fragmentNames = [...VocaliaSandbox.Fragment.matchAll(/^(?:(?:async )?function|const|let|var|class) ([\w$]+)/gm)]
    .map(match => match[1]);
  assert.doesNotMatch(VocaliaSandbox.Fragment, /^(?:import|export)\b/m);
  assert.ok(['universeReasons', 'universePicking', 'universeAnswering'].every(name => fragmentNames.includes(name)));
  for (const name of fragmentNames) {
    if (name.startsWith('universe')) {
      assert.ok(!vocaliaNames.has(name), name);
    } else {
      assert.ok(overrides.includes(name) && vocaliaNames.has(name), name);
    }
  }
  assert.ok(![...vocaliaNames].some(name => name.startsWith('universe') || name.startsWith('vocaliaBase_')));
});

test('each anchored change to the in-memory Vocalia text matches exactly once, keeps the line count, and a miss names it', () => {
  const built = VocaliaSandbox.built();
  const anchored = VocaliaSandbox.anchored(built);
  assert.ok(anchored.startsWith("'use strict';"));
  assert.equal(anchored.split('\n').length, built.split('\n').length);
  assert.doesNotMatch(anchored, /^(?:import|export)\b|import\.meta/m);
  for (const { name, pattern } of VocaliaSandbox.Anchors) {
    const missing = VocaliaSandbox.Vocalia.replace(pattern, '');
    assert.throws(() => VocaliaSandbox.anchored(missing), error => error.message === `Anchored change ${name} matches 0 times`, name);
  }
  assert.throws(
    () => VocaliaSandbox.anchored(`${VocaliaSandbox.Vocalia}\nimport.meta.url;`),
    error => error.message === 'Anchored change import.meta.url matches 2 times',
  );
});

test('real Vocalia: the stored speakingTo, waiting, most recent and last speaker rules stop picking the narrator after it spoke', () => {
  const quiet = { [narratorAvatar]: { speakingTo: [] } };
  const cases = [
    ['last-speaker-stored-speaking-to-targets', 3, {
      chat: [said('Hello.'), spoke('Narrator'), spoke('Collette', 'speakingTo=Narrator, participationNextTurn=idle, arriving=none'), said('What now?')],
      state: { lastSpeakerAvatar: 'Collette.png', members: { 'Collette.png': { speakingTo: ['Narrator'] } } },
    }],
    ['waiting-for-user', 4, {
      chat: [said('Hello.'), spoke('Collette'), said('Go on.'), spoke('Narrator'), said('Then?')],
      state: { lastSpeakerAvatar: narratorAvatar, waitingForUserByAvatar: narratorAvatar, members: { [narratorAvatar]: { speakingTo: ['user'] } } },
    }],
    ['most-recent-route-eligible-prior-assistant', 4, {
      chat: [said('Hello.'), spoke('Collette'), said('Go on.'), spoke('Narrator'), said('Then?')],
      state: { lastSpeakerAvatar: narratorAvatar, members: quiet },
    }],
    ['last-route-eligible-speaker-continuation', 2, {
      chat: [said('Hello.'), { name: 'Narrator', is_user: false, mes: '' }, said('Then?')],
      state: { lastSpeakerAvatar: narratorAvatar, members: quiet },
    }],
  ];
  for (const [reason, userMessageId, options] of cases) {
    const run = variants(options, continuation(userMessageId));
    assert.equal(run.original.reason, reason);
    assert.deepEqual(names(run.original.targets), ['Narrator'], reason);
    assert.deepEqual(names(run.result.targets), ['Collette'], reason);
  }
});

test('real Vocalia: the random and first fallbacks never return the narrator', () => {
  for (const firstMessageFallback of ['random_present', 'first_present']) {
    const settings = { firstMessageFallback };
    const later = variants({ chat: [said('Hello.'), said('Anyone?')], settings }, continuation(1));
    assert.deepEqual(names(later.original.targets), ['Narrator'], firstMessageFallback);
    assert.deepEqual(names(later.result.targets), ['Collette'], firstMessageFallback);
    const first = variants({ chat: [said('Hello.')], settings }, opening(0));
    assert.deepEqual(names(first.original), ['Narrator'], firstMessageFallback);
    assert.deepEqual(names(first.result), ['Collette'], firstMessageFallback);
  }
});

test('real Vocalia: "I ask the narrator about it" does not pick the narrator', () => {
  const line = 'I ask the narrator about it';
  const first = variants({ chat: [said(line)] }, opening(0));
  assert.deepEqual(names(first.original), ['Narrator']);
  assert.deepEqual(names(first.result), ['Collette']);
  const later = variants({ chat: [said('Hello.'), spoke('Collette'), said(line)] }, continuation(2));
  assert.equal(later.original.reason, 'explicit-user-address-or-summon');
  assert.deepEqual(names(later.original.targets), ['Narrator']);
  assert.deepEqual(names(later.result.targets), ['Collette']);
});

test('real Vocalia: "need to get vegetables to Viola" leaves absent Viola absent and makes no phone contact', () => {
  const cases = [['need to get vegetables to Viola', 'present'], ['I text Viola to ask about the vegetables.', 'remote']];
  for (const [line, pulled] of cases) {
    const run = variants({ absent: ['Viola'], chat: [said('Hello.'), spoke('Collette'), said(line)] }, continuation(2));
    const before = plain(run.originalSandbox.state());
    const after = plain(run.sandbox.state());
    assert.ok(names(run.original.targets).includes('Viola'), line);
    assert.ok(before[pulled].includes('Viola.png'), line);
    assert.ok(!names(run.result.targets).includes('Viola'), line);
    assert.deepEqual([after.absent, after.remote, after.present.includes('Viola.png')], [['Viola.png'], [], false], line);
  }
  const witnesses = variants({ absent: ['Viola'] }, sandbox => sandbox.context.getDirectUserMessageWitnessTargets('need to get vegetables to Viola'));
  assert.deepEqual(plain(witnesses.original), ['Viola.png']);
  assert.deepEqual(plain(witnesses.result), []);
});

test('real Vocalia: the empty-Send picker skips the narrator', () => {
  const options = {
    chat: [said('Hello.'), spoke('Collette'), said('Go on.'), spoke('Narrator')],
    state: { lastSpeakerAvatar: narratorAvatar, members: { [narratorAvatar]: { speakingTo: [] } } },
  };
  const empty = variants(options, emptySend);
  assert.deepEqual(names(empty.original.targets), ['Narrator']);
  assert.deepEqual(names(empty.result.targets), ['Collette']);
});

test('real Vocalia: Continue on an unanswered plain player message after the narrator spoke gives Collette, with auto turn flow on or off', () => {
  for (const speakingTo of ['none', 'user']) {
    for (const autoTurnFlow of [true, false]) {
      const label = `speakingTo=${speakingTo} autoTurnFlow=${autoTurnFlow}`;
      const narration = spoke(
        'Narrator', `speakingTo=${speakingTo}, participationNextTurn=idle, arriving=none`, '[narration]The square is busy.[end narration]',
      );
      const options = {
        settings: { autoTurnFlow },
        chat: [said('Hello.'), spoke('Collette'), said('Narrator: we reach the square.'), narration, said('I look around.')],
      };
      const run = variants(
        options,
        /**
         * @param {VocaliaSandbox} sandbox
         * @returns {{member: ?object, reason: string}}
         * @throws {*}
         */
        sandbox => {
          applyReply(sandbox, 1);
          applyReply(sandbox, 3);
          return continueTail(sandbox);
        },
      );
      assert.equal(run.original.member.name, 'Narrator', label);
      assert.equal(run.result.member.name, 'Collette', label);
      assert.ok(run.result.reason.startsWith('controlled-continue-'), label);
      assert.equal(run.sandbox.context.shouldAllowTriggerEnqueueForReason(run.result.reason), true, label);
      assert.deepEqual(run.sandbox.called('firstSpeaker'), [[4]], label);
    }
  }
  const noted = VocaliaSandbox.vocalia({
    universe: true,
    chat: [
      said('Hello.'), spoke('Collette'), said('Narrator: we reach the square.'), spoke('Narrator'), said('I look around.'),
      { name: 'SillyTavern System', is_user: false, is_system: true, mes: 'Chat saved.' },
    ],
  });
  applyReply(noted, 1);
  applyReply(noted, 3);
  assert.equal(continueTail(noted).member.name, 'Collette');
  assert.deepEqual(noted.called('firstSpeaker'), [[4]]);
});

test('real Vocalia: Continue on an unanswered Narrator: message asks firstSpeaker once and the narrator answers', () => {
  const sandbox = VocaliaSandbox.vocalia({
    universe: true, speaker: narratorAvatar, chat: [said('Hello.'), spoke('Collette'), said('Narrator: they reach the market.')],
  });
  applyReply(sandbox, 1);
  const target = continueTail(sandbox);
  assert.equal(target.member.name, 'Narrator');
  assert.equal(target.reason, 'controlled-continue-universe-narrator');
  assert.deepEqual(sandbox.called('firstSpeaker'), [[2]]);
});

test('real Vocalia: Continue with the narrator alone and an unanswered plain message gives the narrator with a reason that works with auto turn flow off', () => {
  const sandbox = VocaliaSandbox.vocalia({
    universe: true, absent: castAbsent, settings: { autoTurnFlow: false },
    chat: [said('Hello.'), spoke('Narrator'), said('We wait.')],
  });
  applyReply(sandbox, 1);
  const target = continueTail(sandbox);
  assert.equal(target.member.name, 'Narrator');
  assert.equal(target.reason, 'controlled-continue-universe-narrator-alone');
  assert.equal(sandbox.context.shouldAllowTriggerEnqueueForReason(target.reason), true);
  assert.equal(sandbox.context.shouldAllowTriggerEnqueueForReason('universe-narrator-alone'), false);
});

test('real Vocalia: Continue with no message id in a narrator group answers the chat tail, not the greeting at message 0', () => {
  const walking = spoke('Narrator', 'speakingTo=user, participationNextTurn=idle, arriving=none', '[narration]The road bends.[end narration]');
  const cases = [
    {
      label: 'a Narrator: tail', speaker: narratorAvatar, replies: [], greeter: 'Collette',
      chat: [greeted('Collette'), greeted('Lize'), said('Narrator: they reach the market.')],
      member: 'Narrator', messageId: 2, reason: 'controlled-continue-universe-narrator', asked: [[2]],
    },
    {
      label: 'a plain tail after the narrator spoke', speaker: null, replies: [3], greeter: 'Collette',
      chat: [greeted('Collette'), greeted('Lize'), said('Narrator: we walk on.'), walking, said('I look around.')],
      member: 'Lize', messageId: 4, reason: 'controlled-continue-prior-route-eligible-assistant', asked: [[4]],
    },
    {
      label: 'the narrator greeting at message 0', speaker: null, replies: [], greeter: 'Narrator',
      chat: [greeted('Narrator'), greeted('Collette'), said('Hello.')],
      member: 'Collette', messageId: 2, reason: 'controlled-continue-prior-route-eligible-assistant', asked: [[2]],
    },
    {
      label: 'a narrator reply tail', speaker: null, replies: [3], greeter: 'Collette',
      chat: [greeted('Collette'), greeted('Lize'), said('Narrator: we walk on.'), walking],
      member: 'Narrator', messageId: 3, reason: 'controlled-continue-message_owner', asked: [],
    },
  ];
  for (const autoTurnFlow of [true, false]) {
    for (const { label, speaker, replies, greeter, chat, member, messageId: tailId, reason, asked } of cases) {
      const title = `${label} autoTurnFlow=${autoTurnFlow}`;
      const run = variants(
        { speaker, chat, settings: { autoTurnFlow } },
        /**
         * @param {VocaliaSandbox} sandbox
         * @returns {{messageId: ?number, member: ?object, reason: string}}
         * @throws {*}
         */
        sandbox => {
          for (const index of replies) {
            applyReply(sandbox, index);
          }
          return continueTail(sandbox);
        },
      );
      assert.equal(run.original.member.name, greeter, title);
      assert.equal(run.original.messageId, 0, title);
      assert.equal(run.result.member.name, member, title);
      assert.equal(run.result.messageId, tailId, title);
      assert.equal(run.result.reason, reason, title);
      assert.equal(run.sandbox.context.shouldAllowTriggerEnqueueForReason(run.result.reason), true, title);
      assert.deepEqual(run.sandbox.called('firstSpeaker'), asked, title);
    }
  }
});

test('real Vocalia: Continue with no narrator in the group, or with an explicit message id, is Vocalia\'s own', () => {
  const chat = [greeted('Collette'), greeted('Lize'), said('I look around.')];
  for (const group of withoutNarrator) {
    const own = sameAsVocalia({ ...group, universe: true, chat }, continueTail, JSON.stringify(group));
    assert.equal(own.result.member.name, 'Collette', JSON.stringify(group));
    assert.equal(own.result.messageId, 0, JSON.stringify(group));
  }
  const explicit = variants(
    { chat },
    /**
     * @param {VocaliaSandbox} sandbox
     * @returns {{messageId: ?number, member: ?object, reason: string}}
     * @throws {*}
     */
    sandbox => sandbox.context.resolveContinueTarget(clickedOn(sandbox, 1)),
  );
  assert.equal(explicit.result.member.name, 'Lize');
  assert.deepEqual(plain(explicit.result), plain(explicit.original));
  assert.deepEqual(explicit.sandbox.called('firstSpeaker'), []);
});

test('real Vocalia: a blank reply at the end of the chat leaves the player message unanswered for Continue; Regenerate of a member\'s reply stays Vocalia\'s own, and of a non-member\'s reply follows the narrator rule', () => {
  const walking = spoke('Narrator', 'speakingTo=user, participationNextTurn=idle, arriving=none', '[narration]The road bends.[end narration]');
  const plainTail = [greeted('Collette'), greeted('Lize'), said('Narrator: we walk on.'), walking, said('I look around.'), blankReply('Collette')];
  const cases = [
    {
      label: 'a blank reply after a plain message', speaker: null, replies: [3], chat: plainTail,
      member: 'Lize', messageId: 4, asked: [[4]], tail: 5,
    },
    {
      label: 'a blank reply and a system message after a plain message', speaker: null, replies: [3],
      chat: [...plainTail, { name: 'SillyTavern System', is_user: false, is_system: true, mes: 'Chat saved.' }],
      member: 'Lize', messageId: 4, asked: [[4]], tail: 5,
    },
    {
      label: 'a blank narrator reply after a Narrator: message', speaker: narratorAvatar, replies: [],
      chat: [greeted('Collette'), greeted('Lize'), said('Narrator: they reach the market.'), blankReply('Narrator')],
      member: 'Narrator', messageId: 2, asked: [[2]], tail: 3,
    },
    {
      label: 'a blank reply after a cast reply that answered', speaker: null, replies: [3],
      chat: [greeted('Collette'), greeted('Lize'), said('Hello.'), spoke('Collette'), blankReply('Lize')],
      member: 'Collette', messageId: 3, asked: [], tail: 4,
    },
    {
      label: 'a blank reply from someone outside the group', speaker: narratorAvatar, replies: [],
      chat: [greeted('Collette'), greeted('Lize'), said('Narrator: the stranger falls silent.'), blankReply('Old Mag')],
      member: 'Narrator', messageId: 2, asked: [[2]], tail: 3, ownerless: true,
    },
  ];
  for (const autoTurnFlow of [true, false]) {
    for (const { label, speaker, replies, chat, member, messageId: answeredId, asked, tail, ownerless } of cases) {
      const title = `${label} autoTurnFlow=${autoTurnFlow}`;
      const options = { speaker, chat: generated(chat), settings: { autoTurnFlow } };
      const continued = variants(
        options,
        /**
         * @param {VocaliaSandbox} sandbox
         * @returns {{messageId: ?number, member: ?object, reason: string}}
         * @throws {*}
         */
        sandbox => {
          for (const index of replies) {
            applyReply(sandbox, index);
          }
          return continueTail(sandbox);
        },
      );
      assert.equal(continued.result.member.name, member, title);
      assert.equal(continued.result.messageId, answeredId, title);
      assert.equal(continued.sandbox.context.shouldAllowTriggerEnqueueForReason(continued.result.reason), true, title);
      assert.deepEqual(continued.sandbox.called('firstSpeaker'), asked, title);
      const regenerated = variants(
        options,
        /**
         * @param {VocaliaSandbox} sandbox
         * @returns {{messageId: ?number, member: ?object, reason: string}}
         * @throws {*}
         */
        sandbox => {
          for (const index of replies) {
            applyReply(sandbox, index);
          }
          return sandbox.context.resolveControlledGenerationTarget('regenerate', clickedOn(sandbox, tail));
        },
      );
      if (ownerless) {
        assert.equal(regenerated.result.member.name, 'Narrator', title);
        assert.equal(regenerated.result.reason, 'controlled-regenerate-universe-narrator', title);
        assert.deepEqual(regenerated.sandbox.called('firstSpeaker'), [[2]], title);
      } else {
        assert.deepEqual(plain(regenerated.result), plain(regenerated.original), title);
        assert.deepEqual(regenerated.sandbox.called('firstSpeaker'), [], title);
      }
    }
  }
});

test('real Vocalia: Regenerate through Vocalia\'s controlled generation on a non-member\'s reply hides the narrator and asks firstSpeaker for the message it answers', async () => {
  const told = spoke('Narrator', 'speakingTo=user, participationNextTurn=idle, arriving=none', '[narration]The inn is warm.[end narration]');
  const inn = [greeted('Collette'), greeted('Lize'), said('Narrator: the inn is warm.'), told];
  const drink = said('I order a drink.');
  const oldMag = { name: 'Old Mag', is_user: false, mes: 'Old Mag cackles.' };
  const hidden = { member: 'Lize', reason: 'controlled-regenerate-prior-route-eligible-assistant' };
  const cases = [
    { label: 'Viola removed from the group', options: { outside: ['Viola'] }, chat: [...inn, drink, spoke('Viola')], ...hidden },
    { label: 'Viola\'s card deleted', options: { deletedCards: ['Viola'] }, chat: [...inn, drink, spoke('Viola')], ...hidden },
    { label: 'an Old Mag reply', options: {}, chat: [...inn, drink, oldMag], ...hidden },
    {
      label: 'a Narrator: message before it', options: { speaker: narratorAvatar },
      chat: [...inn, said('Narrator: the stranger leaves.'), oldMag], member: 'Narrator', reason: 'controlled-regenerate-universe-narrator',
    },
    {
      label: 'the narrator alone', options: { absent: ['Collette', 'Lize', 'Viola'] }, chat: [...inn, drink, oldMag],
      member: 'Narrator', reason: 'controlled-regenerate-universe-narrator-alone',
    },
  ];
  for (const autoTurnFlow of [true, false]) {
    for (const { label, options, chat, member, reason } of cases) {
      const title = `${label} autoTurnFlow=${autoTurnFlow}`;
      const sandbox = VocaliaSandbox.vocalia({ ...options, universe: true, chat: generated(chat), settings: { autoTurnFlow } });
      applyReply(sandbox, 3);
      assert.deepEqual(await regenerated(sandbox, 5, 'regenerate_button'), { member, sourceMessageId: 4, reason }, title);
      assert.deepEqual(sandbox.called('firstSpeaker'), [[4]], title);
      assert.equal(sandbox.context.shouldAllowTriggerEnqueueForReason(reason), true, title);
      assert.equal(sandbox.tavern.chat.length, 5, title);
      if (member === 'Lize') {
        const original = VocaliaSandbox.vocalia({ ...options, built: false, chat: generated(chat), settings: { autoTurnFlow } });
        applyReply(original, 3);
        assert.equal((await regenerated(original, 5, 'regenerate_button')).member, 'Narrator', title);
      }
    }
  }
});

test('real Vocalia: Regenerate and swipe on the narrator\'s own reply or an eligible cast reply are Vocalia\'s own and ask no one', async () => {
  const told = spoke('Narrator', 'speakingTo=user, participationNextTurn=idle, arriving=none', '[narration]The inn is warm.[end narration]');
  const inn = [greeted('Collette'), greeted('Lize'), said('Narrator: the inn is warm.'), told, said('I order a drink.')];
  const tails = [
    ['the narrator\'s reply', spoke('Narrator', 'speakingTo=user, participationNextTurn=idle, arriving=none', '[narration]A bell rings.[end narration]'), 'Narrator'],
    ['Collette\'s reply', spoke('Collette'), 'Collette'],
  ];
  for (const autoTurnFlow of [true, false]) {
    for (const [label, tail, owner] of tails) {
      for (const source of ['regenerate_button', 'swipe_right']) {
        const title = `${label} ${source} autoTurnFlow=${autoTurnFlow}`;
        const outcomes = [];
        for (const built of [false, true]) {
          const sandbox = VocaliaSandbox.vocalia({ built, universe: built, chat: generated([...inn, tail]), settings: { autoTurnFlow } });
          applyReply(sandbox, 3);
          applyReply(sandbox, 5);
          outcomes.push(await regenerated(sandbox, 5, source));
          assert.deepEqual(sandbox.called('firstSpeaker'), [], title);
        }
        assert.deepEqual(outcomes[1], outcomes[0], title);
        assert.equal(outcomes[1].member, owner, title);
      }
    }
  }
});

test('real Vocalia: Regenerate on a non-member\'s reply asks firstSpeaker only when no reply survives between the player message and the replies Vocalia deletes', async () => {
  const greetings = [greeted('Collette'), greeted('Lize')];
  const barges = said('Narrator: Viola barges in.');
  const told = spoke('Narrator', 'speakingTo=user, participationNextTurn=idle, arriving=none', '[narration]The door slams open.[end narration]');
  const reaction = spoke('Viola', 'speakingTo=user, participationNextTurn=idle, arriving=none', '[dialogue]Did I miss anything?[end dialogue]');
  const removed = { outside: ['Viola'], speaker: narratorAvatar };
  const named = { member: 'Narrator', reason: 'controlled-regenerate-universe-narrator', asked: [[2]] };
  const cases = [
    {
      label: 'Viola removed after reacting to the narrator\'s reply', options: removed, applied: [3], left: 4,
      chat: generated([...greetings, barges, told, reaction]),
      member: 'Lize', reason: 'controlled-regenerate-prior-route-eligible-assistant', asked: [],
    },
    {
      label: 'Viola\'s card deleted after the narrator and Lize answered a plain message',
      options: { deletedCards: ['Viola'], speaker: narratorAvatar }, applied: [3, 4], left: 5,
      chat: generated([...greetings, said('We step into the clearing.'), told, spoke('Lize'), reaction]),
      member: 'Lize', reason: 'controlled-regenerate-waiting-for-user', asked: [],
    },
    {
      label: 'the first reply to a Narrator: message', options: removed, applied: [], left: 3,
      chat: generated([...greetings, barges, reaction]), ...named,
    },
    {
      label: 'a reaction after a hidden narrator reply', options: removed, applied: [3], left: 4,
      chat: generated([...greetings, barges, { ...told, is_system: true }, reaction]), ...named,
    },
    {
      label: 'a reaction after a blank narrator reply', options: removed, applied: [], left: 4,
      chat: generated([...greetings, barges, blankReply('Narrator'), reaction]), ...named,
    },
    {
      label: 'Viola removed after reacting to the narrator\'s reply, without gen_id', options: removed, applied: [3], left: 3,
      chat: [...greetings, barges, told, reaction], ...named,
    },
  ];
  for (const autoTurnFlow of [true, false]) {
    for (const { label, options, applied, left, chat, member, reason, asked } of cases) {
      const title = `${label} autoTurnFlow=${autoTurnFlow}`;
      const sandbox = VocaliaSandbox.vocalia({ ...options, universe: true, chat, settings: { autoTurnFlow } });
      for (const index of applied) {
        applyReply(sandbox, index);
      }
      assert.deepEqual(await regenerated(sandbox, chat.length - 1, 'regenerate_button'), { member, sourceMessageId: 2, reason }, title);
      assert.deepEqual(sandbox.called('firstSpeaker'), asked, title);
      assert.equal(sandbox.context.shouldAllowTriggerEnqueueForReason(reason), true, title);
      assert.equal(sandbox.tavern.chat.length, left, title);
    }
  }
});

test('real Vocalia: Continue on a departed or ownerless last reply takes Vocalia\'s fallback, not message 0, and a chat without a non-blank reply resolves no message', () => {
  const departing = spoke('Collette', 'speakingTo=none, participationNextTurn=leaving, arriving=none', '[dialogue]I have to go.[end dialogue]');
  const cases = [
    {
      label: 'a departed last reply', replies: [3], member: 'Lize',
      chat: [greeted('Narrator'), greeted('Lize'), said('Hello.'), departing],
    },
    {
      label: 'an ownerless last reply', replies: [], member: 'Collette',
      chat: [greeted('Narrator'), greeted('Collette'), said('Hello.'), { name: 'Old Mag', is_user: false, mes: 'Old Mag cackles.' }],
    },
  ];
  for (const { label, replies, member, chat } of cases) {
    const run = variants(
      { chat },
      /**
       * @param {VocaliaSandbox} sandbox
       * @returns {{messageId: ?number, member: ?object, reason: string}}
       * @throws {*}
       */
      sandbox => {
        for (const index of replies) {
          applyReply(sandbox, index);
        }
        return continueTail(sandbox);
      },
    );
    assert.equal(run.original.member.name, 'Narrator', label);
    assert.equal(run.result.member.name, member, label);
    assert.equal(run.result.messageId, 3, label);
    assert.equal(run.result.reason, 'controlled-continue-prior-route-eligible-assistant', label);
    assert.deepEqual(run.sandbox.called('firstSpeaker'), [], label);
  }
  const empty = variants(
    { chat: [blankReply('Collette'), { name: 'SillyTavern System', is_user: false, is_system: true, mes: 'Chat saved.' }] },
    continueTail,
  );
  assert.equal(empty.original.member.name, 'Collette');
  assert.deepEqual(
    [empty.result.messageId, empty.result.member, empty.result.reason], [null, null, 'controlled-continue-no-target'],
  );
});

test('real Vocalia: Continue after a reply whose speaker is no longer eligible hides the narrator and asks no one, and only a lone narrator is picked', () => {
  const told = spoke('Narrator', 'speakingTo=user, participationNextTurn=idle, arriving=none', '[narration]The inn is warm.[end narration]');
  const inn = [greeted('Collette'), greeted('Lize'), said('Narrator: the inn is warm.'), told, said('I order a drink.')];
  const cases = [
    {
      label: 'Collette departs', options: {}, replies: [3, 5], lone: ['Lize', 'Viola'],
      chat: [...inn, spoke('Collette', 'speakingTo=none, participationNextTurn=leaving, arriving=none')],
    },
    {
      label: 'Collette is muted', options: { disabled: ['Collette'] }, replies: [3], lone: ['Lize', 'Viola'],
      chat: [...inn, spoke('Collette')],
    },
    {
      label: 'the speaker left the group', options: { outside: ['Viola'] }, replies: [3], lone: ['Collette', 'Lize'],
      chat: [...inn, spoke('Viola')],
    },
  ];
  for (const autoTurnFlow of [true, false]) {
    for (const { label, options, replies, lone, chat } of cases) {
      for (const [absentCast, member, reason] of [
        [[], 'Lize', 'controlled-continue-prior-route-eligible-assistant'],
        [lone, 'Narrator', 'controlled-continue-universe-narrator-alone'],
      ]) {
        const title = `${label} absent=${absentCast} autoTurnFlow=${autoTurnFlow}`;
        const sandbox = VocaliaSandbox.vocalia({ ...options, universe: true, absent: absentCast, chat, settings: { autoTurnFlow } });
        for (const index of replies) {
          applyReply(sandbox, index);
        }
        const target = continueTail(sandbox);
        assert.equal(target.member.name, member, title);
        assert.equal(target.reason, reason, title);
        assert.equal(target.messageId, 5, title);
        assert.equal(sandbox.context.shouldAllowTriggerEnqueueForReason(target.reason), true, title);
        assert.deepEqual(sandbox.called('firstSpeaker'), [], title);
      }
    }
    const narratorTail = VocaliaSandbox.vocalia({ universe: true, chat: [...inn, told], settings: { autoTurnFlow } });
    applyReply(narratorTail, 3);
    applyReply(narratorTail, 5);
    const ownReply = continueTail(narratorTail);
    assert.equal(ownReply.member.name, 'Narrator', `narrator tail autoTurnFlow=${autoTurnFlow}`);
    assert.equal(ownReply.reason, 'controlled-continue-message_owner', `narrator tail autoTurnFlow=${autoTurnFlow}`);
  }
});

test('real Vocalia: empty Send after a blank narrator reply to a Narrator: message asks firstSpeaker and the narrator answers', () => {
  for (const autoTurnFlow of [true, false]) {
    for (const [speaker, member, reason] of [
      [narratorAvatar, 'Narrator', 'empty-send-latest-user-universe-narrator'],
      [null, 'Lize', 'empty-send-most-recent-route-eligible-prior-assistant'],
    ]) {
      const title = `${speaker} autoTurnFlow=${autoTurnFlow}`;
      const sandbox = VocaliaSandbox.vocalia({
        universe: true, speaker, settings: { autoTurnFlow },
        chat: [greeted('Collette'), greeted('Lize'), said('Narrator: they reach the market.'), blankReply('Narrator')],
      });
      sandbox.context.handleBlankAssistantMessage(3, sandbox.tavern.chat[3]);
      const continuation = emptySend(sandbox);
      assert.deepEqual(names(continuation.targets), [member], title);
      assert.equal(continuation.reason, reason, title);
      assert.equal(sandbox.context.shouldAllowTriggerEnqueueForReason(continuation.reason), true, title);
      assert.deepEqual(sandbox.called('firstSpeaker'), [[2]], title);
    }
  }
});

test('real Vocalia: Continue on a lone Narrator: message with no reply at all asks firstSpeaker and the narrator answers', () => {
  const sandbox = VocaliaSandbox.vocalia({ universe: true, speaker: narratorAvatar, chat: [said('Narrator: dawn.')] });
  const target = continueTail(sandbox);
  assert.equal(target.member.name, 'Narrator');
  assert.equal(target.reason, 'controlled-continue-universe-narrator');
  assert.equal(target.messageId, 0);
  assert.deepEqual(sandbox.called('firstSpeaker'), [[0]]);
});

test('real Vocalia: the narrator as the only present member is still picked, with reasons that work with auto turn flow off', () => {
  const state = { lastSpeakerAvatar: narratorAvatar };
  const settings = { autoTurnFlow: false };
  const first = variants({ absent: castAbsent, chat: [said('Hello.')] }, opening(0));
  assert.deepEqual(names(first.result), ['Narrator']);
  const later = variants({ absent: castAbsent, chat: [said('Hello.'), spoke('Narrator'), said('We walk on.')], state }, continuation(2));
  assert.deepEqual(names(later.result.targets), ['Narrator']);
  assert.equal(later.result.reason, 'universe-narrator-alone');
  for (const chat of [[said('Hello.'), spoke('Narrator')], [said('Hello.'), spoke('Narrator'), said('We wait.')]]) {
    const label = chat.at(-1).mes;
    const empty = variants({ absent: castAbsent, chat, state, settings }, emptySend);
    assert.deepEqual(names(empty.result.targets), ['Narrator'], label);
    assert.equal(empty.result.reason, 'empty-send-universe-narrator-alone', label);
    assert.equal(empty.sandbox.context.shouldAllowTriggerEnqueueForReason(empty.result.reason), true, label);
    assert.equal(empty.sandbox.context.shouldAllowTriggerEnqueueForReason('universe-narrator-alone'), false, label);
  }
});

test('real Vocalia: outside picking the narrator stays route-eligible', () => {
  const run = variants({ absent: castAbsent, chat: [said('Hello.')] }, sandbox => [
    sandbox.context.isMemberRouteEligibleCompat(sandbox.member('Narrator')),
    names(sandbox.context.getRouteEligibleMembersCompat()),
  ]);
  assert.deepEqual(plain(run.result), [true, ['Narrator']]);
});

test('real Vocalia: the narrator is always present: a departing reply keeps it, a Narrator: message brings it back, and alone it answers', () => {
  const departing = spoke(
    'Narrator', 'speakingTo=none, participationNextTurn=leaving, arriving=none, leaving=Collette', '[narration]Collette heads home.[end narration]',
  );
  const options = { speaker: narratorAvatar, chat: [said('Hello.'), departing, said('Narrator: morning comes.')] };
  const original = VocaliaSandbox.vocalia({ ...options, built: false });
  const sandbox = VocaliaSandbox.vocalia({ ...options, universe: true });
  for (const replySandbox of [original, sandbox]) {
    assert.equal(applyReply(replySandbox, 1).participationNextTurn, 'departing');
  }
  assert.ok(plain(original.state().absent).includes(narratorAvatar));
  const after = plain(sandbox.state());
  assert.ok(after.present.includes(narratorAvatar));
  assert.deepEqual(after.absent, ['Collette.png']);
  const morning = continuation(2)(sandbox);
  assert.deepEqual(names(morning.targets), ['Narrator']);
  assert.equal(sandbox.context.isRouteEligibleForQueue(morning.targets[0]), true);
  const returning = VocaliaSandbox.vocalia({
    universe: true, speaker: narratorAvatar, absent: ['Narrator'],
    chat: [said('Hello.'), spoke('Collette'), said('Narrator: they reach the market.')],
  });
  const market = continuation(2)(returning);
  assert.deepEqual(names(market.targets), ['Narrator']);
  assert.ok(plain(returning.state().present).includes(narratorAvatar));
  assert.equal(returning.context.isRouteEligibleForQueue(market.targets[0]), true);
  const alone = VocaliaSandbox.vocalia({ universe: true, absent: castAbsent, chat: [said('Hello.'), spoke('Narrator'), said('We walk on.')] });
  assert.deepEqual(names(continuation(2)(alone).targets), ['Narrator']);
});

test('real Vocalia: a departing narrator reply leaves the same state as an idle one, so an empty Send then picks the member it addressed', () => {
  const content = '[narration]Night falls.[end narration]';
  const left = VocaliaSandbox.vocalia({
    universe: true, chat: [said('Hello.'), spoke('Narrator', 'speakingTo=Lize, participationNextTurn=leaving, arriving=none', content)],
  });
  const stayed = VocaliaSandbox.vocalia({
    universe: true, chat: [said('Hello.'), spoke('Narrator', 'speakingTo=Lize, participationNextTurn=idle, arriving=none', content)],
  });
  applyReply(left, 1);
  applyReply(stayed, 1);
  const state = plain(left.state());
  assert.ok(state.present.includes(narratorAvatar));
  assert.equal(state.lastSpeakerAvatar, narratorAvatar);
  assert.deepEqual(state.members[narratorAvatar].speakingTo, ['Lize']);
  assert.deepEqual(state, plain(stayed.state()));
  assert.equal(left.called('onReplyBlock')[0][0].participationNextTurn, 'departing');
  assert.deepEqual(names(emptySend(left).targets), ['Lize']);
  const untouched = [
    ['the narrator absent', ['Narrator'], spoke('Narrator', 'speakingTo=Lize, participationNextTurn=leaving, arriving=none', content)],
    ['malformed', [], spoke('Narrator', 'speakingTo=Lize, participationNextTurn=leaving', content)],
    ['Collette', [], spoke('Collette', 'speakingTo=Lize, participationNextTurn=leaving, arriving=none')],
  ];
  for (const [label, absentNames, message] of untouched) {
    const run = variants(
      { absent: absentNames, chat: [said('Hello.'), message] },
      /**
       * @param {VocaliaSandbox} sandbox
       * @returns {object}
       * @throws {*}
       */
      sandbox => {
        applyReply(sandbox, 1);
        return plain(sandbox.state());
      },
    );
    assert.deepEqual(run.result, run.original, label);
  }
});

test('real Vocalia: when a Narrator: message brings the absent narrator back, Vocalia\'s prompt no longer lists it as absent', () => {
  const sandbox = VocaliaSandbox.vocalia({
    universe: true, speaker: narratorAvatar, absent: ['Narrator'],
    chat: [said('Hello.'), spoke('Collette'), said('Narrator: they reach the market.')],
  });
  sandbox.context.updateExtensionPrompt();
  const before = sandbox.prompts.filter(([key]) => key === 'aspect_vocalia').at(-1)[1];
  assert.match(before, /^Absent\/unreachable: Narrator$/m);
  assert.deepEqual(names(continuation(2)(sandbox).targets), ['Narrator']);
  const after = sandbox.prompts.filter(([key]) => key === 'aspect_vocalia').at(-1)[1];
  assert.match(after, /^Present: Narrator, /m);
  assert.match(after, /^Absent\/unreachable: none$/m);
});

test('real Vocalia: an empty Send after the reply to a Narrator: message was deleted asks firstSpeaker and the narrator answers', () => {
  const options = {
    speaker: narratorAvatar,
    chat: [said('Hello.'), spoke('Collette'), said('Narrator: they reach the market.')],
    state: { lastSpeakerAvatar: 'Collette.png' },
  };
  const run = variants(options, emptySend);
  assert.deepEqual(names(run.result.targets), ['Narrator']);
  assert.equal(run.result.reason, 'empty-send-latest-user-universe-narrator');
  assert.deepEqual(run.sandbox.called('firstSpeaker'), [[2]]);
  const undirected = VocaliaSandbox.vocalia({ ...options, universe: true, speaker: null });
  assert.deepEqual(names(emptySend(undirected).targets), ['Collette']);
  assert.deepEqual(undirected.called('firstSpeaker'), [[2]]);
});

test('real Vocalia: leaving= through the real parser', () => {
  const cases = [
    ['speakingTo=none, participationNextTurn=idle, arriving=none, Leaving=Collette|Lize', [], false, ['Collette.png', 'Lize.png']],
    ['speakingTo=none, participationNextTurn=idle, arriving=none, leaving=collette | LIZE', [], false, ['Collette.png', 'Lize.png']],
    ['speakingTo=none, participationNextTurn=idle, arriving=none, leaving=Col', [], false, []],
    ['speakingTo=none, participationNextTurn=idle, arriving=none, leaving=Narrator|Lize', [], false, ['Lize.png']],
    ['speakingTo=none, participationNextTurn=idle, leaving=Collette', [], true, []],
    ['speakingTo=none, participationNextTurn=idle, arriving=none, leaving=Collette', ['Narrator'], false, ['Narrator.png']],
  ];
  for (const [parameters, absentNames, routingMalformed, expected] of cases) {
    const message = spoke('Narrator', parameters, '[narration]The street empties.[end narration]');
    const sandbox = VocaliaSandbox.vocalia({ universe: true, absent: absentNames, chat: [said('Hello.'), message] });
    const block = applyReply(sandbox, 1);
    assert.equal(block.routingMalformed, routingMalformed, parameters);
    assert.equal(block.parameters.leaving, parameters.split(/leaving=/i)[1], parameters);
    assert.deepEqual(sandbox.called('onReplyBlock').map(([, ownerAvatar, id]) => [ownerAvatar, id]), [[narratorAvatar, 1]], parameters);
    assert.deepEqual(plain(sandbox.state().absent), expected, parameters);
  }
});

test('real Vocalia: with one participant per turn, Collette addressing the narrator and Lize chains Lize', () => {
  for (const speakingTo of ['Narrator|Lize', 'The Narrator|Lize']) {
    const message = spoke('Collette', `speakingTo=${speakingTo}, participationNextTurn=speak, arriving=none`);
    const run = variants(
      { chat: [said('Hello.'), message], settings: { maxParticipantsPerTurn: 1 } },
      /**
       * @param {VocaliaSandbox} sandbox
       * @returns {{targets: Array<object>, speakingTo: string[]}}
       * @throws {*}
       */
      sandbox => {
        const [block] = sandbox.context.parseStructuredMessage(message.mes);
        const targets = sandbox.context.applyOwnerBlockToState(block, sandbox.member('Collette'), 1, true);
        return { targets, speakingTo: Array.from(block.speakingTo) };
      },
    );
    assert.deepEqual(names(run.original.targets), ['Narrator'], speakingTo);
    assert.deepEqual(names(run.result.targets), ['Lize'], speakingTo);
    assert.deepEqual(run.result.speakingTo, speakingTo.split('|'), speakingTo);
  }
});

test('real Vocalia: with universeNarrator present but no narrator in the group, or the narrator muted, every override gives Vocalia\'s own result and state', () => {
  const colletteReply = spoke('Collette', 'speakingTo=Lize|Viola, participationNextTurn=speak, arriving=none');
  /**
   * @param {VocaliaSandbox} sandbox
   * @returns {Array<object>}
   * @throws {*}
   */
  const departure = sandbox => sandbox.context.applyUserDepartureBootstrap(2, 'I leave Collette behind and walk out alone.');
  const calls = [
    ['findMentionedPresentMembers', sandbox => sandbox.context.findMentionedPresentMembers('Collette and Lize, come here.')],
    ['getRouteEligibleMembersCompat', sandbox => sandbox.context.getRouteEligibleMembersCompat()],
    ['isMemberRouteEligibleCompat', sandbox => sandbox.context.isMemberRouteEligibleCompat(sandbox.member('Collette'))],
    ['applyUserDepartureBootstrap', departure],
    ['detectUserSummonBootstrap', sandbox => sandbox.context.detectUserSummonBootstrap('Call Viola.')],
    ['selectTargetsForLatestUnansweredUserMessageRecovery', sandbox => sandbox.context.selectTargetsForLatestUnansweredUserMessageRecovery()],
    ['selectTargetsForEmptySendContinuation', emptySend],
    ['selectFirstSpeakerForOpeningUserMessage', opening(2)],
    ['validTargetsFromBlock', sandbox => sandbox.context.validTargetsFromBlock(
      sandbox.context.parseStructuredMessage(colletteReply.mes)[0], sandbox.member('Collette'),
    )],
    ['applyOwnerBlockToState', sandbox => sandbox.context.applyOwnerBlockToState(
      sandbox.context.parseStructuredMessage(colletteReply.mes)[0], sandbox.member('Collette'), 1, true,
    )],
    ['getControlledActionFallbackTarget', sandbox => sandbox.context.getControlledActionFallbackTarget('continue', 2, null)],
    ['resolveContinueTarget', continueTail],
    ['selectContinuationTargetsForUserMessage', continuation(2)],
  ];
  assert.deepEqual(calls.map(([name]) => name).sort(), [...overrides].sort());
  for (const group of withoutNarrator) {
    const options = {
      ...group, universe: true, absent: ['Viola'],
      chat: [said('Hello.'), colletteReply, said('Call Viola.')], state: { lastSpeakerAvatar: 'Collette.png' },
    };
    for (const [name, run] of calls) {
      sameAsVocalia(options, run, `${name} ${JSON.stringify(group)}`);
    }
    const departed = sameAsVocalia(options, departure, 'departure');
    assert.ok(plain(departed.sandbox.state().absent).includes('Collette.png'));
  }
});

test('real Vocalia: with no narrator in the group, or the narrator muted, "Call Viola." summons her as in Vocalia', () => {
  for (const group of withoutNarrator) {
    const summoned = sameAsVocalia({ ...group, universe: true, absent: castAbsent, chat: [said('Call Viola.')] }, opening(0));
    assert.deepEqual(names(summoned.result), ['Viola'], JSON.stringify(group));
    assert.ok(!plain(summoned.sandbox.state().absent).includes('Viola.png'), JSON.stringify(group));
  }
  const withNarrator = VocaliaSandbox.vocalia({ universe: true, absent: castAbsent, chat: [said('Call Viola.')] });
  assert.deepEqual(names(opening(0)(withNarrator)), ['Narrator']);
  assert.deepEqual(plain(withNarrator.state().absent), ['Collette.png', 'Lize.png', 'Viola.png']);
});
