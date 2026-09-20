import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
const unzip = promisify(gunzip);
export const coldManifestPath = logPath => `${logPath}.cold`;
export const contentHash = bytes => createHash('sha256').update(bytes).digest('hex');
export function coldManifest(body) { return {...body, checksum:contentHash(JSON.stringify(body))}; }
async function regular(path) {
  const info = await lstat(path);
  if (!info.isFile()) throw new Error('cold log source is not a regular file');
}
export async function readColdManifest(logPath) {
  const path=coldManifestPath(logPath);
  try { await regular(path); } catch(error) { if(error.code==='ENOENT')return null; throw error; }
  let value;
  try { value=JSON.parse(await readFile(path,'utf8')); } catch { throw new Error('cold log manifest is corrupt'); }
  const {checksum,...body}=value ?? {};
  const prefix=`${basename(logPath)}.cold-`;
  if(body.version!==1 || body.codec!=='gzip' || typeof body.archive!=='string'
    || body.archive!==basename(body.archive) || !body.archive.startsWith(prefix)
    || !/^[a-f0-9-]+\.gz$/.test(body.archive.slice(prefix.length))
    || !Number.isSafeInteger(body.bytes) || body.bytes<0
    || !Number.isSafeInteger(body.count) || body.count<0
    || !/^[a-f0-9]{64}$/.test(body.hash ?? '')
    || !(body.head===null || /^[a-f0-9]{64}$/.test(body.head ?? ''))
    || checksum!==contentHash(JSON.stringify(body))) throw new Error('cold log manifest is invalid');
  return Object.freeze(value);
}
/** Used by online and offline readers. Bytes/hash verification occurs before
 * any parsed event can become evidence. maxOutputLength stops a gzip bomb. */
export async function readColdLog(logPath, {maxBytes=2*1024**3} = {}) {
  const manifest=await readColdManifest(logPath);
  if(!manifest)return null;
  if(manifest.bytes>maxBytes)throw new Error('cold log exceeds the configured decompression limit');
  const archive=join(dirname(logPath),manifest.archive);await regular(archive);
  let bytes;
  try { bytes=await unzip(await readFile(archive),{maxOutputLength:Math.max(1,manifest.bytes)}); }
  catch { throw new Error('cold log archive is corrupt or exceeds its manifest length'); }
  if(bytes.length!==manifest.bytes || contentHash(bytes)!==manifest.hash)throw new Error('cold log content does not match its manifest');
  return {bytes,manifest,archive};
}
