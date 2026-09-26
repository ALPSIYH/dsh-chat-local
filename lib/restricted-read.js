import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const PATH_FIELD = /^(?:path|paths|file|files|file_path|filePath|filename|directory|dir|cwd|root|target|url|uri)$/u;
const contains = (directory, target) => {
  const child = relative(directory, target);
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
};
// Preserve symlink identity for an absent descendant as well as existing files.
// Do not interpret '..' across a missing directory: POSIX cannot traverse it.
function physical(path) {
  let ancestor = path;
  const missing = [];
  while (true) {
    try { return resolve(realpathSync.native(ancestor), ...missing); }
    catch (error) { if (error.code !== 'ENOENT') return resolve(path); }
    const parent = dirname(ancestor), name = basename(ancestor);
    if (parent === ancestor || name === '..') return resolve(path);
    missing.unshift(name);
    ancestor = parent;
  }
}

function physicalSpelling(cwd, path) {
  if (process.platform === 'win32') return resolve(cwd, path);
  const absoluteCwd = isAbsolute(cwd) ? cwd : `${process.cwd()}${sep}${cwd}`;
  // path.join/resolve would remove '..' before the filesystem follows a link.
  return isAbsolute(path) ? path : `${absoluteCwd}${sep}${path}`;
}

function strings(value, pathsOnly = false, key = '', seen = new Set()) {
  if (typeof value === 'string') return !pathsOnly || !key || PATH_FIELD.test(key) ? [value] : [];
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  return Array.isArray(value) ? value.flatMap(item => strings(item, pathsOnly, key, seen))
    : Object.entries(value).flatMap(([name, item]) => strings(item, pathsOnly, name, seen));
}

/** Match native literal paths; URL-capable network tools opt into URL semantics. */
export function referencesPrivateState(args, { statePath, cwd = process.cwd(), urlArguments = false }) {
  const directories = [dirname(statePath), resolve(homedir(), '.dsh', 'dsh-chat-local')];
  const roots = directories.map(directory => ({
    directory: resolve(directory), realDirectory: physical(physicalSpelling(process.cwd(), directory)),
  }));
  const workingDirectory = physical(cwd);
  return strings(args, true).some(value => {
    const paths = [];
    if (urlArguments) {
      // Fetch parses URLs, including http:host and backslash spellings. Its
      // public URLs are not relative files, even when cwd contains state.
      try {
        const url = new URL(value);
        if (url.protocol !== 'file:') return false;
        paths.push(fileURLToPath(url));
      } catch { paths.push(value); }
    } else {
      // Native file_path is literal: neither a scheme nor '~' removes this
      // candidate. Other allowlisted readers may also interpret URI/home forms.
      paths.push(value);
      // Some other allowlisted readers accept URI/home notation. Check those
      // interpretations too, without discarding the native literal target.
      if (/^file:/iu.test(value)) { try { paths.push(fileURLToPath(value)); } catch {} }
      if (value === '~' || value.startsWith('~/')) paths.push(homedir() + value.slice(1));
    }
    return paths.some(path => {
      // Current POSIX dsh-fs-local resolves physical parent traversal; older
      // hosts/readers normalize lexically. This synchronous guard cannot ask
      // each reader which interpretation it uses, so protect either target.
      const candidates = [
        physical(physicalSpelling(cwd, path)),
        resolve(cwd, path),
        resolve(workingDirectory, path),
      ];
      return candidates.some(absolute => roots.some(({directory, realDirectory}) =>
        contains(directory, absolute) || contains(realDirectory, physical(absolute))));
    });
  });
}

function privateV4(parts) {
  const [first, second] = parts;
  return [0, 10, 127].includes(first) || first === 192 && second === 168
    || first === 172 && second >= 16 && second <= 31 || first === 169 && second === 254;
}

/** Literal target screening only: DNS resolution and redirects belong to the host. */
export function isLocalRequestTarget(args) {
  return strings(args).some(text => [text, ...(text.match(/\bhttps?:\/\/[^\s"'`<>\\]+/giu) ?? [])].some(candidate => {
    let host;
    try {
      const url = new URL(candidate);
      if (!['http:', 'https:'].includes(url.protocol)) return false;
      host = url.hostname.toLowerCase().replace(/^\[|\]$/gu, '').replace(/\.+$/u, '');
    }
    catch { return false; }
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
    if (host === '::' || host === '::1' || /^f[cd][0-9a-f]{2}:/u.test(host) || /^fe[89ab][0-9a-f]:/u.test(host)) return true;
    const mapped = host.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/u);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      return privateV4([high >>> 8, high & 255, low >>> 8, low & 255]);
    }
    const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/u);
    return ipv4 ? privateV4(ipv4.slice(1).map(Number)) : false;
  }));
}
