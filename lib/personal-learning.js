import { randomUUID } from 'node:crypto';
import { normalizeKnowledgeDetails } from './personal-context.js';

export const PERSONAL_UPDATE_ACTIONS = ['pin','unpin','suppress','restore','belief','revoke_belief',
  'lesson','adopt_lesson','reject_lesson','retire_lesson','challenge_belief','review_snapshot'];
export const PERSONAL_UPDATE_FIELDS = ['roomId','action','operationId','sourceRoomId','evidenceId','claim','evidence','supersedes','beliefId',
  'scope','validFrom','validUntil','counterEvidence','reason','lessonId','conditions','trigger','resultEvidence','excludedEvidence','workId'];

const text = (value, name, max = 2000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name} must be 1–${max} characters`);
  return value.trim();
};

/** A receipt proves contact, not truth. Derived judgements are never original support. */
export function checkedEvidence(refs, lookup, { optional = false } = {}) {
  if (refs === undefined && optional) return [];
  if (!Array.isArray(refs) || !refs.length || refs.length > 8) throw new Error('requires 1–8 original personally observed evidence references');
  const unique = new Map();
  for (const ref of refs) {
    if (!ref || typeof ref !== 'object' || Object.keys(ref).some(k => !['sourceRoomId','evidenceId'].includes(k))) throw new Error('invalid evidence reference');
    const item = lookup(ref);
    if (!item || ['judgement','belief','lesson'].includes(item.kind)) throw new Error('requires original personally observed evidence');
    unique.set(JSON.stringify([item.sourceRoomId,item.evidenceId]), { sourceRoomId:item.sourceRoomId, evidenceId:item.evidenceId,
      contentHash:item.contentHash, observationId:item.observationId ?? null });
  }
  return [...unique.values()];
}

/** All knowledge transitions use immutable revisions in the existing memory.belief log. */
export function knowledgeMutation(input, { payload, lookup, belief, sourceRoomIds, revision }) {
  const { action } = input;
  if (action === 'review_snapshot') {
    if (sourceRoomIds.length > 256) throw new Error('review snapshot exceeds source budget');
    const excludedEvidence = input.excludedEvidence ?? [];
    if (!Array.isArray(excludedEvidence) || excludedEvidence.length > 100) throw new Error('review exclusions must be at most 100 references');
    const excluded = excludedEvidence.map(ref => {
      if (!ref || Object.keys(ref).some(k => !['sourceRoomId','evidenceId'].includes(k))
        || typeof ref.evidenceId !== 'string' || !ref.evidenceId || !sourceRoomIds.includes(ref.sourceRoomId)) throw new Error('review exclusion requires an authorized source reference');
      const observed = lookup(ref, true);
      return { sourceRoomId:ref.sourceRoomId, evidenceId:observed?.evidenceId ?? ref.evidenceId };
    });
    const knownExposure = excluded.filter(ref => !!lookup(ref, true));
    const sources = sourceRoomIds.map(roomId => {
      const value = revision(roomId);
      if (!value || !Number.isSafeInteger(value.count)) throw new Error('review source is unavailable');
      return { roomId, count:value.count, head:value.head ?? null };
    });
    return { type:'memory.review', payload:{ ...payload, reviewSnapshotId:randomUUID(), sources,
      ...(input.workId ? { workId:text(input.workId,'workId',300) } : {}), excludedEvidence:excluded, knownExposure,
      blindness:knownExposure.length ? 'known_exposure' : 'not_certified',
      exposureCheck:'declared-references-only', nativeSessionKnowledge:'not-erased' } };
  }
  if (['revoke_belief','reject_lesson','retire_lesson'].includes(action)) {
    const id = action === 'revoke_belief' ? input.beliefId : input.lessonId;
    const previous = belief(id);
    if (!previous || (action === 'revoke_belief' ? previous.kind === 'lesson' : previous.kind !== 'lesson')) throw new Error('current own belief or lesson is required');
    if (action === 'reject_lesson' && previous.status !== 'candidate') throw new Error('only a candidate lesson can be rejected');
    return { type:'memory.belief', payload:{...payload,action:'revoke',beliefId:id,
      ...(action !== 'revoke_belief' ? { recordKind:'lesson', status:action === 'reject_lesson' ? 'rejected':'retired',reason:text(input.reason,'reason') } : {}) } };
  }
  const previous = ['adopt_lesson','challenge_belief'].includes(action)
    ? belief(action === 'adopt_lesson' ? input.lessonId : input.beliefId) : undefined;
  if (['adopt_lesson','challenge_belief'].includes(action) && (!previous || !previous.validEvidence)) throw new Error('current own knowledge with valid original evidence is required');
  if (action === 'adopt_lesson' && (previous.kind !== 'lesson' || previous.status !== 'candidate')) throw new Error('only a candidate lesson can be adopted');
  if (action === 'challenge_belief' && previous.kind === 'lesson') throw new Error('challenge requires a current belief');
  const claim = previous?.claim ?? text(input.claim,'knowledge claim');
  const evidence = previous?.evidence ?? checkedEvidence(input.evidence,lookup);
  const details = previous ? Object.fromEntries(['scope','validFrom','validUntil','conditions','trigger','resultEvidence','counterEvidence'].filter(k=>previous[k]!==undefined).map(k=>[k,structuredClone(previous[k])])) : normalizeKnowledgeDetails(input);
  if (details.scope?.roomId && !sourceRoomIds.includes(details.scope.roomId)) throw new Error('knowledge scope must reference an authorized source');
  const counterEvidence = action === 'challenge_belief' ? checkedEvidence(input.counterEvidence,lookup)
    : previous?.counterEvidence ?? checkedEvidence(input.counterEvidence,lookup,{optional:true});
  const supersedes = previous?.beliefId ?? input.supersedes ?? null;
  if (supersedes && !previous) {
    const old = belief(supersedes);
    if (!old || (old.kind === 'lesson') !== (action === 'lesson')) throw new Error('superseded knowledge must be your current entry of the same kind');
  }
  const record = {...payload,action:supersedes?'revise':'record',beliefId:randomUUID(),claim,evidence,supersedes,...details,
    ...(counterEvidence.length ? {counterEvidence,status:'needs_review'} : {})};
  if (action === 'lesson') {
    const trigger = input.trigger;
    if (!trigger || Object.keys(trigger).some(k=>!['kind','evidence'].includes(k))
      || !['correction','review_failed','confirmed_result','manual'].includes(trigger.kind)) throw new Error('lesson requires an explicit evidence-backed trigger');
    record.recordKind='lesson'; record.status='candidate'; record.conditions=text(input.conditions,'lesson conditions',1000);
    record.trigger={kind:trigger.kind,evidence:checkedEvidence(trigger.evidence,lookup)};
  } else if (action === 'adopt_lesson') {
    record.recordKind='lesson'; record.status=counterEvidence.length?'needs_review':'active';
    record.resultEvidence=checkedEvidence(input.resultEvidence,lookup);
    record.reason=text(input.reason,'adoption reason');
  } else if (action === 'challenge_belief') record.reason=text(input.reason,'challenge reason');
  return {type:'memory.belief',payload:record};
}
