import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, link, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const ARTIFACT_MAX_BYTES = 20 * 1024 * 1024;
export const ARTIFACT_BUNDLE_MAX_BYTES = 128 * 1024 * 1024;
export const artifactHash = bytes => createHash('sha256').update(bytes).digest('hex');
const hashPattern = /^[a-f0-9]{64}$/u;

function roomContents(room) {
  const contents = new Map();
  for (const artifact of room.artifacts ?? []) for (const version of artifact.versions ?? []) {
    if (!version.snapshot) continue; // Legacy previews have no immutable bytes.
    const { contentHash, size, storage } = version.snapshot;
    if (storage !== 'immutable-v1' || !hashPattern.test(contentHash) || contentHash !== version.contentHash
      || !Number.isInteger(size) || size < 0 || size > ARTIFACT_MAX_BYTES || size !== version.size) throw new Error('invalid artifact snapshot metadata');
    if (contents.has(contentHash) && contents.get(contentHash) !== size) throw new Error('conflicting artifact snapshot sizes');
    contents.set(contentHash, size);
  }
  if ([...contents.values()].reduce((sum, size) => sum + size, 0) > ARTIFACT_BUNDLE_MAX_BYTES) throw new Error('artifact snapshot bundle exceeds 128 MiB export limit');
  return contents;
}

/** Validate all bytes before writing any of them. Bundles may only contain the
 * room's registered fixed versions and must include every historical version. */
export function validateArtifactContents(room, bundle) {
  const expected = roomContents(room);
  if (bundle === undefined && expected.size === 0) return [];
  if (!Array.isArray(bundle) || bundle.length !== expected.size) throw new Error('artifact snapshot bundle is incomplete');
  const seen = new Set(), decoded = [];
  for (const item of bundle) {
    if (!item || !expected.has(item.contentHash) || seen.has(item.contentHash) || item.encoding !== 'base64'
      || item.size !== expected.get(item.contentHash) || typeof item.data !== 'string'
      || item.data.length !== Math.ceil(item.size / 3) * 4) throw new Error('invalid artifact snapshot bundle entry');
    const bytes = Buffer.from(item.data, 'base64');
    if (bytes.toString('base64') !== item.data || bytes.length !== item.size || artifactHash(bytes) !== item.contentHash) throw new Error('artifact snapshot bundle integrity check failed');
    seen.add(item.contentHash); decoded.push(bytes);
  }
  return decoded;
}

async function directory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('artifact storage must be a regular directory');
}
async function syncDirectory(path) {
  const fd = await open(path, 'r');
  try { await fd.sync(); } finally { await fd.close(); }
}

/** Content is immutable and published before its RoomJournal reference. An
 * interrupted publication can leave an unreferenced blob, never a reference
 * to a partial file. Reads verify bytes; a pathname is not integrity evidence.
 * Access belongs to the room registry, not to possession of a hash. */
export class ArtifactVersions {
  #tails = new Map();
  constructor(statePath, { capacity } = {}) {
    this.directory = join(dirname(statePath), 'artifact-content');
    this.capacity = capacity;
  }
  pathFor(hash) {
    if (!hashPattern.test(hash)) throw new Error('invalid artifact content hash');
    return join(this.directory, `${hash}.bin`);
  }
  serialize(roomId, operation) {
    const previous = this.#tails.get(roomId) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.catch(() => {});
    this.#tails.set(roomId, tail);
    void tail.then(() => { if (this.#tails.get(roomId) === tail) this.#tails.delete(roomId); });
    return result;
  }
  async exportRoom(room) {
    const bundle = [];
    for (const [contentHash, size] of roomContents(room)) {
      const bytes = await this.read(contentHash, size);
      bundle.push({ contentHash, size, encoding: 'base64', data: bytes.toString('base64') });
    }
    return bundle.length ? bundle : undefined;
  }
  async restoreRoom(room, bundle) {
    const contents = validateArtifactContents(room, bundle);
    for (const bytes of contents) await this.publish(bytes);
  }
  async read(hash, expectedSize) {
    const path = this.pathFor(hash);
    const dir = await lstat(this.directory);
    if (!dir.isDirectory() || dir.isSymbolicLink()) throw new Error('artifact storage must be a regular directory');
    const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await fd.stat();
      if (!info.isFile() || info.size > ARTIFACT_MAX_BYTES) throw new Error('artifact snapshot exceeds size limit or is not a regular file');
      const chunks = []; let size = 0;
      for (;;) {
        const buffer = Buffer.alloc(Math.min(64_000, ARTIFACT_MAX_BYTES + 1 - size));
        const { bytesRead } = await fd.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        size += bytesRead;
        if (size > ARTIFACT_MAX_BYTES) throw new Error('artifact snapshot exceeds size limit');
        chunks.push(buffer.subarray(0, bytesRead));
      }
      const bytes = Buffer.concat(chunks);
      if ((expectedSize !== undefined && size !== expectedSize) || artifactHash(bytes) !== hash) throw new Error('artifact snapshot integrity check failed');
      return bytes;
    } finally { await fd.close(); }
  }
  async publish(bytes) {
    bytes = Buffer.from(bytes);
    if (bytes.length > ARTIFACT_MAX_BYTES) throw new Error('artifact snapshot exceeds size limit');
    const hash = artifactHash(bytes), path = this.pathFor(hash);
    const write = async () => {
      await directory(this.directory);
      const temporary = join(this.directory, `.${hash}.${randomUUID()}.tmp`);
      let fd;
      try {
        fd = await open(temporary, 'wx', 0o600);
        await fd.writeFile(bytes); await fd.sync(); await fd.close(); fd = null;
        try { await link(temporary, path); await syncDirectory(this.directory); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        await this.read(hash, bytes.length);
      } finally { if (fd) await fd.close(); await unlink(temporary).catch(() => {}); }
      return { contentHash: hash, size: bytes.length, storage: 'immutable-v1' };
    };
    return this.capacity ? this.capacity.run({ peakBytes: bytes.length * 2 + 8192 }, write) : write();
  }
}
