import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";

export class DocumentReferenceError extends Error {
  constructor(code, message, { status = 404, candidates } = {}) {
    super(message);
    this.code = code;
    this.status = status;
    if (candidates) this.candidates = candidates;
  }
}

const inside = (root, target) => {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
};
const denied = () => new DocumentReferenceError("FILE_NOT_AUTHORIZED",
  "file reference is outside the authorized participant workspace and is not an exact human-shared file; share this single full path for read-only access", { status: 403 });

function readFailure(path, cause) {
  if (["ENOENT", "ENOTDIR"].includes(cause?.code)) return new DocumentReferenceError("FILE_NOT_FOUND",
    `authorized file was not found at ${path}; check whether it was moved, renamed or deleted`);
  return new DocumentReferenceError("FILE_READ_FAILED",
    `authorized file could not be read at ${path} (${cause?.code ?? "unknown filesystem error"}); check local file availability and macOS access`, { status: 422 });
}

// Filename aliases resolve only against known, already-authorized files.
// Never search directories recursively, guess versions, or authorize a parent directory.
export async function resolveDocumentReference(reference, { workspaces, sharedFiles, fallbackMember }) {
  const absolute = isAbsolute(reference);
  const filename = !absolute && basename(reference) === reference;
  const candidates = new Map();
  let failure;
  const add = item => {
    const key = item.target ?? resolve(item.path);
    if (!candidates.has(key)) candidates.set(key, item);
  };
  for (const { member, cwd } of workspaces) {
    if (typeof cwd !== "string" || !cwd) continue;
    let root;
    try { root = await realpath(cwd); }
    catch (cause) {
      if (!absolute || inside(resolve(cwd), reference)) failure ??= readFailure(cwd, cause);
      continue;
    }
    const path = absolute ? reference : resolve(root, reference);
    if (!inside(root, path) && !(absolute && inside(resolve(cwd), path))) {
      failure ??= denied(); continue;
    }
    try {
      const target = await realpath(path);
      if (!inside(root, target)) { failure = denied(); continue; }
      const info = await stat(target);
      if (!info.isFile()) {
        failure ??= new DocumentReferenceError("FILE_NOT_REGULAR", `reference is not a regular file: ${path}`, { status: 422 });
        continue;
      }
      add({ member, root, target, info, path: target, relativePath: relative(root, target) || basename(target) });
    } catch (cause) {
      const error = readFailure(path, cause);
      // A missing default cwd/filename is not a known file. Permission errors
      // must not silently select another same-name file in a different scope.
      if (error.code === "FILE_READ_FAILED") add({ member, path, error });
      if (absolute || failure?.code !== "FILE_NOT_AUTHORIZED") failure = error;
    }
  }
  for (const shared of sharedFiles) {
    if (!(absolute ? shared.path === reference : filename && basename(shared.path) === reference)) continue;
    const item = { member: fallbackMember, path: shared.path, relativePath: shared.path, shared };
    try {
      item.target = await realpath(shared.path);
      item.info = await stat(item.target);
      if (!item.info.isFile()) item.error = new DocumentReferenceError("FILE_NOT_REGULAR", `shared reference is not a regular file: ${shared.path}`, { status: 422 });
    } catch (cause) { item.error = readFailure(shared.path, cause); }
    // An unavailable shared file remains a candidate: a different live file
    // with the same name must not be substituted without a choice.
    add(item);
  }
  const matches = [...candidates.values()];
  if (matches.length > 1) {
    const choices = matches.map(item => ({ path: item.path, sessionId: item.member.sessionId,
      scope: item.shared ? "human_shared_file" : "participant_workspace", available: !item.error }));
    throw new DocumentReferenceError("FILE_REFERENCE_AMBIGUOUS",
      `multiple authorized files match "${reference}"; choose one exact full path, do not guess:\n${choices.map(item => `${item.path}${item.available ? "" : " (currently unavailable)"}`).join("\n")}`,
      { status: 409, candidates: choices });
  }
  if (matches.length === 1) {
    if (matches[0].error) throw matches[0].error;
    return matches[0];
  }
  if (failure?.code === "FILE_NOT_AUTHORIZED" || absolute) throw failure ?? denied();
  if (failure?.code === "FILE_READ_FAILED" || failure?.code === "FILE_NOT_REGULAR") throw failure;
  if (filename) throw new DocumentReferenceError("FILE_REFERENCE_UNRESOLVED",
    `no exact filename match for "${reference}" in the participant workspace or human-shared files; use the intended full path, not a guessed version`);
  throw failure ?? new DocumentReferenceError("FILE_REFERENCE_UNRESOLVED", "no available participant workspace or shared file matches this reference; use the intended full path");
}
