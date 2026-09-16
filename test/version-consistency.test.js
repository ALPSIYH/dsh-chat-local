import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
