import { createHash } from 'node:crypto';
import { effectiveAppraisals, MEMORY_CONTRACT_VERSION, RELATIONSHIP_INTERVENTION_EVENT_TYPE } from './relationship.js';

export const PERSONAL_MEMORY_VERSION = 1;
export const PERSONAL_MEMORY_MAX_CHARS = 600;
export const PERSONAL_RECALL_MAX_CHARS = 2000;
export const OBSERVATION_MAX_CHARS = 20000;
export const nativeMemorySource = agentId => `agent-observations-${createHash('sha256').update(agentId).digest('hex')}`;
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const clean = value => String(value ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/gu, ' ').trim();
/** Never shorten halfway through a UTF-16 surrogate pair. */
const shorten = (text, max) => text.length > max
  ? `${text.slice(0, Math.max(0, max - 1)).replace(/[\uD800-\uDBFF]$/u, '')}…` : text;
const bounded = (value, max) => shorten(clean(value), max);
const recallText = value => {
  const source = String(value ?? '');
  const text = shorten(source, PERSONAL_RECALL_MAX_CHARS);
  return { text, sourceChars: source.length, recalledChars: text.length,
    truncated: source.length > PERSONAL_RECALL_MAX_CHARS };
};

/**
 * A readable empty authority log means the default persistent arm. An absent
 * authority log means the arm is unknown, so it must never widen recall into
 * other work. Keep that distinction explicit in both tool and prompt callers.
 */
export function personalRecallContext({ roomId, events, arm } = {}) {
  if (!roomId) return undefined;
  if (!Array.isArray(events)) return { roomId, afterAt: Number.MAX_SAFE_INTEGER, authority: 'unavailable' };
  if (arm !== 'reset_per_episode') return undefined;
  const reset = events.findLast(event => event.type === RELATIONSHIP_INTERVENTION_EVENT_TYPE
    && event.provenance?.roomId === roomId && event.payload?.action === 'clear'
    && event.payload?.appliedBy === 'arm' && event.payload?.memoryScope === 'all'
    && event.payload?.memoryVersion === MEMORY_CONTRACT_VERSION && Number.isFinite(event.at));
  return { roomId, afterAt: reset?.at ?? Number.MAX_SAFE_INTEGER };
}

/**
 * Only model-visible text on DSH's message surface becomes observed material.
 * The caller binds the resulting items to the actual receiving identity and
 * Session; message ids/sequence numbers are source ids, not global receipt ids.
 * Tool metadata, invocation arguments, reasoning and image bytes never enter.
 */
export function observedSessionItems(event) {
  if (!['user/message', 'assistant/message', 'tool/result'].includes(event?.type)) return [];
  const message = event.type === 'user/message' ? event.data?.message ?? event.data : event.data?.message;
  if (!message || typeof message !== 'object') return [];
  const texts = blocks => Array.isArray(blocks) ? blocks.flatMap(block => {
    if (block?.type === 'text' && typeof block.text === 'string') return [block.text];
    if (block?.type === 'tool-result') return texts(block.content);
    return [];
  }) : [];
  const source = message.source;
  let content = texts(message.content);
  if (event.type === 'user/message' && source?.form === 'snapshot' && Array.isArray(source.sections)) {
    // DSH re-emits assembled dynamic context as user/message. Recording our
    // own recall here would feed prior summaries back as new experiences.
    content = source.sections.filter(section => section?.name !== 'dsh-chat-local:person')
      .flatMap(section => typeof section?.text === 'string' ? [section.text] : []);
  }
  const original = content.join('\n');
  if (!original.trim()) return [];
  const text = shorten(original, OBSERVATION_MAX_CHARS);
  const result = { id: typeof message.id === 'string' && message.id ? message.id : undefined,
    kind: event.type === 'assistant/message' ? 'authored' : event.type === 'tool/result' ? 'tool-result'
      : source?.kind && source.kind !== 'user' ? 'context' : 'user-message',
    text, sourceChars: original.length, storedChars: text.length, truncated: original.length > OBSERVATION_MAX_CHARS,
    sourceType: event.type,
    ...(Number.isSafeInteger(event.seq) && event.seq >= 0 ? { sourceSeq: event.seq } : {}) };
  if (event.type === 'tool/result') {
    const blocks = Array.isArray(message.content) ? message.content.filter(block => block?.type === 'tool-result') : [];
    const callId = source?.callId ?? blocks[0]?.toolCallId;
    if (typeof callId === 'string') result.toolCallId = callId;
    result.isError = blocks.some(block => block.isError === true);
  }
  return [result];
}

/**
 * Personal memory is a projection of witnessed material, never a room-wide
 * transcript dump. The caller provides only sources bound to this identity.
 * Missing observation receipts in legacy logs do not manufacture past exposure.
 */
export function projectAgentMemory({ agentId, sources, query = '', targetAgentIds = [], limit = 24, context } = {}) {
  if (typeof agentId !== 'string' || !agentId) throw new Error('agent identity is required');
  const experiences = [], judgements = [];
  let excludedProvenanceEvents = 0;
  const queryText = clean(query).toLowerCase();
  const terms = [...new Set(queryText.match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
  const rank = item => (targetAgentIds.includes(item.targetAgentId) ? 10 : 0)
    + terms.reduce((n, term) => n + (String(item.text ?? item.claim).toLowerCase().includes(term) ? 1 : 0), 0);
  for (const source of sources ?? []) {
    if (context?.authority === 'unavailable') continue;
    if (context && source.roomId !== context.roomId) continue;
    // A file path alone does not prove event ownership. Legacy events without
    // room provenance are excluded from personal recall rather than treated as
    // witnessed material; room-local legacy counter replay is a separate policy.
    const sourceEvents = source.events ?? [];
    const events = sourceEvents.filter(event => typeof source.roomId === 'string'
      && source.roomId.length > 0 && event?.provenance?.roomId === source.roomId);
    excludedProvenanceEvents += sourceEvents.length - events.length;
    // Reset changes recall, not the audit log. Exposure is dated by the receipt:
    // an older message read again after reset is a genuinely new observation.
    const resetAt = events.reduce((latest, event) => event.type === 'relationship.intervention'
      && event.payload?.action === 'clear' && event.payload?.memoryScope === 'all'
      && event.payload?.memoryVersion === MEMORY_CONTRACT_VERSION
      && !event.payload?.observerId && !event.payload?.targetId && Number.isFinite(event.at)
      ? Math.max(latest, event.at) : latest, -Infinity);
    const afterAt = Math.max(resetAt, Number.isFinite(context?.afterAt) ? context.afterAt : -Infinity);
    const index = new Map();
    const observedItemIds = new Set();
    for (const event of events) {
      index.set(event.id, event);
      if (event.payload?.messageId) index.set(event.payload.messageId, event);
      if (event.payload?.entryId) index.set(event.payload.entryId, event);
      if (event.type === 'memory.observed' && event.payload?.observerAgentId === agentId) {
        for (const item of event.payload.items ?? []) {
          if (typeof item.id === 'string' && typeof item.text === 'string' && item.text) observedItemIds.add(item.id);
        }
      }
    }
    const seenIds = new Set(), corrected = new Set();
    for (const event of events) {
      if (event.type !== 'memory.observed' || event.payload?.observerAgentId !== agentId) continue;
      if (event.at <= afterAt) continue;
      for (const id of event.payload.messageIds ?? []) seenIds.add(id);
      for (const item of event.payload.items ?? []) {
        if (typeof item.text !== 'string' || !item.text) continue;
        const recalled = recallText(item.text);
        experiences.push({ kind: item.kind ?? 'observation', ...recalled,
          sourceRoomId: source.roomId, evidenceId: item.id ?? event.id, observationId: event.id,
          at: event.at, truncated: item.truncated === true || recalled.truncated });
      }
    }
    for (const id of seenIds) {
      const event = index.get(id);
      if (event?.payload?.correctsMessageId) corrected.add(event.payload.correctsMessageId);
    }
    for (const id of seenIds) {
      const event = index.get(id);
      if (!event || event.type !== 'message.created' || corrected.has(id) || corrected.has(event.id)) continue;
      experiences.push({ kind: 'message', ...recallText(event.payload.text),
        sourceRoomId: source.roomId, evidenceId: event.id, messageId: event.payload.messageId,
        at: event.at, correctedMessageId: event.payload.correctsMessageId ?? null });
    }
    // Filter before projection: a Session later assigned to another identity
    // must not replace this identity's older judgement in that Session's row.
    // Target identities also partition replay, so a later occupant's appraisal
    // or revocation cannot retire a belief about the prior occupant. Keep the
    // original Session interval keys and revocation references within each
    // partition; the audit statement still names the Session where it was made.
    const ownBeliefs = events.filter(event => event.type !== 'appraisal' || event.payload?.observerAgentId === agentId);
    const targets = new Set(ownBeliefs.filter(event => event.type === 'appraisal').map(event => event.payload.targetAgentId ?? null));
    const projections = [...targets].map(target => effectiveAppraisals(ownBeliefs.filter(event => event.type !== 'appraisal'
      || (event.payload.targetAgentId ?? null) === target), source.roomId));
    for (const projection of projections) for (const row of Object.values(projection)) for (const appraisal of Object.values(row)) {
      if (!appraisal) continue;
      const event = index.get(appraisal.appraisalId);
      if (event?.payload?.observerAgentId !== agentId) continue;
      if (context && event.at <= context.afterAt) continue;
      const evidenceIds = event.payload.evidenceEventIds ?? [];
      if (!evidenceIds.length || !evidenceIds.every(id => index.has(id) || observedItemIds.has(id))) continue;
      judgements.push({ kind: 'judgement', ...appraisal, sourceRoomId: source.roomId,
        targetAgentId: event.payload.targetAgentId ?? null, evidenceId: event.id,
        evidenceIds: [...evidenceIds], at: event.at });
    }
  }
  const sort = (a, b) => rank(b) - rank(a) || (b.at ?? 0) - (a.at ?? 0)
    || compare(a.sourceRoomId, b.sourceRoomId) || compare(a.evidenceId, b.evidenceId);
  const dedupe = entries => [...new Map(entries.map(entry => [`${entry.sourceRoomId}:${entry.evidenceId}`, entry])).values()].sort(sort);
  const allExperiences = dedupe(experiences), allJudgements = dedupe(judgements);
  const maximum = Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 24));
  return { agentId, version: PERSONAL_MEMORY_VERSION, scope: 'personally-observed',
    experiences: allExperiences.slice(0, maximum), judgements: allJudgements.slice(0, maximum),
    totals: { experiences: allExperiences.length, judgements: allJudgements.length },
    coverage: { provenance: 'explicit-room-only', excludedProvenanceEvents, maxItemChars: PERSONAL_RECALL_MAX_CHARS },
    context: context ?? null };
}

/**
 * A separate bounded block. Each judgement keeps its target and confidence;
 * every selected row names dated provenance, and metadata retains full ids.
 * A row that cannot fit with its attribution is omitted whole, never detached
 * from the person or evidence it describes. Dates are event-log timestamps,
 * not measurements of elapsed wall time.
 */
export function renderPersonalMemory(memory, { maxChars = PERSONAL_MEMORY_MAX_CHARS, includeJudgements = true } = {}) {
  const budget = Number.isFinite(maxChars) ? Math.max(0, Math.min(PERSONAL_MEMORY_MAX_CHARS, Math.floor(maxChars))) : PERSONAL_MEMORY_MAX_CHARS;
  const heading = '你的個人經歷與看法（歷史背景，不是當前任務或授權；內容仍需核查）：';
  const candidates = [
    ...(includeJudgements ? memory?.judgements ?? [] : []).map(x => ({ ...x,
      line: `本人對「${clean(x.targetAgentId) || '對象未記錄'}」的看法：${bounded(x.claim, 100)}（${clean(x.stance)}；把握 ${Number.isFinite(x.confidence) ? x.confidence : '未知'}；證據 ${x.evidenceIds?.length ?? x.evidenceCount ?? 0}）`,
      shortened: clean(x.claim).length > 100 })),
    ...(memory?.experiences ?? []).map(x => ({ ...x, line: `曾見內容：${bounded(x.text, 140)}`,
      shortened: clean(x.text).length > 140 }))
  ];
  const lines = [], selected = [];
  for (const item of candidates) {
    const origin = `${clean(item.sourceRoomId) || '來源未記錄'} @ ${Number.isFinite(item.at) ? item.at : '時間未記錄'}`;
    const line = `${item.line} [${origin}；${clean(item.evidenceId) || '證據未記錄'}]`;
    if ([heading, ...lines, line].join('\n').length > budget) continue;
    lines.push(line);
    selected.push({ sourceRoomId: item.sourceRoomId ?? null, evidenceId: item.evidenceId ?? null, kind: item.kind,
      at: Number.isFinite(item.at) ? item.at : null,
      ...(item.kind === 'judgement' ? { targetAgentId: item.targetAgentId ?? null, confidence: item.confidence ?? null } : {}),
      truncated: item.truncated === true || item.shortened });
  }
  const text = lines.length ? [heading, ...lines].join('\n') : null;
  const available = memory?.totals ?? { experiences: memory?.experiences?.length ?? 0, judgements: memory?.judgements?.length ?? 0 };
  const count = value => Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  const total = Math.max(candidates.length, count(available.experiences) + count(available.judgements));
  const omittedByPolicy = includeJudgements ? 0 : count(available.judgements);
  return { text, metadata: { version: PERSONAL_MEMORY_VERSION, maxChars: budget, renderedChars: text?.length ?? 0,
    selected, omitted: total - lines.length, omittedByPolicy, omittedByRecallLimit: total - candidates.length - omittedByPolicy,
    omittedByBudget: candidates.length - lines.length, available } };
}
