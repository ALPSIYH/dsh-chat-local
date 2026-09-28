import assert from 'node:assert/strict';
import test from 'node:test';
import {normalizeCollaboration} from '../lib/collaboration-policy.js';
import {addRequest,reconcileLedgerRequests,refreshRequests,reconcileCharterRequests,assertWorkClosure,requestReviewableMessages,memberUnreviewedMessages,collaborationOverviewOf,closureRequest,publicLedgerEntry} from '../lib/collaboration-requests.js';
const make=()=>({roomSeq:10,messages:[],members:[{sessionId:'owner'},{sessionId:'reviewer'},{sessionId:'child-owner'}],ledger:[],artifacts:[],profileProposals:[],collaboration:normalizeCollaboration({strategy:'work'}),orchestration:{}});
function accepted(room){
 const ref={artifactId:'artifact',versionId:'version',contentHash:'a'.repeat(64)};
 room.artifacts=[{id:ref.artifactId,versions:[{id:ref.versionId,contentHash:ref.contentHash,snapshot:{storage:'immutable-v1'}}]}];
 const submission={versionStatus:'fixed',contractHash:'contract',inputRefs:[],artifactRefs:[ref],revision:3,coverage:{satisfied:['result'],missing:[],impact:''}};
 const work={id:'work',kind:'task',contractVersion:1,contractHash:'contract',status:'done',inputRefs:[],integration:true,requiredWorkIds:[],ownerSessionId:'owner',reviewerSessionId:'reviewer',submission,review:{verdict:'approve',versionStatus:'fixed',contractHash:'contract',submissionRevision:3,artifactRefs:[ref],eventCutoffRoomSeq:10}};
 room.ledger.push(work);return work;
}
test('an unknown earlier execution survives a later submit and contract refresh',()=>{
 const room=make(),previous={id:'work',kind:'task',contractHash:'old',status:'in_progress'};
 const request=addRequest(room,{workId:'work',recipient:'owner',purpose:'assignment',basisVersion:'old'});request.state='unknown';
 const next={...previous,status:'in_review',reviewerSessionId:'reviewer',submission:{revision:4}};
 reconcileLedgerRequests(room,next,previous,{type:'submit',actor:'session:owner',summary:'later result',sources:[{id:'source'}]});assert.equal(request.state,'unknown');
 room.ledger=[{...next,contractHash:'new'}];refreshRequests(room);assert.equal(request.state,'unknown');
 room.members=[];refreshRequests(room);assert.equal(request.state,'unknown');
});
test('unknown recovery, integration and review executions cannot be settled by later ledger actions',()=>{
 for(const [purpose,type] of [['recovery','progress'],['integration','submit'],['review','review']]) {
  const room=make(),previous={id:'work',kind:'task',contractHash:'old',status:'in_progress'};
  const request=addRequest(room,{workId:'work',recipient:'owner',purpose,basisVersion:'old'});request.state='unknown';
  const next={...previous,status:'done',contractHash:'changed'};room.ledger=[next];
  reconcileLedgerRequests(room,next,previous,{type,actor:'owner',sources:[]});refreshRequests(room);
  assert.equal(request.state,'unknown',purpose);assert.equal(request.resolution,null,purpose);
 }
});
test('explicit issue retains its audit trail when the contract returns to its original value or its recipient leaves',()=>{
 const room=make(),work={id:'work',kind:'task',status:'open',contractHash:'old',revision:1};room.ledger=[work];
 const request=addRequest(room,{workId:'work',recipient:'owner',purpose:'objection',basisVersion:'old'});
 work.contractHash='new';work.revision++;refreshRequests(room);
 work.contractHash='old';work.revision++;refreshRequests(room);
 assert.equal(request.state,'pending');assert.equal(request.basisVersion,'old');assert.equal(request.currentBasisVersion,'old');
 assert.deepEqual(request.basisChanges.map(change=>[change.from,change.to]),[['old','new'],['new','old']]);
 room.members=room.members.filter(member=>member.sessionId!=='owner');refreshRequests(room);
 assert.equal(request.state,'needs_resolution');assert.equal(request.recipientMissing,true);
});
test('a later charter vote does not silently reconcile an unknown charter execution',()=>{
 const room=make(),request=addRequest(room,{recipient:'reviewer',purpose:'charter_review',proposalId:'proposal'});request.state='unknown';
 room.profileProposals=[{id:'proposal',status:'applied',reviews:[{sessionId:'reviewer',comment:'later vote'}],sources:[]}];
 reconcileCharterRequests(room);assert.equal(request.state,'unknown');
});
test('integration can see same-room required-child increments, not unrelated work',()=>{
 const room=make();room.ledger=[{id:'work',requiredWorkIds:['child']}];
 const request=addRequest(room,{workId:'work',recipient:'owner',purpose:'integration'});
 room.collaboration.unreviewed=[{messageId:'own',workId:'work',recipient:'owner',state:'unreviewed'},{messageId:'child',workId:'child',recipient:'child-owner',state:'unreviewed'},{messageId:'shared',workId:null,recipient:'reviewer',state:'unreviewed'},{messageId:'unrelated',workId:'unrelated',recipient:'reviewer',state:'unreviewed'}];
 assert.deepEqual(requestReviewableMessages(room,request).map(x=>x.messageId),['own','child','shared']);
 assert.deepEqual(memberUnreviewedMessages(room,'owner').map(x=>x.messageId),['own','child','shared']);
 const other=make();other.collaboration.unreviewed=[{messageId:'foreign',state:'unreviewed',recipient:'owner'}];
 assert.ok(!requestReviewableMessages(room,request).some(x=>x.messageId==='foreign'));
});
test('late explicit corrections remain pending and visible after fixed acceptance and contract changes',()=>{
 const room=make(),work=accepted(room);room.roomSeq=11;
 const request=addRequest(room,{workId:'work',recipient:'owner',purpose:'correction',basisVersion:'contract',basisRoomSeq:11});
 const view=collaborationOverviewOf(room);assert.equal(view.acceptedWithNewEvents,true);assert.equal(view.postAcceptanceIssueCount,1);assert.equal(view.pendingCount,1);
 const revised={...work,status:'open',contractHash:'changed',revision:5};room.ledger=[revised];reconcileLedgerRequests(room,revised,work,{type:'amend',actor:'human:me',sources:[]});refreshRequests(room);
 assert.ok(['pending','needs_resolution'].includes(request.state));assert.equal(request.basisVersion,'contract');assert.equal(request.currentBasisVersion,'changed');
});
test('unknown post-acceptance work never advertises an accepted flag or passes integration closure',()=>{
 const room=make(),work=accepted(room);room.roomSeq=11;
 const request=addRequest(room,{workId:'work',recipient:'reviewer',purpose:'review',basisVersion:'contract',basisRoomSeq:11});request.state='unknown';
 const view=collaborationOverviewOf(room);assert.equal(view.outcome,'unknown');assert.equal(view.acceptedWithNewEvents,false);assert.equal(view.acceptanceCutoffRoomSeq,null);
 assert.throws(()=>assertWorkClosure(room,work),/unresolved/);
});
test('late routine notification preserves its unread status without automatically reopening accepted work',()=>{
 const room=make();accepted(room);room.roomSeq=11;room.collaboration.unreviewed=[{messageId:'late-note',roomSeq:11,workId:'work',recipient:'owner',state:'unreviewed'}];
 const view=collaborationOverviewOf(room);assert.equal(view.outcome,'accepted');assert.equal(view.acceptedWithNewEvents,true);assert.equal(view.postAcceptanceUnreviewedCount,1);
 assert.equal(closureRequest(room,{id:'account',originMessageId:'original'}),null);assert.equal(room.collaboration.unreviewed[0].state,'unreviewed');
});

test('public handoff projection does not equate a human disposition with delivery and never persists derived state',()=>{
 const room=make(),request=addRequest(room,{recipient:'owner',purpose:'decision'}),entry={id:'decision',handoff:{id:'handoff',requestId:request.id,requestIds:[request.id]}};
 request.state='resolved';request.resolution={disposition:'rejected',actor:'human:me'};
 assert.equal(publicLedgerEntry(room,entry).handoff.state,'resolved');assert.equal(entry.handoff.state,undefined);
 request.state='unknown';request.recipientMissing=true;
 const view=publicLedgerEntry(room,entry);assert.equal(view.handoff.state,'interrupted');assert.match(view.handoff.error,/未知/);assert.equal(entry.handoff.state,undefined);
});
