import test from "node:test";
import assert from "node:assert/strict";
import { RELATIONSHIP_VERSION, deriveRelationships } from "../lib/relationship.js";

/**
 * These tests build event envelopes by hand instead of driving a room, because
 * the module under test is the pure derivation: driving a room would test the
 * writer, and would make the ledger counters untestable until Task 2.2 emits
 * them. The ledger fixtures below use the payload names Task 2.2 is specified
 * to emit (`entryId`, `kind`, `action`, `status`, `ownerSessionId`,
 * `reviewerSessionId`, `verdict`, `state`, `dispositionAction`,
 * `proposerSessionId`, `replacesProposalId`), so they are the event shapes this
 * module will consume once that task lands.
 */

const ROOM = "room-1";
const OTHER_ROOM = "room-2";

/** One hand-built envelope with the fields the derivation reads. */
function event({ id, type, actor = "system:system", payload = {}, provenance = {}, causes = [], tick = 0, at = 0 }) {
  const [kind, ...rest] = actor.split(":");
  return {
    v: 1,
    id,
    at,
    tick,
    type,
    actor: { kind, id: rest.join(":") },
    payload,
    causes,
    provenance: { roomId: ROOM, actorId: rest.join(":"), ...provenance },
    prev: null,
    hash: `hash-${id}`
  };
}

/** A `message.created` envelope as `#messageEvent` writes one. */
function message({ id, author, tick, at }) {
  return event({ id, type: "message.created", actor: `session:${author}`, tick, at,
    payload: { messageId: `m-${id}`, roomSeq: tick, text: id, authorKind: "session", mentions: [] },
    provenance: { messageId: `m-${id}`, originClass: "agent" } });
}

/** A `delivery.sent` / `delivery.settled` envelope as `#deliveryEvent` writes one. */
function delivery({ id, member, status, tick, at, previous = null }) {
  return event({
    id,
    type: status === "sent" ? "delivery.sent" : "delivery.settled",
    actor: `session:${member}`,
    tick,
    at,
    payload: status === "sent"
      ? { deliveryId: `d-${id}`, member, status }
      : { deliveryId: `d-${id}`, member, status, previous, error: null },
    causes: [`m-${id}`],
    provenance: { originClass: "agent", messageId: `m-${id}` }
  });
}

/** A `ledger.transition` envelope: the shape Task 2.2 is specified to emit. */
function transition({ id, tick, at, payload }) {
  return event({ id, type: "ledger.transition", actor: "session:human", tick, at, payload });
}

/** A `charter.*` envelope; the plan names this family for superseded proposals. */
function charter({ id, tick, at, type = "charter.proposed", payload }) {
  return event({ id, type, actor: `session:${payload.proposerSessionId ?? "human"}`, tick, at, payload });
}

/**
 * Three members (o1, o2, r1) and one turn. `turn.scheduled` is the membership
 * evidence: there is no member-added event in the log today, so the recipients
 * list of a turn is the only place the log records who the room's members are.
 */
function membersEvent() {
  return event({
    id: "t8",
    type: "turn.scheduled",
    tick: 1,
    at: 8,
    payload: { rootMessageId: "m-root", epoch: 1, recipients: ["o1", "o2", "r1"],
      order: "configured", rotationStart: 0, executed: ["o2", "r1", "o1"] }
  });
}

/** A fully hand-built room: every counter has at least one contributing event. */
function log() {
  return [
    membersEvent(),
    message({ id: "t2", author: "o1", tick: 1, at: 2 }),
    message({ id: "t3", author: "o1", tick: 1, at: 3 }),
    message({ id: "t4", author: "r1", tick: 1, at: 4 }),
    delivery({ id: "t5", member: "o1", status: "sent", tick: 2, at: 5 }),
    delivery({ id: "t6", member: "o2", status: "sent", tick: 2, at: 6 }),
    delivery({ id: "t7", member: "r1", status: "sent", tick: 2, at: 7 }),
    delivery({ id: "t9", member: "o1", status: "delivered", tick: 3, at: 9, previous: "sent" }),
    delivery({ id: "t10", member: "o2", status: "failed", tick: 3, at: 10, previous: "sent" }),
    delivery({ id: "t11", member: "o2", status: "delivered", tick: 3, at: 11, previous: "failed" }),
    // The status vocabulary is wider than the two counters: superseded is read
    // and counted by neither, and it must not be mistaken for a failure.
    delivery({ id: "t12", member: "r1", status: "superseded", tick: 3, at: 12, previous: "sent" }),
    transition({ id: "t13", tick: 4, at: 13, payload: { entryId: "e1", revision: 2, kind: "task", action: "acknowledge",
      status: "in_progress", ownerSessionId: "o1", reviewerSessionId: "r1", state: null } }),
    transition({ id: "t14", tick: 4, at: 14, payload: { entryId: "e1", revision: 3, kind: "task", action: "progress",
      status: "blocked", ownerSessionId: "o1", reviewerSessionId: "r1", state: "blocked" } }),
    transition({ id: "t15", tick: 5, at: 15, payload: { entryId: "e2", revision: 1, kind: "task", action: "progress",
      status: "blocked", ownerSessionId: "o2", reviewerSessionId: "r1", state: "blocked" } }),
    transition({ id: "t16", tick: 5, at: 16, payload: { entryId: "e1", revision: 4, kind: "task", action: "submit",
      status: "in_review", ownerSessionId: "o1", reviewerSessionId: "r1", state: null } }),
    transition({ id: "t17", tick: 5, at: 17, payload: { entryId: "e1", revision: 5, kind: "task", action: "review",
      status: "in_progress", ownerSessionId: "o1", reviewerSessionId: "r1", verdict: "request_changes" } }),
    transition({ id: "t18", tick: 6, at: 18, payload: { entryId: "e2", revision: 2, kind: "task", action: "comment",
      status: "blocked", ownerSessionId: "o2", reviewerSessionId: "r1", dispositionAction: "dismiss_blocker" } }),
    transition({ id: "t19", tick: 6, at: 19, payload: { entryId: "e1", revision: 6, kind: "task", action: "review",
      status: "done", ownerSessionId: "o1", reviewerSessionId: "r1", verdict: "approve" } }),
    transition({ id: "t20", tick: 7, at: 20, payload: { entryId: "e3", revision: 1, kind: "dispute", action: "record",
      status: "open", ownerSessionId: "r1", reviewerSessionId: null } }),
    transition({ id: "t21", tick: 7, at: 21, payload: { entryId: "e3", revision: 2, kind: "dispute", action: "amend",
      status: "in_progress", ownerSessionId: "r1", reviewerSessionId: null } }),
    transition({ id: "t22", tick: 7, at: 22, payload: { entryId: "e4", revision: 1, kind: "dispute", action: "record",
      status: "resolved", ownerSessionId: "o2", reviewerSessionId: null } }),
    transition({ id: "t23", tick: 8, at: 23, payload: { entryId: "p1", revision: 1, kind: "decision", action: "record",
      status: "proposed", proposerSessionId: "o1" } }),
    charter({ id: "t24", tick: 8, at: 24, payload: { proposalId: "p2", proposerSessionId: "o2", replacesProposalId: "p1" } })
  ];
}

const ALL_ZERO = {
  deliveriesOffered: 0, deliveryFailures: 0, deliverySuccesses: 0,
  reviewsApproved: 0, reviewsChangesRequested: 0,
  blockedReports: 0, blockedConfirmed: 0, unresolvedDisagreements: 0,
  charterProposalsSuperseded: 0, messagesAuthored: 0
};

/** Counters for one (observer, target) cell, or a failure that names the cell. */
function countersFor(result, observer, target) {
  const pair = result.pairs.find((item) => item.observer === observer && item.target === target);
  assert.ok(pair, `expected a pair for ${observer} -> ${target}`);
  return pair.counters;
}

/** The counters every observer must see for one target: C counts target facts. */
function expectTarget(result, target, expected) {
  for (const observer of ["o1", "o2", "r1"]) {
    assert.deepEqual(countersFor(result, observer, target), { ...ALL_ZERO, ...expected },
      `counters for ${observer} -> ${target}`);
  }
}

/** Deterministic shuffle: a fixed permutation schedule, never Math.random. */
function shuffle(items, seed = 7) {
  const out = [...items];
  let state = seed;
  for (let index = out.length - 1; index > 0; index -= 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    const swap = state % (index + 1);
    [out[index], out[swap]] = [out[swap], out[index]];
  }
  return out;
}

test("RELATIONSHIP_VERSION is 1", () => {
  assert.equal(RELATIONSHIP_VERSION, 1);
});

test("every counter is derived from its stated event evidence", () => {
  const result = deriveRelationships({ events: log(), roomId: ROOM, asOfTick: 8 });
  expectTarget(result, "o1", {
    deliveriesOffered: 1, deliverySuccesses: 1, messagesAuthored: 2,
    // e1 was blocked and only ever rejected while still open: no resume and no
    // disposition, so the report stands unconfirmed.
    blockedReports: 1, blockedConfirmed: 0, charterProposalsSuperseded: 1
  });
  expectTarget(result, "o2", {
    deliveriesOffered: 1, deliveryFailures: 1, deliverySuccesses: 1,
    blockedReports: 1, blockedConfirmed: 1
  });
  expectTarget(result, "r1", {
    // r1 held the reviewer seat on e1: one approve, one request_changes.
    deliveriesOffered: 1, messagesAuthored: 1,
    reviewsApproved: 1, reviewsChangesRequested: 1, unresolvedDisagreements: 1
  });
});

test("a dispute is unresolved only until a closed status is its final one", () => {
  const result = deriveRelationships({ events: log(), roomId: ROOM, asOfTick: 8 });
  // e3 (owned by r1) ends at in_progress, so it stays unresolved; e4 (owned by
  // o2) ends resolved, so it does not count even though it was a dispute.
  expectTarget(result, "r1", { deliveriesOffered: 1, messagesAuthored: 1,
    reviewsApproved: 1, reviewsChangesRequested: 1, unresolvedDisagreements: 1 });
  // o2's own dispute closed, and the assertion is on that counter alone: the
  // row itself is not empty, so an all-zero expectation would be a different
  // claim than the one under test.
  expectTarget(result, "o2", { deliveriesOffered: 1, deliveryFailures: 1, deliverySuccesses: 1,
    blockedReports: 1, blockedConfirmed: 1 });
});

test("a blocked report is confirmed by a later in_progress, or by a disposition", () => {
  const events = [
    membersEvent(),
    // e1: blocked, then explicitly resumed by the owner.
    transition({ id: "b1", tick: 1, at: 1, payload: { entryId: "e1", kind: "task", action: "progress", status: "blocked",
      ownerSessionId: "o1", state: "blocked" } }),
    transition({ id: "b2", tick: 2, at: 2, payload: { entryId: "e1", kind: "task", action: "progress", status: "open",
      ownerSessionId: "o1", state: "in_progress" } }),
    // e2: blocked, then confirmed by a disposition rather than a resume.
    transition({ id: "b3", tick: 1, at: 3, payload: { entryId: "e2", kind: "task", action: "progress", status: "blocked",
      ownerSessionId: "o1", state: "blocked" } }),
    transition({ id: "b4", tick: 3, at: 4, payload: { entryId: "e2", kind: "task", action: "comment", status: "blocked",
      ownerSessionId: "o1", dispositionAction: "dismiss_blocker" } }),
    // e3: blocked and never resolved, so it is reported but not confirmed.
    transition({ id: "b5", tick: 1, at: 5, payload: { entryId: "e3", kind: "task", action: "progress", status: "blocked",
      ownerSessionId: "o1", state: "blocked" } }),
    // e4: blocked twice, resumed once: the confirmation pairs with one report.
    transition({ id: "b6", tick: 1, at: 6, payload: { entryId: "e4", kind: "task", action: "progress", status: "blocked",
      ownerSessionId: "o1", state: "blocked" } }),
    transition({ id: "b7", tick: 2, at: 7, payload: { entryId: "e4", kind: "task", action: "progress", status: "blocked",
      ownerSessionId: "o1", state: "blocked" } }),
    transition({ id: "b8", tick: 3, at: 8, payload: { entryId: "e4", kind: "task", action: "progress", status: "open",
      ownerSessionId: "o1", state: "in_progress" } })
  ];
  const result = deriveRelationships({ events, roomId: ROOM, asOfTick: 3 });
  expectTarget(result, "o1", { blockedReports: 5, blockedConfirmed: 3 });
});

test("a superseded proposal counts on the ledger path too, not only the charter family", () => {
  const events = [
    membersEvent(),
    transition({ id: "l1", tick: 1, at: 1, payload: { entryId: "P1", revision: 1, kind: "charter", action: "propose",
      status: "pending", proposerSessionId: "o1" } }),
    transition({ id: "l2", tick: 2, at: 2, payload: { entryId: "P2", revision: 1, kind: "charter", action: "propose",
      status: "pending", proposerSessionId: "o2", replacesProposalId: "P1" } })
  ];
  const result = deriveRelationships({ events, roomId: ROOM, asOfTick: 2 });
  // P1 was replaced, so o1's proposal is the superseded one; P2 replaced it, so
  // o2's own proposal was not superseded by anything.
  expectTarget(result, "o1", { charterProposalsSuperseded: 1 });
  expectTarget(result, "o2", { charterProposalsSuperseded: 0 });
});

test("omitting asOfTick derives the whole log rather than dropping it", () => {
  // A missing horizon must not read as "tick 0": the plan lets the caller omit
  // it, and the only safe default is the log's own last tick.
  const whole = deriveRelationships({ events: log(), roomId: ROOM });
  assert.deepEqual(whole, deriveRelationships({ events: log(), roomId: ROOM, asOfTick: 8 }));
});

test("the transition behind an unresolved disagreement is part of the basis", () => {
  // R45: counting a disagreement from the entry's *final* status is still a read
  // of the event that carried that status, so the pair must be able to name it —
  // and its tick must reflect it. Without this, the snapshot's derivedFromCount
  // would understate the evidence and pair.tick would understate the horizon.
  const events = [
    membersEvent(),
    transition({ id: "d1", tick: 1, at: 1, payload: { entryId: "e9", revision: 1, kind: "dispute", action: "record",
      status: "open", ownerSessionId: "o1" } }),
    transition({ id: "d2", tick: 2, at: 2, payload: { entryId: "e9", revision: 2, kind: "dispute", action: "amend",
      status: "in_progress", ownerSessionId: "o1" } })
  ];
  const result = deriveRelationships({ events, roomId: ROOM, asOfTick: 2 });
  expectTarget(result, "o1", { unresolvedDisagreements: 1 });
  const pair = result.pairs.find((item) => item.observer === "o1" && item.target === "o1");
  assert.ok(pair.derivedFrom.includes("d1"), "the event that established the dispute is evidence");
  assert.ok(pair.derivedFrom.includes("d2"), "the event that fixed the final status is evidence");
  assert.equal(pair.tick, 2);
  assert.ok(result.derivedFrom.includes("d2"), "the result's basis carries it too");
});

test("the replaced proposal's own transition is part of the basis", () => {
  // The same class as R45: the replaced proposal's record is read to learn who
  // proposed it, so it belongs in the basis even though its counter is
  // incremented by the replacement. The replaced proposal arrives as a ledger
  // transition and its replacement via the charter family, so both spellings of
  // that read are on one path.
  const events = [
    membersEvent(),
    transition({ id: "c1", tick: 1, at: 1, payload: { entryId: "P1", revision: 1, kind: "charter", action: "propose",
      status: "pending", proposerSessionId: "o1" } }),
    charter({ id: "c2", tick: 2, at: 2, payload: { proposalId: "P2", proposerSessionId: "o2", replacesProposalId: "P1" } })
  ];
  const result = deriveRelationships({ events, roomId: ROOM, asOfTick: 2 });
  expectTarget(result, "o1", { charterProposalsSuperseded: 1 });
  const pair = result.pairs.find((item) => item.observer === "o1" && item.target === "o1");
  assert.ok(pair.derivedFrom.includes("c1"), "the replaced proposal's own record is evidence");
  assert.ok(pair.derivedFrom.includes("c2"), "the replacement is evidence");
  assert.equal(pair.tick, 2);
});

test("a replacement beyond the horizon is not evidence on any path", () => {
  // R46: the superseded-proposal pass used to walk the unfiltered log, so an
  // event the cutoff excluded still raised a pair's tick and entered its basis
  // while changing no counter. Two replacements of one proposal pin that down:
  // the in-horizon one counts and is named; the out-of-horizon one is invisible,
  // so the count is exactly 1 rather than 2.
  const events = [
    membersEvent(),
    transition({ id: "p1", tick: 2, at: 2, payload: { entryId: "P1", revision: 1, kind: "charter", action: "propose",
      status: "pending", proposerSessionId: "o1" } }),
    transition({ id: "c3", tick: 3, at: 3, payload: { entryId: "P2", revision: 1, kind: "charter", action: "propose",
      status: "pending", proposerSessionId: "o2", replacesProposalId: "P1" } }),
    transition({ id: "c9", tick: 9, at: 9, payload: { entryId: "P3", revision: 1, kind: "charter", action: "propose",
      status: "pending", proposerSessionId: "o2", replacesProposalId: "P1" } })
  ];
  const result = deriveRelationships({ events, roomId: ROOM, asOfTick: 4 });
  expectTarget(result, "o1", { charterProposalsSuperseded: 1 });
  const pair = result.pairs.find((item) => item.observer === "o1" && item.target === "o1");
  // The tick is the in-horizon replacement's, the basis names the replaced
  // proposal's own record and that replacement, and the excluded event is
  // neither in the pair's basis nor in the result's.
  assert.equal(pair.tick, 3, "an excluded event must not raise the pair's tick");
  assert.deepEqual(pair.derivedFrom.filter((id) => id !== "t8"), ["c3", "p1"]);
  assert.ok(!pair.derivedFrom.includes("c9"));
  assert.ok(!result.derivedFrom.includes("c9"));
});

test("the fixture exercises every counter, so one cannot pass by staying at zero", () => {
  // A counter no assertion ever sees as non-zero is a counter this suite cannot
  // distinguish from an unimplemented one; this fails loudly in that case.
  const result = deriveRelationships({ events: log(), roomId: ROOM, asOfTick: 8 });
  const exercised = new Set();
  for (const pair of result.pairs) {
    for (const [name, value] of Object.entries(pair.counters)) if (value !== 0) exercised.add(name);
  }
  assert.deepEqual([...exercised].sort(), Object.keys(ALL_ZERO).sort());
});

test("no counter is invented and none is omitted", () => {
  const result = deriveRelationships({ events: log(), roomId: ROOM, asOfTick: 8 });
  for (const pair of result.pairs) {
    assert.deepEqual(Object.keys(pair.counters).sort(), Object.keys(ALL_ZERO).sort());
    // The plan's field order, spelled out rather than merely sorted.
    assert.deepEqual(Object.keys(pair), ["observer", "target", "tick", "counters", "derivedFrom"]);
  }
});

test("the self-pair is present and identical to every other observer's view", () => {
  const result = deriveRelationships({ events: log(), roomId: ROOM, asOfTick: 8 });
  for (const target of ["o1", "o2", "r1"]) {
    assert.deepEqual(countersFor(result, target, target), countersFor(result, "o1", target));
  }
});

test("every member is an observer of every member: nine directed pairs", () => {
  const result = deriveRelationships({ events: log(), roomId: ROOM, asOfTick: 8 });
  assert.deepEqual(result.pairs.map((pair) => `${pair.observer}->${pair.target}`), [
    "o1->o1", "o1->o2", "o1->r1", "o2->o1", "o2->o2", "o2->r1", "r1->o1", "r1->o2", "r1->r1"
  ]);
});

test("shuffling the input does not change the output", () => {
  const ordered = deriveRelationships({ events: log(), roomId: ROOM, asOfTick: 8 });
  for (const seed of [1, 2, 3, 99]) {
    const shuffled = deriveRelationships({ events: shuffle(log(), seed), roomId: ROOM, asOfTick: 8 });
    assert.deepEqual(shuffled, ordered, `seed ${seed}`);
  }
});

test("two derivations of the same input are byte-identical", () => {
  const first = deriveRelationships({ events: log(), roomId: ROOM, asOfTick: 8 });
  const second = deriveRelationships({ events: log(), roomId: ROOM, asOfTick: 8 });
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("byte-identical output does not depend on the key order events were built in", () => {
  // Two spellings of the same log: same facts, different insertion order. The
  // output must serialise the same, which a comparison of two calls over one
  // shared array cannot show.
  const reversedKeys = log().map((item) => ({
    hash: item.hash, prev: item.prev, provenance: item.provenance, causes: item.causes,
    payload: item.payload, actor: item.actor, type: item.type, tick: item.tick,
    at: item.at, id: item.id, v: item.v
  }));
  const a = deriveRelationships({ events: log(), roomId: ROOM, asOfTick: 8 });
  const b = deriveRelationships({ events: reversedKeys, roomId: ROOM, asOfTick: 8 });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("an empty log derives no pairs and consumes nothing", () => {
  const result = deriveRelationships({ events: [], roomId: ROOM, asOfTick: 0 });
  assert.deepEqual(result, { pairs: [], derivedFrom: [] });
});

test("events from another room never leak into this room's pairs", () => {
  const foreign = log().map((item, index) => ({
    ...item, id: `x${index}`,
    provenance: { ...item.provenance, roomId: OTHER_ROOM }
  }));
  const own = deriveRelationships({ events: log(), roomId: ROOM, asOfTick: 8 });
  const mixed = deriveRelationships({ events: [...log(), ...foreign], roomId: ROOM, asOfTick: 8 });
  assert.deepEqual(mixed, own);
  assert.ok(mixed.derivedFrom.every((id) => !id.startsWith("x")));
});

test("asOfTick is an inclusive cutoff and pair.tick is the pair's freshest evidence", () => {
  const truncated = deriveRelationships({ events: log(), roomId: ROOM, asOfTick: 4 });
  // Nothing stamped after tick 4 counts: the approve at t19, the resume at t18
  // and o2's blocked report at t15 are all outside the horizon.
  expectTarget(truncated, "o1", { deliveriesOffered: 1, deliverySuccesses: 1, messagesAuthored: 2, blockedReports: 1 });
  expectTarget(truncated, "o2", { deliveriesOffered: 1, deliveryFailures: 1, deliverySuccesses: 1 });
  const pairs = Object.fromEntries(truncated.pairs.filter((pair) => pair.observer === "o1")
    .map((pair) => [pair.target, pair.tick]));
  // o1's freshest own fact is the blocked report at tick 4 and o2's is the
  // delivered settlement at tick 3. r1's is its own superseded settlement at
  // tick 3: the status counts for neither outcome counter, but the event is
  // still part of the pair's basis and so still raises its tick.
  assert.deepEqual(pairs, { o1: 4, o2: 3, r1: 3 });
});

test("derivedFrom is sorted, de-duplicated, and only names events the derivation read", () => {
  const result = deriveRelationships({ events: log(), roomId: ROOM, asOfTick: 8 });
  const sorted = [...new Set(result.derivedFrom)].sort();
  assert.deepEqual(result.derivedFrom, sorted);
  assert.ok(result.derivedFrom.includes("t8"), "membership evidence is part of the basis");
  assert.ok(result.derivedFrom.includes("t19"), "an event that moved a counter is part of the basis");
  // The clause in this test's name: every id it returns must exist in the log it
  // was given. A basis naming an event the caller never passed is unusable as
  // provenance, and this is the assertion that catches this module growing one.
  const known = new Set(log().map((item) => item.id));
  for (const id of [...result.derivedFrom, ...result.pairs.flatMap((pair) => pair.derivedFrom)]) {
    assert.ok(known.has(id), `basis names an event the log does not contain: ${id}`);
  }
  const union = new Set(result.pairs.flatMap((pair) => pair.derivedFrom));
  assert.deepEqual([...union].sort(), sorted, "the result's basis is the union of its pairs'");
});

test("the derivation never mutates its input", () => {
  const events = log();
  const before = JSON.stringify(events);
  deriveRelationships({ events, roomId: ROOM, asOfTick: 8 });
  assert.equal(JSON.stringify(events), before);
});

test("input the module cannot interpret is refused rather than guessed at", () => {
  assert.throws(() => deriveRelationships({ events: log() }), TypeError);
  assert.throws(() => deriveRelationships({ events: {}, roomId: ROOM }), TypeError);
  assert.throws(() => deriveRelationships({ events: [], roomId: ROOM, asOfTick: Number.NaN }), TypeError);
});
