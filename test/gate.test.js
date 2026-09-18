import test from "node:test";
import assert from "node:assert/strict";
import { apply } from "../lib/index.js";
import {
  GATE_ACTIONS,
  GATE_RISK_CLASSES,
  GATE_TOOL_CLASSES,
  GATE_UNCLASSIFIED_TOOL,
  classifyToolExecution,
  evaluateGate
} from "../lib/gate.js";

/**
 * The gate is a pure judgement about one tool execution, taken while a member of
 * a room is about to act. These tests call it directly with hand-built counters,
 * which is the only way to pin each rule: the store's own path is exercised
 * separately, but the rules themselves are decided here.
 *
 * The pair is always "the acting member as target" — the counters recorded
 * against them — so a fixture below is simply a counter snapshot.
 */
const PAIR = (counters = {}) => ({ observer: "s1", target: "s1", counters: { ...counters } });

const ON = { gate: true };
const OFF = { gate: false };

/** The four judgements, as the plan names them. */
const JUDGEMENTS = ["allow", "require_confirmation", "require_independent_review", "deny"];

test("a room that has not turned the gate on is never withheld, whatever its counters say", () => {
  const worst = PAIR({ unresolvedDisagreements: 5, deliveryFailures: 9, deliverySuccesses: 0 });
  for (const policy of [OFF, {}, undefined, { gate: "yes" }, { gate: 1 }]) {
    assert.equal(evaluateGate({ pair: worst, action: "execute", riskClass: "high", policy }), "allow");
    assert.equal(evaluateGate({ pair: worst, action: "review", riskClass: "low", policy }), "allow");
  }
});

test("a high-impact action by a member the room could never reach requires confirmation", () => {
  const once = { deliveryFailures: 1, deliverySuccesses: 0 };
  assert.equal(evaluateGate({ pair: PAIR(once), action: "execute", riskClass: "high", policy: ON }),
    "require_confirmation");
  // The rule is "failed, and never succeeded": a member whose delivery has
  // succeeded is reachable, so the same failures no longer hold the action.
  assert.equal(evaluateGate({ pair: PAIR({ ...once, deliverySuccesses: 1 }), action: "execute", riskClass: "high", policy: ON }),
    "allow");
  assert.equal(evaluateGate({ pair: PAIR({ deliveryFailures: 0, deliverySuccesses: 0 }), action: "execute", riskClass: "high", policy: ON }),
    "allow");
  // A low-impact action is not what this rule is for.
  assert.equal(evaluateGate({ pair: PAIR(once), action: "read", riskClass: "low", policy: ON }), "allow");
});

test("a review action by a member with an unresolved disagreement requires an independent reviewer", () => {
  assert.equal(evaluateGate({ pair: PAIR({ unresolvedDisagreements: 1 }), action: "review", riskClass: "low", policy: ON }),
    "require_independent_review");
  assert.equal(evaluateGate({ pair: PAIR({ unresolvedDisagreements: 0 }), action: "review", riskClass: "low", policy: ON }),
    "allow");
  // Only a review is a review: the same member may still do other room work.
  assert.equal(evaluateGate({ pair: PAIR({ unresolvedDisagreements: 1 }), action: "work", riskClass: "low", policy: ON }),
    "allow");
});

test("when both rules hold, the independent reviewer is the one that wins", () => {
  // A review that is also high impact: the confirmation path would let the
  // member proceed on the user's word, which does not cure a self-review. The
  // stronger, more specific remedy therefore decides the judgement.
  const both = PAIR({ unresolvedDisagreements: 2, deliveryFailures: 3, deliverySuccesses: 0 });
  assert.equal(evaluateGate({ pair: both, action: "review", riskClass: "high", policy: ON }),
    "require_independent_review");
});

test("the gate fails closed on a judgement it cannot classify", () => {
  const clean = PAIR({});
  for (const input of [
    { riskClass: "extreme", action: "execute" },
    { riskClass: undefined, action: "execute" },
    { riskClass: null, action: "execute" },
    { riskClass: "high", action: "approve" },
    { riskClass: "high", action: undefined },
    { riskClass: undefined, action: undefined }
  ]) {
    assert.equal(evaluateGate({ pair: clean, policy: ON, ...input }), "deny", JSON.stringify(input));
    // No pair either: an unclassifiable action is refused on its own, not
    // because of anything recorded about a member.
    assert.equal(evaluateGate({ pair: undefined, policy: ON, ...input }), "deny", JSON.stringify(input));
  }
  // The off switch comes first: even an unreadable judgement is not the gate's
  // business in a room that has not enabled it.
  assert.equal(evaluateGate({ pair: clean, riskClass: "extreme", action: "approve", policy: OFF }), "allow");
});

test("an absent counter snapshot is not evidence against a member", () => {
  // The rules fire on what the room recorded. A snapshot that is missing, is
  // not a counter table, or does not carry the field at all establishes
  // nothing, and the gate does not invent a fact about a member from that.
  assert.equal(evaluateGate({ pair: undefined, action: "execute", riskClass: "high", policy: ON }), "allow");
  assert.equal(evaluateGate({ pair: PAIR(), action: "review", riskClass: "low", policy: ON }), "allow");
  assert.equal(evaluateGate({ pair: { observer: "s1", target: "s1" }, action: "execute", riskClass: "high", policy: ON }), "allow");
  assert.equal(evaluateGate({ pair: { counters: "not a table" }, action: "execute", riskClass: "high", policy: ON }), "allow");
  assert.equal(evaluateGate({ pair: { counters: [1, 2] }, action: "execute", riskClass: "high", policy: ON }), "allow");
  // A field that is not a number is not a count either.
  assert.equal(evaluateGate({ pair: PAIR({ deliveryFailures: "3", deliverySuccesses: "0" }), action: "execute", riskClass: "high", policy: ON }),
    "allow");
  assert.equal(evaluateGate({ pair: PAIR({ unresolvedDisagreements: "1" }), action: "review", riskClass: "low", policy: ON }),
    "allow");
  assert.equal(evaluateGate({ pair: PAIR({ unresolvedDisagreements: 1 }), action: "review", riskClass: "low", policy: ON }),
    "require_independent_review", "the fixture must be able to fail this rule");
});

test("the judgement is a deterministic function of its input and writes nothing to it", () => {
  const pair = Object.freeze({ observer: "s1", target: "s1",
    counters: Object.freeze({ deliveryFailures: 1, deliverySuccesses: 0, unresolvedDisagreements: 2 }) });
  const input = Object.freeze({ pair, action: "review", riskClass: "high", policy: Object.freeze({ gate: true }) });
  const first = evaluateGate(input);
  const second = evaluateGate(input);
  assert.equal(first, second);
  assert.equal(first, "require_independent_review");
  assert.ok(JUDGEMENTS.includes(first));
  // Frozen input: a write would have thrown above, and nothing was left behind.
  assert.deepEqual(pair.counters, { deliveryFailures: 1, deliverySuccesses: 0, unresolvedDisagreements: 2 });
});

test("the tool table classifies every registered tool and is itself well-formed", () => {
  const seen = new Set();
  for (const [name, entry] of GATE_TOOL_CLASSES) {
    assert.equal(typeof name, "string");
    assert.ok(name.length > 0, "a table key is a tool name");
    assert.ok(GATE_RISK_CLASSES.includes(entry.riskClass), `${name} has a known risk class`);
    assert.ok(GATE_ACTIONS.includes(entry.action), `${name} has a known action`);
    assert.ok(!seen.has(name), `${name} is listed once`);
    seen.add(name);
  }
  const registered = [];
  const ctx = {
    effect(fn) { const dispose = fn(); if (typeof dispose === "function") dispose(); },
    on() {},
    tools: { register(tool) { registered.push(tool.name); }, guard() {} },
    webServer: { register() {} },
    sessionTitle: { get() {} },
    sessions: { get() { return { header: { cwd: "/tmp" } }; } },
    agents: { get() {} },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async () => {} },
    get(name) { return this[name]; }
  };
  apply(ctx, { path: "/tmp/dcl-gate-table-check/rooms.json" });
  assert.ok(registered.length > 0, "the plugin must register tools for this check to mean anything");
  for (const name of registered) {
    assert.ok(GATE_TOOL_CLASSES.has(name), `the gate table does not classify the plugin's own tool ${name}`);
  }
});

test("a tool execution becomes a risk class and an action, or nothing the gate can read", () => {
  assert.deepEqual(classifyToolExecution("bash", {}), { riskClass: "high", action: "execute" });
  assert.deepEqual(classifyToolExecution("read", {}), { riskClass: "low", action: "read" });
  assert.deepEqual(classifyToolExecution("chat_memory", {}), { riskClass: "low", action: "read" });
  assert.deepEqual(classifyToolExecution("chat_send", {}), { riskClass: "low", action: "work" });
  assert.deepEqual(classifyToolExecution("chat_charter_review", {}), { riskClass: "low", action: "review" });
  // `chat_work` carries its action in an argument, so the same tool is a review
  // or ordinary room work depending on what the member asked it to do.
  assert.deepEqual(classifyToolExecution("chat_work", { action: "review", verdict: "approve" }),
    { riskClass: "low", action: "review" });
  assert.deepEqual(classifyToolExecution("chat_work", { action: "progress" }), { riskClass: "low", action: "work" });
  assert.deepEqual(classifyToolExecution("chat_work", {}), { riskClass: "low", action: "work" });
  // An unlisted tool is classified conservatively, not left unreadable.
  assert.deepEqual(classifyToolExecution("some_tool_from_the_future"), GATE_UNCLASSIFIED_TOOL);
  assert.equal(GATE_UNCLASSIFIED_TOOL.riskClass, "high");
  assert.equal(GATE_UNCLASSIFIED_TOOL.unclassified, true,
    "an unlisted tool is also a possible review action");
  // A missing name cannot be classified at all.
  for (const name of ["", undefined, null, 7]) {
    assert.equal(classifyToolExecution(name, {}).riskClass, undefined);
    assert.equal(classifyToolExecution(name, {}).action, undefined);
  }
});

test("a tool the table does not name is read as a possible review as well as high impact", () => {
  const unresolved = PAIR({ unresolvedDisagreements: 1, deliveryFailures: 0, deliverySuccesses: 5 });
  // The unlisted tool's own classification, read the way the guard reads it.
  const classification = classifyToolExecution("some_tool_from_the_future", {});
  const judge = (policy, pair) => evaluateGate({ pair, policy, ...classification });
  // The member carries an open disagreement, so an action that might be a review
  // is refused: leaving a tool out of the table must not be a way to self-review.
  assert.equal(judge(ON, unresolved), "require_independent_review");
  assert.equal(judge(ON, PAIR({ unresolvedDisagreements: 0 })), "allow");
  // And the high-impact reading still holds, for a member the room cannot reach.
  assert.equal(judge(ON, PAIR({ deliveryFailures: 2, deliverySuccesses: 0 })), "require_confirmation");
  // Both hold: the independent reviewer speaks, exactly as for a named review.
  assert.equal(judge(ON, PAIR({ unresolvedDisagreements: 1, deliveryFailures: 2, deliverySuccesses: 0 })),
    "require_independent_review");
  // Table membership is what decides this: a named `execute` tool with the same
  // counters is judged by the confirmation rule alone.
  assert.equal(evaluateGate({ pair: unresolved, action: "execute", riskClass: "high", policy: ON }), "allow");
  assert.equal(evaluateGate({ pair: unresolved, action: "review", riskClass: "low", policy: ON }),
    "require_independent_review");
  // Off is still off, and no snapshot still establishes nothing about anyone.
  assert.equal(judge(OFF, unresolved), "allow");
  assert.equal(judge(ON, undefined), "allow");
});
