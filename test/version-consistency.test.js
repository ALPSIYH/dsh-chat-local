import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
  return async (path) => {
    const req = Readable.from([]);
    req.url = `/api/dsh-chat-local${path}`; req.method = "GET"; req.headers = {};
    let status, body;
    await handler(req, { writeHead(code) { status = code; }, end(text) { body = JSON.parse(text); } });
    assert.equal(status, 200, body?.error);
    return body.value;
  };
}

test("the health endpoint reports the version declared in package.json, not a copied literal", async (t) => {
  const request = await boot(t);
  const health = await request("/health");
  assert.equal(health.status, "ok");
  assert.equal(health.name, manifest.name);
  assert.equal(health.version, manifest.version, "health must report the manifest version so the two cannot drift");
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
  const declared = range.replace(/^[\s>^~=v]+/, "").trim();
  assert.ok(
    readme.includes(`\`${declared}\``),
    `README must name the declared DSH version \`${declared}\` so the prose and the machine-readable range agree`
  );
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
