import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { AgentPersonas } from '../lib/agent-persona.js';

const moduleUrl = new URL('../lib/agent-persona.js', import.meta.url).href;
const agent = { id: 'persistent-person' };
const nextMarkdown = '# Personality\nCareful about evidence; direct communication.\n';
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'dcl-persona-resilience-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const statePath = join(directory, 'rooms.json');
  return { directory, statePath, personas: new AgentPersonas(statePath) };
}
function crashedWriter(statePath, stage, expectedHash) {
  const script = `
    import fs from 'node:fs';
    import {syncBuiltinESMExports} from 'node:module';
    import {basename} from 'node:path';
    import {AgentPersonas} from ${JSON.stringify(moduleUrl)};
    const statePath=${JSON.stringify(statePath)}, stage=${JSON.stringify(stage)};
    const write=fs.promises.writeFile, rename=fs.promises.rename;
    fs.promises.writeFile=async (path, data, options)=>{
      const name=basename(String(path)), history=String(path).includes('/history/');
      const kill=(stage==='initial' && name.startsWith('PERSONA.md')) || (stage==='history' && history) || (stage==='replacement' && name.startsWith('PERSONA.md.') && name.endsWith('.tmp'));
      if(kill){await write(path,String(data).slice(0,13),options);process.exit(77);}
      return write(path,data,options);
    };
    fs.promises.rename=async (...args)=>{const result=await rename(...args);if(stage==='after-rename' && basename(String(args[1]))==='PERSONA.md')process.exit(77);return result;};
    syncBuiltinESMExports();
    const personas=new AgentPersonas(statePath);
    if(stage==='initial')await personas.read(${JSON.stringify(agent)});
    else await personas.save(${JSON.stringify(agent)},{markdown:${JSON.stringify(nextMarkdown)},expectedHash:${JSON.stringify(expectedHash)}});
    process.exit(90);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 77, `fault injection must be reached: ${result.stderr}`);
}

test('process death while creating a default personality never publishes a partial configured persona', async t => {
  const h = await fixture(t);
  crashedWriter(h.statePath, 'initial');
  const reopened = await new AgentPersonas(h.statePath).read(agent);
  assert.equal(reopened.configured, false);
  assert.match(reopened.markdown, /## 穩定背景/);
  assert.match(reopened.markdown, /不要虛構經歷/);
});

for (const stage of ['history', 'replacement', 'after-rename']) test(`persona process death at ${stage} retains a complete current and recoverable old version`, async t => {
  const h = await fixture(t), original = await h.personas.read(agent);
  const first = await h.personas.save(agent, { markdown: '# Original\nPrevious stable personality.', expectedHash: original.hash });
  crashedWriter(h.statePath, stage, first.hash);
  const reopened = new AgentPersonas(h.statePath), current = await reopened.read(agent);
  assert.equal(current.markdown, stage === 'after-rename' ? nextMarkdown : first.markdown);
  if (stage !== 'after-rename') await reopened.save(agent, { markdown: nextMarkdown, expectedHash: current.hash });
  assert.equal(await readFile(join(dirname(current.path), 'history', `${first.hash}.md`), 'utf8'), first.markdown);
  assert.equal((await reopened.read(agent)).markdown, nextMarkdown);
});

test('ordinary failed persona replacement preserves current and removes its partial temporary file before retry', async t => {
  const h = await fixture(t), original = await h.personas.read(agent);
  const write = fs.promises.writeFile;
  let failed = false;
  fs.promises.writeFile = async (path, data, options) => {
    if (!failed && basename(String(path)).startsWith('PERSONA.md.') && String(path).endsWith('.tmp')) {
      failed = true; await write(path, 'partial', options); throw Object.assign(new Error('injected persona EIO'), { code: 'EIO' });
    }
    return write(path, data, options);
  };
  syncBuiltinESMExports();
  try { await assert.rejects(h.personas.save(agent, { markdown: nextMarkdown, expectedHash: original.hash }), /injected persona EIO/); }
  finally { fs.promises.writeFile = write; syncBuiltinESMExports(); }
  assert.equal((await h.personas.read(agent)).hash, original.hash);
  assert.deepEqual((await readdir(dirname(original.path))).filter(name => name.endsWith('.tmp')), []);
  assert.equal((await h.personas.save(agent, { markdown: nextMarkdown, expectedHash: original.hash })).markdown, nextMarkdown);
});

for (const kind of ['corrupt-file', 'directory', 'symlink']) test(`a ${kind} at a named persona archive cannot be silently accepted as a saved old version`, async t => {
  const h = await fixture(t), original = await h.personas.read(agent);
  const history = join(dirname(original.path), 'history');
  await mkdir(history);
  const archive = join(history, `${original.hash}.md`);
  if (kind === 'corrupt-file') await writeFile(archive, original.markdown.slice(0, 9));
  if (kind === 'directory') await mkdir(archive);
  if (kind === 'symlink') { const target = join(h.directory, 'unrelated.md'); await writeFile(target, original.markdown); await symlink(target, archive); }
  await assert.rejects(h.personas.save(agent, { markdown: nextMarkdown, expectedHash: original.hash }), /history|archive|regular|integrity/);
  assert.equal(await readFile(original.path, 'utf8'), original.markdown);
  await rm(archive, { recursive: true, force: true });
  assert.equal((await h.personas.save(agent, { markdown: nextMarkdown, expectedHash: original.hash })).markdown, nextMarkdown);
});

test('an identity directory symlink cannot give one person another person’s Markdown', async t => {
  const h = await fixture(t), other = { id: 'different-person' };
  const initial = await h.personas.read(other);
  const saved = await h.personas.save(other, { markdown: 'OTHER_PERSON_PRIVATE_PERSONALITY', expectedHash: initial.hash });
  await symlink(dirname(saved.path), dirname(h.personas.pathFor(agent.id)));
  await assert.rejects(h.personas.read(agent), /directory|symbolic|symlink/);
  assert.equal((await h.personas.read(other)).markdown, saved.markdown);
});

test('a history directory symlink does not redirect persona archives outside that person', async t => {
  const h = await fixture(t), original = await h.personas.read(agent);
  const unrelated = join(h.directory, 'unrelated'); await mkdir(unrelated);
  await symlink(unrelated, join(dirname(original.path), 'history'));
  await assert.rejects(h.personas.save(agent, { markdown: nextMarkdown, expectedHash: original.hash }), /directory|symbolic|symlink/);
  assert.deepEqual(await readdir(unrelated), []);
  assert.equal((await h.personas.read(agent)).hash, original.hash);
});

test('two initial reads never observe the other writer’s partially written template', async t => {
  const h = await fixture(t), original = fs.promises.writeFile;
  let release, reached, held = false;
  const blocked = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { reached = resolve; });
  fs.promises.writeFile = async (path, data, options) => {
    if (!held && basename(String(path)).startsWith('PERSONA.md')) {
      held = true; await original(path, String(data).slice(0, 13), options); reached(); await blocked;
      return original(path, data, { ...options, flag: 'w' });
    }
    return original(path, data, options);
  };
  syncBuiltinESMExports();
  const first = h.personas.read(agent);
  first.catch(() => {});
  try {
    await started;
    const second = await new AgentPersonas(h.statePath).read(agent);
    assert.equal(second.configured, false);
    assert.match(second.markdown, /不要虛構經歷/);
    release();
    assert.deepEqual(await first, second);
  } finally { release(); fs.promises.writeFile = original; syncBuiltinESMExports(); await first; }
});

test('invalid UTF-8 current Markdown is reported instead of silently replacing corrupted bytes', async t => {
  const h = await fixture(t), original = await h.personas.read(agent);
  const valid = '\uFEFF# 人格\n保留完整 Unicode 😀 與 BOM。';
  await writeFile(original.path, valid);
  assert.equal((await h.personas.read(agent)).markdown, valid, 'strict decoding must preserve legitimate Markdown bytes');
  await writeFile(original.path, Buffer.from([0xff]));
  await assert.rejects(h.personas.read(agent), /UTF-8|encoding/);
});

test('archive verification compares valid Markdown instead of accepting UTF-8 replacement decoding', async t => {
  const h = await fixture(t), initial = await h.personas.read(agent);
  const current = await h.personas.save(agent, { markdown: '\uFFFD', expectedHash: initial.hash });
  const archive = join(dirname(current.path), 'history', `${current.hash}.md`);
  await writeFile(archive, Buffer.from([0xff]));
  await assert.rejects(h.personas.save(agent, { markdown: nextMarkdown, expectedHash: current.hash }), /UTF-8|encoding/);
  assert.equal(await readFile(current.path, 'utf8'), current.markdown);
});
