import { randomUUID } from "node:crypto";
import { collaborationEnabled, commonBlockerKey, integrationWork, messagePurpose, responsibleMember, selectRecipients, stableFingerprint } from "./collaboration-policy.js";
import { assertFixedReview } from "./work-contract.js";

const openStates = new Set(["pending", "dispatched", "unknown", "needs_resolution"]);
const inactive = new Set(["cancelled", "archived", "paused"]);
const explicitIssues = new Set(["correction", "objection"]);
export const requestOpen = request => openStates.has(request.state);

export function addRequest(room, input) {
  const requests = room.collaboration.requests;
  const key = input.operationKey ?? stableFingerprint([input.triggerEventId, input.recipient, input.purpose, input.workId ?? null, input.basisVersion ?? null]);
  const prior = requests.find(request => request.operationKey === key);
  if (prior) return prior;
  const request = { id: randomUUID(), revision: 1, state: input.recipient ? "pending" : "needs_resolution", createdAt: Date.now(), ...input, operationKey: key,
    budgetAccountId: input.budgetAccountId ?? room.collaboration.activeBudgetId ?? null, resolution: null };
  requests.push(request);
  return request;
}

export function recordMessageRequests(room, message, recipients = selectRecipients(room, message)) {
  if (!collaborationEnabled(room)) return [];
  message.purpose = messagePurpose(message, room);
  if (message.requestId) {
    const existing=room.collaboration.requests.find(item=>item.id===message.requestId);
    if (!existing || !requestOpen(existing)) throw new Error("request is not pending");
    message.requestIds=[existing.id];
    existing.deliveryMessageId=message.id;
    return [existing];
  }
  if (message.purpose === "notify") {
    const owner = responsibleMember(room, message.workId)?.sessionId;
    if (owner !== message.author) room.collaboration.unreviewed.push({ messageId: message.id, roomSeq: message.roomSeq, workId: message.workId ?? null, recipient: owner ?? null, state: "unreviewed", exposedTo: [] });
    return [];
  }
  const work = room.ledger.find(item => item.id === message.workId);
  const targets = recipients.length ? recipients.map(item => item.sessionId) : [null];
  const requests = targets.map(recipient => addRequest(room, { triggerEventId: message.id, workId: work?.id ?? null, recipient,
    purpose: message.purpose, basisVersion: work?.contractHash ?? null, basisRoomSeq: message.roomSeq, budgetAccountId: message.budgetAccountId,
    ...(message.requestId ? { operationKey: `message-request:${message.requestId}:${recipient}` } : {}) }));
  message.requestIds = requests.map(request => request.id);
  return requests;
}

export function settleRequest(request, resolution, { sourceMessageIds = [], actor, at = Date.now() } = {}) {
  request.state = resolution.disposition === "needs_evidence" ? "needs_resolution" : "resolved";
  request.resolution = { ...resolution, sourceMessageIds, actor, at }; request.revision += 1;
}

/** Handoff fields are a view of the single request record; never read them to decide request completion. */
export function reconcileHandoffView(room, entry) {
  if (!entry.handoff?.requestId) return;
  const request = room.collaboration.requests.find(item => item.id === entry.handoff.requestId);
  if (!request) return;
  const { state: _state, completedAt: _completed, error: _error, ...transport } = entry.handoff;
  entry.handoff = { ...transport, requestId: request.id };
}

/** Compatibility display only. Request state and delivery receipts remain the
 * authorities; this projection must never be stored in the ledger or history. */
export function publicLedgerEntry(room, entry) {
  if (!entry?.handoff || !collaborationEnabled(room)) return entry;
  const handoff=entry.handoff;
  const ids=new Set([handoff.requestId,...(handoff.requestIds??[])]);
  const requests=room.collaboration.requests.filter(request=>ids.has(request.id));
  const deliveries=request=>room.messages.flatMap(message=>message.deliveries??[]).filter(delivery=>delivery.id===request.deliveryId);
  const sent=request=>deliveries(request).some(delivery=>["sent","delivered","working","replied","passed"].includes(delivery.status));
  let state,error=requests.find(request=>request.error)?.error;
  if (requests.some(request=>request.state==="unknown")) {state="interrupted";error="執行結果未知；先核對實際結果，再明確處置，不能直接重試。";}
  else if (!requests.length || requests.some(request=>!request.recipient||request.recipientMissing)) state="no_recipient";
  else if (requests.some(request=>request.state==="needs_resolution")) state=error?"failed":"needs_report";
  else if (requests.some(request=>request.state==="pending")) state="queued";
  else if (requests.some(request=>request.state==="dispatched")) {
    state=requests.filter(request=>request.state==="dispatched").every(sent)?"waiting_report":"sending";
  } else if (requests.every(request=>request.state==="resolved")) state=requests.every(request=>request.resolution?.disposition==="work_recorded")?"reported":requests.every(sent)?"delivered":"resolved";
  else state="cancelled";
  return {...entry,handoff:{...handoff,state,...(error?{error}:{}),messageId:handoff.messageId??requests.find(request=>request.deliveryMessageId)?.deliveryMessageId,requestStates:requests.map(request=>({id:request.id,state:request.state}))}};
}

export function reconcileLedgerRequests(room, next, previous, event) {
  if (!collaborationEnabled(room)) return;
  const requests = room.collaboration.requests;
  const triggerEventId = event.rootMessageId ?? event.sources?.[0]?.id ?? `ledger:${next.id}:${next.revision}`;
  for (const request of requests.filter(item => item.workId === next.id && requestOpen(item))) {
    if (request.state==="unknown") continue;
    if (explicitIssues.has(request.purpose)) {
      retainIssue(request,next);
      continue;
    }
    if (inactive.has(next.status) || (previous && next.contractHash !== previous.contractHash && request.basisVersion && request.basisVersion !== next.contractHash)) {
      request.state = "obsolete"; request.revision += 1; request.obsoleteReason = inactive.has(next.status) ? next.status : "contract_changed";
    } else if ((["progress", "submit"].includes(event.type) && ["assignment", "recovery", "integration"].includes(request.purpose)) || (event.type === "review" && request.purpose === "review")) {
      settleRequest(request, { disposition: "work_recorded", summary: event.summary ?? event.type }, { actor: event.actor, sourceMessageIds: event.sources?.map(item => item.id) ?? [] });
    }
  }
  if (next.handoff && next.handoff.id !== previous?.handoff?.id) {
    const handoff = next.handoff;
    const blockerKey = commonBlockerKey(next);
    const targets = handoff.sessionIds ?? [];
    for (const recipient of targets.length ? targets : [null]) {
      const shared=blockerKey?requests.find(request=>request.blockerKey===blockerKey&&request.recipient===recipient&&requestOpen(request)):null;
      const request = addRequest(room, { triggerEventId, workId: next.id, recipient, purpose: handoff.purpose,
        basisVersion: next.contractHash, basisRoomSeq: room.roomSeq, operationKey: shared?.operationKey??`handoff:${handoff.id}:${recipient}`, handoffId: handoff.id, ...(blockerKey?{blockerKey}:{}),
        relatedWorkIds: [next.id], text: handoff.text, humanRequested: event.actor === "human:me" });
      if (!request.relatedWorkIds.includes(next.id)) request.relatedWorkIds.push(next.id);
      handoff.requestId ??= request.id;
      handoff.requestIds = [...new Set([...(handoff.requestIds ?? []), request.id])];
    }
    reconcileHandoffView(room, next);
  }
  if (next.handoff?.requestId) reconcileHandoffView(room,next);
  if (event.type === "submit" && next.reviewerSessionId) addRequest(room, { triggerEventId, workId: next.id, recipient: next.reviewerSessionId, purpose: "review", basisVersion: next.contractHash, basisRoomSeq: room.roomSeq, operationKey: `review:${next.id}:${next.submission?.revision}`, submissionRevision: next.submission?.revision });
  if ((event.type === "record" || event.type === "amend") && next.ownerSessionId && !inactive.has(next.status) && next.status !== "done" && !next.acknowledgement) addRequest(room, { triggerEventId, workId: next.id, recipient: next.ownerSessionId, purpose: "assignment", basisVersion: next.contractHash, basisRoomSeq: room.roomSeq, operationKey: `assignment:${next.id}:${next.contractHash}` });
  if (event.type === "review" && next.status === "in_progress") addRequest(room, { triggerEventId, workId: next.id, recipient: next.ownerSessionId, purpose: "assignment", basisVersion: next.contractHash, basisRoomSeq: room.roomSeq, operationKey: `rework:${next.id}:${next.revision}` });
  if (next.status==="done"&&next.contractVersion===1&&next.review?.verdict==="approve"&&previous?.status!=="done") next.review.eventCutoffRoomSeq=room.roomSeq;
}

function retainIssue(request, work) {
  if (work?.contractHash&&work.contractHash!==(request.currentBasisVersion??request.basisVersion)) {
    request.basisChanges??=[];request.basisChanges.push({from:request.currentBasisVersion??request.basisVersion,to:work.contractHash,workRevision:work.revision,at:Date.now()});
    request.currentBasisVersion=work.contractHash;request.revision++;
  }
  if (!work||inactive.has(work.status)) {
    if (request.state==="pending") {request.state="needs_resolution";request.revision++;}
    request.waitReason="work_inactive";
  }
}

export function refreshRequests(room) {
  if (!collaborationEnabled(room)) return;
  for (const request of room.collaboration.requests.filter(requestOpen)) {
    if (request.state==="unknown") continue;
    const work = room.ledger.find(item => item.id === request.workId);
    if (request.workId&&explicitIssues.has(request.purpose)) retainIssue(request,work);
    else if (request.workId && (!work || inactive.has(work.status) || (request.basisVersion && work.contractHash !== request.basisVersion))) {
      request.state = "obsolete"; request.revision += 1; request.obsoleteReason = "work_changed";
    }
    if (requestOpen(request) && request.recipient && !room.members.some(member => member.sessionId === request.recipient)) {
      request.state = "needs_resolution"; request.recipientMissing = true;
    }
  }
}

export function requestReviewableMessages(room, request) {
  const work=request?.purpose==="integration"?room.ledger.find(item=>item.id===request.workId):null;
  const scope=work?new Set([work.id,...(work.requiredWorkIds??[])]):null;
  return room.collaboration.unreviewed.filter(item=>item.state==="unreviewed"&&(scope?(!item.workId||scope.has(item.workId)):item.recipient===request?.recipient));
}

export function memberUnreviewedMessages(room, sessionId) {
  const assigned=room.collaboration.requests.filter(request=>requestOpen(request)&&request.recipient===sessionId&&request.purpose==="integration").flatMap(request=>requestReviewableMessages(room,request));
  return room.collaboration.unreviewed.filter(item=>item.state==="unreviewed"&&(item.recipient===sessionId||assigned.includes(item)));
}

const fixedAcceptance = (room, entry) => {
  if (entry.status!=="done"||entry.contractVersion!==1||entry.review?.verdict!=="approve"||entry.review?.versionStatus!=="fixed") return false;
  try {assertFixedReview(room,entry,{...entry.review,expectedContractHash:entry.review.contractHash,expectedSubmissionRevision:entry.review.submissionRevision});return true;}catch{return false;}
};
function acceptedCutoff(room) {
  const tasks=room.ledger.filter(item=>item.kind==="task"&&!["cancelled","archived"].includes(item.status));
  return tasks.length&&tasks.every(task=>fixedAcceptance(room,task)&&Number.isSafeInteger(task.review.eventCutoffRoomSeq))?Math.max(...tasks.map(task=>task.review.eventCutoffRoomSeq)):null;
}

/** Charter decisions keep their own versioned evidence, while every wakeup is
 * represented by the same request queue and debited to the active account. */
export function reconcileCharterRequests(room, account) {
  if (!collaborationEnabled(room)) return;
  for (const request of room.collaboration.requests.filter(item=>item.proposalId&&requestOpen(item))) {
    if (request.state==="unknown") continue;
    const proposal=room.profileProposals.find(item=>item.id===request.proposalId);
    const vote=proposal?.reviews.find(item=>item.sessionId===request.recipient);
    const replacement=room.profileProposals.find(item=>item.replacesProposalId===request.proposalId);
    if (request.purpose==="charter_review"&&vote || request.purpose==="charter_rework"&&replacement) {
      settleRequest(request,{disposition:"charter_recorded",summary:vote?.comment??"A replacement proposal was recorded"},{actor:request.recipient,sourceMessageIds:proposal?.sources.map(item=>item.id)??[]});
    } else if (!proposal || ["applied","superseded","dismissed"].includes(proposal.status) || request.purpose==="charter_review"&&proposal.status!=="pending") {
      request.state="obsolete"; request.revision++; request.obsoleteReason="proposal_changed";
    }
  }
  if (!account) return;
  for (const proposal of room.profileProposals) {
    const targets=proposal.status==="pending"?proposal.reviewers.filter(member=>!proposal.reviews.some(review=>review.sessionId===member.sessionId)).map(member=>member.sessionId)
      :proposal.status==="changes_requested"&&!room.profileProposals.some(next=>next.replacesProposalId===proposal.id)?[proposal.proposer.sessionId]:[];
    for (const recipient of targets) if (room.members.some(member=>member.sessionId===recipient)) addRequest(room,{
      triggerEventId:proposal.sources[0]?.id??account.originMessageId,recipient,purpose:proposal.status==="pending"?"charter_review":"charter_rework",
      proposalId:proposal.id,basisVersion:proposal.fingerprint,basisRoomSeq:room.roomSeq,budgetAccountId:account.id,operationKey:`charter:${proposal.id}:${proposal.status}:${recipient}`
    });
  }
}

export function pausePendingRequests(room, reason) {
  let changed=false;
  if (!collaborationEnabled(room)) return changed;
  for (const request of room.collaboration.requests) if (request.state==="pending") {
    request.state="needs_resolution"; request.waitReason=reason; request.revision++; changed=true;
  }
  return changed;
}

export function closureRequest(room, account) {
  const work = integrationWork(room);
  const cutoff=acceptedCutoff(room);
  const remaining=room.collaboration.unreviewed.filter(item=>item.state==="unreviewed"&&(cutoff===null||item.roomSeq<=cutoff));
  const recipient = work?.ownerSessionId ?? remaining.find(item=>room.members.some(member=>member.sessionId===item.recipient))?.recipient;
  const unreviewed=work?requestReviewableMessages(room,{purpose:"integration",workId:work.id,recipient}):remaining.filter(item=>item.recipient===recipient);
  if (!recipient || (!work && !unreviewed.length)) return null;
  const closingWork=work??room.ledger.find(entry=>entry.id===unreviewed.find(item=>item.workId)?.workId);
  const previous=room.collaboration.requests.findLast(item=>item.budgetAccountId===account.id&&["integration","unreviewed"].includes(item.purpose)&&item.recipient===recipient&&item.workId===(closingWork?.id??null));
  if (previous&&(requestOpen(previous)||previous.basisVersion===(closingWork?.contractHash??null)&&!unreviewed.some(item=>item.roomSeq>previous.basisRoomSeq))) return previous;
  return addRequest(room, { triggerEventId: account.originMessageId, workId: closingWork?.id ?? null, recipient, purpose: work ? "integration" : "unreviewed", basisVersion: closingWork?.contractHash ?? null,
    basisRoomSeq: room.roomSeq, budgetAccountId: account.id, operationKey: `integration:${account.id}:${closingWork?.id??"messages"}:${recipient}:${room.roomSeq}`, unreviewedMessageIds: unreviewed.map(item => item.messageId) });
}

export function assertWorkClosure(room, entry) {
  if (!collaborationEnabled(room) || !(entry.integration || entry.requiredWorkIds?.length)) return;
  const scope = new Set([entry.id, ...(entry.requiredWorkIds ?? [])]);
  const pending = room.collaboration.requests.filter(request => requestOpen(request) && (!request.workId || scope.has(request.workId)) && !(request.purpose === "review" && request.workId === entry.id && request.state!=="unknown"));
  const unread = room.collaboration.unreviewed.filter(item => item.state === "unreviewed" && (!item.workId || scope.has(item.workId)));
  if (pending.length || unread.length) throw new Error(`integration cannot close: ${pending.length} unresolved requests and ${unread.length} unreviewed messages`);
}

export function collaborationOverviewOf(room) {
  const state = room.collaboration;
  const requests = state?.requests ?? [];
  const pending = requests.filter(requestOpen);
  const unreviewed = (state?.unreviewed ?? []).filter(item => item.state === "unreviewed");
  const tasks = room.ledger.filter(item => item.kind === "task" && !["cancelled", "archived"].includes(item.status));
  const unknown = pending.some(item => item.state === "unknown");
  const cutoff=acceptedCutoff(room);
  const postRequests=cutoff===null?[]:pending.filter(item=>item.basisRoomSeq>cutoff);
  const postUnreviewed=cutoff===null?[]:unreviewed.filter(item=>item.roomSeq>cutoff);
  const currentAccepted=!unknown&&tasks.length&&tasks.every(entry=>fixedAcceptance(room,entry))&&pending.length===postRequests.length&&unreviewed.length===postUnreviewed.length;
  const outcome = unknown ? "unknown" : currentAccepted ? "accepted"
    : tasks.some(item => item.submission) ? "partial" : tasks.some(item => item.status === "blocked") ? "waiting" : room.orchestration?.endReason === "budget_exhausted" ? "budget_exhausted" : "incomplete";
  return { strategy: state?.strategy ?? "legacy", revision: state?.revision ?? 1, coordinatorSessionId: room.members.find(member=>member.sessionId===state?.coordinatorSessionId)?.sessionId??room.members[0]?.sessionId??null,
    acceptanceCutoffRoomSeq:currentAccepted?cutoff:null,acceptedWithNewEvents:!!currentAccepted&&(postRequests.length>0||postUnreviewed.length>0),
    postAcceptanceRequestCount:currentAccepted?postRequests.length:0,postAcceptanceIssueCount:currentAccepted?postRequests.filter(item=>explicitIssues.has(item.purpose)).length:0,postAcceptanceUnreviewedCount:currentAccepted?postUnreviewed.length:0,
    requests:requests.map(request=>{
      const sourceMessageIds=[...new Set([request.triggerEventId,request.deliveryMessageId,...(request.unreviewedMessageIds??[]),...(["integration","unreviewed"].includes(request.purpose)?requestReviewableMessages(room,request).map(item=>item.messageId):[])])].filter(id=>room.messages?.some(message=>message.id===id));
      return {...request,triggerMessageId:sourceMessageIds.find(id=>id===request.triggerEventId||id===request.deliveryMessageId)??null,sourceMessageIds};
    }), pendingCount: pending.length, unreviewed, unreviewedCount: unreviewed.length, budget: state?.budget ?? {}, budgetAccounts: state?.budgetAccounts ?? [],
    outcome, execution: room.orchestration, cutoffRoomSeq: room.roomSeq, tasks: tasks.map(item => ({ id: item.id, title: item.title, status: item.status, ownerSessionId: item.ownerSessionId, reviewerSessionId: item.reviewerSessionId, submission: item.submission, blocker: item.blocker })) };
}
