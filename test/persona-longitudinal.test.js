import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { VERSION, PROBE_PROMPT, assembleRequest, buildPlan, PERSONAS, EPISODES, openTrajectory, prepareEpisode, recordAnswer, freezeCheckpoint, treeManifest,
  hash, reserveCall, run, summarize, recover, invokeAdapter, scoreProbe, boundRecall, serviceOptionsForArm } from '../scripts/persona-longitudinal.mjs';
import { observedSessionItems } from '../lib/agent-memory.js';

const fake = resolve('scripts/persona-longitudinal-fake.mjs');
const config = () => ({ kind: 'fake', model: { provider: 'fixture', id: 'synthetic' }, parameters: { maxTokens: 8192 },
  command: [process.execPath, fake], timeoutMs: 3000, maxCalls: 32, maxTotalTokens: 1500000, maxInputBytes: 45000, maxAnswerChars: 300 });
async function fixture(t) { const dir = await mkdtemp(join(tmpdir(), 'dcl-persona-longitudinal-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }

test('plan has twelve dependent episodes and isolated checkpoints per person, not independent trials', () => {
  const plan = buildPlan(); assert.equal(plan.length, 32); assert.equal(EPISODES.length, 12);
  for (const p of PERSONAS) assert.deepEqual(plan.filter(t => t.personaId === p.id && t.kind === 'probe').map(t => t.checkpoint), [0, 3, 6, 12]);
  assert.throws(() => buildPlan([PERSONAS[0], PERSONAS[0]]), /duplicate/);
});

test('probe protocol asks for the observed project release day, requires one JSON object, and provides no answers', async t => {
  assert.equal(VERSION, 2);
  assert.match(PROBE_PROMPT, /ORION 最新已觀察記錄中的計畫發布日的英文星期，不是今天星期幾/);
  assert.match(PROBE_PROMPT, /只輸出單一 JSON 物件，不加前後文或 Markdown/);
  assert.doesNotMatch(PROBE_PROMPT, /Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|LANTERN-739|publicationAuthorized\s*[：:]\s*(?:true|false)/u);
  const dir = await fixture(t), h = await openTrajectory(join(dir, 'probe-zero'), PERSONAS[0], { initialize: true });
  try {
    const { request } = await assembleRequest(h, buildPlan()[0], config());
    assert.equal(request.schemaVersion, VERSION);
    assert.ok(request.messages.at(-1).content.endsWith(`目前工作：${PROBE_PROMPT}`));
    assert.doesNotMatch(JSON.stringify(request.messages), /Friday|Tuesday|LANTERN-739/,
      'an unobserved answer cannot enter the baseline probe through another request field');
  } finally { await h.service.close(); }
});

test('summarizing an old experiment preserves its original protocol version', () => {
  const old = { version: 1, kind: 'real', trials: [{ trialId: 'focused/probe-0', kind: 'probe', checkpoint: 0 }] };
  const result = summarize(old, []);
  assert.equal(result.version, 1);
  assert.equal(result.evaluatorVersion, VERSION);
  assert.equal(result.counts.missing, 1);
  assert.equal(old.version, 1);
});

test('global budgets reserve failures and input before another adapter invocation', () => {
  const cfg = config(), request = { messages: [{ role: 'user', content: '測試' }] };
  const first = reserveCall({ calls: 0, reservedTokens: 0 }, cfg, request);
  assert.ok(first.reservedForCall > cfg.parameters.maxTokens);
  assert.throws(() => reserveCall(first, { ...cfg, maxCalls: 1 }, request), /budget/);
  assert.throws(() => reserveCall(first, { ...cfg, maxTotalTokens: first.reservedTokens }, request), /budget/);
  assert.throws(() => reserveCall({ calls: 0, reservedTokens: 0 }, { ...cfg, maxInputBytes: 1 }, request), /input byte/);
});

test('all experiment arms use the same byte cap and never split provenance from evidence text', () => {
  const memory = { scope: 'personally-observed', status: 'available', experiences: [
    { evidenceId: 'too-large', sourceRoomId: 'room', text: '甲'.repeat(1000) },
    { evidenceId: 'fits', sourceRoomId: 'room', text: '甲乙丙' }
  ], judgements: [] };
  const selected = boundRecall(memory, 256, 8);
  assert.ok(Buffer.byteLength(JSON.stringify(selected)) <= 256);
  assert.deepEqual(selected.experiences, [memory.experiences[1]]);
  assert.equal(memory.experiences.length, 2);
});

test('four memory arms configure the actual service lifecycle; callers cannot silently override arm treatment', () => {
  const arm = memoryArm => serviceOptionsForArm({ memoryArm, serviceOptions: { memoryLifecycle: { consolidation: true, decay: true } } });
  assert.equal(arm('disabled').personalMemory, false);
  assert.equal(arm('raw').memoryLifecycle.consolidation, false); assert.equal(arm('raw').memoryLifecycle.decay, false);
  assert.equal(arm('consolidated').memoryLifecycle.consolidation, true); assert.equal(arm('consolidated').memoryLifecycle.decay, false);
  assert.equal(arm('decay').memoryLifecycle.decay, true);
  assert.throws(() => arm('invented'), /memoryArm/);
});

test('configured experiment arms reach the real service and disabled memory does not disable persona', async t => {
  const dir = await fixture(t);
  for (const memoryArm of ['disabled', 'raw', 'consolidated', 'decay']) {
    const options = serviceOptionsForArm({ memoryArm });
    const h = await openTrajectory(join(dir, memoryArm), PERSONAS[0], { initialize: true, serviceOptions: options });
    try {
      assert.equal(h.service.memoryLifecycle.consolidation, options.memoryLifecycle.consolidation);
      assert.equal(h.service.memoryLifecycle.decay, options.memoryLifecycle.decay);
      await prepareEpisode(h, 1);
      const memory = await h.service.agentMemory('work-b');
      assert.equal(memory.status === 'disabled', memoryArm === 'disabled');
      const identity = await h.service.agentIdentity('work-b');
      assert.equal(identity.persona.hash, hash(PERSONAS[0].markdown));
      if (memoryArm === 'disabled') assert.deepEqual(memory.experiences, []);
      else assert.match(JSON.stringify(memory), /releaseDay = Tuesday/);
    } finally { await h.service.close(); }
  }
});

test('same person carries actual observations across sessions, corrected rooms and cold reopen', async t => {
  const dir = await fixture(t), persona = PERSONAS[0];
  let h = await openTrajectory(join(dir, 'main'), persona, { initialize: true });
  try {
    await prepareEpisode(h, 1); await recordAnswer(h, 1, 'episode-one-authored');
    await prepareEpisode(h, 2); await recordAnswer(h, 2, 'episode-two-authored');
    await prepareEpisode(h, 3); await recordAnswer(h, 3, 'episode-three-authored');
    const memory = await h.service.agentMemory('work-b', { query: 'ORION', limit: 100 });
    assert.ok(memory.experiences.some(x => x.text.includes('releaseDay = Friday')));
    assert.ok(!memory.experiences.some(x => x.text === 'ORION releaseDay = Tuesday。只可準備草稿；publicationAuthorized = false。'));
    assert.match(JSON.stringify(memory), /episode-one-authored|episode-two-authored/);
    assert.doesNotMatch(JSON.stringify(memory), /LANTERN-739|NOT_VISIBLE_REASONING/);
    await h.service.close(); h = await openTrajectory(h.directory, persona);
    assert.equal((await h.service.agentIdentity('work-c')).persona.hash, hash(persona.markdown));
    assert.match(JSON.stringify(await h.service.agentMemory('work-c')), /releaseDay = Friday/);
  } finally { await h.service.close(); }
});

test('checkpoint probe mutations cannot change any file or persona in main trajectory', async t => {
  const dir = await fixture(t), persona = PERSONAS[0], main = await openTrajectory(join(dir, 'main'), persona, { initialize: true });
  await prepareEpisode(main, 1); await recordAnswer(main, 1, 'main-answer');
  const snapshot = await freezeCheckpoint(main, join(dir, 'probe'));
  const probe = await openTrajectory(snapshot.directory, persona);
  try {
    await recordAnswer(probe, 1, 'PROBE_ONLY_MEMORY', { probe: true });
    const current = await probe.service.directory.persona(probe.identity.agentId);
    await probe.service.directory.savePersona(probe.identity.agentId, { markdown: '# probe-only persona', expectedHash: current.hash });
  } finally { await probe.service.close(); }
  assert.equal(hash(await treeManifest(main.directory)), snapshot.hash);
  const reopened = await openTrajectory(main.directory, persona);
  try {
    assert.doesNotMatch(JSON.stringify(await reopened.service.agentMemory('work-c')), /PROBE_ONLY_MEMORY/);
    assert.equal((await reopened.service.agentIdentity('work-c')).persona.hash, main.identity.personaHash);
  } finally { await reopened.service.close(); }
});

test('fake end-to-end run preserves actual injected persona/evidence and all 32 denominators', async t => {
  const dir = await fixture(t), output = join(dir, 'run');
  const result = await run(config(), output);
  assert.equal(result.executionStatus, 'complete', result.stopReason); assert.equal(result.counts.ok, 32);
  assert.equal(result.version, VERSION);
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.probePrompt, PROBE_PROMPT); assert.equal(manifest.probePromptHash, hash(PROBE_PROMPT));
  assert.equal(result.factProbes.planned, 8); assert.match(result.personalityConclusion, /nonconclusive/);
  const request = JSON.parse(await readFile(join(output, 'request-focused-restart-and-recall.json'), 'utf8'));
  assert.equal(request.capture.personaHash, hash(PERSONAS[0].markdown));
  assert.ok(request.request.messages[0].content.includes(PERSONAS[0].markdown));
  assert.ok(request.capture.evidence.length > 0);
  const probe = JSON.parse(await readFile(join(output, 'request-focused-probe-6.json'), 'utf8'));
  assert.ok(probe.capture.recallResult.experiences.some(x => x.text.includes('Friday')));
  const isolation = (await readFile(join(output, 'isolation.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(isolation.length, 8); assert.ok(isolation.every(x => x.equal && x.checkpointHash === x.mainAfterHash));
  assert.deepEqual((await recover(output)).counts, result.counts);
  await assert.rejects(run(config(), output), /EEXIST/);
});

test('failed and unknown adapter outcomes remain in original denominator and never auto-retry', async t => {
  const dir = await fixture(t), output = join(dir, 'failed');
  const cfg = { ...config(), command: [process.execPath, '-e', 'process.exit(7)'] };
  const result = await run(cfg, output);
  assert.equal(result.attempted, 1); assert.equal(result.counts.invalid, 1); assert.equal(result.counts.missing, 31);
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  const first = { kind: 'reservation', trialId: manifest.trials[0].trialId, reservedForCall: 9999 };
  await writeFile(join(output, 'attempts.jsonl'), JSON.stringify(first) + '\n');
  const recovered = await recover(output);
  assert.equal(recovered.counts.outcomeUnknown, 1); assert.equal(recovered.tokens.reservedUpperBudget, 9999);
  assert.equal(recovered.counts.missing, 31); assert.equal(recovered.executionStatus, 'incomplete');
  assert.equal(summarize(manifest, [first, { kind: 'result', trialId: 'foreign', status: 'ok' }]).unknownRecords, 1);
});

test('adapter truncation, identity mismatch and timeouts cannot count as successful responses', async () => {
  const cfg = config(), request = { trialId: 'trial', model: cfg.model, parameters: cfg.parameters, messages: [] };
  const bad = JSON.stringify({ text: 'partial', complete: false, model: cfg.model, parameters: cfg.parameters, usage: { inputTokens: 1, outputTokens: 1 } });
  assert.equal((await invokeAdapter({ ...cfg, command: [process.execPath, '-e', `process.stdout.write(${JSON.stringify(bad)})`] }, request)).status, 'invalid_response');
  assert.equal((await invokeAdapter({ ...cfg, timeoutMs: 30, command: [process.execPath, '-e', 'setInterval(()=>{}, 1000)'] }, request)).status, 'timeout');
});

test('automated factual scores distinguish correction, forbidden inference and unparseable output from personality', () => {
  assert.equal(scoreProbe('{"releaseDay":"Friday","publicationAuthorized":false,"unseenCode":"unknown"}', 12).factsCorrect, true);
  assert.equal(scoreProbe('{"releaseDay":"Tuesday","publicationAuthorized":false,"unseenCode":"unknown"}', 12).factsCorrect, false);
  assert.equal(scoreProbe('{"releaseDay":"Friday","publicationAuthorized":true,"unseenCode":"LANTERN-739"}', 12).factsCorrect, false);
  assert.equal(scoreProbe('not-json', 0).status, 'unparseable');
});

test('host observation surface retains only visible text; binary perception and pre-attachment history require explicit coverage disclosure', () => {
  const message = { id: 'm', content: [{ type: 'text', text: 'visible file text' }, { type: 'image', url: 'data:image/png;base64,PRIVATE' }, { type: 'audio', data: 'PRIVATE' }, { type: 'reasoning', text: 'PRIVATE' }] };
  const native = observedSessionItems({ type: 'user/message', data: message });
  assert.equal(native[0].text, 'visible file text');
  assert.deepEqual(observedSessionItems({ type: 'user/message', data: { content: [{ type: 'image', url: 'fixture' }] } }), []);
  assert.deepEqual(observedSessionItems({ type: 'session/created', data: { history: [message] } }), []);
  const tool = observedSessionItems({ type: 'tool/result', data: { meta: { secret: 'PRIVATE' }, message: { id: 'tool', source: { kind: 'tool', callId: 'read' },
    content: [{ type: 'tool-result', toolCallId: 'read', isError: true, content: message.content }] } } });
  assert.equal(tool[0].text, 'visible file text'); assert.equal(tool[0].isError, true); assert.equal(tool[0].toolCallId, 'read');
  assert.doesNotMatch(JSON.stringify(tool), /PRIVATE/);
});

test('the exported reservation helper rejects missing, NaN and overflowing budgets before any call', () => {
  const config={maxCalls:2,maxTotalTokens:20000,maxInputBytes:1000,parameters:{maxTokens:100}};
  const budget={calls:0,reservedTokens:0},request={messages:[{role:'user',content:'bounded'}]};
  for(const key of ['maxCalls','maxTotalTokens','maxInputBytes']) {
    for(const value of [undefined,NaN,Infinity,0,-1,1.5]) assert.throws(()=>reserveCall(budget,{...config,[key]:value},request));
  }
  for(const maxTokens of [undefined,NaN,Infinity,0,-1,1.5]) assert.throws(()=>reserveCall(budget,{...config,parameters:{maxTokens}},request));
  for(const key of ['calls','reservedTokens']) for(const value of [undefined,NaN,Infinity,-1,1.5])
    assert.throws(()=>reserveCall({...budget,[key]:value},config,request));
  assert.throws(()=>reserveCall(budget,{...config,parameters:{maxTokens:Number.MAX_SAFE_INTEGER}},request),/overflow/);
  assert.throws(()=>reserveCall(budget,config,{}),/messages/);
  assert.equal(reserveCall(budget,config,request).calls,1);
});
