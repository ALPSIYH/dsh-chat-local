import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DshChatLocalService } from '../lib/room-store.js';

const modules = process.env.DSH_MODULES_DIR;
const options = { skip: !modules ? 'set DSH_MODULES_DIR to run the installed native filesystem tools'
  : process.platform === 'win32' && 'POSIX physical parent traversal fixture' };
const host = name => import(pathToFileURL(join(modules, '@deepseek-ai', name, 'lib/index.js')));

test('installed native read cannot reach private room state through physical parent traversal', options, async t => {
  const [{ Context }, { default: SystemPrompt }, { default: Tools }, { LocalFileSystem }, toolFs] = await Promise.all([
    host('cordis'), host('dsh-system-prompt'), host('dsh-tools'), host('dsh-fs-local'), host('dsh-tool-fs'),
  ]);
  const directory = await mkdtemp(join(tmpdir(), 'dcl-native-read-'));
  const workspace = join(directory, 'work'), store = join(directory, 'store'), path = join(store, 'rooms.json');
  const ctx = new Context(), service = new DshChatLocalService({}, { path });
  t.after(async () => { await ctx.fiber.dispose(); await service.close(); await rm(directory, { recursive: true, force: true }); });
  await service.ready;
  const marker = 'private-room-marker-never-returned';
  await service.createRoom({ name: marker, autoDeliver: false });
  await mkdir(workspace); await mkdir(join(store, 'sub'));
  await symlink(join(store, 'sub'), join(workspace, 'via'));
  await writeFile(join(workspace, 'rooms.json'), 'public-control');
  await ctx.plugin(SystemPrompt, {});
  await ctx.plugin(Tools, {});
  await ctx.plugin(LocalFileSystem, { cwd: workspace, diffBasisMaxBytes: 1024 * 1024 });
  await ctx.plugin(toolFs, { readLimit: 2000, readMaxLineLength: 2000, readMaxBytes: 100000, readStreamMinSize: 1000000 });
  ctx.tools.guard(execution => service.guardToolExecution(execution));
  let call = 0;
  const invoke = (file_path, cwd) => ctx.tools.execute({
    name: 'read', arguments: { file_path }, callId: `read-${call++}`, signal: new AbortController().signal,
    agent: { session: { id: 'reader', header: { cwd } } },
  });
  const privateTargets = [
    [path, workspace],
    ['via/../rooms.json', workspace],
    [workspace + '/via/../rooms.json', workspace],
    ['../rooms.json', join(workspace, 'via')],
    ['rooms.json', workspace + '/via/..'],
  ];
  // Establish the oracle using the actual provider before installing a room
  // policy. On POSIX all spellings reach private data; the public file is a
  // deliberate decoy for a guard that only performs lexical normalization.
  if (process.platform !== 'win32') {
    for (const [input, cwd] of privateTargets) {
      const target = await ctx.fs.resolve(input, { cwd });
      assert.match(await ctx.fs.readText(target), new RegExp(marker), `${input} from ${cwd}`);
    }
  }
  for (const actionMode of ['discuss_only', 'read_only_audit']) {
    service.policyLocks.set('reader', { active: true, actionMode, roomId: 'restricted' });
    for (const [input, cwd] of privateTargets) {
      const result = await invoke(input, cwd);
      assert.equal(result.isError, true, `${actionMode}: ${input} from ${cwd}`);
      assert.match(JSON.stringify(result), /受限模式/);
      assert.ok(!JSON.stringify(result).includes(marker));
    }
    const publicResult = await invoke(join(workspace, 'rooms.json'), workspace);
    assert.notEqual(publicResult.isError, true, `${actionMode}: public control`);
    assert.match(JSON.stringify(publicResult), /public-control/);
  }
});
