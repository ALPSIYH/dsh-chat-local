import { createHash } from 'node:crypto';

export const WORK_CONTRACT_VERSION = 1;
export const CONTRACT_FIELDS = ['title', 'details', 'acceptanceCriteria', 'ownerSessionId', 'reviewerSessionId',
  'ownerAgentId', 'reviewerAgentId', 'inputRefs', 'requiredWorkIds', 'integration', 'allowPartialDelivery'];
export const canonicalWorkJson = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const workHash = value => createHash('sha256').update(canonicalWorkJson(value)).digest('hex');
const referenceOrder = (a,b) => canonicalWorkJson(a) < canonicalWorkJson(b) ? -1 : canonicalWorkJson(a) > canonicalWorkJson(b) ? 1 : 0;
const id = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 500) throw new Error(`${label} must be a nonempty identifier`);
  return value.trim();
};
const hash = value => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new Error('a SHA-256 content/contract hash is required');
  return value;
};
function exact(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!fields.includes(key)) throw new Error(`unsupported ${label} field: ${key}`);
}
export function artifactReference(value) {
  exact(value, ['artifactId', 'versionId', 'contentHash'], 'artifact reference');
  return { artifactId: id(value.artifactId, 'artifactId'), versionId: id(value.versionId, 'versionId'), contentHash: hash(value.contentHash) };
}
export function artifactReferences(value, { required = false } = {}) {
  if (!Array.isArray(value) || value.length > 20 || (required && !value.length)) throw new Error('artifactRefs must contain 1–20 fixed versions');
  const refs = value.map(artifactReference);
  if (new Set(refs.map(ref => `${ref.artifactId}:${ref.versionId}`)).size !== refs.length) throw new Error('duplicate artifact reference');
  return refs.sort(referenceOrder);
}
export function inputReferences(value = []) {
  if (!Array.isArray(value) || value.length > 40) throw new Error('inputRefs must contain at most 40 references');
  const refs = value.map(ref => {
    if (ref?.kind === 'artifact') {
      exact(ref, ['kind', 'artifactId', 'versionId', 'contentHash'], 'input reference');
      const { kind, ...value } = ref; return { kind, ...artifactReference(value) };
    }
    exact(ref, ['kind', 'entryId', 'submissionRevision', 'contractHash'], 'input reference');
    if (ref.kind !== 'work' || !Number.isSafeInteger(ref.submissionRevision) || ref.submissionRevision < 1) throw new Error('work input needs a fixed submissionRevision');
    return { kind: 'work', entryId: id(ref.entryId, 'entryId'), submissionRevision: ref.submissionRevision, contractHash: hash(ref.contractHash) };
  });
  if (new Set(refs.map(canonicalWorkJson)).size !== refs.length) throw new Error('duplicate input reference');
  return refs.sort(referenceOrder);
}
export function normalizeContract(entry) {
  if (entry.kind !== 'task') {
    if (entry.contractVersion !== undefined || entry.integration || entry.inputRefs?.length || entry.requiredWorkIds?.length) throw new Error('work contracts apply only to tasks');
    return entry;
  }
  if (entry.contractVersion === undefined) {
    if (entry.submission) entry.submission = { ...entry.submission, versionStatus: 'unfixed' };
    return entry;
  }
  if (entry.contractVersion !== WORK_CONTRACT_VERSION) throw new Error('unsupported work contract version');
  entry.inputRefs = inputReferences(entry.inputRefs);
  if (!Array.isArray(entry.requiredWorkIds ?? []) || (entry.requiredWorkIds?.length ?? 0) > 40) throw new Error('requiredWorkIds must contain at most 40 work ids');
  entry.requiredWorkIds = [...new Set((entry.requiredWorkIds ?? []).map(value => id(value, 'required work id')))].sort();
  for (const key of ['integration', 'allowPartialDelivery']) {
    if (entry[key] !== undefined && typeof entry[key] !== 'boolean') throw new Error(`${key} must be a boolean`);
    entry[key] = entry[key] === true;
  }
  entry.contractHash = workHash(Object.fromEntries(CONTRACT_FIELDS.map(key => [key, entry[key] ?? null])));
  return entry;
}
export function coverage(value) {
  exact(value, ['satisfied', 'missing', 'impact'], 'coverage');
  const result = {};
  for (const key of ['satisfied', 'missing']) {
    if (!Array.isArray(value[key]) || value[key].length > 40 || value[key].some(item => typeof item !== 'string' || !item.trim() || item.length > 1000)) throw new Error(`coverage.${key} must list at most 40 specific criteria`);
    result[key] = value[key].map(item => item.trim());
  }
  if (typeof value.impact !== 'string' || value.impact.length > 4000 || (result.missing.length && !value.impact.trim())) throw new Error('missing coverage requires an impact explanation');
  if (!result.satisfied.length && !result.missing.length) throw new Error('coverage must account for at least one criterion');
  return { ...result, impact: value.impact.trim() };
}
export function artifactVersion(room, ref, { fixed = true } = {}) {
  const artifact = room.artifacts.find(item => item.id === ref.artifactId);
  const version = artifact?.versions?.find(item => item.id === ref.versionId);
  if (!version || version.contentHash !== ref.contentHash) throw new Error('artifact reference does not match a version in this room');
  if (fixed && version.snapshot?.storage !== 'immutable-v1') throw new Error('artifact version is unfixed; publish a content snapshot first');
  return { artifact, version };
}
export function workSubmission(room, ref) {
  const entry = room.ledger.find(item => item.id === ref.entryId);
  const candidates = [entry?.submission, ...(entry?.history ?? []).flatMap(event => [event.after?.submission, event.before?.submission])];
  const submission = candidates.find(item => item?.revision === ref.submissionRevision && item.contractHash === ref.contractHash);
  if (!submission || submission.versionStatus !== 'fixed') throw new Error('work input does not identify a fixed submitted version');
  return { entry, submission };
}
export function validateContractReferences(room, entry) {
  if (!entry.contractVersion) return;
  for (const ref of entry.inputRefs) {
    if (ref.kind === 'artifact') artifactVersion(room, ref);
    else {
      if (ref.entryId === entry.id) throw new Error('a work item cannot use its own submission as an input');
      workSubmission(room, ref);
    }
  }
  for (const child of entry.requiredWorkIds) if (child === entry.id || !room.ledger.some(item => item.id === child && item.kind === 'task')) throw new Error('required work must be another task in this room');
  const visit = (child, seen = new Set()) => {
    if (child === entry.id) return true;
    if (seen.has(child)) return false;
    seen.add(child); return (room.ledger.find(item => item.id === child)?.requiredWorkIds ?? []).some(value => visit(value, seen));
  };
  if (entry.requiredWorkIds.some(child => visit(child))) throw new Error('required work dependencies cannot form a cycle');
}
export function assertFixedReview(room, entry, input) {
  const submission = entry.submission;
  if (!submission || submission.versionStatus !== 'fixed' || submission.contractHash !== entry.contractHash
    || canonicalWorkJson(submission.inputRefs) !== canonicalWorkJson(entry.inputRefs)) throw new Error('current work contract has no matching fixed submission');
  if (input.expectedContractHash !== entry.contractHash || input.expectedSubmissionRevision !== submission.revision) throw new Error('review must identify the current contract and submission revision');
  const refs = artifactReferences(input.artifactRefs, { required: true });
  if (canonicalWorkJson(refs) !== canonicalWorkJson(submission.artifactRefs)) throw new Error('review artifact versions do not match the submission');
  for (const ref of refs) artifactVersion(room, ref);
  if (input.verdict === 'approve' && submission.coverage.missing.length && !entry.allowPartialDelivery) throw new Error('partial delivery does not satisfy this work contract');
  return { contractHash: entry.contractHash, inputRefs: structuredClone(entry.inputRefs), artifactRefs: refs,
    submissionRevision: submission.revision, coverage: structuredClone(submission.coverage), versionStatus: 'fixed' };
}
