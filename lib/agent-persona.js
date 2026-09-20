import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile, rename, link, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const PERSONA_MAX_CHARS = 8000;
export const PERSONA_VERSION = 1;
const tails = new Map();
const fingerprint = text => createHash('sha256').update(text).digest('hex');
const absent = '<!-- persona:unconfigured -->';
const withoutMarker = text => text.replaceAll(absent, '');

async function managedDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('persona storage directory must be a regular directory, not a symlink');
}

async function regularMarkdown(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('persona must be a regular Markdown file');
  if (info.size > PERSONA_MAX_CHARS * 4) throw new Error('persona exceeds the configured size limit');
  let markdown;
  try { markdown = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(path)); }
  catch (error) {
    if (error.code !== 'ERR_ENCODING_INVALID_ENCODED_DATA') throw error;
    throw new Error('persona Markdown must be valid UTF-8; corrupted bytes were not replaced');
  }
  if (markdown.length > PERSONA_MAX_CHARS) throw new Error(`persona exceeds ${PERSONA_MAX_CHARS} characters`);
  return markdown;
}

// Publish only complete files, without replacing an existing default/archive.
// A killed writer may leave its private temporary file, never a partial target.
async function publishNew(path, markdown) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, markdown, { flag: 'wx', mode: 0o600 });
    try { await link(temporary, path); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  } finally { await unlink(temporary).catch(() => {}); }
}

function template(agent) {
  return `${absent}\n# Agent 人格\n\n身分：${String(agent.id)}\n\n## 性格與價值取向\n\n尚未設定。\n\n## 溝通偏好\n\n尚未設定。\n\n## 工作習慣\n\n尚未設定。\n\n## 穩定背景\n\n只填入使用者明確設定的背景；不要虛構經歷。\n`;
}

/** One identity owns one editable Markdown source, independent of its rooms. */
export class AgentPersonas {
  constructor(statePath) { this.directory = join(dirname(statePath), 'agents'); }

  pathFor(agentId) {
    if (typeof agentId !== 'string' || !agentId) throw new Error('agent identity is required');
    return join(this.directory, fingerprint(agentId), 'PERSONA.md');
  }

  async read(agent) {
    const path = this.pathFor(agent.id);
    await managedDirectory(this.directory);
    await managedDirectory(dirname(path));
    try { await lstat(path); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await publishNew(path, template(agent));
    }
    const markdown = await regularMarkdown(path);
    return { agentId: agent.id, version: PERSONA_VERSION, path, markdown,
      hash: fingerprint(markdown), configured: withoutMarker(markdown).trim().length > 0
        && withoutMarker(markdown).trim() !== withoutMarker(template(agent)).trim() };
  }

  async save(agent, { markdown, expectedHash } = {}) {
    if (typeof markdown !== 'string' || markdown.length > PERSONA_MAX_CHARS) throw new Error(`persona must be Markdown of at most ${PERSONA_MAX_CHARS} characters`);
    if (typeof expectedHash !== 'string' || !expectedHash) throw new Error('persona expectedHash is required');
    markdown = withoutMarker(markdown);
    const path = this.pathFor(agent.id);
    const previous = tails.get(path) ?? Promise.resolve();
    const operation = previous.then(async () => {
      const current = await this.read(agent);
      if (current.hash !== expectedHash) throw Object.assign(new Error('persona changed; read and compare before saving'), { status: 409 });
      const history = join(dirname(path), 'history');
      await managedDirectory(history);
      const archive = join(history, `${current.hash}.md`);
      await publishNew(archive, current.markdown);
      // Existing files are not proof of a complete archive. Refuse to replace
      // the current persona if its named old version is corrupt or redirected.
      if (await regularMarkdown(archive) !== current.markdown) throw new Error('persona history integrity failed; current persona was preserved');
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, markdown, { flag: 'wx', mode: 0o600 });
        await rename(temporary, path);
      } finally { await unlink(temporary).catch(() => {}); }
      return this.read(agent);
    });
    const tail = operation.catch(() => {});
    tails.set(path, tail);
    try { return await operation; }
    finally { if (tails.get(path) === tail) tails.delete(path); }
  }
}
