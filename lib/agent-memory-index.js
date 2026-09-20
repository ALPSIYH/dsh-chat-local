import { effectiveAppraisals, MEMORY_CONTRACT_VERSION, tickOf } from './relationship.js';
import { memoryActivation, boundPersonalRecall, memoryContentHash, memoryTerms, MEMORY_LIFECYCLE_VERSION } from './memory-lifecycle.js';
import { runArm } from './experiment.js';

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const key = (...parts) => JSON.stringify(parts);
const identity = value => typeof value === 'string' && value.length > 0;
const textValue = text => {
  const raw = String(text ?? '');
  const result = raw.length > 2000 ? `${raw.slice(0, 1999).replace(/[\uD800-\uDBFF]$/u, '')}…` : raw;
  return { text: result, contentHash: memoryContentHash(raw), sourceChars: raw.length, recalledChars: result.length, truncated: raw.length > 2000 };
};
const sameRevision = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const latest = (a, b) => (b.observedAt ?? b.at ?? 0) - (a.observedAt ?? a.at ?? 0)
  || compare(a.sourceRoomId, b.sourceRoomId) || compare(a.evidenceId, b.evidenceId);
// Authorship is explicit provenance, never inferred from vocabulary or truth.
const ownAccount = item => ['authored', 'belief', 'judgement'].includes(item.kind) || item.authoredByObserver === true;
const recallScore = (item, matches, targets) => matches + (item.pinned ? 10 : 0) + (targets.includes(item.targetAgentId) ? 10 : 0);
const compareRecall = (a, b) => b._score - a._score || Number(ownAccount(a)) - Number(ownAccount(b)) || latest(a, b);
const fullReset = event => event.type === 'relationship.intervention' && event.payload?.action === 'clear'
  && event.payload?.memoryScope === 'all' && event.payload?.memoryVersion === MEMORY_CONTRACT_VERSION;
const grams = text => {
  const found = new Set();
  // Adjacent character pairs preserve substring recall (including CJK) without
  // storing redundant triples or whitespace postings. Final matches still check
  // the complete term, so the index never manufactures semantic similarity.
  for (const token of memoryTerms(text)) { found.add(`\0${token}`); const chars = [...token]; for (let i = 0; i < chars.length - 1; i++) found.add(chars[i] + chars[i + 1]); }
  return found;
};
function sortedInsert(array, item) {
  let lo = 0, hi = array.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (latest(array[mid], item) <= 0) lo = mid + 1; else hi = mid; }
  array.splice(lo, 0, item);
}

/**
 * Rebuildable, process-local derived index. Only verified committed source views
 * may be supplied by the owner. Source authorization is supplied on every read;
 * cached ownership is never permission. No serialized cache is trusted at startup.
 */
export class AgentMemoryIndex {
  #sources = new Map();
  #agents = new Map();
  #dirty = new Set();
  #scheduled = null;
  #evicted = new Map();
  #clock = 0;
  #unavailablePolicySources = new Map();
  #inheritedPolicyAuthority = new Map();
  #policyHistoryIncomplete = false;
  #work = { indexedEvents: 0, rebuiltSources: 0, consolidatedGroups: 0, recallCandidates: 0, appraisalStatementsProcessed: 0 };
  constructor({ maxCandidateCount = 2000, maxIndexBytes = 256 * 1024 * 1024, maxAgentIndexBytes = 256 * 1024 * 1024 } = {}) {
    if (!Number.isSafeInteger(maxCandidateCount) || maxCandidateCount < 1) throw new TypeError('invalid memory candidate cap');
    if (!Number.isSafeInteger(maxIndexBytes) || maxIndexBytes < 4096 || !Number.isSafeInteger(maxAgentIndexBytes) || maxAgentIndexBytes < 4096) throw new TypeError('invalid index byte budget');
    this.maxCandidateCount = Math.min(2000, maxCandidateCount);
    this.maxIndexBytes = maxIndexBytes; this.maxAgentIndexBytes = Math.min(maxIndexBytes, maxAgentIndexBytes);
  }
  revision(roomId) { return structuredClone(this.#sources.get(roomId)?.revision ?? null); }
  authorityContext(roomId) {
    const source = this.#sources.get(roomId);
    return source ? { roomId, arm: runArm(source.manifest ? [source.manifest] : [], roomId),
      events: source.armReset ? [source.armReset] : [] } : { roomId, events: undefined, arm: undefined };
  }
  #agent(agentId) {
    if (!this.#agents.has(agentId)) this.#agents.set(agentId, { leaves: new Map(), aliases: new Map(), groups: new Map(),
      cards: new Map(), recent: [], terms: new Map(), sourceCards: new Map(), controls: new Map(), beliefs: new Map(), beliefRecent: [], beliefStatements: new Map() });
    return this.#agents.get(agentId);
  }
  #source(roomId, revision) {
    return { roomId, revision, ids: new Set(), aliases: new Map(), messages: new Map(), waiting: new Map(),
      observationReceipts: new Map(), observed: new Map(), corrected: new Map(), agents: new Set(), interventions: [], appraisals: new Map(),
      policyAgents: new Set(), controlAgents: new Set(), retirementAgents: new Set(), accountedBytes: 512, cardBytes: 0, leafBytes: 0, usedAt: ++this.#clock, pendingAppraisalTargets: new Map(), judgementKeys: new Map(), horizon: 0, replayHorizon: 0, resetAt: -Infinity, manifest: null, armReset: null, excluded: 0 };
  }
  #schedule(agentId, groupId) {
    this.#dirty.add(key(agentId, groupId));
    if (this.#scheduled === null) {
      this.#scheduled = setImmediate(() => { this.#scheduled = null; this.flush(); });
      this.#scheduled.unref?.();
    }
  }
  #removeLeaf(agentId, leafKey) {
    const agent = this.#agents.get(agentId), prior = agent?.leaves.get(leafKey);
    if (!prior) return;
    agent.leaves.delete(leafKey);
    const source = this.#sources.get(prior.sourceRoomId); if (source) source.leafBytes -= prior.accountedBytes;
    for (const alias of prior.aliases ?? []) if (agent.aliases.get(key(prior.sourceRoomId, alias)) === leafKey) agent.aliases.delete(key(prior.sourceRoomId, alias));
    agent.groups.get(prior.groupId)?.delete(leafKey);
    this.#schedule(agentId, prior.groupId);
  }
  #putLeaf(agentId, item, aliases = []) {
    const agent = this.#agent(agentId), leafKey = key(item.sourceRoomId, item.evidenceId);
    const prior = agent.leaves.get(leafKey);
    if (prior?.contentHash === item.contentHash) item = { ...item, exposureFrom: prior.exposureFrom ?? prior.observedAt };
    else item = { ...item, exposureFrom: item.observedAt };
    this.#removeLeaf(agentId, leafKey);
    const groupId = key(item.sourceRoomId, item.kind, item.contentHash ?? memoryContentHash(item.claim), item.targetAgentId ?? null, ownAccount(item));
    const leaf = { ...item, aliases: [...new Set([item.evidenceId, ...aliases])], groupId, leafKey };
    leaf.accountedBytes = Buffer.byteLength(JSON.stringify(leaf)) + 128;
    const source = this.#sources.get(item.sourceRoomId); if (source) source.leafBytes += leaf.accountedBytes;
    agent.leaves.set(leafKey, leaf);
    for (const alias of leaf.aliases) agent.aliases.set(key(item.sourceRoomId, alias), leafKey);
    if (!agent.groups.has(groupId)) agent.groups.set(groupId, new Set());
    agent.groups.get(groupId).add(leafKey);
    this.#schedule(agentId, groupId);
  }
  #rebuildCard(agentId, groupId) {
    const agent = this.#agents.get(agentId); if (!agent) return;
    const previous = agent.cards.get(groupId);
    if (previous) {
      agent.cards.delete(groupId);
      const source = this.#sources.get(previous.sourceRoomId); if (source) source.cardBytes -= previous.accountedBytes;
      const position = agent.recent.indexOf(previous); if (position >= 0) agent.recent.splice(position, 1);
      const sourceView = agent.sourceCards.get(previous.sourceRoomId); sourceView?.pinned.delete(groupId);
      if (previous.targetAgentId) sourceView?.targets.get(previous.targetAgentId)?.delete(groupId);
      const sourcePosition = sourceView?.recent.indexOf(previous); if (sourcePosition >= 0) sourceView.recent.splice(sourcePosition, 1);
      for (const term of previous.searchGrams) { const rows = sourceView?.terms.get(term); rows?.delete(groupId); if (!rows?.size) sourceView.terms.delete(term); }
      for (const term of previous.searchGrams) { const rows = agent.terms.get(term); rows?.delete(groupId); if (!rows?.size) agent.terms.delete(term); }
    }
    for (const [roomId, view] of agent.sourceCards) if (!view.recent.length && !view.terms.size) agent.sourceCards.delete(roomId);
    const members = agent.groups.get(groupId); if (!members?.size) { agent.groups.delete(groupId); return; }
    let representative = null, controlledRepresentative = null, count = 0, pinned = false;
    const policySources = new Set();
    for (const leafKey of members) {
      const leaf = agent.leaves.get(leafKey), control = this.#control(agent, leaf);
      if (!representative || latest(leaf, representative) < 0) representative = leaf;
      if (control.originRoomId) policySources.add(control.originRoomId);
      if (control.suppressed) continue;
      count++; pinned ||= control.pinned;
      if (!controlledRepresentative || latest(leaf, controlledRepresentative) < 0) controlledRepresentative = leaf;
    }
    if (!representative) return;
    const { aliases, leafKey, accountedBytes, ...base } = representative;
    const card = { ...base, pinned: false, consolidatedCount: members.size, consolidation: 'extractive-equivalence',
      policySources, controlledRepresentative, controlledCount: count, controlledPinned: pinned,
      searchGrams: grams(base.text ?? base.claim) };
    card.accountedBytes = Buffer.byteLength(JSON.stringify(base)) + [...card.searchGrams].reduce((n, gram) => n + 48 + gram.length * 2, 128);
    const source = this.#sources.get(card.sourceRoomId); if (source) source.cardBytes += card.accountedBytes;
    agent.cards.set(groupId, card); sortedInsert(agent.recent, card);
    if (!agent.sourceCards.has(card.sourceRoomId)) agent.sourceCards.set(card.sourceRoomId, { recent: [], terms: new Map(), pinned: new Set(), targets: new Map() });
    const sourceView = agent.sourceCards.get(card.sourceRoomId); sortedInsert(sourceView.recent, card);
    if (card.controlledPinned) sourceView.pinned.add(groupId);
    if (card.targetAgentId) { if (!sourceView.targets.has(card.targetAgentId)) sourceView.targets.set(card.targetAgentId, new Set()); sourceView.targets.get(card.targetAgentId).add(groupId); }
    for (const term of card.searchGrams) { if (!sourceView.terms.has(term)) sourceView.terms.set(term, new Set()); sourceView.terms.get(term).add(groupId); }
    for (const term of card.searchGrams) { if (!agent.terms.has(term)) agent.terms.set(term, new Set()); agent.terms.get(term).add(groupId); }
    this.#work.consolidatedGroups++;
  }
  flush() {
    if (this.#scheduled !== null) { clearImmediate(this.#scheduled); this.#scheduled = null; }
    const pending = [...this.#dirty]; this.#dirty.clear();
    for (const value of pending) this.#rebuildCard(...JSON.parse(value));
    this.#enforceCapacity(); this.#pruneAgents();
    return this.stats();
  }
  #control(agent, leaf, allowed) {
    const control = agent.controls.get(key(leaf.sourceRoomId, leaf.evidenceId));
    if (!control || allowed && !allowed.has(control.originRoomId)
      || !(control.at > (this.#sources.get(control.originRoomId)?.resetAt ?? this.#inheritedPolicyAuthority.get(control.originRoomId)?.resetAt ?? Infinity))
      || control.contentHash && control.contentHash !== leaf.contentHash) return { pinned: false, suppressed: false };
    const pinAt = control.pinAt ?? control.at;
    const source = this.#sources.get(leaf.sourceRoomId);
    const validPinReceipt = control.pinObservationId
      ? this.#supportsObservation(control.observerAgentId, leaf, control.pinObservationId)
      : source?.resetAt === -Infinity && pinAt >= (leaf.exposureFrom ?? leaf.observedAt ?? leaf.at);
    const originReset = this.#sources.get(control.originRoomId)?.resetAt ?? this.#inheritedPolicyAuthority.get(control.originRoomId)?.resetAt ?? Infinity;
    return { ...control, pinned: control.pinned && validPinReceipt && pinAt > originReset };
  }
  dropSource(roomId) {
    const source = this.#sources.get(roomId); if (!source) return false;
    this.#sources.delete(roomId);
    const authorityAgents = new Set([...source.controlAgents, ...source.retirementAgents]);
    if (authorityAgents.size) {
      const cap = Math.max(1, Math.min(4096, Math.floor(this.maxIndexBytes / 4096)));
      if (!this.#unavailablePolicySources.has(roomId) && this.#unavailablePolicySources.size >= cap) {
        this.#unavailablePolicySources.delete(this.#unavailablePolicySources.keys().next().value); this.#policyHistoryIncomplete = true;
      }
      this.#unavailablePolicySources.set(roomId, authorityAgents);
    }
    for (const [agentId, agent] of this.#agents) {
      for (const [leafKey, leaf] of agent.leaves) if (leaf.sourceRoomId === roomId) this.#removeLeaf(agentId, leafKey);
      for (const [controlKey, control] of agent.controls) if (control.originRoomId === roomId) {
        agent.controls.delete(controlKey);
        const leaf = agent.leaves.get(controlKey); if (leaf) this.#schedule(agentId, leaf.groupId);
      }
      let beliefsChanged = false;
      for (const [statementId, statement] of agent.beliefStatements) if (statement.sourceRoomId === roomId) { agent.beliefStatements.delete(statementId); beliefsChanged = true; }
      if (beliefsChanged) this.#rebuildBeliefs(agent);
    }
    this.#pruneAgents();
    return true;
  }
  syncSource(roomId, { events, revision, appendOnly = false, baseRevision = null, verified = true } = {}) {
    if (!identity(roomId) || !Array.isArray(events) || revision === undefined || verified !== true) throw new TypeError('verified source view is required');
    let source = this.#sources.get(roomId);
    if (appendOnly && (!source || !sameRevision(source.revision, baseRevision))) throw new Error('memory source delta has stale base revision');
    if (!appendOnly) { this.dropSource(roomId); source = this.#source(roomId, revision); this.#sources.set(roomId, source); this.#work.rebuiltSources++; }
    const dirtyBeliefs = new Map(), changedBeliefGraphs = new Set();
    const markBelief = (agentId, target) => { if (!dirtyBeliefs.has(agentId)) dirtyBeliefs.set(agentId, new Set()); dirtyBeliefs.get(agentId).add(target); };
    for (const event of events) {
      this.#work.indexedEvents++;
      if (event?.provenance?.roomId !== roomId) { source.excluded++; continue; }
      if (!identity(event.id)) continue;
      if (source.ids.has(event.id)) continue;
      source.ids.add(event.id);
      // Conservative data accounting, not a claim about engine heap/RSS. It
      // includes source strings, leaves, postings and object/map allowances.
      source.accountedBytes += event.id.length * 2 + 96;
      if (event.type === 'message.created') source.accountedBytes += Buffer.byteLength(JSON.stringify(event.payload)) + 96;
      else if (['appraisal', 'memory.belief', 'memory.control'].includes(event.type)) source.accountedBytes += Buffer.byteLength(JSON.stringify(event.payload)) + 128;
      source.aliases.set(event.id, event.id);
      if (identity(event.payload?.entryId)) source.aliases.set(event.payload.entryId, event.id);
      source.horizon = Math.max(source.horizon, tickOf(event));
      if (event.type !== 'appraisal') source.replayHorizon = Math.max(source.replayHorizon, tickOf(event));
      const given = event.payload ?? {};
      if (event.type === 'run.manifest') source.manifest = event;
      if (fullReset(event)) {
        source.interventions.push(event);
        for (const [agentId, targets] of source.appraisals) for (const target of targets.keys()) markBelief(agentId, target);
        if (given.appliedBy === 'arm' && Number.isFinite(event.at)) source.armReset = event;
        if (!given.observerId && !given.targetId && Number.isFinite(event.at)) {
          for (const [agentId, agent] of this.#agents) for (const [controlKey, control] of agent.controls) if (control.originRoomId === roomId) {
            const leaf = agent.leaves.get(controlKey); if (leaf) this.#schedule(agentId, leaf.groupId);
          }
          source.resetAt = Math.max(source.resetAt, event.at);
          for (const agentId of source.agents) {
            const agent = this.#agent(agentId);
            for (const [leafKey, leaf] of agent.leaves) if (leaf.sourceRoomId === roomId && leaf.kind !== 'judgement'
              && (leaf.observedAt ?? leaf.at) <= source.resetAt) this.#removeLeaf(agentId, leafKey);
          }
          source.observed.clear(); source.corrected.clear(); source.waiting.clear(); source.observationReceipts.clear();
        }
      }
      if (event.type === 'message.created') {
        source.messages.set(event.id, { id: event.id, at: event.at, ...given });
        if (identity(given.messageId)) { source.aliases.set(given.messageId, event.id); source.messages.set(given.messageId, source.messages.get(event.id)); }
        for (const alias of [event.id, given.messageId]) for (const [agentId, receipt] of source.waiting.get(alias) ?? []) this.#observeMessage(source, agentId, alias, receipt);
      } else if (event.type === 'memory.observed' && identity(given.observerAgentId)) {
        const agentId = given.observerAgentId; source.agents.add(agentId);
        if (event.at <= source.resetAt) continue;
        source.observationReceipts.set(event.id, { agentId, at: event.at,
          items: new Map((given.items ?? []).filter(item => typeof item.text === 'string').map(item => [item.id ?? event.id, memoryContentHash(item.text)])),
          messageIds: new Set(given.messageIds ?? []) });
        for (const item of given.items ?? []) if (typeof item.text === 'string' && item.text) {
          this.#putLeaf(agentId, { kind: item.kind ?? 'observation', ...textValue(item.text), sourceRoomId: roomId,
            evidenceId: item.id ?? event.id, observationId: event.id, at: event.at, observedAt: event.at,
            truncated: item.truncated === true || item.text.length > 2000 });
        }
        for (const messageId of given.messageIds ?? []) this.#observeMessage(source, agentId, messageId, event);
      } else if (event.type === 'appraisal' && identity(given.observerAgentId)) {
        const agentId = given.observerAgentId; source.agents.add(agentId);
        if (!source.appraisals.has(agentId)) source.appraisals.set(agentId, new Map());
        const target = given.targetAgentId ?? null, targets = source.appraisals.get(agentId);
        if (!targets.has(target)) targets.set(target, []);
        targets.get(target).push(event); markBelief(agentId, target);
      } else if (event.type === 'memory.control' && identity(given.observerAgentId)) {
        source.agents.add(given.observerAgentId); source.policyAgents.add(given.observerAgentId); source.controlAgents.add(given.observerAgentId);
        this.#applyControl(roomId, event);
      } else if (event.type === 'memory.belief' && identity(given.observerAgentId)) {
        source.agents.add(given.observerAgentId); source.policyAgents.add(given.observerAgentId);
        if (given.action === 'revoke' || identity(given.supersedes)) source.retirementAgents.add(given.observerAgentId);
        this.#applyBelief(roomId, event); changedBeliefGraphs.add(given.observerAgentId);
      }
    }
    // A later tick can make a future-valid statement active. This touches only
    // compact interval statements, never unrelated message/observation history.
    for (const [pair, due] of source.pendingAppraisalTargets) if (due <= source.replayHorizon) markBelief(...JSON.parse(pair));
    for (const [agentId, targets] of dirtyBeliefs) for (const target of targets) this.#refreshAppraisals(source, agentId, target);
    for (const agentId of changedBeliefGraphs) this.#rebuildBeliefs(this.#agent(agentId));
    source.revision = structuredClone(revision); source.usedAt = ++this.#clock;
    this.#evicted.delete(roomId); this.#unavailablePolicySources.delete(roomId);
    this.#enforceCapacity();
    return { revision: this.revision(roomId), indexedEvents: events.length, queuedGroups: this.#dirty.size };
  }
  #observeMessage(source, agentId, messageId, receipt) {
    if (!identity(messageId)) return;
    if (!source.waiting.has(messageId)) source.waiting.set(messageId, new Map());
    source.waiting.get(messageId).set(agentId, { id: receipt.id, at: receipt.at });
    const message = source.messages.get(messageId); if (!message) return;
    if (!source.observed.has(agentId)) source.observed.set(agentId, new Map());
    source.observed.get(agentId).set(message.id, { id: receipt.id, at: receipt.at });
    if (!source.corrected.has(agentId)) source.corrected.set(agentId, new Set());
    const corrected = source.corrected.get(agentId);
    if (message.correctsMessageId) {
      corrected.add(message.correctsMessageId);
      const previous = source.messages.get(message.correctsMessageId);
      if (previous) { corrected.add(previous.id); this.#removeLeaf(agentId, key(source.roomId, previous.id)); }
    }
    if (corrected.has(message.id) || corrected.has(message.messageId)) return;
    this.#putLeaf(agentId, { kind: 'message', ...textValue(message.text), sourceRoomId: source.roomId,
      ...(identity(message.authorAgentId) ? { authoredByObserver: message.authorAgentId === agentId } : {}),
      evidenceId: message.id, messageId: message.messageId, at: message.at, observedAt: receipt.at,
      observationId: receipt.id, correctedMessageId: message.correctsMessageId ?? null }, [message.messageId].filter(identity));
  }
  #refreshAppraisals(source, agentId, targetAgentId) {
    const agent = this.#agent(agentId), pair = key(agentId, targetAgentId);
    for (const leafKey of source.judgementKeys.get(pair) ?? []) this.#removeLeaf(agentId, leafKey);
    source.judgementKeys.set(pair, new Set());
    const statements = source.appraisals.get(agentId)?.get(targetAgentId) ?? [];
    this.#work.appraisalStatementsProcessed += statements.length + source.interventions.length;
    const horizon = statements.reduce((n, event) => Math.max(n, tickOf(event)), source.replayHorizon);
    const future = statements.map(event => event.payload?.validFrom).filter(at => Number.isFinite(at) && at > horizon);
    if (future.length) source.pendingAppraisalTargets.set(pair, Math.min(...future)); else source.pendingAppraisalTargets.delete(pair);
    const byId = new Map(statements.map(event => [event.id, event]));
    const projected = effectiveAppraisals([...source.interventions, ...statements], source.roomId, horizon);
    for (const row of Object.values(projected)) for (const appraisal of Object.values(row)) {
      if (!appraisal) continue;
      const event = byId.get(appraisal.appraisalId), evidenceIds = event.payload.evidenceEventIds ?? [];
      if (!evidenceIds.length || !evidenceIds.every(id => source.aliases.has(id) || agent.aliases.has(key(source.roomId, id)))) continue;
      source.judgementKeys.get(pair).add(key(source.roomId, event.id));
      this.#putLeaf(agentId, { kind: 'judgement', ...appraisal, sourceRoomId: source.roomId, targetAgentId,
        evidenceId: event.id, evidenceIds: [...evidenceIds], at: event.at, observedAt: event.at, contentHash: memoryContentHash(appraisal.claim) });
    }
  }
  #applyControl(roomId, event) {
    const p = event.payload;
    if (!identity(p.sourceRoomId) || !identity(p.evidenceId) || !['pin', 'unpin', 'suppress', 'restore'].includes(p.action)) return;
    const agent = this.#agent(p.observerAgentId), aliasKey = key(p.sourceRoomId, p.evidenceId);
    const controlKey = agent.aliases.get(aliasKey) ?? aliasKey;
    const prior = agent.controls.get(controlKey) ?? { pinned: false, suppressed: false };
    const next = { ...prior, observerAgentId: p.observerAgentId, originRoomId: roomId, at: event.at, contentHash: p.contentHash ?? prior.contentHash };
    if (p.action === 'pin' || p.action === 'unpin') { next.pinned = p.action === 'pin'; next.pinAt = event.at; next.pinObservationId = p.observationId ?? null; }
    else next.suppressed = p.action === 'suppress';
    agent.controls.set(controlKey, next);
    const leaf = agent.leaves.get(controlKey);
    if (leaf) this.#schedule(p.observerAgentId, leaf.groupId);
  }
  #applyBelief(roomId, event) {
    const p = event.payload;
    if (!identity(p.beliefId) || !['record', 'revise', 'revoke', undefined].includes(p.action)) return;
    if (p.action !== 'revoke' && (!identity(p.claim) || !Array.isArray(p.evidence) || !p.evidence.length)) return;
    const agent = this.#agent(p.observerAgentId);
    agent.beliefStatements.set(key(roomId, event.id), { sourceRoomId: roomId, evidenceId: event.id,
      beliefId: p.beliefId, action: p.action ?? 'record', at: event.at, claim: p.claim,
      evidence: structuredClone(p.evidence ?? []), supersedes: p.supersedes ?? null });
  }
  #rebuildBeliefs(agent) {
    // Explicit reference edges, not source load order or unrelated clocks,
    // retire prior claims. A reset hides records but does not undo a revocation.
    // Removing an entire source removes exactly its statements and edges.
    const retired = new Set(), records = new Map();
    for (const statement of agent.beliefStatements.values()) {
      if (statement.action === 'revoke') { retired.add(statement.beliefId); continue; }
      if (identity(statement.supersedes)) retired.add(statement.supersedes);
      // Conflicting reuse of an immutable belief id is unavailable, never LWW.
      if (records.has(statement.beliefId)) records.set(statement.beliefId, null);
      else records.set(statement.beliefId, statement);
    }
    agent.beliefs.clear(); agent.beliefRecent = [];
    for (const [beliefId, statement] of records) {
      if (!statement || retired.has(beliefId)) continue;
      const value = { kind: 'belief', beliefId, claim: statement.claim, sourceRoomId: statement.sourceRoomId,
        evidenceId: statement.evidenceId, at: statement.at, observedAt: statement.at, contentHash: memoryContentHash(statement.claim),
        evidence: structuredClone(statement.evidence), supersedes: statement.supersedes };
      agent.beliefs.set(beliefId, value); agent.beliefRecent.push(value);
    }
    agent.beliefRecent.sort(latest);
  }
  #authorizedCard(agent, card, allowed) {
    if (!card.policySources.size || [...card.policySources].every(source => !allowed.has(source))) return card;
    if ([...card.policySources].every(source => allowed.has(source))) return card.controlledRepresentative
      ? { ...card, ...card.controlledRepresentative, pinned: card.controlledPinned, consolidatedCount: card.controlledCount } : null;
    let representative = null, count = 0, pinned = false;
    for (const leafKey of agent.groups.get(card.groupId) ?? []) {
      const leaf = agent.leaves.get(leafKey), control = this.#control(agent, leaf, allowed);
      if (control.suppressed) continue;
      count++; pinned ||= control.pinned;
      if (!representative || latest(leaf, representative) < 0) representative = leaf;
    }
    return representative ? { ...card, ...representative, pinned, consolidatedCount: count } : null;
  }
  #permitted(leaf, allowed, context) {
    return allowed.has(leaf.sourceRoomId) && this.#sources.has(leaf.sourceRoomId)
      && (leaf.observedAt ?? leaf.at) > this.#sources.get(leaf.sourceRoomId).resetAt && context?.authority !== 'unavailable'
      && (!context || leaf.sourceRoomId === context.roomId && (leaf.observedAt ?? leaf.at) > context.afterAt);
  }
  lookup({ agentId, sourceRoomId, evidenceId, sourceRoomIds, context, includeSuppressed = false } = {}) {
    if (!Array.isArray(sourceRoomIds)) throw new TypeError('current source authorization is required');
    if (this.#policyUnavailable(agentId, sourceRoomIds)) return null;
    const agent = this.#agents.get(agentId), leaf = agent?.leaves.get(agent.aliases.get(key(sourceRoomId, evidenceId)));
    if (!leaf || !this.#permitted(leaf, new Set(sourceRoomIds), context)) return null;
    const control = this.#control(agent, leaf, new Set(sourceRoomIds));
    if (control.suppressed) return includeSuppressed ? { sourceRoomId, evidenceId: leaf.evidenceId,
      contentHash: leaf.contentHash, suppressed: true, pinned: control.pinned } : null;
    const { aliases, groupId, leafKey, accountedBytes, ...item } = leaf;
    return structuredClone({ ...item, pinned: control.pinned, suppressed: false });
  }
  belief({ agentId, beliefId, sourceRoomIds, context } = {}) {
    if (!Array.isArray(sourceRoomIds)) throw new TypeError('current source authorization is required');
    const belief = this.#agents.get(agentId)?.beliefs.get(beliefId);
    if (!belief || !this.#permitted(belief, new Set(sourceRoomIds), context)) return null;
    const validEvidence = belief.evidence.every(ref => {
      const leaf = this.lookup({ agentId, sourceRoomIds, context, sourceRoomId: ref.sourceRoomId, evidenceId: ref.evidenceId });
      return leaf && leaf.contentHash === ref.contentHash && (ref.observationId
        ? this.#supportsObservation(agentId, leaf, ref.observationId) : (leaf.exposureFrom ?? leaf.observedAt) <= belief.at);
    });
    return validEvidence ? structuredClone({ ...belief, current: true, validEvidence })
      : { beliefId: belief.beliefId, sourceRoomId: belief.sourceRoomId, evidenceId: belief.evidenceId, current: true, validEvidence: false };
  }
  recall({ agentId, sourceRoomIds, context, query = '', targetAgentIds = [], limit = 24,
    maxBytes = 65536, now = Date.now(), mode = 'default', lifecycle = true, consolidation = true, decay = lifecycle, halfLifeMs, minActivation,
    sourceOverrides = [], candidateLimit = this.maxCandidateCount, _lookup = null, _supportsObservation = null, _policySourceRoomIds = sourceRoomIds, _beliefs = null } = {}) {
    candidateLimit = Math.max(1, Math.min(this.maxCandidateCount, Number.isInteger(candidateLimit) ? candidateLimit : this.maxCandidateCount));
    if (!identity(agentId) || !Array.isArray(sourceRoomIds)) throw new TypeError('identity and current source authorization are required');
    if (sourceOverrides.some(source => source.events?.some(event => event.type === 'memory.control') || this.#sources.get(source.roomId)?.controlAgents.size))
      throw new Error('policy-source snapshot requires a separate complete index');
    if (sourceOverrides.length && this.#policyUnavailable(agentId, sourceRoomIds))
      return boundPersonalRecall({ agentId, version: 2, scope: 'personally-observed', totals: { experiences: 0, judgements: 0, beliefs: 0 },
        context: context ?? null, coverage: { partial: true, policyUnavailable: true, candidatesExamined: 0, candidatesVisited: 0, candidateLimit } }, [], { limit, maxBytes });
    if (sourceOverrides.length) {
      const overlay = new AgentMemoryIndex({ maxCandidateCount: Math.max(1, Math.floor(this.maxCandidateCount / 2)),
        maxIndexBytes: this.maxIndexBytes, maxAgentIndexBytes: this.maxAgentIndexBytes });
      const overridden = new Set(sourceOverrides.map(source => source.roomId));
      const common = { agentId, context, query, targetAgentIds, limit: 100, maxBytes: 65536, now, mode, lifecycle, consolidation, decay, halfLifeMs, minActivation };
      try {
        for (const source of sourceOverrides) overlay.syncSource(source.roomId, { events: source.events, revision: source.revision ?? { snapshot: true }, verified: true });
        const inherited = overlay.#agent(agentId);
        for (const [controlKey, control] of this.#agents.get(agentId)?.controls ?? []) {
          if (!overridden.has(JSON.parse(controlKey)[0]) || !sourceRoomIds.includes(control.originRoomId)) continue;
          const authority = this.#sources.get(control.originRoomId); if (!authority) continue;
          inherited.controls.set(controlKey, structuredClone(control));
          const destination = overlay.#sources.get(JSON.parse(controlKey)[0]);
          if (destination) destination.accountedBytes += Buffer.byteLength(controlKey) + Buffer.byteLength(JSON.stringify(control)) + 128;
          overlay.#inheritedPolicyAuthority.set(control.originRoomId, { resetAt: authority.resetAt });
          const leaf = inherited.leaves.get(controlKey); if (leaf) overlay.#schedule(agentId, leaf.groupId);
        }
        const combined = { beliefs: new Map(), beliefRecent: [], beliefStatements: new Map([
          ...[...this.#agents.get(agentId)?.beliefStatements ?? []].filter(([, statement]) => !overridden.has(statement.sourceRoomId)),
          ...inherited.beliefStatements]) };
        this.#rebuildBeliefs(combined);
        const supports = (owner, leaf, id) => (overridden.has(leaf.sourceRoomId) ? overlay : this).#supportsObservation(owner, leaf, id);
        const lookup = input => (overridden.has(input.sourceRoomId) ? overlay : this).lookup({ ...input, sourceRoomIds });
        const results = [this.recall({ ...common, sourceRoomIds: sourceRoomIds.filter(id => !overridden.has(id)), candidateLimit: Math.max(1, candidateLimit - Math.floor(candidateLimit / 2)), _beliefs: combined.beliefRecent.filter(belief => !overridden.has(belief.sourceRoomId)), _lookup: lookup, _supportsObservation: supports, _policySourceRoomIds: sourceRoomIds }),
          overlay.recall({ ...common, sourceRoomIds: sourceRoomIds.filter(id => overridden.has(id)), _beliefs: combined.beliefRecent.filter(belief => overridden.has(belief.sourceRoomId)), _lookup: lookup, _supportsObservation: supports, _policySourceRoomIds: sourceRoomIds })];
        const candidates = results.flatMap(result => [...result.experiences, ...result.judgements, ...result.beliefs]);
        // Recompute the same lexical score after merging independent source views.
        for (const item of candidates) item._score = recallScore(item, memoryActivation(item, { query }).matches, targetAgentIds);
        candidates.sort(compareRecall);
        for (const item of candidates) delete item._score;
        const totals = Object.fromEntries(['experiences', 'judgements', 'beliefs'].map(field => [field, results.reduce((n, result) => n + result.totals[field], 0)]));
        return boundPersonalRecall({ agentId, version: 2, scope: 'personally-observed', lifecycleVersion: MEMORY_LIFECYCLE_VERSION, context: context ?? null, totals,
          coverage: { provenance: 'explicit-room-only', maxItemChars: 2000, fixedSourceSnapshots: sourceOverrides.length,
            candidatesExamined: results.reduce((n, result) => n + result.coverage.candidatesExamined, 0),
            candidateLimit: candidateLimit, partial: results.some(result => result.coverage.partial || result.coverage.omittedByBudget > 0),
            totalsScope: 'eligible-examined-candidates', forgetting: 'retrieval-only', rawDeletion: false } }, candidates, { limit, maxBytes });
      } finally { overlay.close(); }
    }
    this.flush();
    for (const roomId of sourceRoomIds) { const source = this.#sources.get(roomId); if (source) source.usedAt = ++this.#clock; }
    const policyUnavailable = this.#policyUnavailable(agentId, sourceRoomIds);
    const allowed = new Set(policyUnavailable || context?.authority === 'unavailable' ? [] : sourceRoomIds.filter(id => !context || id === context.roomId)), agent = this.#agents.get(agentId), selected = new Map();
    let examined = 0, visited = 0, omittedDormant = 0, invalidBeliefs = 0;
    const candidates = [];
    for (const belief of _beliefs ?? agent?.beliefRecent ?? []) {
      if (visited >= Math.min(100, candidateLimit)) break;
      visited++;
      if (!this.#permitted(belief, allowed, context)) continue;
      examined++;
      const valid = belief.evidence.every(ref => {
        const leaf = (_lookup ?? (input => this.lookup(input)))({ agentId, sourceRoomIds, context, sourceRoomId: ref.sourceRoomId, evidenceId: ref.evidenceId });
        return leaf && leaf.contentHash === ref.contentHash && (ref.observationId
          ? (_supportsObservation ?? ((owner, item, id) => this.#supportsObservation(owner, item, id)))(agentId, leaf, ref.observationId)
          : (leaf.exposureFrom ?? leaf.observedAt) <= belief.at);
      });
      if (!valid) { invalidBeliefs++; continue; }
      const activation = memoryActivation(belief, { now, query, mode, lifecycle: decay, halfLifeMs, minActivation });
      if (!activation.eligible) { omittedDormant++; continue; }
      candidates.push({ ...belief, memoryState: activation.state, _score: activation.matches });
    }
    const add = card => {
      if (!card || visited >= candidateLimit) return;
      visited++;
      if (selected.has(card.groupId)) return;
      // Sources not authorized to this request cannot consume its candidate budget.
      if (!this.#permitted(card, allowed, context)) return;
      examined++; selected.set(card.groupId, card);
    };
    if (agent) {
      for (const roomId of allowed) { const view = agent.sourceCards.get(roomId); if (!view) continue;
        for (const id of view.pinned) { add(agent.cards.get(id)); if (visited >= candidateLimit) break; }
        for (const target of targetAgentIds) for (const id of view.targets.get(target) ?? []) { add(agent.cards.get(id)); if (visited >= candidateLimit) break; }
      }
      for (const roomId of allowed) {
        const view = agent.sourceCards.get(roomId); if (!view) continue;
        for (const term of memoryTerms(query)) {
          for (const id of view.terms.get(`\0${term}`) ?? []) { add(agent.cards.get(id)); if (visited >= candidateLimit) break; }
          const needles = [...grams(term)].filter(gram => !gram.startsWith('\0')); let smallest = null;
          for (const gram of needles) { const ids = view.terms.get(gram); if (!ids) { smallest = new Set(); break; } if (!smallest || ids.size < smallest.size) smallest = ids; }
          for (const id of smallest ?? []) {
            if (visited >= candidateLimit) break;
            const card = agent.cards.get(id);
            if (String(card?.text ?? card?.claim ?? '').toLowerCase().includes(term)) add(card); else visited++;
            if (visited >= candidateLimit) break;
          }
        }
      }
      // Merge source-local ordered streams. Unauthorized history is not scanned.
      const streams = [...allowed].map(roomId => agent.sourceCards.get(roomId)?.recent ?? []), offsets = streams.map(() => 0);
      while (visited < candidateLimit) {
        let best = -1;
        for (let i = 0; i < streams.length; i++) if (offsets[i] < streams[i].length
          && (best < 0 || latest(streams[i][offsets[i]], streams[best][offsets[best]]) < 0)) best = i;
        if (best < 0) break;
        add(streams[best][offsets[best]++]);
      }
    }
    for (const original of selected.values()) {
      const card = this.#authorizedCard(agent, original, new Set(_policySourceRoomIds)); if (!card || !this.#permitted(card, allowed, context)) continue;
      const activation = memoryActivation(card, { now, query, mode, lifecycle: decay, halfLifeMs, minActivation });
      if (!activation.eligible) { omittedDormant++; continue; }
      const { groupId, searchGrams, accountedBytes, policySources, controlledRepresentative, controlledCount, controlledPinned, aliases, leafKey, ...item } = card;
      const score = recallScore(card, activation.matches, targetAgentIds);
      if (consolidation) candidates.push({ ...item, memoryState: activation.state, _score: score });
      else for (const leafKey of agent.groups.get(card.groupId) ?? []) {
        if (candidates.length >= candidateLimit) break;
        const leaf = agent.leaves.get(leafKey);
        if (!leaf || !this.#permitted(leaf, allowed, context) || this.#control(agent, leaf, new Set(_policySourceRoomIds)).suppressed) continue;
        const { groupId, aliases, leafKey: ignoredKey, accountedBytes: ignoredBytes, ...raw } = leaf;
        const pinned = this.#control(agent, leaf, new Set(_policySourceRoomIds)).pinned;
        const ownActivation = memoryActivation({ ...raw, pinned }, { now, query, mode, lifecycle: decay, halfLifeMs, minActivation });
        if (ownActivation.eligible) candidates.push({ ...raw, pinned, memoryState: ownActivation.state,
          _score: recallScore({ ...raw, pinned }, ownActivation.matches, targetAgentIds) });
      }
    }
    candidates.sort(compareRecall);
    for (const item of candidates) delete item._score;
    this.#work.recallCandidates += visited;
    const totals = { experiences: 0, judgements: 0, beliefs: 0 };
    for (const item of candidates) totals[item.kind === 'judgement' ? 'judgements' : item.kind === 'belief' ? 'beliefs' : 'experiences']++;
    return boundPersonalRecall({ agentId, version: 2, scope: 'personally-observed', totals, context: context ?? null,
      lifecycleVersion: MEMORY_LIFECYCLE_VERSION, coverage: { provenance: 'explicit-room-only', maxItemChars: 2000,
        excludedProvenanceEvents: sourceRoomIds.reduce((sum, roomId) => sum + (this.#sources.get(roomId)?.excluded ?? 0), 0),
        candidatesExamined: examined, candidatesVisited: visited, candidateLimit: candidateLimit, partial: policyUnavailable || visited >= candidateLimit || sourceRoomIds.some(roomId => !this.#sources.has(roomId)),
        policyUnavailable, unavailableSources: sourceRoomIds.filter(roomId => !this.#sources.has(roomId)).length,
        evictedSources: sourceRoomIds.filter(roomId => this.#evicted.has(roomId)).length,
        totalsScope: 'eligible-examined-candidates', omittedDormant, invalidBeliefs, forgetting: 'retrieval-only', rawDeletion: false } },
    candidates, { limit, maxBytes });
  }
  #policyUnavailable(agentId, sourceRoomIds) {
    return this.#policyHistoryIncomplete && sourceRoomIds.some(id => !this.#sources.has(id))
      || [...this.#unavailablePolicySources].some(([id, agents]) => sourceRoomIds.includes(id) && agents.has(agentId));
  }
  #pruneAgents() {
    for (const [agentId, agent] of this.#agents) if (!agent.leaves.size && !agent.controls.size && !agent.beliefStatements.size) this.#agents.delete(agentId);
  }
  #supportsObservation(agentId, leaf, observationId) {
    if (!observationId) return true;
    const receipt = this.#sources.get(leaf.sourceRoomId)?.observationReceipts.get(observationId);
    return receipt?.agentId === agentId && (receipt.items.get(leaf.evidenceId) === leaf.contentHash
      || receipt.messageIds.has(leaf.evidenceId) || receipt.messageIds.has(leaf.messageId));
  }
  #diagnosticBytes() {
    return Buffer.byteLength(JSON.stringify([...this.#evicted])) + Buffer.byteLength(JSON.stringify([...this.#unavailablePolicySources].map(([id, agents]) => [id, [...agents]])))
      + (this.#evicted.size + this.#unavailablePolicySources.size) * 128;
  }
  #accounted(source) { return source.accountedBytes + source.leafBytes + source.cardBytes; }
  #enforceCapacity() {
    while (this.#sources.size) {
      const sources = [...this.#sources.values()], total = sources.reduce((n, source) => n + this.#accounted(source), this.#diagnosticBytes());
      const charged = new Map();
      for (const source of sources) for (const agentId of source.agents) charged.set(agentId,
        (charged.get(agentId) ?? 0) + this.#accounted(source) / Math.max(1, source.agents.size));
      const agentLimit = Math.min(this.maxAgentIndexBytes, this.maxIndexBytes / Math.max(1, charged.size));
      const overAgent = [...charged].find(([, used]) => used > agentLimit)?.[0];
      if (total <= this.maxIndexBytes && !overAgent) break;
      const pool = overAgent ? sources.filter(source => source.agents.has(overAgent)) : sources;
      const threshold = overAgent ? agentLimit : this.maxIndexBytes;
      const oversized = pool.find(source => this.#accounted(source) / (overAgent ? Math.max(1, source.agents.size) : 1) > threshold);
      const victim = oversized ?? pool.sort((a, b) => a.usedAt - b.usedAt || compare(a.roomId, b.roomId))[0];
      if (this.#evicted.size >= Math.max(1, Math.min(1024, Math.floor(this.maxIndexBytes / 4096)))) this.#evicted.delete(this.#evicted.keys().next().value);
      this.#evicted.set(victim.roomId, { reason: overAgent ? 'agent-index-budget' : 'global-index-budget', revision: victim.revision });
      this.dropSource(victim.roomId);
      // Remove retired cards now, before returning any result from this cache.
      const dirty = [...this.#dirty]; this.#dirty.clear();
      for (const value of dirty) this.#rebuildCard(...JSON.parse(value));
    }
  }
  stats() { return { ...this.#work, sources: this.#sources.size, agents: this.#agents.size, queuedGroups: this.#dirty.size,
    cards: [...this.#agents.values()].reduce((sum, agent) => sum + agent.cards.size, 0),
    leaves: [...this.#agents.values()].reduce((sum, agent) => sum + agent.leaves.size, 0),
    accountedBytes: [...this.#sources.values()].reduce((sum, source) => sum + this.#accounted(source), this.#diagnosticBytes()),
    accounting: 'derived-data-and-map-allowances-not-heap-rss', maxIndexBytes: this.maxIndexBytes,
    maxAgentIndexBytes: this.maxAgentIndexBytes, evictedSources: this.#evicted.size,
    policyAuthorityMarkers: this.#unavailablePolicySources.size, policyHistoryIncomplete: this.#policyHistoryIncomplete }; }
  close() { if (this.#scheduled !== null) clearImmediate(this.#scheduled); this.#scheduled = null;
    this.#sources.clear(); this.#agents.clear(); this.#dirty.clear(); this.#evicted.clear();
    this.#unavailablePolicySources.clear(); this.#inheritedPolicyAuthority.clear(); this.#policyHistoryIncomplete = false; }
}
