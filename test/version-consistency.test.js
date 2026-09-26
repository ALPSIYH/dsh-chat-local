import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { apply } from "../lib/index.js";

const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const changelog = await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8");

/** Boot the real plugin against one temporary state file and return its HTTP handler. */
async function boot(t) {
  const directory = await mkdtemp(join(tmpdir(), "dsh-version-"));
  const disposers = [];
  let handler;
  apply({
    effect(fn) { const dispose = fn(); if (typeof dispose === "function") disposers.push(dispose); },
    on() {},
    tools: { register() {}, guard() {} },
    webServer: { register(route) { handler = route.handler; } },
    sessionTitle: { get() {} },
    sessions: { get() { return { header: { cwd: directory } }; } },
    agents: { get() {} },
    dshBridge: { status: async () => ({ state: "idle" }) },
    get(name) { return this[name]; }
  }, { path: join(directory, "rooms.json") });
  t.after(async () => {
    for (const dispose of disposers.reverse()) await dispose();
    await rm(directory, { recursive: true, force: true });
  });
  /** One real request through the plugin's own handler, status and headers intact. */
  const raw = async (path, { method = "GET", body, ifNoneMatch } = {}) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.url = `/api/dsh-chat-local${path}`; req.method = method;
    req.headers = ifNoneMatch === undefined ? {} : { "if-none-match": ifNoneMatch };
    const result = {};
    await handler(req, { writeHead(status, headers) { Object.assign(result, { status, headers }); },
      end(text) { result.body = text; } });
    return result;
  };
  const request = async (path, options) => {
    const result = await raw(path, options);
    assert.equal(result.status, 200, result.body);
    return JSON.parse(result.body).value;
  };
  return { request, raw, directory };
}

test("the health endpoint reports the version declared in package.json, not a copied literal", async (t) => {
  const { request } = await boot(t);
  const health = await request("/health");
  assert.equal(health.status, "ok");
  assert.equal(health.name, manifest.name);
  assert.equal(health.version, manifest.version, "health must report the manifest version so the two cannot drift");
});

test("health reports the audit side channel and the state version", async (t) => {
  // `boot` already exists in this file and boots the real plugin against a
  // temporary state file; reuse it instead of writing a second one.
  const { request } = await boot(t);
  const health = await request("/health");
  assert.equal(health.status, "ok");
  assert.equal(health.stateVersion, 17);
  assert.equal(typeof health.audit.appended, "number");
  assert.equal(typeof health.audit.failed, "number");
});

test("health's ETag ignores the volatile audit counters, so a conditional GET still answers 304", async (t) => {
  const { request, raw } = await boot(t);
  const before = await request("/health");
  assert.equal(before.audit.appended, 0);
  const etag = (await raw("/health")).headers.etag;
  assert.ok(etag, "a read response carries an ETag");
  // One real profile edit appends a message.created, which moves the monotonic
  // counters. They only ever climb, so hashing them into the tag would make it
  // change on every logged event and no conditional GET could ever return 304.
  const room = await request("/rooms", { method: "POST", body: { name: "條件", autoDeliver: false } });
  await request(`/rooms/${room.id}/profile`, { method: "POST",
    body: { charter: "新章程", expectedRevision: room.profile.revision } });
  const after = await request("/health");
  assert.ok(after.audit.appended >= 1, "the edit must have been audited");
  const afterRaw = await raw("/health");
  assert.equal(afterRaw.headers.etag, etag, "an audit write must not change what the body is identified by");
  const unchanged = await raw("/health", { ifNoneMatch: etag });
  assert.equal(unchanged.status, 304);
  assert.equal(unchanged.body, undefined);
});

test("the package manifest declares the DeepSeek Harness range it is built against", () => {
  const range = manifest.dsh?.engines?.dsh;
  assert.equal(typeof range, "string");
  assert.ok(range.trim().length > 0, "dsh.engines.dsh must not be blank");
  // A lower bound is what installers compare against; a bare "*" would defeat the gate.
  assert.match(range, />=|>|\^|~/, "declare a comparable range, not a wildcard");
});

test("the README states the same DeepSeek Harness version the manifest declares", () => {
  const range = manifest.dsh.engines.dsh;
  const declared = range.replace(/^[\s>^~=v]+/, "").trim().split(/\s+/)[0];
  assert.ok(
    readme.includes(`\`${declared}\``),
    `README must name the declared DSH version \`${declared}\` so the prose and the machine-readable range agree`
  );
});

test("the README's offline-verification promise names an entry point that is shipped", async () => {
  // `verifyChain`'s only production caller validates an *imported* snapshot, so
  // the README may promise offline verification of the live log only while the
  // entry point it names actually exists.
  assert.match(readme, /scripts\/verify-event-log\.mjs/, "name the offline verifier in the README");
  await access(new URL("../scripts/verify-event-log.mjs", import.meta.url));
});

test("/health publishes a path-free audit error and names the record it dropped", async (t) => {
  const { request, directory } = await boot(t);
  // Occupy the events directory with a file: the next audit append fails exactly
  // as the leak was reported, ENOTDIR with an absolute path in the raw message.
  await writeFile(join(directory, "events"), "not a directory");
  const room = await request("/rooms", { method: "POST", body: { name: "洩漏", autoDeliver: false } });
  await request(`/rooms/${room.id}/profile`, { method: "POST",
    body: { charter: "新章程", expectedRevision: room.profile.revision } });
  const health = await request("/health");
  assert.equal(typeof health.audit.lastError, "string");
  // /health answers unauthenticated on loopback, so the absolute path must not
  // be part of what it reports.
  assert.ok(!health.audit.lastError.includes("/"), health.audit.lastError);
  assert.ok(!health.audit.lastError.includes(directory), health.audit.lastError);
  assert.match(health.audit.lastError, /^ENOTDIR/);
  // The dropped append is named, not only counted: the operator can tell which
  // record has no event for it.
  assert.equal(health.audit.droppedCount >= 1, true);
  const gap = health.audit.dropped.at(-1);
  assert.equal(gap.roomId, room.id);
  assert.equal(gap.type, "message.created");
  assert.equal(typeof gap.messageId, "string");
});

test("the CHANGELOG's newest release is the version the manifest publishes", () => {
  const first = changelog.match(/^##\s*\[([^\]]+)\]/m);
  assert.ok(first, "CHANGELOG must open with a released version heading");
  assert.equal(first[1], manifest.version, "record the released version in CHANGELOG before publishing it");
});

test("the lockfile records the version the manifest publishes", async () => {
  const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
  assert.equal(lock.version, manifest.version, "regenerate the lockfile after a version bump");
  assert.equal(lock.packages?.[""]?.version, manifest.version, "the root package entry must match too");
});

test("no tracked file leaks a personal absolute path", async () => {
  // A home directory with a real user name in it is a personal identifier; the
  // placeholder names used by tests and examples are not. This is checked
  // because such a path is invisible to a plain keyword search for the author.
  const placeholders = new Set(["example", "another", "your", "you", "me", "username", "user"]);
  const homePath = /\/(?:Users|home)\/([A-Za-z0-9._-]+)/g;
  // Walk every file in the repository rather than a hand-listed set of roots and
  // extensions: the previous version skipped subdirectories and anything that was
  // not js/mjs/md/json/yml, which is exactly where a personal path can hide
  // (LICENSE, .gitignore, a nested *.d.ts or a future docs/ directory).
  // Scratch directories that the root .gitignore lists, so the repository never
  // tracks or publishes them: `.superpowers/` and `.worktrees/` are ignored
  // explicitly there (`.git` and `node_modules/` likewise cannot be tracked).
  // The guard's claim is about tracked files, and an agent's own working notes
  // legitimately name the checkout they are working in; scanning them only
  // produces noise. The skip is justified by those ignore rules, not assumed.
  const SKIP_DIRECTORIES = new Set(["node_modules", ".git", ".superpowers", ".worktrees"]);
  const files = [];
  async function walk(directory, prefix) {
    for (const entry of await readdir(new URL(directory, import.meta.url), { withFileTypes: true })) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      if (entry.isDirectory()) await walk(`${directory}${entry.name}/`, `${prefix}${entry.name}/`);
      else if (entry.isFile()) files.push(`../${prefix}${entry.name}`);
    }
  }
  await walk("../", "");
  const leaks = [];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    for (const match of source.matchAll(homePath)) {
      if (!placeholders.has(match[1])) leaks.push(`${file.replace("../", "")}: ${match[0]}`);
    }
  }
  assert.deepEqual(leaks, [], `personal paths must not be committed:\n${leaks.join("\n")}`);
});

test("no source file hardcodes a plugin release version", async () => {
  const files = ["../lib/index.js", "../lib/client.js", "../lib/room-store.js", "../lib/native-conversations.js"];
  // Match any release literal, not just the current one: the drift worth
  // guarding against is a stale copy of a *previous* version.
  const releaseLiteral = /\d+\.\d+\.\d+-local\.\d+/;
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    const found = source.match(releaseLiteral);
    assert.equal(
      found, null,
      `${file} must not hardcode a release version (found ${found?.[0]}); read it from the manifest instead`
    );
  }
});
