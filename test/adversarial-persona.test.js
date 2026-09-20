import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentPersonas } from '../lib/agent-persona.js';

const hash = markdown => createHash('sha256').update(markdown).digest('hex');
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dcl-persona-adversarial-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { path: join(directory, 'rooms.json'), personas: new AgentPersonas(join(directory, 'rooms.json')), agent: { id: 'person' } };
}

test('malformed UTF-16 input is rejected before a persona or history is changed', async t => {
  const h = await fixture(t), original = await h.personas.read(h.agent);
  for (const text of ['\uD800', '\uDC00', 'prefix\uD800suffix', '\uD800\uD800', '\uDC00\uD800']) {
    await assert.rejects(h.personas.save(h.agent, { markdown: text, expectedHash: original.hash }), /Unicode|UTF-16|surrogate/);
    assert.deepEqual(await h.personas.read(h.agent), original);
  }
  assert.deepEqual((await readdir(dirname(original.path))).sort(), ['PERSONA.md']);
});

for (const seed of [7, 191, 4099]) test(`seed ${seed}: concurrent editors preserve one winner and content-addressed history`, async t => {
  const h = await fixture(t), editors = Array.from({ length: 4 }, () => new AgentPersonas(h.path));
  let random = seed, current = await h.personas.read(h.agent);
  const previous = new Map();
  const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
  for (let round = 0; round < 8; round++) {
    const texts = editors.map((_, editor) => `# Person ${seed}/${round}/${editor}\n${['甲😀', 'e\u0301', '\uFEFF海', '\u0000文'][next() % 4]}:${next()}`);
    const outcomes = await Promise.allSettled(editors.map((editor, index) => editor.save(h.agent, { markdown: texts[index], expectedHash: current.hash })));
    assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
    for (const failure of outcomes.filter(item => item.status === 'rejected')) assert.equal(failure.reason.status, 409);
    previous.set(current.hash, current.markdown);
    current = await h.personas.read(h.agent);
    assert.ok(texts.includes(current.markdown));
    assert.equal(current.hash, hash(current.markdown));
    assert.equal(await readFile(current.path, 'utf8'), current.markdown);
  }
  const archives = await readdir(join(dirname(current.path), 'history'));
  assert.deepEqual(archives.sort(), [...previous.keys()].map(key => `${key}.md`).sort());
  for (const [key, markdown] of previous) assert.equal(await readFile(join(dirname(current.path), 'history', `${key}.md`), 'utf8'), markdown);
});
