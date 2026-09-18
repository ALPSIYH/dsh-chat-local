import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { apply } from "../lib/index.js";

/**
 * How the runtime calls `apply` is part of `apply`'s contract.
 *
 * Cordis dispatches a plugin callback by construction when the callback is
 * constructable, and by a plain call otherwise; it reads only the init hooks off
 * a constructed instance, so the service `apply` returns is discarded. That made
 * `return service` — added so tests can drive the same instance the registry and
 * the routes use — depend on `apply` staying a hoisted `function` declaration.
 * Two natural refactors break it silently: an arrow function is not
 * constructable, and an `async` function has no prototype, so both fall to the
 * plain-call branch where the returned service becomes the plugin's effect and
 * Cordis rejects it with `TypeError: Invalid effect`. The plugin then does not
 * mount at all.
 *
 * This file pins that contract mechanically. It takes no Cordis dependency
 * (the package has none), so it reproduces the runtime's dispatch rule instead
 * of importing it; the negative controls below tie that reproduction to
 * observable JavaScript semantics rather than to a comment.
 */

// Mirrors `isConstructor` in @deepseek-ai/cordis (`lib/index.js`): constructed
// exactly when the callback has a prototype and is not an async or generator
// function.
const AsyncGeneratorFunction = async function* () {}.constructor;
const GeneratorFunction = function* () {}.constructor;
function isConstructor(callback) {
  if (!callback.prototype) return false;
  if (callback instanceof GeneratorFunction) return false;
  if (AsyncGeneratorFunction !== Function && callback instanceof AsyncGeneratorFunction) return false;
  return true;
}

/**
 * A context shaped like the one the harness hands the plugin, with one
 * deliberate difference from the other test boot helpers: `effect` applies the
 * runtime's own validation. Cordis accepts a function, `null` or `undefined`
 * as an effect and throws `Invalid effect` for anything else, so a change that
 * makes the mount return the service as an effect fails here rather than being
 * quietly ignored.
 */
function harness(directory) {
  const disposers = [];
  const registered = new Map();
  let handler, observe;
  const ctx = {
    effect(fn) {
      const effect = fn();
      if (typeof effect === "function") { disposers.push(effect); return; }
      if (effect === null || effect === undefined) return;
      throw new TypeError("Invalid effect");
    },
    on(name, fn) { assert.equal(name, "session/event"); observe = fn; },
    tools: { register(tool) { registered.set(tool.name, tool); }, guard() {} },
    webServer: { register(route) { handler = route.handler; } },
    sessionTitle: { get() {} },
    sessions: { get() { return { header: { cwd: directory } }; } },
    agents: { get() {} },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async () => {} },
    get(name) { return this[name]; }
  };
  return { ctx, registered, disposers, handler: () => handler, observe: () => observe };
}

test("the runtime's constructor dispatch mounts the plugin, whose registry and routes are live", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-plugin-mount-"));
  const h = harness(directory);
  const config = { path: join(directory, "rooms.json"), maxRounds: 1, replyTimeoutMs: 5_000 };
  // The predicate first, so the mounting call below is the branch the runtime
  // actually takes. This assertion is what fails when `apply` becomes an arrow
  // function or `async`.
  assert.equal(isConstructor(apply), true,
    "apply must stay a constructable function declaration; Cordis discards the service it returns and mounts nothing otherwise");
  try {
    // Exactly the runtime's constructor branch: `new callback(ctx, config)`.
    // The value is deliberately discarded — every assertion below reaches the
    // service only through the registry and the HTTP handler, so nothing here
    // depends on the returned service.
    new apply(h.ctx, config);
    t.after(async () => {
      for (const dispose of h.disposers.reverse()) await dispose();
      await rm(directory, { recursive: true, force: true });
    });

    for (const name of ["chat_appraise", "chat_relationships", "chat_memory"]) {
      assert.equal(typeof h.registered.get(name)?.execute, "function", `${name} is registered by the mount`);
    }
    assert.equal(typeof h.handler(), "function", "the mount registered the HTTP route");

    const request = async (path, body) => {
      const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
      req.url = `/api/dsh-chat-local${path}`;
      req.method = body === undefined ? "GET" : "POST";
      req.headers = {};
      let status, text;
      await h.handler()(req, { writeHead(code) { status = code; }, end(body2) { text = body2; } });
      assert.equal(status, 200, text);
      const parsed = JSON.parse(text);
      assert.equal(parsed.ok, true, parsed.error);
      return parsed.value;
    };
    // A room created through the route must be visible to the tool, which is the
    // one-instance property the returned service existed to give tests.
    const room = await request("/rooms", { name: "挂载检查",
      members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
    const exec = { agent: { session: { id: "s1" } } };
    const memory = await h.registered.get("chat_memory").execute({ room: room.id }, exec);
    assert.equal(memory.roomId, room.id, "the route and the tool registry share one mounted service");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the mount check has teeth: an arrow or async rewrite of apply is not constructable", async () => {
  // The negative controls, so a green mount test cannot be a tautology: the
  // predicate must reject the two shapes the review named, and such a callback
  // must genuinely fail the runtime's construction. The stand-in bodies are
  // shaped like `apply` — register effects, then return the service — but do not
  // run the real plugin, which would open the default state file under `~/.dsh`.
  const service = { close() {} };
  const arrow = (ctx) => { ctx.effect(() => () => service.close()); return service; };
  const asyncApply = async function (ctx) { ctx.effect(() => () => service.close()); return service; };
  assert.equal(isConstructor(arrow), false, "an arrow function is dispatched as a plain call, not constructed");
  assert.equal(isConstructor(asyncApply), false, "an async function has no prototype and is not constructed");
  assert.equal(isConstructor(function named() {}), true, "a function declaration is the mountable shape");
  assert.equal(isConstructor(function* generator() {}), false);
  assert.equal(isConstructor(async function* asyncGenerator() {}), false);
  // Construction of the arrow cannot even start.
  assert.throws(() => new arrow({ effect() {} }), TypeError);
  // The async rewrite is called as a plain function, so its `return service`
  // becomes the plugin's effect; the runtime accepts a function, `null` or
  // `undefined` and rejects the service, which is how the mount dies silently.
  await assert.rejects(asyncApply({ effect() {} }).then((effect) => {
    if (typeof effect === "function" || effect === null || effect === undefined) return effect;
    throw new TypeError("Invalid effect");
  }), /Invalid effect/);
});
