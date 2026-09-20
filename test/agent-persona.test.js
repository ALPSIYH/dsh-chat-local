import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentPersonas } from '../lib/agent-persona.js';

test('personality is a persistent Markdown document keyed by identity, with conflict detection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dcl-persona-'));
  try {
    const personas = new AgentPersonas(join(directory, 'rooms.json'));
    const original = await personas.read({ id: 'person-one', alias: 'A' });
    assert.equal(original.configured, false);
    assert.equal(await readFile(original.path, 'utf8'), original.markdown);
    const markdown = '# Personality\n\nCareful, direct, curious.\n';
    const saved = await personas.save({ id: 'person-one', alias: 'A' }, { markdown, expectedHash: original.hash });
    assert.notEqual(saved.hash, original.hash);
    assert.equal(saved.configured, true);
    assert.equal((await personas.read({ id: 'person-one', alias: 'Renamed' })).markdown, markdown);
    assert.equal((await new AgentPersonas(join(directory, 'rooms.json')).read({ id: 'person-one', alias: 'B' })).hash, saved.hash);
    await assert.rejects(personas.save({ id: 'person-one' }, { markdown: 'stale overwrite', expectedHash: original.hash }), /changed/);
    const other = await personas.read({ id: 'person-two', alias: 'A' });
    assert.notEqual(other.path, saved.path);
    assert.equal(other.configured, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('two personality edits with the same version cannot both succeed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dcl-persona-'));
  try {
    const personas = new AgentPersonas(join(directory, 'rooms.json'));
    const agent = { id: '../same-person', alias: 'A' };
    const old = await personas.read(agent);
    assert.ok(old.path.startsWith(join(directory, 'agents')));
    const writes = await Promise.allSettled(['one', 'two'].map(markdown => personas.save(agent, { markdown, expectedHash: old.hash })));
    assert.equal(writes.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(writes.filter(x => x.status === 'rejected').length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('editing template prose activates personality even if its internal marker remains', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dcl-persona-edit-'));
  try {
    const personas = new AgentPersonas(join(directory, 'rooms.json'));
    const agent = { id: 'person' };
    const pristine = await personas.read(agent);
    const edited = pristine.markdown.replace('尚未設定。', '保持審慎；直接指出證據缺口。');
    await writeFile(pristine.path, edited);
    assert.equal((await personas.read(agent)).configured, true, 'ordinary direct Markdown edits must take effect');
    await writeFile(pristine.path, pristine.markdown);
    const saved = await personas.save(agent, { markdown: edited, expectedHash: pristine.hash });
    assert.equal(saved.configured, true);
    assert.ok(!saved.markdown.includes('<!-- persona:unconfigured -->'));
    const reverted = await personas.save(agent, { markdown: pristine.markdown, expectedHash: saved.hash });
    assert.equal(reverted.configured, false, 'saving an unchanged template must not invent a configured personality');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
