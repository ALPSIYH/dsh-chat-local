/**
 * Deterministic derivation of per-pair relationship counters from one room's
 * event log.
 *
 * This module is the C backbone of the relational layer: it answers "who has
 * worked with whom, how reliably, and where it went wrong" by *reading* the
 * append-only log, never by writing state. It is pure on purpose — no I/O, no
 * `Date.now()`, no randomness, no model — so a snapshot is reproducible from the
 * log alone and can be replayed or audited later.
 *
 * Every counter's formula is fixed by the plan
 * (`docs/superpowers/plans/2026-09-17-relational-memory-phases-2-5.md`, Task 2.1).
 * Counting is order-independent because the events are sorted before anything is
 * read, and the result is canonical so two derivations of the same log serialise
 * to the same bytes.
 *
 * Counter observations, where the plan's table leaves a choice:
 *
 * - Membership comes from `member.added` / `member.removed` (R41): the events
 *   govern every session they name. A session the log never states — possible
 *   only in a log written before those events existed — still comes from the
 *   roster/delivery inference, per session and never scoped to a prefix of the
 *   log, so a room that was already running does not lose its members when the
 *   log states a later join; see `membershipFrom`.
 * - A counter describes the **target**, so the same target carries identical
 *   counters under every observer. The observer axis is the interface the later
 *   A layer (model appraisal) fills in; today it exists so "me about me" is a
 *   real, analysable baseline rather than a missing row.
 * - `deliveriesOffered` counts `delivery.sent` events, which the writer only
 *   ever stamps with status `sent`.
 * - A `delivery.settled` with any other status (`superseded`, `replied`) is read
 *   and counted by neither outcome counter, and is still part of the derivation
 *   basis.
 * - `blockedConfirmed` pairs by `entryId` and order, never by elapsed time: each
 *   report is confirmed at most once, by the earliest later `progress` +
 *   `in_progress` or recorded disposition for that entry.
 * - `unresolvedDisagreements` counts one per dispute entry whose **final** status
 *   is not a closed one, attributed to that entry's recorded owner.
 * - `charterProposalsSuperseded` counts proposals that were **replaced** (a
 *   proposal id some other event named as `replacesProposalId`), attributed to
 *   the replaced proposal's own proposer.
 */

/**
 * The ledger statuses that mean "this entry is finished", imported from the
 * neutral protocol module rather than copied: `room-store.js` closes ledger
 * entries on the same list, and `unresolvedDisagreements` changes meaning with
 * the store's vocabulary (R43). Importing the constant keeps this module pure —
 * it is data, not the store — while removing the copy that had to "move
 * together" with the store's.
 */
import { CLOSED_LEDGER_STATUSES } from "./work-protocol.js";

/** Bumped whenever a counter is added, removed, or redefined. */
export const RELATIONSHIP_VERSION = 1;

/** Counters in a fixed order, so the serialised shape never depends on insertion. */
function emptyCounters() {
  return {
    deliveriesOffered: 0,
    deliveryFailures: 0,
    deliverySuccesses: 0,
    reviewsApproved: 0,
    reviewsChangesRequested: 0,
    blockedReports: 0,
    blockedConfirmed: 0,
    unresolvedDisagreements: 0,
    charterProposalsSuperseded: 0,
    messagesAuthored: 0
  };
}

/** Code-unit order: locale-free, so the output cannot depend on the OS locale. */
function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The event's tick; an envelope from before ticks existed reads as tick 0. */
function tickOf(event) {
  return Number.isFinite(event.tick) ? event.tick : 0;
}

/** The event's epoch-millisecond stamp; a missing one stays lowest, never "now". */
function atOf(event) {
  return Number.isFinite(event.at) ? event.at : 0;
}

/**
 * Total order over events. `(tick, at, id)` is the plan's sort key; the source
 * index is a final tiebreak so two envelopes sharing all three — impossible from
 * the writer, possible in a hand-built fixture — still count deterministically
 * without inventing a fact.
 */
function sortEvents(events) {
  return events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => tickOf(a.event) - tickOf(b.event)
      || atOf(a.event) - atOf(b.event)
      || compareStrings(String(a.event?.id), String(b.event?.id))
      || a.index - b.index)
    .map((entry) => entry.event);
}

/**
 * Which room an event belongs to, or null when the envelope says nothing. A
 * per-room log is the normal input, so this only ever rejects an event that
 * demonstrably belongs somewhere else — the cross-room leak a caller cannot see
 * from inside one room's file.
 */
function roomOf(event) {
  const declared = event?.provenance?.roomId ?? event?.roomId;
  return typeof declared === "string" && declared ? declared : null;
}

/**
 * Whether `candidate` sits after `reference` in the `(tick, at, id)` order the
 * log is counted in. A blocked report and the transition that retires it can
 * share a tick, so sequence — not elapsed time — decides which came first.
 */
function follows(candidate, reference) {
  const tick = tickOf(candidate);
  const other = tickOf(reference);
  if (tick !== other) return tick > other;
  const at = atOf(candidate);
  const otherAt = atOf(reference);
  if (at !== otherAt) return at > otherAt;
  return compareStrings(String(candidate?.id), String(reference?.id)) > 0;
}

/** Whether an event states a membership fact (R41). */
function statesMembership(event) {
  return event.type === "member.added" || event.type === "member.removed";
}

/**
 * The room's member set, read from the log.
 *
 * `member.added` / `member.removed` are the authoritative membership facts
 * (R41): for every session the log states, the statement decides — the last add
 * wins unless a later remove retires it, so a re-join is a new period and a
 * departure is not a tombstone. In a log written from a room's creation every
 * member is stated, so on such a log the events are the only source that names
 * anyone.
 *
 * The inference this module used before those events existed survives as the
 * fallback for the sessions the log **never states** — a session can only be
 * unstated in the part of a log written before the writer could state it. That
 * fallback is per session, never scoped to a prefix of the log: scoping it to
 * the events' own position let a room's first join truncate the fallback to
 * nothing and evict every member whose roster evidence sat after it (C1). The
 * price of reading the whole log is that a session named only by a stale
 * delivery is admitted too; that is the safe direction for an audit, and it can
 * happen only in a log that could not state the difference.
 *
 * The inference's sources are the ordered roster a turn executed, the recipients
 * it was scheduled for, and the members a delivery was addressed to. Both turn
 * lists are written from `room.members`, and a delivery can only be addressed to
 * a session a turn was scheduled for, so on a complete log the two agree. The
 * delivery source is kept anyway: an append is allowed to fail without failing
 * the room operation it observed, and a dropped `turn.scheduled` must not erase
 * the member whose delivery survived it.
 *
 * A message author is deliberately not used on either source: an author is
 * evidence that someone spoke, not that the room holds them as a member, so
 * admitting authors would let any session that ever spoke create member rows.
 *
 * Membership, like every other fact here, is bounded by the horizon (R46): a
 * member who joined after `asOfTick` is not yet an observer, and the events
 * beyond it are not part of the basis.
 */
function membershipFrom(sorted, tickCap) {
  const basisIds = [];
  const members = new Set();
  const lastAdd = new Map();
  const lastRemove = new Map();
  sorted.forEach((event, index) => {
    if (tickOf(event) > tickCap) return;
    if (event.type === "turn.scheduled") {
      // The membership basis is the scheduler's own statement of the room's
      // roster, not a member's activity.
      if (event.actor?.kind === "system" && String(event.actor?.id ?? "") === "system") basisIds.push(String(event.id));
      for (const id of [...(event.payload?.executed ?? []), ...(event.payload?.recipients ?? [])]) {
        if (typeof id === "string" && id) members.add(id);
      }
      return;
    }
    if (event.type === "delivery.sent") {
      const member = event.payload?.member;
      if (typeof member === "string" && member) members.add(member);
      return;
    }
    if (!statesMembership(event)) return;
    basisIds.push(String(event.id));
    const id = event.payload?.sessionId;
    if (typeof id !== "string" || !id) return;
    if (event.type === "member.added") lastAdd.set(id, index);
    else lastRemove.set(id, index);
  });
  for (const id of new Set([...lastAdd.keys(), ...lastRemove.keys()])) {
    const addedAt = lastAdd.get(id);
    const removedAt = lastRemove.get(id);
    // A re-join is a new period: the later of the two facts decides, so a
    // member who left and came back is an observer again.
    if (addedAt !== undefined && (removedAt === undefined || removedAt < addedAt)) members.add(id);
    else members.delete(id);
  }
  return { members, basisIds };
}

/** One target's accumulating row: counters, basis ids, and the freshest tick. */
function targetRow() {
  return { counters: emptyCounters(), ids: new Set(), maxTick: 0 };
}

/** Record that `event` was read as evidence about `target`. */
function note(rows, target, event) {
  // A non-string target is not a session: without this guard the missing value
  // would be stringified into the basis as the literal id "undefined", which is
  // a worse failure than omitting it.
  if (typeof target !== "string" || !target) return;
  const row = rows.get(target);
  if (!row) return;
  row.ids.add(String(event.id));
  if (tickOf(event) > row.maxTick) row.maxTick = tickOf(event);
}

/**
 * Read the sorted log once and produce every target's counters.
 *
 * The single pass is not only for speed: it is what makes one definition of
 * "which events count" serve both the counters and the derivation basis, so the
 * two can never drift apart.
 */
function count(sorted, tickCap) {
  // Membership is the one fact that belongs to no single pair: it is decided
  // once, from the membership events (or the pre-R41 inference behind them), and
  // every pair is handed that basis below.
  const { members: memberSet, basisIds: membershipIds } = membershipFrom(sorted, tickCap);
  const members = [...memberSet].sort(compareStrings);
  // Every member gets a row up front, so an observation can never be dropped
  // just because it arrived before the turn event that named its owner.
  const rows = new Map(members.map((id) => [id, targetRow()]));
  // Blocked reports and the events that can retire one, both grouped by entry in
  // the same pass; the proposal ids this log records, so a replacement can be
  // attributed to the proposer of the proposal it replaced.
  const blockedReports = new Map();
  const confirmations = new Map();
  const finalStatus = new Map();
  const proposalProposer = new Map();
  const supersededIds = new Set();

  for (const event of sorted) {
    const given = event.payload ?? {};
    if (event.type === "turn.scheduled") {
      if (tickOf(event) > tickCap) continue;
      for (const id of [...(given.executed ?? []), ...(given.recipients ?? [])]) {
        if (typeof id !== "string" || !id) continue;
        if (!rows.has(id)) rows.set(id, targetRow());
        note(rows, id, event);
      }
      continue;
    }
    if (tickOf(event) > tickCap) continue;

    if (event.type === "delivery.sent") {
      if (typeof given.member === "string" && rows.has(given.member)) {
        rows.get(given.member).counters.deliveriesOffered += 1;
        note(rows, given.member, event);
      }
      continue;
    }

    if (event.type === "delivery.settled") {
      if (typeof given.member !== "string" || !rows.has(given.member)) continue;
      // `failed` and `delivered` are the two counted outcomes; any other status
      // is read and counted by neither, yet still belongs to the basis.
      if (given.status === "failed") rows.get(given.member).counters.deliveryFailures += 1;
      else if (given.status === "delivered") rows.get(given.member).counters.deliverySuccesses += 1;
      note(rows, given.member, event);
      continue;
    }

    if (event.type === "message.created") {
      const author = event.provenance?.actorId;
      if (typeof author !== "string" || !rows.has(author)) continue;
      rows.get(author).counters.messagesAuthored += 1;
      note(rows, author, event);
      continue;
    }

    if (event.type === "ledger.transition") {
      const entry = String(given.entryId);
      if (given.entryId !== undefined) {
        // The dispute's establishing event is remembered alongside its final
        // status: a counted disagreement is read from *both* — the status fixes
        // whether it counts and the dispute transition fixes what it is — so
        // both belong in the basis that explains the count (R45).
        const prior = finalStatus.get(entry);
        // `disputeEvent` records the entry's *establishing* dispute transition
        // and is kept across later ones; `event` moves to each new last
        // transition, since the final status is what decides whether it counts.
        const disputeEvent = prior?.disputeEvent ?? (given.kind === "dispute" ? event : null);
        finalStatus.set(entry, { kind: given.kind, status: given.status, owner: given.ownerSessionId, disputeEvent, event });
      }
      // Recorded before the `replacesProposalId` early-read below: a proposer
      // must still be resolvable for a proposal this event did not replace.
      if (given.entryId !== undefined && typeof given.proposerSessionId === "string") {
        proposalProposer.set(entry, { proposer: given.proposerSessionId, event });
      }
      if (typeof given.replacesProposalId === "string" && given.replacesProposalId) supersededIds.add(given.replacesProposalId);
      if (given.reviewerSessionId === undefined && given.proposerSessionId === undefined
        && given.ownerSessionId === undefined) continue;

      const reviewer = given.reviewerSessionId;
      if (rows.has(reviewer) && given.verdict === "approve") {
        rows.get(reviewer).counters.reviewsApproved += 1;
        note(rows, reviewer, event);
      } else if (rows.has(reviewer) && given.verdict === "request_changes") {
        rows.get(reviewer).counters.reviewsChangesRequested += 1;
        note(rows, reviewer, event);
      }

      // A blocked report is retired by a later resume (`progress` +
      // `in_progress`) or a recorded disposition for the same entry. Both are
      // collected here, in sorted order, so pairing them costs one walk.
      const resumes = given.action === "progress" && given.state === "in_progress";
      if (resumes || typeof given.dispositionAction === "string") {
        const entry = String(given.entryId);
        if (!confirmations.has(entry)) confirmations.set(entry, []);
        confirmations.get(entry).push(event);
      }

      const owner = given.ownerSessionId;
      if (typeof owner !== "string") continue;
      if (given.action === "progress" && given.state === "blocked") {
        // The report is itself evidence about its owner; a confirmation is only
        // evidence once it actually retires a report, so that note waits for
        // the pairing pass below.
        if (rows.has(owner)) rows.get(owner).counters.blockedReports += 1;
        note(rows, owner, event);
        const entry = String(given.entryId);
        if (!blockedReports.has(entry)) blockedReports.set(entry, []);
        blockedReports.get(entry).push({ owner, event });
      } else if (resumes || typeof given.dispositionAction === "string") {
        note(rows, owner, event);
      }
      continue;
    }

    if (String(event.type ?? "").startsWith("charter.")) {
      if (given.proposalId !== undefined && typeof given.proposerSessionId === "string") {
        proposalProposer.set(String(given.proposalId), { proposer: given.proposerSessionId, event });
      }
      if (typeof given.replacesProposalId === "string" && given.replacesProposalId) supersededIds.add(given.replacesProposalId);
      // The act of replacing is evidence about the proposer who filed the new
      // draft as well as about the proposer it replaced.
      note(rows, given.proposerSessionId, event);
      continue;
    }
  }

  addConfirmedBlockers(rows, blockedReports, confirmations);
  addUnresolvedDisagreements(rows, finalStatus);
  addSupersededProposals(rows, proposalProposer, supersededIds, sorted, tickCap);
  return { members, rows, membershipIds };
}

/**
 * Pair each blocked report with the earliest later confirmation for its entry: a
 * resume (`progress` + `in_progress`) or a recorded disposition. Pairing walks
 * the sorted log rather than measuring elapsed time, so a report and its
 * confirmation can share a tick and still pair by sequence, and each
 * confirmation can retire at most one report.
 */
function addConfirmedBlockers(rows, blockedReports, confirmations) {
  for (const [entryId, reports] of blockedReports) {
    const qualifiers = confirmations.get(entryId) ?? [];
    // Both lists were pushed while walking the sorted log, so they are already
    // in sequence; a comparator here would only reintroduce the ordering
    // question this function exists to answer.
    let cursor = 0;
    for (const report of reports) {
      while (cursor < qualifiers.length) {
        const candidate = qualifiers[cursor];
        cursor += 1;
        if (!follows(candidate, report.event)) continue;
        if (rows.has(report.owner)) {
          rows.get(report.owner).counters.blockedConfirmed += 1;
          note(rows, report.owner, candidate);
        }
        break;
      }
    }
  }
}

/**
 * One unresolved disagreement per dispute entry whose final status is open.
 *
 * The owning session is the final transition's `ownerSessionId`. The plan's
 * table names no attribution field for this counter, so this is a deliberate
 * choice: the entry's last recorded owner is the member the disagreement is
 * currently attributed to, and a re-owned dispute counts against its new owner
 * rather than its first. Both driving events — the transition that established
 * the dispute and the transition that fixed its final status — are noted, so the
 * count is traceable to the events that produced it.
 */
function addUnresolvedDisagreements(rows, finalStatus) {
  for (const facts of finalStatus.values()) {
    if (facts.kind !== "dispute") continue;
    if (CLOSED_LEDGER_STATUSES.has(facts.status)) continue;
    if (!rows.has(facts.owner)) continue;
    rows.get(facts.owner).counters.unresolvedDisagreements += 1;
    note(rows, facts.owner, facts.event);
    note(rows, facts.owner, facts.disputeEvent);
  }
}

/** A superseded proposal counts against the proposer of the proposal replaced. */
function addSupersededProposals(rows, proposalProposer, supersededIds, sorted, tickCap) {
  for (const replacedId of supersededIds) {
    const replaced = proposalProposer.get(replacedId);
    if (!rows.has(replaced?.proposer)) continue;
    rows.get(replaced.proposer).counters.charterProposalsSuperseded += 1;
    // The replaced proposal's own record is what identifies its proposer, so it
    // is part of the basis that explains the count (R45).
    note(rows, replaced.proposer, replaced.event);
  }
  // The act of replacing is evidence about the proposer of the proposal that was
  // replaced, whether the replacement arrived as a ledger transition or as a
  // charter event. Capped here as well as in the counting walk (R46): an event
  // past the horizon is not evidence on any path, and noting it would raise
  // `pair.tick` and enter the basis while changing no counter.
  for (const event of sorted) {
    if (tickOf(event) > tickCap) continue;
    const given = event.payload ?? {};
    if (typeof given.replacesProposalId !== "string") continue;
    note(rows, proposalProposer.get(given.replacesProposalId)?.proposer, event);
  }
}

/**
 * Derive every directed pair's counters from one room's log.
 *
 * `roomId` scopes the read — an event that demonstrably belongs to another room
 * is not this room's evidence — and `asOfTick` is an inclusive horizon: an event
 * stamped after it is not evidence, which is what lets a turn snapshot describe
 * the state as of that turn rather than as of whenever it was written.
 */
export function deriveRelationships({ events, roomId, asOfTick } = {}) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array of event envelopes");
  if (typeof roomId !== "string" || !roomId) throw new TypeError("roomId must name the room whose log is being derived");
  if (asOfTick !== undefined && !(typeof asOfTick === "number" && Number.isFinite(asOfTick))) {
    throw new TypeError("asOfTick must be a finite number when provided");
  }

  const inRoom = events.filter((event) => {
    const declared = roomOf(event);
    return declared === null || declared === roomId;
  });
  const sorted = sortEvents(inRoom);
  const tickCap = asOfTick ?? (sorted.length === 0 ? 0 : Math.max(...sorted.map(tickOf)));

  const { members, rows, membershipIds } = count(sorted, tickCap);
  const membershipBasis = [...new Set(membershipIds)].sort(compareStrings);

  const pairs = [];
  for (const observer of members) {
    for (const target of members) {
      const row = rows.get(target);
      // The counters are copied per pair rather than shared: every observer of
      // one target genuinely sees the same numbers today, but a caller that
      // amends one pair must not thereby rewrite another.
      pairs.push({
        observer,
        target,
        // A pair reports the freshest evidence behind its own counters; a pair
        // with no evidence of its own reports 0 rather than the room's horizon.
        tick: row.maxTick,
        counters: { ...row.counters },
        derivedFrom: [...new Set([...membershipBasis, ...row.ids])].sort(compareStrings)
      });
    }
  }

  const derivedFrom = [...new Set(pairs.flatMap((pair) => pair.derivedFrom))].sort(compareStrings);
  return { pairs, derivedFrom };
}

/**
 * The "current relationships" projection: what the log's newest statements say
 * about each directed pair.
 *
 * The result is a plain JSON object keyed by observer, then by target, whose
 * value is that pair's `Counters` exactly as the snapshot carried them:
 *
 *     { "observer": { "target": { deliveriesOffered: 0, ... } } }
 *
 * An empty log — or any log with no `relationship.snapshot` — projects to `{}`:
 * this function reports what a snapshot *stated* and never derives, so a log
 * whose counters are all derivable still has no current relationships until an
 * event says what they are. A snapshot is not assumed complete either: a pair
 * the newest snapshot omits is read from the newest snapshot that names it, so
 * the projection is the most recent statement about each pair rather than the
 * latest snapshot's table.
 *
 * Snapshots are ordered by the same `(tick, at, id)` total order the derivation
 * counts in, not by their position in `events`, and the output's keys are
 * inserted in code-unit order — so neither the result nor its serialised text
 * depends on the order the caller happened to pass the log in, nor on any
 * `Map`/`Set` iteration order. Counters are copied, so amending the projection
 * cannot rewrite the events it was read from.
 */
export function latestRelationships(events, roomId) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array of event envelopes");
  if (typeof roomId !== "string" || !roomId) throw new TypeError("roomId must name the room whose log is being projected");

  const inRoom = events.filter((event) => {
    const declared = roomOf(event);
    return declared === null || declared === roomId;
  });

  // Observer -> target -> the counters of the newest snapshot that named it.
  const latest = new Map();
  for (const event of sortEvents(inRoom)) {
    if (event.type !== "relationship.snapshot") continue;
    const pairs = event.payload?.pairs;
    // A snapshot the module cannot interpret is skipped, not guessed at: an
    // unreadable pair table would otherwise contribute invented zero rows.
    if (!Array.isArray(pairs)) continue;
    for (const pair of pairs) {
      if (typeof pair?.observer !== "string" || !pair.observer) continue;
      if (typeof pair?.target !== "string" || !pair.target) continue;
      if (!pair.counters || typeof pair.counters !== "object" || Array.isArray(pair.counters)) continue;
      let row = latest.get(pair.observer);
      if (!row) { row = new Map(); latest.set(pair.observer, row); }
      row.set(pair.target, { ...pair.counters });
    }
  }

  const result = {};
  for (const observer of [...latest.keys()].sort(compareStrings)) {
    const row = latest.get(observer);
    const targets = {};
    for (const target of [...row.keys()].sort(compareStrings)) targets[target] = row.get(target);
    result[observer] = targets;
  }
  return result;
}
