// Read-only production audit. All writes below target newly created test fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { DshChatLocalService } from '../lib/room-store.js';
import { readNativePermission } from '../lib/native-permissions.js';
import { Readable } from 'node:stream';
import { apply } from '../lib/index.js';

async function waitFor(predicate) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Isolated delivery did not start');
}
async function harness(options={}) {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-review-20260911-'));
  const calls = [];
  const canceled=[];
  const ctx = {
    agents: { get: () => ({ cancel(reason) { canceled.push(reason); } }) },
    dshBridge: {
      status: async () => ({ state: 'idle' }),
      deliverExternal: async (from, to, text, delivery) => { calls.push({ from, to, text, delivery }); }
    },
    get(name) { return this[name]; }
  };
  const path = join(directory, 'rooms.json');
  const service = new DshChatLocalService(ctx, { path, maxRounds: 1, replyTimeoutMs: options.replyTimeoutMs??30000 });
  await service.ready;
  const room = (name, autoDeliver = true) => service.createRoom({ name, autoDeliver,
    members: [{ kind: 'session', sessionId: 's1', alias: '成员' }] });
  const send = (roomId, text, extra = {}) => service.send({ roomId, author: 'human:me', authorKind: 'human', text, ...extra });
  const activate = async call => {
    await service.observeSessionEvent('s1', { type: 'turn/start', data: { turn: 1 } });
    await service.observeSessionEvent('s1', { type: 'user/message', data: { content: [{ type: 'text', text:
      `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]\n${call.text}` }] } });
  };
  return { directory, path, ctx, service, calls, canceled, room, send, activate };
}

test('P1: queuing another room must not disable the active read-only guard', async t => {
  const h = await harness(); t.after(() => h.service.close());
  const a = await h.room('只读房间 A'), b = await h.room('等待房间 B');
  await h.send(a.id, 'A 只读检查'); await waitFor(() => h.calls.length === 1);
  await h.activate(h.calls[0]);
  const execution = { name: 'bash', agent: { session: { id: 's1' } } };
  const before = h.service.guardToolExecution(execution);
  assert.match(before, /Host 已拒绝/);
  await h.send(b.id, 'B 排队检查'); await waitFor(() => h.calls.length === 2);
  const after = h.service.guardToolExecution(execution);
  t.diagnostic(JSON.stringify({ activeBefore: !!before, activeAfter: !!after,
    pendingRooms: [...h.service.pending.values()].map(x => x.roomId) }));
  assert.match(after ?? '', /Host 已拒绝/, 'A is still active; B marker has not been delivered');
});

test('P1: concurrent human sends must not create two live roots with the same epoch', async t => {
  const h = await harness(); t.after(() => h.service.close());
  const room = await h.room('并发发送');
  const [first, second] = await Promise.all([h.send(room.id, '第一条'), h.send(room.id, '第二条')]);
  await waitFor(() => h.calls.length >= 1);
  await new Promise(resolve => setTimeout(resolve, 50));
  const captures = [...h.service.pending.values()].map(x => ({ root: x.rootMessageId, epoch: x.epoch }));
  t.diagnostic(JSON.stringify({ first: first.id, second: second.id, captures, bridgeCalls: h.calls.length }));
  assert.equal(captures.length, 1, 'The superseded first root must not remain active');
  assert.equal(captures[0].root, second.id);
});

test('P1: retry after failed persistence must actually persist the accepted message', async t => {
  const h = await harness(); t.after(() => h.service.close());
  const room = await h.room('落盘失败', false);
  const badPath = join(h.directory, 'cannot-replace-directory'); await mkdir(badPath);
  h.service.path = badPath;
  const input = { clientOperationId: 'stable-client-operation', automaticDelivery: false };
  await assert.rejects(h.send(room.id, '必须保存的消息', input), /EISDIR/);
  h.service.path = h.path;
  const accepted = await h.send(room.id, '必须保存的消息', input);
  const persisted = JSON.parse(await readFile(h.path, 'utf8')).rooms.find(x => x.id === room.id).messages;
  t.diagnostic(JSON.stringify({ retryAcceptedId: accepted.id, memoryCount: (await h.service.messages(room.id)).length,
    diskCount: persisted.length }));
  assert.ok(persisted.some(x => x.id === accepted.id), 'A successful retry must not return a memory-only message');
});

test('P2: startup must reconcile historical working deliveries even when the room is idle', async t => {
  const h = await harness();
  const room = await h.room('历史处理中', false);
  const message = await h.send(room.id, '历史消息', { automaticDelivery: false });
  await h.service.close();
  const state = JSON.parse(await readFile(h.path, 'utf8'));
  state.rooms[0].messages[0].deliveries = [{ id: 'orphan-delivery', member: 's1', status: 'working' }];
  state.rooms[0].orchestration = { state: 'idle', epoch: 2 };
  await writeFile(h.path, JSON.stringify(state));
  const reloaded = new DshChatLocalService(h.ctx, { path: h.path }); t.after(() => reloaded.close());
  const actual = (await reloaded.messages(room.id)).find(x => x.id === message.id).deliveries[0].status;
  t.diagnostic(JSON.stringify({ orchestration: (await reloaded.resolveRoom(room.id)).orchestration.state, delivery: actual }));
  assert.notEqual(actual, 'working', 'No capture exists after restart; do not imply ongoing work');
});

test('P2: a late participants response from room A must not overwrite selected room B', async t => {
  const source = await readFile(new URL('../lib/client.js',import.meta.url), 'utf8');
  const start = source.indexOf('        const refreshParticipants = async () => {');
  const end = source.indexOf('        const refreshArtifacts =', start);
  assert.ok(start > 0 && end > start);
  let resolveResponse; const deferred = new Promise(resolve => { resolveResponse = resolve; });
  const applied = [];
  const context = { selectedRoom: { id: 'A' }, selectedIdRef: { current: 'A' }, api: () => deferred,
    encodeURIComponent, setParticipants: value => applied.push(value) };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + '\nglobalThis.refresh = refreshParticipants;', context);
  const pending = context.refresh();
  context.selectedIdRef.current = 'B';
  resolveResponse([{ sessionId: 'member-of-A' }]); await pending;
  t.diagnostic(JSON.stringify({ selectedRoom: context.selectedIdRef.current, applied }));
  assert.equal(applied.length, 0, 'The stale response belongs to room A');
});

test('P2: retrying a correction after a lost response must not duplicate the correction', async t => {
  const h = await harness(); t.after(() => h.service.close());
  const room = await h.room('纠正重试', false);
  const original = await h.send(room.id, '原始消息', { automaticDelivery: false });
  const source = await readFile(new URL('../lib/client.js',import.meta.url), 'utf8');
  const start = source.indexOf('        const correctMessage = async () => {');
  const end = source.indexOf('        const retryFailed =', start);
  assert.ok(start > 0 && end > start);
  let attempts = 0; const operationIds = [];
  const context = { selectedRoom: room, correctionTarget: original, correctionDraft: '修正消息',
    managementBusy: false, encodeURIComponent, crypto,
    api: async (_path, options) => {
      if (!options) return h.service.messages(room.id);
      const input = JSON.parse(options.body); operationIds.push(input.clientOperationId);
      const result = await h.service.correctHumanMessage(room.id, original.id, input);
      if (++attempts === 1) throw new Error('Simulated lost HTTP response after server commit');
      return result;
    },
    setManagementBusy(value) { context.managementBusy = value; },
    setCorrectionTarget(value) { context.correctionTarget = value; },
    setCorrectionDraft(value) { context.correctionDraft = value; },
    setMessages() {}, setNotice() {}, setError() {}
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + '\nglobalThis.correct = correctMessage;', context);
  await context.correct(); await context.correct();
  const corrections = (await h.service.messages(room.id)).filter(x => x.correctsMessageId === original.id);
  t.diagnostic(JSON.stringify({ attempts, operationIds, corrections: corrections.length }));
  assert.equal(corrections.length, 1, 'Retry is the same user operation, not a second correction');
});

test('failed commit retry schedules once, and concurrent identical retries share the commit receipt',async t=>{
  const h=await harness();t.after(()=>h.service.close());
  const room=await h.room('恢复投递');
  const bad=join(h.directory,'bad');await mkdir(bad);h.service.path=bad;
  await assert.rejects(h.send(room.id,'恢复发送',{clientOperationId:'resume'}),/EISDIR/);
  assert.equal(h.calls.length,0);
  assert.equal((await h.service.messages(room.id))[0].savePending,true);
  h.service.path=h.path;
  await Promise.all([h.send(room.id,'恢复发送',{clientOperationId:'resume'}),h.send(room.id,'恢复发送',{clientOperationId:'resume'})]);
  await waitFor(()=>h.calls.length===1);
  assert.equal((await h.service.messages(room.id)).length,1);
  assert.equal((await h.service.messages(room.id))[0].savePending,undefined);
  await h.service.close();
  const reloaded=new DshChatLocalService(h.ctx,{path:h.path});t.after(()=>reloaded.close());
  assert.equal((await reloaded.messages(room.id)).length,1);
  assert.equal((await reloaded.messages(room.id))[0].deliveries[0].status,'failed');
  assert.notEqual((await reloaded.resolveRoom(room.id)).orchestration.endReason,'completed');
  assert.equal(h.calls.length,1,'restart does not silently replay the accepted task');
});

test('retrying an older failed commit cannot supersede or restart a newer task',async t=>{
  const h=await harness();t.after(()=>h.service.close());const room=await h.room('旧请求');
  const bad=join(h.directory,'bad');await mkdir(bad);h.service.path=bad;
  await assert.rejects(h.send(room.id,'旧消息',{clientOperationId:'old'}));h.service.path=h.path;
  const newer=await h.send(room.id,'新任务',{clientOperationId:'new'});await waitFor(()=>h.calls.length===1);
  await h.send(room.id,'旧消息',{clientOperationId:'old'});
  assert.equal(h.calls.length,1);assert.equal((await h.service.resolveRoom(room.id)).orchestration.rootMessageId,newer.id);
});

test('coalesced cross-room markers keep the stricter policy and cannot publish mixed results',async t=>{
  const h=await harness();t.after(()=>h.service.close());const a=await h.room('只读 A'),b=await h.room('B');
  await h.send(a.id,'A');await waitFor(()=>h.calls.length===1);await h.activate(h.calls[0]);
  await h.service.setRoomPolicy(b.id,{defaultActionMode:'inherit_dsh',expectedRevision:1,confirmRisk:true});
  await h.send(b.id,'B');await waitFor(()=>h.calls.length===2);await h.activate(h.calls[1]);
  assert.match(h.service.guardToolExecution({name:'bash',agent:{session:{id:'s1'}}}),/Host 已拒绝/);
  await assert.rejects(h.service.send({roomId:b.id,author:'s1',authorKind:'session',text:'mixed'}),/合并/);
  await h.service.observeSessionEvent('s1',{type:'turn/end',data:{turn:1,reason:{kind:'completed'}}});
  await waitFor(()=>h.service.pending.size===0);
  assert.equal((await h.service.messages(a.id)).length,1);
  assert.ok((await h.service.messages(b.id)).every(x=>x.authorKind!=='session'));
  assert.equal(h.service.guardToolExecution({name:'bash',agent:{session:{id:'s1'}}}),undefined);
});

test('a marker with no tracked turn still settles, records delivered, and arms the guard',async t=>{
  const h=await harness();t.after(()=>h.service.close());
  const room=await h.room('重挂载后的投递');
  await h.send(room.id,'重挂载检查');await waitFor(()=>h.calls.length===1);
  const call=h.calls[0];
  // A remount while the member's DSH turn is already running: this instance
  // never saw that turn's `turn/start`, so neither map holds anything for "s1".
  // `capture.turn` is therefore `undefined` here, and no lock exists yet.
  assert.equal(h.service.turnBySession.get('s1'),undefined,'the fixture must not have observed a turn');
  assert.equal(h.service.policyLocks.get('s1'),undefined,'the fixture must not already hold a policy lock');
  await h.service.observeSessionEvent('s1',{type:'user/message',data:{content:[{type:'text',text:
    `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from room:${room.id}]\n重挂载检查`}]}});
  const events=await h.service.eventsFor(room.id);
  const delivered=events.filter(event=>event.type==='delivery.settled'
    &&event.payload.deliveryId===call.delivery.id&&event.payload.status==='delivered');
  assert.equal(delivered.length,1,'the delivered transition must still be recorded for an untracked turn');
  const denial=h.service.guardToolExecution({name:'bash',agent:{session:{id:'s1'}}});
  assert.equal(typeof denial,'string','the room guard must not be inert after the marker was observed');
  assert.match(denial,/Host 已拒绝/);
});

test('an unactivated queued timeout does not cancel another native Session turn',async t=>{
  const h=await harness({replyTimeoutMs:250});t.after(()=>h.service.close());const room=await h.room('排队超时');
  await h.send(room.id,'排队');await waitFor(()=>h.calls.length===1);
  await h.service.observeSessionEvent('s1',{type:'turn/start',data:{turn:7}});
  await waitFor(()=>(h.service.pending.size===0));
  assert.equal(h.canceled.length,0);
});

test('DSH permission observation works without attaching a Session and always disposes the lease',async()=>{
  let disposed=0,observed=0;
  const ctx={sessionQuery:{observeSession:async(id,options)=>{
    assert.equal(id,'cold');assert.equal(options.projectionMode,'all');observed++;
    return {projections:{values:{permissions:{currentValue:'workspace-write'}}},[Symbol.dispose](){disposed++;}};
  }}};
  assert.equal(await readNativePermission(ctx,'cold'),'workspace-write');assert.equal(observed,1);assert.equal(disposed,1);
  assert.equal(await readNativePermission({sessionQuery:{observeSession:async()=>({[Symbol.dispose](){disposed++;}})}},'cold'),undefined);
  assert.equal(disposed,2);
});

test('room-scoped setters reject an A response even after switching A → B → A',async()=>{
  const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('    function useRoomState('),source.indexOf('    function ledgerStatusOptions('));
  const updated=[],scopeRef={current:{id:'A',generation:1}};
  const context=vm.createContext({React:{useState:value=>[value,next=>updated.push((typeof next==='function'?next(value):next).value)]},scopeRef});
  vm.runInContext(body+'\nglobalThis.oldSetter=useRoomState(scopeRef,[])[1];',context);
  scopeRef.current={id:'B',generation:2};scopeRef.current={id:'A',generation:3};context.oldSetter('stale');
  assert.equal(updated.length,0);
  vm.runInContext('useRoomState(scopeRef,[])[1]("fresh")',context);assert.deepEqual(updated,['fresh']);
});

test('switching conversation hides the prior value before any effect or network response',async()=>{
  const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('    function useRoomState('),source.indexOf('    function ledgerStatusOptions('));
  let stored;
  const scopeRef={current:{id:'A',generation:1}},context=vm.createContext({React:{useState:initial=>{stored??=initial;return [stored,next=>{stored=typeof next==='function'?next(stored):next;}];}},scopeRef});
  vm.runInContext(body+'\nuseRoomState(scopeRef,[])[1](["old conversation"]);',context);
  scopeRef.current={id:'B',generation:2};
  assert.equal(vm.runInContext('useRoomState(scopeRef,[])[0].length',context),0);
  vm.runInContext('useRoomState(scopeRef,[])[1](prior=>[...prior,"new conversation"]);',context);
  assert.equal(vm.runInContext('useRoomState(scopeRef,[])[0].join("/")',context),'new conversation');
});

test('conditional client reads reuse unchanged values and mutations invalidate the cache',async()=>{
  const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('    async function api('),source.indexOf('    function statusLabel('));
  const calls=[];let n=0;
  const context=vm.createContext({BASE:'',fetch:async(path,options)=>{
    calls.push({path,options});n++;return n===2?{status:304}: {status:200,ok:true,headers:{get:()=>`"v${n}"`},json:async()=>({ok:true,value:{n}})};
  }});
  vm.runInContext(body,context);
  const first=await vm.runInContext('api("/rooms")',context),second=await vm.runInContext('api("/rooms")',context);
  assert.equal(first,second);assert.equal(calls[1].options.headers['if-none-match'],'"v1"');
  await vm.runInContext('api("/rooms",{method:"POST",body:"{}"})',context);await vm.runInContext('api("/rooms")',context);
  assert.equal(calls[3].options.headers['if-none-match'],undefined);
});

test('concurrent first attempts with the same operation cannot acknowledge a failed save',async t=>{
  const h=await harness();t.after(()=>h.service.close());
  const room=await h.room('同时首次发送');
  const bad=join(h.directory,'bad');await mkdir(bad);h.service.path=bad;
  const results=await Promise.allSettled([h.send(room.id,'相同操作',{clientOperationId:'first'}),h.send(room.id,'相同操作',{clientOperationId:'first'})]);
  assert.deepEqual(results.map(result=>result.status),['rejected','rejected']);
  assert.equal(h.calls.length,0);assert.equal((await h.service.messages(room.id)).length,1);
  h.service.path=h.path;
  await h.send(room.id,'相同操作',{clientOperationId:'first'});await waitFor(()=>h.calls.length===1);
});

test('an expired inbox delivery is denied only when its actual native turn starts',async t=>{
  const h=await harness({replyTimeoutMs:100});t.after(()=>h.service.close());
  const room=await h.room('晚到的过期投递');
  await h.send(room.id,'超时后不应执行');await waitFor(()=>h.calls.length===1);
  await waitFor(()=>h.service.pending.size===0);
  const execution={name:'bash',agent:{session:{id:'s1'}}};
  assert.equal(h.service.guardToolExecution(execution),undefined);assert.equal(h.canceled.length,0);
  await h.activate(h.calls[0]);
  assert.match(h.service.guardToolExecution(execution),/失效|超时/);assert.equal(h.canceled.length,1);
  await assert.rejects(h.service.send({roomId:room.id,author:'s1',authorKind:'session',text:'晚到结果'}),/失效/);
  await h.service.observeSessionEvent('s1',{type:'turn/end',data:{turn:1}});
  await h.service.observeSessionEvent('s1',{type:'turn/start',data:{turn:2}});
  assert.equal(h.service.guardToolExecution(execution),undefined);
});

test('actual HTTP handler returns a bodyless 304 and changes its ETag after mutation',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'dcl-etag-'));let handler;const disposers=[];
  apply({effect(fn){const dispose=fn();if(typeof dispose==='function')disposers.push(dispose);},on(){},tools:{register(){},guard(){}},webServer:{register(route){handler=route.handler;}}},{path:join(directory,'rooms.json')});
  t.after(async()=>{for(const dispose of disposers.reverse())await dispose();});
  const request=async(method,etag,body)=>{
    const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);Object.assign(req,{url:'/api/dsh-chat-local/rooms',method,headers:{'if-none-match':etag}});
    const result={};await handler(req,{writeHead(status,headers){Object.assign(result,{status,headers});},end(body){result.body=body;}});return result;
  };
  const first=await request('GET');assert.equal(first.status,200);assert.ok(first.headers.etag);
  const unchanged=await request('GET',first.headers.etag);assert.equal(unchanged.status,304);assert.equal(unchanged.body,undefined);
  const mutation=await request('POST',first.headers.etag,{name:'条件同步',autoDeliver:false});assert.equal(mutation.status,200);assert.equal(mutation.headers.etag,undefined);
  const changed=await request('GET',first.headers.etag);assert.equal(changed.status,200);assert.notEqual(changed.headers.etag,first.headers.etag);
  assert.equal(JSON.parse(changed.body).value.length,1);
});

test('prepare continuation drafts only the pending member tasks without sending or repeating completed work',async()=>{
  const source=await readFile(new URL('../lib/client.js',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('        const prepareContinuation ='),source.indexOf('        const onTimelineScroll ='));
  const changes={};
  const context=vm.createContext({draft:'',selectedRoom:{id:'r',orchestration:{pendingSessionIds:['editor']}},participants:[{sessionId:'editor'},{sessionId:'author'}],
    ledger:[{id:'review',kind:'task',title:'方法学验收',status:'in_review',reviewerSessionId:'editor',ownerSessionId:'author'},{id:'summary',kind:'task',title:'汇总',status:'in_progress',ownerSessionId:'editor'},{id:'done',kind:'task',title:'已完成检查',status:'done',ownerSessionId:'editor'}],
    closedLedgerStatus:status=>status==='done',setDraft:text=>{changes.text=text;},setMentionIds:ids=>{changes.ids=ids;},setMentionAll:all=>{changes.all=all;},setNotice:notice=>{changes.notice=notice;},rememberRoomUi(){},textareaRef:{current:{focus(){}}}});
  vm.runInContext(body+'\nprepareContinuation()',context);
  assert.match(changes.text,/独立验收「方法学验收」/);assert.match(changes.text,/推进「汇总」/);assert.ok(!changes.text.includes('已完成检查'));
  assert.deepEqual([...changes.ids],['editor']);assert.equal(changes.all,false);assert.match(changes.notice,/发送后才会启动/);
});
