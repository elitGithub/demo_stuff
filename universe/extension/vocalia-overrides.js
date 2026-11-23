const universeReasons = Object.freeze({
  FirstSpeaker: 'universe-narrator',
  Alone: 'universe-narrator-alone',
  RecoveryFirstSpeaker: 'empty-send-latest-user-universe-narrator',
  EmptySendAlone: 'empty-send-universe-narrator-alone',
  ContinueFirstSpeaker: 'controlled-continue-universe-narrator',
  ContinueAlone: 'controlled-continue-universe-narrator-alone',
  ContinueOwner: 'controlled-continue-{source}',
  RegenerateFirstSpeaker: 'controlled-regenerate-universe-narrator',
  RegenerateAlone: 'controlled-regenerate-universe-narrator-alone',
});
const universeContinueAction = 'continue';
let universePicking = false;
let universeAnswering = false;

/**
 * @returns {boolean}
 * @throws {*}
 */
function universeNarratorInGroup() {
  return Boolean(globalThis.universeNarrator)
    && getGroupMembers().some(member => !member.disabled && globalThis.universeNarrator.isNarrator(member.avatar));
}

/**
 * @returns {?number}
 * @throws {*}
 */
function universeUnansweredUserMessageId() {
  const latestUser = findLatestUserMessageBefore(ctx().chat.length);
  const lastReplyId = findLastAssistantMessageId();
  return latestUser && (lastReplyId === null || lastReplyId < latestUser.messageId) ? latestUser.messageId : null;
}

/**
 * @param {boolean} answering
 * @param {function(): *} pick
 * @returns {*}
 * @throws {*}
 */
function universeHidingNarrator(answering, pick) {
  const previousPicking = universePicking;
  const previousAnswering = universeAnswering;
  universePicking = true;
  universeAnswering = answering;
  try {
    return pick();
  } finally {
    universePicking = previousPicking;
    universeAnswering = previousAnswering;
  }
}

/**
 * @param {Array<object>} members
 * @returns {Array<object>}
 * @throws {*}
 */
function universeWithoutNarrator(members) {
  return members.filter(member => !globalThis.universeNarrator.isNarrator(member.avatar));
}

/**
 * @param {number} userMessageId
 * @returns {?object}
 * @throws {*}
 */
function universeFirstSpeaker(userMessageId) {
  const chosen = getMemberByAvatar(globalThis.universeNarrator.firstSpeaker(userMessageId));
  if (chosen && globalThis.universeNarrator.isNarrator(chosen.avatar) && !vocaliaBase_isMemberRouteEligibleCompat(chosen)) {
    setPresence(chosen.avatar, MEMBER_STATUS_PRESENT);
    updateExtensionPrompt();
    updateDiagnosticsPanel();
    saveMetadata();
  }
  return chosen;
}

/**
 * @returns {?object}
 * @throws {*}
 */
function universeLoneNarrator() {
  const eligible = vocaliaBase_getRouteEligibleMembersCompat();
  return eligible.length === 1 && globalThis.universeNarrator.isNarrator(eligible[0].avatar) ? eligible[0] : null;
}

/**
 * @param {string} text
 * @returns {Array<object>}
 * @throws {*}
 */
function findMentionedPresentMembers(text) {
  const members = vocaliaBase_findMentionedPresentMembers(text);
  return universePicking ? universeWithoutNarrator(members) : members;
}

/**
 * @returns {Array<object>}
 * @throws {*}
 */
function getRouteEligibleMembersCompat() {
  const members = vocaliaBase_getRouteEligibleMembersCompat();
  return universePicking ? universeWithoutNarrator(members) : members;
}

/**
 * @param {?object} member
 * @returns {boolean}
 * @throws {*}
 */
function isMemberRouteEligibleCompat(member) {
  const eligible = vocaliaBase_isMemberRouteEligibleCompat(member);
  if (!eligible || !universePicking) {
    return eligible;
  }
  return !globalThis.universeNarrator.isNarrator(member.avatar);
}

/**
 * @param {number} userMessageId
 * @param {string} userText
 * @returns {Array<object>}
 * @throws {*}
 */
function applyUserDepartureBootstrap(userMessageId, userText) {
  if (!universeNarratorInGroup()) {
    return vocaliaBase_applyUserDepartureBootstrap(userMessageId, userText);
  }
  return [];
}

/**
 * @param {string} text
 * @returns {{physical: Array<object>, remote: Array<object>, targets: Array<object>, evidence: Array<object>}}
 * @throws {*}
 */
function detectUserSummonBootstrap(text) {
  const detection = vocaliaBase_detectUserSummonBootstrap(text);
  if (!universeNarratorInGroup()) {
    return detection;
  }
  return { ...detection, physical: [], remote: [], targets: [] };
}

/**
 * @returns {{hasLatestUserMessage: boolean, reason: string, targets: Array<object>, sourceMessageId: number}}
 * @throws {*}
 */
function selectTargetsForLatestUnansweredUserMessageRecovery() {
  if (!universeNarratorInGroup()) {
    return vocaliaBase_selectTargetsForLatestUnansweredUserMessageRecovery();
  }
  const recovery = universeHidingNarrator(true, vocaliaBase_selectTargetsForLatestUnansweredUserMessageRecovery);
  const sourceMessageId = recovery.hasLatestUserMessage ? recovery.sourceMessageId : universeUnansweredUserMessageId();
  const chosen = sourceMessageId === null ? null : universeFirstSpeaker(sourceMessageId);
  if (!chosen) {
    return recovery;
  }
  return {
    ...recovery, hasLatestUserMessage: true, reason: universeReasons.RecoveryFirstSpeaker, targets: [chosen], sourceMessageId,
  };
}

/**
 * @returns {{reason: string, targets: Array<object>, hasLatestUserMessage: (boolean|undefined), sourceMessageId: (number|undefined)}}
 * @throws {*}
 */
function selectTargetsForEmptySendContinuation() {
  if (!universeNarratorInGroup()) {
    return vocaliaBase_selectTargetsForEmptySendContinuation();
  }
  const continuation = universeHidingNarrator(false, vocaliaBase_selectTargetsForEmptySendContinuation);
  const lone = continuation.targets.length ? null : universeLoneNarrator();
  return lone ? { ...continuation, reason: universeReasons.EmptySendAlone, targets: [lone] } : continuation;
}

/**
 * @param {number} userMessageId
 * @returns {Array<object>}
 * @throws {*}
 */
function selectFirstSpeakerForOpeningUserMessage(userMessageId) {
  if (universeAnswering || !universeNarratorInGroup()) {
    return vocaliaBase_selectFirstSpeakerForOpeningUserMessage(userMessageId);
  }
  const chosen = universeFirstSpeaker(userMessageId);
  if (chosen) {
    return [chosen];
  }
  const targets = universeHidingNarrator(true, () => vocaliaBase_selectFirstSpeakerForOpeningUserMessage(userMessageId));
  const lone = targets.length ? null : universeLoneNarrator();
  return lone ? [lone] : targets;
}

/**
 * @param {object} block
 * @param {?object} ownerMember
 * @returns {Array<object>}
 * @throws {*}
 */
function validTargetsFromBlock(block, ownerMember) {
  if (!universeNarratorInGroup()) {
    return vocaliaBase_validTargetsFromBlock(block, ownerMember);
  }
  const members = getGroupMembers();
  const speakingTo = [];
  for (const name of block.speakingTo) {
    const member = isUserAlias(name) ? null : getMemberByName(name, members);
    if (!member || !globalThis.universeNarrator.isNarrator(member.avatar)) {
      speakingTo.push(name);
    }
  }
  return vocaliaBase_validTargetsFromBlock({ ...block, speakingTo }, ownerMember);
}

/**
 * @param {?object} block
 * @param {?object} ownerMember
 * @param {number} messageId
 * @param {boolean} firstAssistantForUserMessage
 * @returns {Array<object>}
 * @throws {*}
 */
function applyOwnerBlockToState(block, ownerMember, messageId, firstAssistantForUserMessage) {
  if (!universeNarratorInGroup()) {
    return vocaliaBase_applyOwnerBlockToState(block, ownerMember, messageId, firstAssistantForUserMessage);
  }
  const narratorAccepted = Boolean(ownerMember) && globalThis.universeNarrator.isNarrator(ownerMember.avatar)
    && !block.routingMalformed && isOwnerEligibleForStateTransitions(ownerMember);
  const staying = narratorAccepted && block.participationNextTurn === MEMBER_STATUS_DEPARTING
    ? { ...block, participationNextTurn: MEMBER_STATUS_IDLE }
    : block;
  const targets = vocaliaBase_applyOwnerBlockToState(staying, ownerMember, messageId, firstAssistantForUserMessage);
  if (narratorAccepted) {
    const leaving = (block.parameters.leaving ?? '').split('|').map(name => name.trim().toLocaleLowerCase());
    for (const member of getGroupMembers()) {
      if (!globalThis.universeNarrator.isNarrator(member.avatar) && leaving.includes(member.name.toLocaleLowerCase())) {
        setPresence(member.avatar, MEMBER_STATUS_ABSENT);
      }
    }
  }
  globalThis.universeNarrator.onReplyBlock(block, ownerMember?.avatar ?? null, messageId);
  return targets;
}

/**
 * @param {string} action
 * @param {?number} targetMessageId
 * @param {?object} [rejectedMessageCandidate]
 * @returns {{messageId: ?number, message: ?object, member: ?object, source: string, reason: string, rejectedMessageCandidate: ?object}}
 * @throws {*}
 */
function getControlledActionFallbackTarget(action, targetMessageId, rejectedMessageCandidate) {
  if (!universeNarratorInGroup()) {
    return vocaliaBase_getControlledActionFallbackTarget(action, targetMessageId, rejectedMessageCandidate);
  }
  const fallback = universeHidingNarrator(
    true,
    () => vocaliaBase_getControlledActionFallbackTarget(action, targetMessageId, rejectedMessageCandidate),
  );
  const continuing = action === universeContinueAction;
  let answeredId = null;
  if (continuing) {
    answeredId = universeUnansweredUserMessageId();
  } else {
    const answered = findLatestUserMessageBefore(targetMessageId);
    const replied = Boolean(answered) && ctx().chat
      .slice(answered.messageId + 1, getTailRegenerateDeleteWindow().start)
      .some(message => !message.is_system && !isBlankAssistantMessage(message));
    answeredId = answered && !replied ? answered.messageId : null;
  }
  const chosen = answeredId === null ? null : universeFirstSpeaker(answeredId);
  if (chosen) {
    return {
      ...fallback, member: chosen, reason: continuing ? universeReasons.ContinueFirstSpeaker : universeReasons.RegenerateFirstSpeaker,
    };
  }
  const lone = fallback.member ? null : universeLoneNarrator();
  if (!lone) {
    return fallback;
  }
  return { ...fallback, member: lone, reason: continuing ? universeReasons.ContinueAlone : universeReasons.RegenerateAlone };
}

/**
 * @param {?Element} clickedElement
 * @returns {{messageId: ?number, message: ?object, member: ?object, source: string, reason: string}}
 * @throws {*}
 */
function resolveContinueTarget(clickedElement) {
  if (!universeNarratorInGroup() || getMessageIdFromDomElement(clickedElement) !== null) {
    return vocaliaBase_resolveContinueTarget(clickedElement);
  }
  const unansweredId = universeUnansweredUserMessageId();
  if (unansweredId !== null) {
    return getControlledActionFallbackTarget(universeContinueAction, unansweredId, null);
  }
  const lastReplyId = findLastAssistantMessageId();
  const candidate = lastReplyId === null ? null : resolveMessageTargetOwner(lastReplyId);
  if (candidate?.member) {
    return { ...candidate, reason: universeReasons.ContinueOwner.replace('{source}', candidate.source) };
  }
  return getControlledActionFallbackTarget(universeContinueAction, lastReplyId, candidate);
}

/**
 * @param {number} userMessageId
 * @param {object} state
 * @returns {{reason: string, targets: Array<object>}}
 * @throws {*}
 */
function selectContinuationTargetsForUserMessage(userMessageId, state) {
  if (universeAnswering || !universeNarratorInGroup()) {
    return vocaliaBase_selectContinuationTargetsForUserMessage(userMessageId, state);
  }
  const chosen = universeFirstSpeaker(userMessageId);
  if (chosen) {
    return { reason: universeReasons.FirstSpeaker, targets: [chosen] };
  }
  const continuation = universeHidingNarrator(
    true,
    () => vocaliaBase_selectContinuationTargetsForUserMessage(userMessageId, state),
  );
  const lone = continuation.targets.length ? null : universeLoneNarrator();
  return lone ? { ...continuation, reason: universeReasons.Alone, targets: [lone] } : continuation;
}
