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

/** Bumped whenever a counter is added, removed, or redefined. */
export const RELATIONSHIP_VERSION = 1;

/**
 * The ledger statuses that mean "this entry is finished".
 *
 * Duplicated from `lib/room-store.js` rather than imported: this module must
 * stay free of the store, because reading the store would replace the event log
 * as the source of truth. The two lists are one contract — if the store's ledger
 * status vocabulary changes, `unresolvedDisagreements` changes meaning with it —
 * so the copy is deliberate and must move together with the store's
 * `CLOSED_LEDGER_STATUSES`.
 */
const CLOSED_LEDGER_STATUSES = new Set(["done", "decided", "resolved", "archived", "cancelled", "paused"]);

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

/**
 * The room's member set, read from the log.
 *
 * There is no member-added event yet, so membership is the union of every
 * session the log places *in the room's turn structure*: the ordered roster a
 * turn executed, the recipients it was scheduled for, and the members a delivery
 * was addressed to. Both turn lists are written from `room.members`, and a
 * delivery can only be addressed to a session a turn was scheduled for, so on a
 * complete log the two sources agree. The delivery source is kept anyway: an
 * append is allowed to fail without failing the room operation it observed, and
 * a dropped `turn.scheduled` must not erase the member whose delivery survived
 * it. The cost of that robustness is that an event naming a session the room no
 * longer holds admits an observer row with all-zero counters — a visible
 * over-inclusion, which is the safer direction for an audit.
 *
 * A message author is deliberately not used: an author is evidence that someone
 * spoke, not that the room holds them as a member, so admitting authors would let
 * any session that ever spoke create member rows.
 */
function membersFrom(sorted) {
  const members = new Set();
  for (const event of sorted) {
    const given = event.payload ?? {};
    if (event.type === "turn.scheduled") {
      for (const id of [...(given.executed ?? []), ...(given.recipients ?? [])]) {
        if (typeof id === "string" && id) members.add(id);
      }
    } else if (event.type === "delivery.sent") {
      if (typeof given.member === "string" && given.member) members.add(given.member);
    }
  }
  return members;
}

/** One target's accumulating row: counters, basis ids, and the freshest tick. */
function targetRow() {
  return { counters: emptyCounters(), ids: new Set(), maxTick: 0 };
}

/** Record that `event` was read as evidence about `target`. */
function note(rows, target, event) {
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
  const members = [...membersFrom(sorted)].sort(compareStrings);
  // Every member gets a row up front, so an observation can never be dropped
  // just because it arrived before the turn event that named its owner.
  const rows = new Map(members.map((id) => [id, targetRow()]));
  const membershipIds = [];
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
      // Membership is the one fact that belongs to no single pair; it is noted
      // separately and added to every pair's basis below.
      if (event.actor?.kind === "system" && String(event.actor?.id ?? "") === "system") membershipIds.push(String(event.id));
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
      if (given.entryId !== undefined) {
        finalStatus.set(String(given.entryId), { kind: given.kind, status: given.status, owner: given.ownerSessionId });
        if (typeof given.proposerSessionId === "string") proposalProposer.set(String(given.entryId), given.proposerSessionId);
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
        proposalProposer.set(String(given.proposalId), given.proposerSessionId);
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
  addSupersededProposals(rows, proposalProposer, supersededIds, sorted);
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

/** One unresolved disagreement per dispute entry whose final status is open. */
function addUnresolvedDisagreements(rows, finalStatus) {
  for (const facts of finalStatus.values()) {
    if (facts.kind !== "dispute") continue;
    if (CLOSED_LEDGER_STATUSES.has(facts.status)) continue;
    if (!rows.has(facts.owner)) continue;
    rows.get(facts.owner).counters.unresolvedDisagreements += 1;
  }
}

/** A superseded proposal counts against the proposer of the proposal replaced. */
function addSupersededProposals(rows, proposalProposer, supersededIds, sorted) {
  for (const replacedId of supersededIds) {
    const proposer = proposalProposer.get(replacedId);
    if (!rows.has(proposer)) continue;
    rows.get(proposer).counters.charterProposalsSuperseded += 1;
  }
  // The act of replacing is evidence about the proposer of the proposal that was
  // replaced, whether the replacement arrived as a ledger transition or as a
  // charter event.
  for (const event of sorted) {
    const given = event.payload ?? {};
    if (typeof given.replacesProposalId !== "string") continue;
    note(rows, proposalProposer.get(given.replacesProposalId), event);
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
