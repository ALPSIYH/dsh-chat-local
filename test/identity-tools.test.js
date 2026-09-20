import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { apply } from "../lib/index.js";
import { classifyToolExecution } from "../lib/gate.js";

async function mounted(t, config = {}, host = {}) {
  const directory = await mkdtemp(join(tmpdir(), "dcl-identity-tools-"));
  const tools = new Map();
  const hooks = new Map(), disposers = [];
  let handler;
  const ctx = {
    effect(fn) { const dispose = fn(); if (typeof dispose === "function") disposers.push(dispose); },
    on(name, listener) { hooks.set(name, listener); return () => hooks.delete(name); },
    tools: { register(tool) { tools.set(tool.name, tool); }, guard() {} },
    webServer: { register(route) { handler = route.handler; } },
    agents: { get() {} }, sessions: { get() { return { header: { cwd: directory } }; } },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async () => {} },
    get(name) { return this[name]; }, ...host
  };
  const service = apply(ctx, { path: join(directory, "rooms.json"), ...config });
  await service.ready;
  t.after(async () => { await service.close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, body, headers = {}) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.url = `/api/dsh-chat-local${path}`; req.method = body === undefined ? "GET" : "POST"; req.headers = headers;
    let code, text;
    await handler(req, { writeHead(value) { code = value; }, end(value) { text = value; } });
    return { code, ...JSON.parse(text) };
  };
  const room = await service.createRoom({ name: "Identity tools", autoDeliver: false,
    members: [{ kind: "session", sessionId: "s1", alias: "One" }, { kind: "session", sessionId: "s2", alias: "Two" }] });
  return { service, tools, room, request, hooks, disposers, execute: (name, sessionId, args = {}) =>
    tools.get(name).execute(args, { agent: { session: { id: sessionId } } }) };
}

test("personality administration uses optimistic hashes while identity tools reveal only the caller's personality", async (t) => {
  const h = await mounted(t);
  assert.equal(h.service.personalMemory, true, "personal memory defaults on");
  const first = await h.execute("chat_identity", "s1", { room: h.room.id });
  const second = await h.execute("chat_identity", "s2", { room: h.room.id });
  assert.notEqual(first.agentId, second.agentId);
  assert.equal(first.persona.path, undefined, "agent reads do not expose administration paths");
  assert.equal(first.persona.configured, false);
  const path = `/agents/${encodeURIComponent(first.agentId)}/persona`;
  const read = await h.request(path);
  assert.equal(read.code, 200); assert.equal(read.value.agentId, first.agentId);
  assert.equal(read.value.hash, first.persona.hash);
  const saved = await h.request(path, { markdown: "# Personality\nCareful with evidence.", expectedHash: read.value.hash });
  assert.equal(saved.code, 200, saved.error); assert.equal(saved.value.configured, true);
  assert.notEqual(saved.value.hash, read.value.hash);
  const conflict = await h.request(path, { markdown: "# Stale overwrite", expectedHash: read.value.hash });
  assert.equal(conflict.code, 409);
  assert.equal((await h.execute("chat_identity", "s1")).persona.markdown, saved.value.markdown);
  assert.notEqual((await h.execute("chat_identity", "s2")).persona.markdown, saved.value.markdown);
  const crossSite = await h.request(path, { markdown: "# Forged", expectedHash: saved.value.hash }, { "sec-fetch-site": "cross-site" });
  assert.equal(crossSite.code, 403);
  assert.equal((await h.request(path)).value.markdown, saved.value.markdown);
  assert.ok(![...h.tools.keys()].some(name => /persona|identity.*(?:save|edit)/u.test(name)), "no model-callable personality mutation tool");
});

test("personal recall isolates observation receipts and refuses arbitrary identity arguments", async (t) => {
  const h = await mounted(t);
  const identities = await Promise.all(["s1", "s2"].map(session => h.execute("chat_identity", session)));
  for (const [index, identity] of identities.entries()) {
    const written = await h.service.eventLog.append(h.room.id, { type: "memory.observed", tick: 1,
      actor: { kind: "system", id: "system" }, provenance: { roomId: h.room.id },
      payload: { observerAgentId: identity.agentId, items: [{ id: `private-${index}`, text: `Private observed content ${index}` }] } });
    assert.ok(written);
  }
  const recalled = await h.execute("chat_recall", "s1", { query: "Private", limit: 1 });
  assert.equal(recalled.agentId, identities[0].agentId);
  assert.equal(recalled.experiences.length, 1);
  assert.equal(recalled.experiences[0].text, "Private observed content 0");
  assert.doesNotMatch(JSON.stringify(recalled), /Private observed content 1/u);
  for (const name of ["chat_identity", "chat_recall"]) {
    assert.equal(h.tools.get(name).parameters.additionalProperties, false);
    assert.equal(h.tools.get(name).parameters.properties.agentId, undefined);
    await assert.rejects(h.execute(name, "s1", { agentId: identities[1].agentId }), /unsupported personal memory argument/u);
    await assert.rejects(h.tools.get(name).execute({}, {}), /owning DSH session/u);
    await assert.rejects(h.execute(name, "outsider", { room: h.room.id }), /member/u);
    assert.deepEqual(classifyToolExecution(name, {}), { riskClass: "low", action: "read" });
  }
  for (const limit of [0, 101, 1.5, "2"]) await assert.rejects(h.execute("chat_recall", "s1", { limit }), /limit/u);
  await assert.rejects(h.execute("chat_recall", "s1", { query: 1 }), /query/u);
});

test("a native session with multiple identities must disambiguate through its own room membership", async (t) => {
  const h = await mounted(t, { personalMemory: false });
  assert.equal(h.service.personalMemory, false);
  const other = await h.service.createRoom({ name: "Other identity", autoDeliver: false,
    members: [{ kind: "session", sessionId: "s1", alias: "Another person" }] });
  for (const name of ["chat_identity", "chat_recall"]) {
    await assert.rejects(h.execute(name, "s1"), /unambiguous Agent identity/u);
    const original = await h.execute(name, "s1", { room: h.room.name });
    const alternate = await h.execute(name, "s1", { room: other.id });
    assert.notEqual(original.agentId, alternate.agentId);
    await assert.rejects(h.execute(name, "s2", { room: other.id }), /member/u);
  }
});

test("native prompt context is optional and its event registration is disposed", async (t) => {
  const absent = await mounted(t);
  assert.equal(absent.hooks.has("system-prompt/assemble"), false);
  const h = await mounted(t, {}, { get(name) { return name === "systemPrompt" ? {} : this[name]; } });
  assert.equal(h.hooks.has("system-prompt/assemble"), true);
  for (const dispose of h.disposers) await dispose();
  assert.equal(h.hooks.has("system-prompt/assemble"), false);
});

test("native context awaits other providers and passes personality Markdown as a literal variable", async (t) => {
  const h = await mounted(t, {}, { systemPrompt: {} });
  const identity = await h.execute("chat_identity", "s1");
  const markdown = "# Personality\nKeep literal {{secret}} and {{unknown_variable}} syntax.";
  const saved = await h.request(`/agents/${encodeURIComponent(identity.agentId)}/persona`, {
    markdown, expectedHash: identity.persona.hash
  });
  assert.equal(saved.code, 200);
  const hook = h.hooks.get("system-prompt/assemble");
  const priorContext = { name: "host", text: "Existing context" };
  const assembly = { contexts: [], variables: {} };
  const result = { contexts: [priorContext], variables: { secret: "must not expand", host_value: "kept" } };
  let nextCalls = 0;
  const returned = await hook(assembly, { agent: { session: { id: "s1" } } }, async () => {
    nextCalls++; await Promise.resolve(); return result;
  });
  assert.equal(nextCalls, 1);
  assert.equal(returned, result);
  assert.deepEqual(assembly, { contexts: [], variables: {} }, "uses the completed provider result");
  assert.equal(result.contexts[0], priorContext);
  assert.equal(result.variables.host_value, "kept");
  assert.deepEqual(result.contexts[1], { name: "dsh-chat-local:person", text: "{{dsh_chat_person_context}}" });
  assert.ok(result.variables.dsh_chat_person_context.includes(markdown));
  assert.doesNotMatch(result.contexts[1].text, /secret|unknown_variable/u,
    "user Markdown is never inserted into the host template source");
  for (const context of [{}, { agent: { session: { id: "unbound" } } }]) {
    const unchanged = { contexts: [], variables: {} };
    assert.equal(await hook(assembly, context, async () => unchanged), unchanged);
    assert.deepEqual(unchanged, { contexts: [], variables: {} });
  }
});
