import { createHash } from 'node:crypto';

export const MEMORY_LIFECYCLE_VERSION = 1;
export const PERSONAL_RECALL_MAX_BYTES = 64 * 1024;
export const PERSONAL_RECALL_MAX_ITEMS = 100;
export const DEFAULT_MEMORY_HALF_LIFE_MS = 30 * 86400000;
export const memoryContentHash = value => createHash('sha256').update(String(value ?? '')).digest('hex');
export const memoryTerms = value => [...new Set(String(value ?? '').toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
const bytes = value => Buffer.byteLength(JSON.stringify(value));

/** A reversible retrieval policy. It neither changes evidence nor infers personality. */
export function memoryActivation(item, { now = Date.now(), halfLifeMs = DEFAULT_MEMORY_HALF_LIFE_MS,
  minActivation = 0.2, query = '', mode = 'default', lifecycle = true } = {}) {
  if (!Number.isFinite(now) || !Number.isFinite(halfLifeMs) || halfLifeMs <= 0
    || !Number.isFinite(minActivation) || minActivation < 0 || minActivation > 1) throw new TypeError('invalid memory decay policy');
  if (!['default', 'explicit'].includes(mode)) throw new TypeError('invalid memory recall mode');
  const text = String(item.text ?? item.claim ?? '').toLowerCase();
  const exact = new Set(memoryTerms(text));
  const matches = memoryTerms(query).reduce((total, term) => total + Number(text.includes(term)) + Number(exact.has(term)), 0);
  const age = Math.max(0, now - (item.observedAt ?? item.at ?? now));
  const activation = 2 ** (-age / halfLifeMs);
  const state = item.suppressed ? 'suppressed' : item.pinned || !lifecycle || activation >= minActivation ? 'active' : 'dormant';
  return { state, activation, matches, eligible: state === 'active'
    || state === 'dormant' && mode === 'explicit' && matches > 0 };
}

/** Total count and serialized-byte caps apply to the entire response, metadata included. */
export function boundPersonalRecall(base, candidates, { limit = 24, maxBytes = PERSONAL_RECALL_MAX_BYTES } = {}) {
  const maxItems = Math.min(PERSONAL_RECALL_MAX_ITEMS, Math.max(1, Number.isInteger(limit) ? limit : 24));
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024) throw new TypeError('memory byte budget must be at least 1024');
  maxBytes = Math.min(PERSONAL_RECALL_MAX_BYTES, maxBytes);
  const result = { ...base, experiences: [], judgements: [], beliefs: [],
    coverage: { ...base.coverage, maxItems, maxBytes, omittedByBudget: Math.max(0, Number.isSafeInteger(base.coverage?.omittedByBudget) ? base.coverage.omittedByBudget : 0), returnedItems: 0, serializedBytes: 0 } };
  // Reserve enough room for the final counters before accepting a row.
  const fits = () => bytes(result) + 64 <= maxBytes;
  if (!fits()) throw new RangeError('memory response metadata exceeds byte budget');
  for (const item of candidates) {
    const field = item.kind === 'judgement' ? 'judgements' : item.kind === 'belief' ? 'beliefs' : 'experiences';
    if (result.coverage.returnedItems >= maxItems) { result.coverage.omittedByBudget++; continue; }
    result[field].push(structuredClone(item));
    if (!fits()) { result[field].pop(); result.coverage.omittedByBudget++; continue; }
    result.coverage.returnedItems++;
  }
  for (let i = 0; i < 4; i++) result.coverage.serializedBytes = bytes(result);
  if (bytes(result) > maxBytes) throw new RangeError('memory response exceeded byte budget');
  return result;
}

/** Public, versioned defaults also participate in experiment fingerprints. */
export function normalizeMemoryLifecycle(input = {}) {
  const boolean = (name, fallback) => typeof input?.[name] === 'boolean' ? input[name] : fallback;
  const integer = (name, fallback, min, max) => Number.isSafeInteger(input?.[name])
    ? Math.max(min, Math.min(max, input[name])) : fallback;
  return { version: MEMORY_LIFECYCLE_VERSION, consolidation: boolean('consolidation', true), decay: boolean('decay', true),
    halfLifeDays: integer('halfLifeDays', 30, 1, 36500), maxRecallBytes: integer('maxRecallBytes', 65536, 1024, 65536),
    maxIndexBytes: integer('maxIndexBytes', 256 * 1024 * 1024, 4096, 2 ** 31),
    maxAgentIndexBytes: integer('maxAgentIndexBytes', 256 * 1024 * 1024, 4096, 2 ** 31),
    maxCandidateCount: integer('maxCandidateCount', 2000, 1, 2000) };
}
