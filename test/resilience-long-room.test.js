import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DshChatLocalService } from '../lib/room-store.js';

test('a persisted room with 150000 messages cold-loads without a variadic argument ceiling', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dcl-large-room-load-'));
  const path = join(directory, 'rooms.json');
  let service = new DshChatLocalService({}, { path });
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  await service.ready;
  const room = await service.createRoom({ name: 'long history', autoDeliver: false, members: [] });
  const version = service.stateVersion();
  await service.close();
  const state = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(state.version, version);
  const count = 150_000;
  const stored = state.rooms.find(item => item.id === room.id);
  stored.messages = Array.from({ length: count }, (_, index) => ({ id: `message-${index + 1}`, roomId: room.id,
    author: 'human:me', authorKind: 'human', text: `history ${index + 1}`, roomSeq: index + 1, sentAt: index + 1, deliveries: [] }));
  // The cached room counter may lag imported messages; normalization must scan
  // all messages and preserve their sequence instead of spreading the array.
  stored.roomSeq = 1;
  await writeFile(path, JSON.stringify(state));
  service = new DshChatLocalService({}, { path });
  await service.ready;
  const loaded = service.state.rooms.find(item => item.id === room.id);
  assert.equal(service.stateVersion(), version);
  assert.equal(loaded.messages.length, count);
  assert.equal(loaded.roomSeq, count);
  assert.equal(loaded.messages[0].text, 'history 1');
  assert.equal(loaded.messages.at(-1).roomSeq, count);
  assert.equal(loaded.messages.at(-1).text, `history ${count}`);
});
