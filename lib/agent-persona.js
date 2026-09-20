import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const PERSONA_MAX_CHARS = 8000;
export const PERSONA_VERSION = 1;
const tails = new Map();
const fingerprint = text => createHash('sha256').update(text).digest('hex');
const absent = '<!-- persona:unconfigured -->';
const withoutMarker = text => text.replaceAll(absent, '');

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
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    try { await writeFile(path, template(agent), { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error('persona must be a regular Markdown file');
    if (info.size > PERSONA_MAX_CHARS * 4) throw new Error('persona exceeds the configured size limit');
    const markdown = await readFile(path, 'utf8');
    if (markdown.length > PERSONA_MAX_CHARS) throw new Error(`persona exceeds ${PERSONA_MAX_CHARS} characters`);
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
      await mkdir(history, { recursive: true, mode: 0o700 });
      await writeFile(join(history, `${current.hash}.md`), current.markdown, { flag: 'wx', mode: 0o600 })
        .catch(error => { if (error.code !== 'EEXIST') throw error; });
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, markdown, { mode: 0o600 });
      await rename(temporary, path);
      return this.read(agent);
    });
    const tail = operation.catch(() => {});
    tails.set(path, tail);
    try { return await operation; }
    finally { if (tails.get(path) === tail) tails.delete(path); }
  }
}
