/** Context is a retrieval hint, never an authority or a new observation. */
export function buildPersonalQuery({ query = '', task, trigger } = {}) {
  const parts = [query, trigger?.text, task?.title, task?.details, task?.description,
    ...(Array.isArray(task?.acceptanceCriteria) ? task.acceptanceCriteria : [task?.acceptanceCriteria]).map(item => typeof item === 'string' ? item : item?.text)].filter(x => typeof x === 'string' && x.trim());
  return [...new Set(parts.map(x => x.trim()))].join('\n').slice(0, 2000);
}

export function normalizeKnowledgeScope(scope) {
  if (scope === undefined) return undefined;
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)
    || Object.keys(scope).some(key => !['roomId', 'workId', 'topic'].includes(key))) throw new Error('invalid knowledge scope');
  const result = {};
  for (const [key, value] of Object.entries(scope)) {
    if (typeof value !== 'string' || !value.trim() || value.length > 300) throw new Error('knowledge scope values must be 1–300 characters');
    result[key] = value.trim();
  }
  return result;
}

export function knowledgeApplicability(item, { now = Date.now(), roomId, workId } = {}) {
  const scope = item.scope ?? {};
  const applicable = (!scope.roomId || scope.roomId === roomId) && (!scope.workId || scope.workId === workId);
  const outsideValidity = (Number.isFinite(item.validFrom) && now < item.validFrom)
    || (Number.isFinite(item.validUntil) && now >= item.validUntil);
  const needsReview = Boolean(outsideValidity || item.status === 'needs_review' || item.counterEvidence?.length);
  return { applicable, status: item.status === 'candidate' ? 'candidate' : needsReview ? 'needs_review' : item.status ?? 'active', outsideValidity, needsReview };
}

export function normalizeKnowledgeDetails(input) {
  const result = {};
  const scope = normalizeKnowledgeScope(input.scope);
  if (scope !== undefined) result.scope = scope;
  for (const key of ['validFrom', 'validUntil']) if (input[key] !== undefined) {
    if (!Number.isSafeInteger(input[key]) || input[key] < 0) throw new Error(`${key} must be an epoch millisecond integer`);
    result[key] = input[key];
  }
  if (result.validFrom !== undefined && result.validUntil !== undefined && result.validFrom >= result.validUntil)
    throw new Error('knowledge validity interval must have a positive duration');
  return result;
}

export const LEARNING_HINT = '若這次有明確更正、驗收失敗或已核實結果，可用 chat_memory_update(action="lesson") 提出帶本人原始證據的工作方法候選；用 adopt_lesson 附結果證據採納。無新教訓不必記錄或發言；候選不改人格，採納不代表普遍正確。';

/** Preserve retrieval order when response fields are flattened for another byte budget. */
export function rankPersonalRecall(items) {
  if (!items.some(item => Number.isFinite(item.relevance))) return items;
  const own = item => ['authored','belief','lesson','judgement'].includes(item.kind) || item.authoredByObserver === true;
  return items.sort((a,b) => (b.relevance ?? 0) - (a.relevance ?? 0) || Number(own(a)) - Number(own(b))
    || (b.observedAt ?? b.at ?? 0) - (a.observedAt ?? a.at ?? 0)
    || String(a.sourceRoomId).localeCompare(String(b.sourceRoomId)) || String(a.evidenceId).localeCompare(String(b.evidenceId)));
}
