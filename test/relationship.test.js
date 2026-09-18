import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { DshChatLocalService } from "../lib/room-store.js";
import { apply } from "../lib/index.js";
import { RELATIONSHIP_VERSION, deriveRelationships, latestRelationships } from "../lib/relationship.js";

/**
 * These tests build event envelopes by hand instead of driving a room, because
 * the module under test is the pure derivation: driving a room would test the
 * writer, and would make the ledger counters untestable until Task 2.2 emits
 * them. The ledger fixtures below use the payload names Task 2.2 is specified
 * to emit (`entryId`, `kind`, `action`, `status`, `ownerSessionId`,
 * `reviewerSessionId`, `verdict`, `state`, `dispositionAction`,
 * `proposerSessionId`, `replacesProposalId`), so they are the event shapes this
 * module will consume once that task lands.
 *
 * The section at the end of this file is different in kind: it boots the real
 * plugin and drives its own HTTP handler and tool registry, because the two
 * read-only surfaces are a route and a tool rather than a pure function. There
 * the expected value is computed with the pure functions above out of the log
 * the plugin itself exports, so the surfaces are compared against the same
 * definition they are supposed to expose.
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

/** A `member.added` / `member.removed` envelope: the shape the store now writes (R41). */
function membership({ id, sessionId, type = "member.added", alias = sessionId, role = null, tick = 0, at = 0 }) {
  return event({ id, type, actor: "human:human:me", tick, at, payload: { sessionId, alias, role, at } });
}

/** An ordered `turn.scheduled` envelope, used as pre-R41 membership evidence. */
function turn({ id, tick, at, roster }) {
  return event({ id, type: "turn.scheduled", tick, at,
    payload: { rootMessageId: "m-root", epoch: 1, recipients: [...roster], order: "configured",
      rotationStart: 0, executed: [...roster] } });
}

/** The observers a derivation admits, in the pair order it emits them. */
function observers(result) {
  return [...new Set(result.pairs.map((pair) => pair.observer))];
}

/**
 * A `relationship.snapshot` envelope as the store's writer emits one. The
 * projection reads only the fields below, so a fixture built here and a snapshot
 * produced by a real turn are the same shape.
 */
function snapshot({ id, tick, at, pairs, version = RELATIONSHIP_VERSION, derivedFromCount = 0 }) {
  return event({ id, type: "relationship.snapshot", tick, at,
    payload: { pairs, version, derivedFromCount, asOfTick: tick } });
}

/** One `Pair` as `deriveRelationships` emits it, with counters overridden. */
function pair(observer, target, counters = {}, tick = 0) {
  return { observer, target, tick, counters: { ...ALL_ZERO, ...counters }, derivedFrom: [] };
}

/**
 * Three members (o1, o2, r1) and one turn. This log predates `member.added`:
 * `turn.scheduled`'s roster is then the only membership evidence there is, and
 * the derivation must still read it (R41's documented fallback).
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

test("the fallback still derives members from the roster of a log that predates member events", () => {
  // R41's other half: the inference is a fallback, not a deletion. A log with no
  // membership event must derive exactly the observers it did before, or every
  // existing room would come back empty after the upgrade.
  const result = deriveRelationships({ events: log(), roomId: ROOM, asOfTick: 8 });
  assert.deepEqual(observers(result), ["o1", "o2", "r1"]);
  assert.ok(result.derivedFrom.includes("t8"), "the roster that supplied them is the basis");
});

test("a membership event is authoritative for the session it names", () => {
  // A session the log states is governed by that statement, not by what the
  // rosters happen to say later: a2 left, and a roster written from the store
  // before the change still lists it.
  const events = [
    membership({ id: "ma1", sessionId: "a1", tick: 0, at: 1 }),
    membership({ id: "ma2", sessionId: "a2", alias: "乙", role: "复核", tick: 0, at: 2 }),
    membership({ id: "mr2", sessionId: "a2", type: "member.removed", tick: 3, at: 3 }),
    turn({ id: "t1", tick: 4, at: 4, roster: ["a1", "a2"] }),
    message({ id: "t2", author: "a1", tick: 4, at: 5 })
  ];
  const result = deriveRelationships({ events, roomId: ROOM, asOfTick: 4 });
  assert.deepEqual(observers(result), ["a1"]);
  assert.ok(result.pairs[0].derivedFrom.includes("ma1"), "the membership fact is part of the basis");
});

test("a member stated only by member.added is an observer, though no turn ever named it", () => {
  // The invisibility R41 removes: a session the log states is a member even
  // when it never appeared in a turn or a delivery.
  const events = [
    membership({ id: "ma1", sessionId: "a1", tick: 0, at: 1 }),
    membership({ id: "ma9", sessionId: "a9", tick: 0, at: 2 })
  ];
  const result = deriveRelationships({ events, roomId: ROOM, asOfTick: 0 });
  assert.deepEqual(observers(result), ["a1", "a9"]);
  assert.deepEqual(result.pairs.map((pair) => `${pair.observer}->${pair.target}`),
    ["a1->a1", "a1->a9", "a9->a1", "a9->a9"]);
});

test("a member.removed event retires the observer row", () => {
  const events = [
    membership({ id: "ma1", sessionId: "a1", tick: 0, at: 1 }),
    membership({ id: "ma2", sessionId: "a2", tick: 0, at: 2 }),
    membership({ id: "mr2", sessionId: "a2", type: "member.removed", tick: 3, at: 3 }),
    turn({ id: "t1", tick: 1, at: 4, roster: ["a1", "a2"] }),
    message({ id: "t2", author: "a1", tick: 1, at: 5 })
  ];
  const result = deriveRelationships({ events, roomId: ROOM, asOfTick: 3 });
  assert.deepEqual(observers(result), ["a1"]);
  assert.deepEqual(result.pairs.map((pair) => `${pair.observer}->${pair.target}`), ["a1->a1"]);
});

test("a member who left and rejoined is an observer again", () => {
  // Removal is a fact about a period, not a tombstone: a later add wins, which
  // is what keeps a re-joined participant from being permanently invisible.
  const events = [
    membership({ id: "ma1", sessionId: "a1", tick: 0, at: 1 }),
    membership({ id: "mr1", sessionId: "a1", type: "member.removed", tick: 2, at: 2 }),
    membership({ id: "ma2", sessionId: "a1", type: "member.added", tick: 4, at: 4 })
  ];
  assert.deepEqual(observers(deriveRelationships({ events, roomId: ROOM, asOfTick: 1 })), ["a1"]);
  assert.deepEqual(observers(deriveRelationships({ events, roomId: ROOM, asOfTick: 2 })), []);
  assert.deepEqual(observers(deriveRelationships({ events, roomId: ROOM, asOfTick: 4 })), ["a1"]);
});

test("a post-creation membership change never evicts a roster the log never stated (C1)", () => {
  // The reproduced defect: the fallback used to be scoped to the log prefix
  // before the first membership event. A room whose roster was never stated in
  // that prefix — created before the writer learned to emit the events — lost
  // every pre-existing member the moment one join was recorded: the roster
  // evidence sits *after* that event, so the prefix was empty.
  const roster = { id: "t1", tick: 2, at: 2, roster: ["a1", "a2", "a3", "a4", "d4"] };
  const withoutEvent = [
    turn(roster),
    message({ id: "t2", author: "a2", tick: 2, at: 3 })
  ];
  // Before the join was stated, the inference alone names the room.
  assert.deepEqual(observers(deriveRelationships({ events: withoutEvent, roomId: ROOM, asOfTick: 2 })),
    ["a1", "a2", "a3", "a4", "d4"]);
  // A session the log never states can only be read from that inference, so
  // recording the join must not evict the four members it never named.
  const events = [membership({ id: "md4", sessionId: "d4", tick: 1, at: 1 }), ...withoutEvent];
  const after = deriveRelationships({ events, roomId: ROOM, asOfTick: 2 });
  assert.deepEqual(observers(after), ["a1", "a2", "a3", "a4", "d4"]);
  assert.ok(after.derivedFrom.includes("t1"), "the roster that supplies the unstated members is evidence");
  assert.ok(after.derivedFrom.includes("md4"));
});

test("an unstated session is still read from the inference, and the cost of that is stated", () => {
  // The boundary of the switch, pinned rather than hidden: a session no
  // membership event names — possible only in the part of a log written before
  // the writer could state it — is read from the roster/delivery inference. That
  // keeps a legacy room's members, at the price of admitting a session named
  // only by a stale delivery, which is the safe direction for an audit.
  const events = [
    turn({ id: "t8", tick: 1, at: 8, roster: ["o1", "o2"] }),
    message({ id: "t2", author: "o1", tick: 1, at: 2 }),
    membership({ id: "ma3", sessionId: "o3", tick: 5, at: 5 }),
    turn({ id: "t9", tick: 6, at: 9, roster: ["o1", "o2", "o3", "ghost"] })
  ];
  const result = deriveRelationships({ events, roomId: ROOM, asOfTick: 6 });
  assert.deepEqual(observers(result), ["ghost", "o1", "o2", "o3"]);
  assert.ok(result.derivedFrom.includes("t8"), "the pre-upgrade roster that supplied o1 and o2 is evidence");
  assert.ok(result.derivedFrom.includes("ma3"));
});

test("a membership event beyond the horizon is not evidence on any path", () => {
  // The R46 rule, applied to the new events: a snapshot as of tick 3 must not
  // observe a member who joined at tick 9, nor count that add as its basis.
  const events = [
    membership({ id: "ma3", sessionId: "o3", tick: 9, at: 9 }),
    membership({ id: "ma1", sessionId: "o1", tick: 1, at: 1 })
  ];
  const result = deriveRelationships({ events, roomId: ROOM, asOfTick: 3 });
  assert.deepEqual(observers(result), ["o1"]);
  assert.ok(!result.derivedFrom.includes("ma3"));
  assert.deepEqual(observers(deriveRelationships({ events, roomId: ROOM, asOfTick: 9 })), ["o1", "o3"]);
});

/**
 * The projection reads the snapshots out of the log. It reports what a snapshot
 * stated about a pair — it never derives, so a log whose counters are all
 * derivable still projects nothing until a snapshot says so.
 */
test("the projection of an empty log carries no pairs", () => {
  assert.deepEqual(latestRelationships([], ROOM), {});
});

test("a log with no relationship.snapshot projects no pairs", () => {
  assert.deepEqual(latestRelationships(log(), ROOM), {});
  assert.deepEqual(latestRelationships([membersEvent(), message({ id: "t2", author: "o1", tick: 1, at: 2 })], ROOM), {});
});

test("the projection carries the counters of the snapshot that covers each pair", () => {
  const events = [
    membership({ id: "ma1", sessionId: "o1" }),
    snapshot({ id: "s1", tick: 1, at: 1, pairs: [
      pair("o1", "o1", { messagesAuthored: 1 }),
      pair("o1", "o2", { deliveryFailures: 2, deliveriesOffered: 3 })
    ] })
  ];
  assert.deepEqual(latestRelationships(events, ROOM), {
    o1: {
      o1: { ...ALL_ZERO, messagesAuthored: 1 },
      o2: { ...ALL_ZERO, deliveryFailures: 2, deliveriesOffered: 3 }
    }
  });
});

test("a later snapshot moves every pair it covers", () => {
  const events = [
    membership({ id: "ma1", sessionId: "o1" }),
    membership({ id: "ma2", sessionId: "o2" }),
    snapshot({ id: "s1", tick: 1, at: 1, pairs: [pair("o1", "o2", { messagesAuthored: 1 })] }),
    snapshot({ id: "s2", tick: 2, at: 2, pairs: [pair("o1", "o2", { messagesAuthored: 4 })] })
  ];
  const projected = latestRelationships(events, ROOM);
  assert.equal(projected.o1.o2.messagesAuthored, 4);
  // Two snapshots do not merge: the newer statement replaces the older one
  // wholesale rather than adding to it.
  assert.deepEqual(projected, { o1: { o2: { ...ALL_ZERO, messagesAuthored: 4 } } });
});

test("a pair the latest snapshot no longer covers keeps the last snapshot that did", () => {
  // A snapshot is not assumed complete: a pair the newest one omits is read from
  // the newest snapshot that names it, rather than being dropped or reported as
  // zero, because the most recent statement about that pair is the true one.
  const events = [
    membership({ id: "ma1", sessionId: "o1" }),
    snapshot({ id: "s1", tick: 1, at: 1, pairs: [pair("o1", "o2", { messagesAuthored: 1 })] }),
    snapshot({ id: "s2", tick: 2, at: 2, pairs: [pair("o1", "o1", { messagesAuthored: 9 })] })
  ];
  assert.deepEqual(latestRelationships(events, ROOM), {
    o1: {
      o1: { ...ALL_ZERO, messagesAuthored: 9 },
      o2: { ...ALL_ZERO, messagesAuthored: 1 }
    }
  });
});

test("the newest snapshot is the last in the log order, not the last in the array", () => {
  const events = [
    membership({ id: "ma1", sessionId: "o1" }),
    snapshot({ id: "s2", tick: 2, at: 2, pairs: [pair("o1", "o1", { messagesAuthored: 4 })] }),
    snapshot({ id: "s1", tick: 1, at: 1, pairs: [pair("o1", "o1", { messagesAuthored: 1 })] })
  ];
  assert.equal(latestRelationships(events, ROOM).o1.o1.messagesAuthored, 4);
});

test("projecting a shuffled log gives the same result", () => {
  const events = [
    membership({ id: "ma1", sessionId: "o1" }),
    membership({ id: "ma2", sessionId: "o2" }),
    snapshot({ id: "s1", tick: 1, at: 1, pairs: [pair("o1", "o1"), pair("o1", "o2", { messagesAuthored: 1 })] }),
    message({ id: "t2", author: "o1", tick: 2, at: 2 }),
    snapshot({ id: "s2", tick: 2, at: 2, pairs: [pair("o1", "o1", { messagesAuthored: 1 }), pair("o1", "o2", { messagesAuthored: 1 })] })
  ];
  const ordered = latestRelationships(events, ROOM);
  for (const seed of [1, 2, 3, 99]) {
    assert.deepEqual(latestRelationships(shuffle(events, seed), ROOM), ordered, `seed ${seed}`);
  }
});

test("two projections of the same log serialise to the same bytes, with sorted keys", () => {
  const events = [
    membership({ id: "ma2", sessionId: "o2" }),
    membership({ id: "ma1", sessionId: "o1" }),
    snapshot({ id: "s1", tick: 1, at: 1, pairs: [pair("o2", "o1"), pair("o1", "o2"), pair("o1", "o1")] })
  ];
  const first = latestRelationships(events, ROOM);
  const second = latestRelationships(events, ROOM);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  // A plain object's insertion order is observable in its JSON, so the
  // observers and targets are inserted in code-unit order rather than in the
  // order the snapshot happened to list them.
  assert.deepEqual(Object.keys(first), ["o1", "o2"]);
  assert.deepEqual(Object.keys(first.o1), ["o1", "o2"]);
  assert.deepEqual(Object.keys(first.o2), ["o1"]);
});

test("a snapshot from another room is not this room's current relationship", () => {
  const foreign = event({ id: "x1", type: "relationship.snapshot", tick: 1, at: 1,
    payload: { pairs: [pair("f1", "f2", { messagesAuthored: 7 })], version: RELATIONSHIP_VERSION,
      derivedFromCount: 0, asOfTick: 1 },
    provenance: { roomId: OTHER_ROOM } });
  assert.deepEqual(latestRelationships([foreign], ROOM), {});
  assert.equal(latestRelationships([foreign], OTHER_ROOM).f1.f2.messagesAuthored, 7);
});

test("the projection copies the counters and never mutates the log", () => {
  // The projection is a read: a caller that amends what it got back must not
  // thereby rewrite the snapshot the log holds.
  const events = [
    membership({ id: "ma1", sessionId: "o1" }),
    snapshot({ id: "s1", tick: 1, at: 1, pairs: [pair("o1", "o1", { messagesAuthored: 1 })] })
  ];
  const before = JSON.stringify(events);
  const projected = latestRelationships(events, ROOM);
  projected.o1.o1.messagesAuthored = 99;
  assert.equal(events[1].payload.pairs[0].counters.messagesAuthored, 1, "the log keeps its own value");
  assert.equal(JSON.stringify(events), before, "the input is not mutated");
});

test("a malformed snapshot is skipped rather than guessed at", () => {
  const events = [
    event({ id: "s1", type: "relationship.snapshot", tick: 1, at: 1, payload: { pairs: "not an array" } }),
    event({ id: "s2", type: "relationship.snapshot", tick: 2, at: 2, payload: { pairs: [
      null, { observer: "o1" }, { observer: "o1", target: "o2" },
      pair("o1", "o1", { messagesAuthored: 3 })
    ] } })
  ];
  assert.deepEqual(latestRelationships(events, ROOM), { o1: { o1: { ...ALL_ZERO, messagesAuthored: 3 } } });
});

test("input the projection cannot interpret is refused rather than guessed at", () => {
  assert.throws(() => latestRelationships(log(), undefined), TypeError);
  assert.throws(() => latestRelationships({}, ROOM), TypeError);
  assert.throws(() => latestRelationships([], ""), TypeError);
});

test("an action_gate event is not evidence for any counter", () => {
  // The gate reads these counters and, when it refuses an execution, writes an
  // event into the same log they are derived from. An event type the derivation
  // does not name has to stay external to it: if the gate's own refusals moved
  // the counters, what it judges would depend on what it had already refused.
  const base = log();
  const before = deriveRelationships({ events: base, roomId: ROOM });
  const gateEvent = event({ id: "g1", type: "action_gate", actor: "session:r1", tick: 8, at: 25,
    payload: { tool: "bash", judgement: "require_confirmation", riskClass: "high", action: "execute",
      basis: { observer: "r1", target: "r1", asOfTick: 8, version: 1, derivedFromCount: 0,
        counters: { deliveryFailures: 0, deliverySuccesses: 1, unresolvedDisagreements: 1 } } } });
  const after = deriveRelationships({ events: [...base, gateEvent], roomId: ROOM });
  assert.deepEqual(after, before);
  // The fixture must carry real counters: "nothing changed" proves nothing on a
  // log of zeros.
  assert.ok(Object.values(countersFor(after, "r1", "r1")).some((value) => value > 0));
});

/**
 * The read-only surfaces: `GET /rooms/:id/relationships` and the
 * `chat_relationships` tool.
 *
 * Unlike the rest of this file, these tests boot the real plugin and drive its
 * own request handler and tool registry, because the units under test are a
 * route and a tool. The expected value is never hand-written: it is
 * `latestRelationships` over the log the plugin itself exports through
 * `GET /rooms/:id/snapshot`, so a surface that disagrees with the sanctioned
 * projection fails here.
 */

async function waitFor(predicate, label) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** The actor every `chat_*` tool derives from the DSH execution context. */
function exec(sessionId) {
  return { agent: { session: { id: sessionId } } };
}

/**
 * Boot the plugin against one temporary state file and return the handler and
 * tool registry it registered, plus a request helper that reads the JSON
 * envelope exactly as a client would.
 */
async function bootPlugin() {
  const directory = await mkdtemp(join(tmpdir(), "dcl-relationship-surfaces-"));
  const disposers = [];
  const registered = new Map();
  const calls = [];
  let handler, observe;
  const ctx = {
    effect(fn) { const dispose = fn(); if (typeof dispose === "function") disposers.push(dispose); },
    on(name, fn) { assert.equal(name, "session/event"); observe = fn; },
    tools: { register(tool) { registered.set(tool.name, tool); }, guard() {} },
    webServer: { register(route) { handler = route.handler; } },
    sessionTitle: { get() {} },
    sessions: { get() { return { header: { cwd: directory } }; } },
    agents: { get() {} },
    dshBridge: { status: async () => ({ state: "idle" }),
      deliverExternal: async (from, to, text, delivery) => { calls.push({ from, to, text, delivery }); } },
    get(name) { return this[name]; }
  };
  apply(ctx, { path: join(directory, "rooms.json"), maxRounds: 1, replyTimeoutMs: 800 });
  const request = async (path, body) => {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    req.url = `/api/dsh-chat-local${path}`;
    req.method = body === undefined ? "GET" : "POST";
    let status, text;
    await handler(req, { writeHead(code) { status = code; }, end(body2) { text = body2; } });
    assert.equal(status, 200, text);
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true, parsed.error);
    return parsed.value;
  };
  return {
    directory, registered, calls, request,
    /** One DSH session event, as the harness observes it. */
    sessionEvent: (sessionId, event) => observe({ id: sessionId }, event),
    close: async () => { for (const dispose of disposers.reverse()) await dispose();
      await rm(directory, { recursive: true, force: true }); }
  };
}

/** The room's own log, read through the plugin's run-snapshot export. */
async function eventsOf(plugin, roomId) {
  const snapshot = await plugin.request(`/rooms/${roomId}/snapshot`);
  return JSON.parse(snapshot.content).events;
}

/** Drive one delivered member through a complete turn, as DSH reports it. */
async function driveReply(plugin, call, text) {
  await plugin.sessionEvent(call.to, { type: "turn/start", data: { turn: 1 } });
  await plugin.sessionEvent(call.to, { type: "user/message", data: { content: [{ type: "text",
    text: `[dsh-bridge dsh-chat-local-room message ${call.delivery.id} from ${call.from}]` }] } });
  await plugin.sessionEvent(call.to, { type: "assistant/message", data: { turn: 1, step: 1,
    message: { content: [{ type: "text", text }] } } });
  await plugin.sessionEvent(call.to, { type: "turn/end", data: { turn: 1, reason: { kind: "completed" } } });
}

/**
 * Two members and two scheduled turns. The second turn's snapshot already sees
 * the first turn's reply, so the projection the surfaces expose carries a
 * non-zero counter — a table of zeros could not tell a working surface from one
 * that returns a constant.
 */
async function twoTurnRoom(plugin) {
  const room = await plugin.request("/rooms", { name: "关系面", autoDeliver: true,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }, { kind: "session", sessionId: "s2", alias: "乙" }] });
  await plugin.request(`/rooms/${room.id}/messages`, { author: "human:me", authorKind: "human",
    text: "第一轮", mentions: ["s1"] });
  const call = await waitFor(() => plugin.calls[0], "the first delivery");
  await driveReply(plugin, call, "回复");
  await waitFor(async () => (await plugin.request(`/rooms/${room.id}`)).orchestration?.state === "idle", "the turn to end");
  await plugin.request(`/rooms/${room.id}/messages`, { author: "human:me", authorKind: "human",
    text: "第二轮", mentions: ["s1"] });
  await waitFor(async () => (await eventsOf(plugin, room.id))
    .filter((event) => event.type === "relationship.snapshot").length >= 2, "the second snapshot");
  return room;
}

test("the route returns the full projected matrix the log states", async () => {
  const plugin = await bootPlugin();
  try {
    const room = await twoTurnRoom(plugin);
    const projected = latestRelationships(await eventsOf(plugin, room.id), room.id);
    assert.equal(projected.s1.s1.messagesAuthored, 1, "the fixture must carry a non-zero counter");
    const route = await plugin.request(`/rooms/${room.id}/relationships`);
    // The route is the projection, not a re-derivation and not a reshape: the
    // same object the pure module returns over the room's own log.
    assert.deepEqual(route, projected);
    assert.deepEqual(Object.keys(route), ["s1", "s2"], "both members are observers");
    assert.deepEqual(Object.keys(route.s2), ["s1", "s2"], "every observer sees every target");
    assert.deepEqual(Object.keys(route.s1.s2).sort(), Object.keys(ALL_ZERO).sort(),
      "each cell carries the full counter set");
  } finally { await plugin.close(); }
});

test("the tool returns only the calling session's own row, and refuses a non-member", async () => {
  const plugin = await bootPlugin();
  try {
    const room = await twoTurnRoom(plugin);
    const matrix = await plugin.request(`/rooms/${room.id}/relationships`);
    const tool = plugin.registered.get("chat_relationships");
    assert.ok(tool, "the plugin registers chat_relationships");
    const own = await tool.execute({ room: room.id }, exec("s1"));
    // Exactly one observer's row travels: the caller's, and nothing that could
    // be mistaken for a second observer's view.
    assert.deepEqual(Object.keys(own).sort(), ["observer", "targets"]);
    assert.equal(own.observer, "s1");
    assert.deepEqual(own.targets, matrix.s1);
    assert.equal("s2" in own, false);
    // The other member reaches only their own row, never the first one's.
    const theirs = await tool.execute({ room: room.id }, exec("s2"));
    assert.equal(theirs.observer, "s2");
    assert.deepEqual(theirs.targets, matrix.s2);
    await assert.rejects(tool.execute({ room: room.id }, exec("outsider")), /member/);
  } finally { await plugin.close(); }
});

test("the tool reads through the one projection the route returns", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-relationship-path-"));
  const ctx = {
    agents: { get: () => undefined },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async () => {} },
    get(name) { return this[name]; }
  };
  const service = new DshChatLocalService(ctx, { path: join(directory, "rooms.json") });
  await service.ready;
  try {
    const room = await service.createRoom({ name: "同一路径", autoDeliver: true,
      members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
    // One scheduled turn gives the projection a row to carry, so "the row is a
    // selection out of the projection" is visible rather than two empty objects.
    await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "开始" });
    await waitFor(async () => (await service.eventsFor(room.id))
      .some((event) => event.type === "relationship.snapshot"), "the relationship snapshot");
    const projections = [];
    const reads = [];
    const project = service.relationships.bind(service);
    const read = service.eventLog.read.bind(service.eventLog);
    service.relationships = async (roomId) => { projections.push(roomId); return project(roomId); };
    service.eventLog.read = async (roomId) => { reads.push(roomId); return read(roomId); };
    const row = await service.relationshipRow(room.id, "s1");
    // One projection, one log read: the tool's row is a selection out of what
    // the route returns, not a second derivation.
    assert.deepEqual(projections, [room.id]);
    assert.deepEqual(reads, [room.id]);
    assert.deepEqual(row, { observer: "s1", targets: { s1: ALL_ZERO } });
    const matrix = await service.relationships(room.id);
    assert.deepEqual(row.targets, matrix.s1);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("the tool selects the caller's own row, not the first observer's", async () => {
  // Today the real projection gives every observer the same numbers for one
  // target, so comparing the tool's row against `matrix.s1` cannot tell "my row"
  // from "whoever's row came first". A stub with distinct per-observer counters
  // can, and that is the claim under test: the selection is keyed by the calling
  // session. The prototype is patched so the patch reaches the registry inside
  // `apply`, and restored in `finally` so no other test can see it.
  const project = DshChatLocalService.prototype.relationships;
  DshChatLocalService.prototype.relationships = async () => ({
    s1: { s1: { ...ALL_ZERO, messagesAuthored: 11 }, s2: { ...ALL_ZERO, messagesAuthored: 12 } },
    s2: { s1: { ...ALL_ZERO, messagesAuthored: 21 }, s2: { ...ALL_ZERO, messagesAuthored: 22 } }
  });
  let plugin;
  try {
    plugin = await bootPlugin();
    const room = await plugin.request("/rooms", { name: "取行", autoDeliver: false,
      members: [{ kind: "session", sessionId: "s1", alias: "甲" }, { kind: "session", sessionId: "s2", alias: "乙" }] });
    const tool = plugin.registered.get("chat_relationships");
    assert.deepEqual(await tool.execute({ room: room.id }, exec("s2")), { observer: "s2", targets: {
      s1: { ...ALL_ZERO, messagesAuthored: 21 }, s2: { ...ALL_ZERO, messagesAuthored: 22 } } });
    assert.deepEqual(await tool.execute({ room: room.id }, exec("s1")), { observer: "s1", targets: {
      s1: { ...ALL_ZERO, messagesAuthored: 11 }, s2: { ...ALL_ZERO, messagesAuthored: 12 } } });
  } finally {
    // Restored before the close, not after: a rejecting `close()` would
    // otherwise leave this stub on the prototype for every later test in the
    // file to inherit.
    DshChatLocalService.prototype.relationships = project;
    if (plugin) await plugin.close();
  }
});

test("a room with no snapshot projects nothing, and neither surface appends an event", async () => {
  const plugin = await bootPlugin();
  try {
    const room = await plugin.request("/rooms", { name: "空关系", autoDeliver: false,
      members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
    const before = JSON.stringify(await eventsOf(plugin, room.id));
    assert.deepEqual(await plugin.request(`/rooms/${room.id}/relationships`), {},
      "no snapshot means no current relationship, not an invented table");
    const tool = plugin.registered.get("chat_relationships");
    assert.deepEqual(await tool.execute({ room: room.id }, exec("s1")), { observer: "s1", targets: {} });
    assert.equal(JSON.stringify(await eventsOf(plugin, room.id)), before,
      "a read-only surface must not append to the log it reads");
  } finally { await plugin.close(); }
});

test("a missing or unreadable log degrades to an empty projection instead of failing the request", async () => {
  const plugin = await bootPlugin();
  try {
    const room = await twoTurnRoom(plugin);
    assert.notDeepEqual(await plugin.request(`/rooms/${room.id}/relationships`), {},
      "the fixture must have a projection to lose");
    const tool = plugin.registered.get("chat_relationships");
    const logPath = join(plugin.directory, "events", `${room.id}.jsonl`);
    // A room whose log is simply absent: no relationship state is readable.
    await rm(logPath, { force: true });
    assert.deepEqual(await plugin.request(`/rooms/${room.id}/relationships`), {});
    assert.deepEqual(await tool.execute({ room: room.id }, exec("s1")), { observer: "s1", targets: {} });
    // A log that is present but cannot be parsed: same empty answer, still no 500.
    await writeFile(logPath, "this is not an event\n", "utf8");
    assert.deepEqual(await plugin.request(`/rooms/${room.id}/relationships`), {});
    assert.deepEqual(await tool.execute({ room: room.id }, exec("s1")), { observer: "s1", targets: {} });
  } finally { await plugin.close(); }
});

test("chat_relationships stays available in a restricted group turn", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-relationship-guard-"));
  const ctx = {
    agents: { get: () => undefined },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async () => {} },
    get(name) { return this[name]; }
  };
  const service = new DshChatLocalService(ctx, { path: join(directory, "rooms.json") });
  await service.ready;
  try {
    const room = await service.createRoom({ name: "受限回合", autoDeliver: false,
      members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
    service.policyLocks.set("s1", { active: true, actionMode: "discuss_only", expiresAt: Date.now() + 10_000 });
    assert.equal(service.guardToolExecution({ name: "chat_relationships", arguments: { room: room.id },
      agent: { session: { id: "s1" } } }), undefined);
    // The allowance is specific to this read-only tool, not a general loosening.
    assert.match(service.guardToolExecution({ name: "bash", arguments: {}, agent: { session: { id: "s1" } } }),
      /非只读工具/);
  } finally {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  }
});
