import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const PATH_FIELD = /^(?:path|paths|file|files|file_path|filePath|filename|directory|dir|cwd|root|target|url|uri)$/u;
const contains = (directory, target) => {
  const child = relative(directory, target);
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
};
const physical = path => { try { return realpathSync.native(path); } catch { return resolve(path); } };

function strings(value, pathsOnly = false, key = '', seen = new Set()) {
  if (typeof value === 'string') return !pathsOnly || !key || PATH_FIELD.test(key) ? [value] : [];
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  return Array.isArray(value) ? value.flatMap(item => strings(item, pathsOnly, key, seen))
    : Object.entries(value).flatMap(([name, item]) => strings(item, pathsOnly, name, seen));
}

/** Match native literal paths; URL-capable network tools opt into URL semantics. */
export function referencesPrivateState(args, { statePath, cwd = process.cwd(), urlArguments = false }) {
  const directories = [resolve(dirname(statePath)), resolve(homedir(), '.dsh', 'dsh-chat-local')];
  const roots = directories.map(directory => ({ directory, realDirectory: physical(directory) }));
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
      // dsh-fs-local treats file_path literally: neither a scheme nor '~'
      // removes this candidate. Normalize '..' before following symlinks,
      // in the same order as the host's resolveLocalTarget.
      paths.push(value);
      // Some other allowlisted readers accept URI/home notation. Check those
      // interpretations too, without discarding the native literal target.
      if (/^file:/iu.test(value)) { try { paths.push(fileURLToPath(value)); } catch {} }
      if (value === '~' || value.startsWith('~/')) paths.push(homedir() + value.slice(1));
    }
    return paths.some(path => {
      const absolute = resolve(workingDirectory, path);
      return roots.some(({directory, realDirectory}) => contains(directory, absolute) || contains(realDirectory, physical(absolute)));
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
