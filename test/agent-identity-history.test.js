import test from "node:test";
import assert from "node:assert/strict";
import { migrateAgentDirectory, registerParticipations, visibleAppraisalEvents, observedEvidenceIds } from "../lib/agent-directory.js";
import { effectiveAppraisals } from "../lib/relationship.js";

function stateWithHistory() {
  const room = { id: "room", groupId: "group", createdAt: 1, updatedAt: 1, ledger: [],
    members: [{ sessionId: "session", alias: "Current", memberId: "member", agentId: "agent-b" }] };
  const previous = { id: "original-participation", roomId: "room", sessionId: "session", agentId: "agent-a", alias: "Previous" };
  return { rooms: [room], groups: [{ id: "group", createdAt: 1, defaults: {
    defaultParticipantIds: ["member"], members: [{ id: "member", sourceSessionId: "session", alias: "Current", agentId: "agent-b", agentRevision: 1 }] } }],
  workspace: { agents: [{ id: "agent-a", revision: 1 }, { id: "agent-b", revision: 1 }], participations: [previous] } };
}

test("reusing a room Session for another Agent preserves both identity bindings", () => {
  const state = stateWithHistory();
  const previous = structuredClone(state.workspace.participations[0]);
  assert.equal(registerParticipations(state, state.rooms[0]), true);
  const current = state.workspace.participations.find((item) => item.id === state.rooms[0].members[0].participationId);
  assert.equal(current.agentId, "agent-b");
  assert.deepEqual(state.workspace.participations.find((item) => item.id === previous.id), previous);
  assert.equal(state.workspace.participations.length, 2);
  assert.equal(registerParticipations(state, state.rooms[0]), false, "registering the same binding twice is idempotent");
});

test("identity migration prefers historical participation over changed group defaults", () => {
  const state = stateWithHistory();
  delete state.rooms[0].members[0].agentId;
  migrateAgentDirectory(state);
  assert.equal(state.rooms[0].members[0].agentId, "agent-a");
  assert.equal(state.rooms[0].members[0].participationId, "original-participation");
  assert.equal(state.workspace.participations.length, 1);
});

test("ambiguous historical identity is rejected unless the member names its participation", () => {
  const state = stateWithHistory();
  delete state.rooms[0].members[0].agentId;
  state.workspace.participations.push({ id: "second-participation", roomId: "room", sessionId: "session", agentId: "agent-b" });
  const original = structuredClone(state);
  assert.throws(() => migrateAgentDirectory(state), /ambiguous|身分|身份/);
  assert.deepEqual(state.rooms[0], original.rooms[0], "failed inference must not relabel the live room");
  state.rooms[0].members[0].participationId = "original-participation";
  migrateAgentDirectory(state);
  assert.equal(state.rooms[0].members[0].agentId, "agent-a");
});

test("identity projection excludes a prior occupant's records and revocations without deleting history", () => {
  const current = { id: "current", type: "appraisal", at: 2, tick: 2, provenance: { roomId: "room" }, payload: {
    observerId: "session", observerAgentId: "agent-b", aboutAgentId: "target", targetAgentId: "agent-c",
    stance: "trust", confidence: 0.8, claim: "B's judgement", evidenceEventIds: ["evidence"], action: "record", validFrom: 2, validTo: null } };
  const stale = { ...current, id: "stale", at: 1, tick: 1,
    payload: { ...current.payload, observerAgentId: "agent-a", claim: "A's judgement", validFrom: 1 } };
  const staleRevocation = { ...current, id: "stale-revoke", at: 3, tick: 3,
    payload: { ...current.payload, observerAgentId: "agent-a", action: "revoke", revokesAppraisalId: "current", validTo: 3 } };
  const events = [stale, current, staleRevocation];
  const visible = visibleAppraisalEvents(events, { roomId: "room",
    members: [{ sessionId: "session", agentId: "agent-b" }, { sessionId: "target", agentId: "agent-c" }],
    participations: [{ roomId: "room", sessionId: "session", agentId: "agent-a" },
      { roomId: "room", sessionId: "session", agentId: "agent-b" }, { roomId: "room", sessionId: "target", agentId: "agent-c" }] });
  assert.deepEqual(visible.map((event) => event.id), ["current"]);
  assert.equal(effectiveAppraisals(visible, "room", 4).session.target.claim, "B's judgement");
  assert.equal(events.length, 3);
});

test("legacy appraisals remain readable only while both Session identities are unambiguous", () => {
  const event = { id: "legacy", type: "appraisal", payload: { observerId: "s1", aboutAgentId: "s2" } };
  const scope = { roomId: "room", members: [{ sessionId: "s1", agentId: "a" }, { sessionId: "s2", agentId: "b" }],
    participations: [{ roomId: "room", sessionId: "s1", agentId: "a" }, { roomId: "room", sessionId: "s2", agentId: "b" }] };
  assert.deepEqual(visibleAppraisalEvents([event], scope), [event]);
  scope.participations.push({ roomId: "room", sessionId: "s1", agentId: "prior" });
  assert.deepEqual(visibleAppraisalEvents([event], scope), []);
});

test("evidence receipts are room-scoped and never reveal another observer's private appraisal", () => {
  const events = [
    { id: "message-event", type: "message.created", payload: { messageId: "message" }, provenance: { roomId: "room" } },
    { id: "foreign-private", type: "appraisal", payload: { observerId: "other", observerAgentId: "other-agent" }, provenance: { roomId: "room" } },
    { id: "receipt", type: "memory.observed", actor: { kind: "system" }, provenance: { roomId: "room", originClass: "system" },
      payload: { observerAgentId: "agent", messageIds: ["message"], evidenceIds: ["foreign-private"] } },
    { id: "foreign-room", type: "message.created", actor: { kind: "session", id: "session" },
      payload: { messageId: "foreign-message", authorAgentId: "agent" }, provenance: { roomId: "elsewhere" } }
  ];
  const evidence = observedEvidenceIds(events, { roomId: "room", sessionId: "session", agentId: "agent" });
  assert.ok(evidence.has("message"));
  assert.ok(evidence.has("message-event"));
  assert.ok(!evidence.has("foreign-private"));
  assert.ok(!evidence.has("foreign-room"));
  assert.ok(!evidence.has("foreign-message"));
});
