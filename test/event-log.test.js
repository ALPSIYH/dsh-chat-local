import test from "node:test";
import assert from "node:assert/strict";
import { createEvent, serializeEvent, verifyChain, EVENT_LOG_VERSION } from "../lib/event-log.js";

test("an event carries version, provenance and a hash over its own content", () => {
  const event = createEvent({
    type: "message.created", tick: 7, at: 1_700_000_000_000,
    actor: { kind: "session", id: "s1" },
    payload: { messageId: "m1", text: "你好" },
    causes: ["m0"],
    provenance: { originClass: "agent", sessionKind: "interactive", roomId: "r1" }
  });
  assert.equal(event.v, EVENT_LOG_VERSION);
  assert.equal(event.tick, 7);
  assert.equal(typeof event.id, "string");
  assert.equal(event.prev, null);
  assert.equal(typeof event.hash, "string");
  assert.equal(event.hash.length, 64);
});

test("serialization is one line and round-trips", () => {
  const event = createEvent({ type: "t", actor: { kind: "human", id: "human:me" },
    payload: { text: "多行\n内容" }, provenance: { roomId: "r1" } });
  const line = serializeEvent(event);
  assert.ok(!line.includes("\n"));
  assert.deepEqual(JSON.parse(line).payload, { text: "多行\n内容" });
});

test("a tampered event breaks the chain at its index", () => {
  const a = createEvent({ type: "a", actor: { kind: "human", id: "human:me" }, payload: {}, provenance: { roomId: "r" } });
  const b = createEvent({ type: "b", actor: { kind: "human", id: "human:me" }, payload: {}, provenance: { roomId: "r" }, prev: a.hash });
  const c = createEvent({ type: "c", actor: { kind: "human", id: "human:me" }, payload: {}, provenance: { roomId: "r" }, prev: b.hash });
  assert.deepEqual(verifyChain([a, b, c]), { ok: true, brokenAt: null });
  const tampered = { ...b, payload: { sneaky: true } };
  assert.deepEqual(verifyChain([a, tampered, c]), { ok: false, brokenAt: 1 });
});

test("a serialized line verifies after read-back even with an undefined-valued key", () => {
  const event = createEvent({ type: "a", actor: { kind: "human", id: "human:me" },
    payload: { x: undefined }, provenance: { roomId: "r" } });
  assert.deepEqual(verifyChain([JSON.parse(serializeEvent(event))]), { ok: true, brokenAt: null });
});
