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
 *   counters under every observer. This module derives the C backbone only; the
 *   A layer (`effectiveAppraisals` below) is each observer's own statements
 *   about others, and an appraisal is not a counter and never enters one. A
 *   reader that merges the two must label them apart: a count is what the room's
 *   event record states, an appraisal is a member's judgement.
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
 * - A `relationship.intervention` opens a **new counting window** for the
 *   targets it names: only events after it count, and a `set`/`seed` also gives
 *   the window its starting counters. The ten formulas above are unchanged —
 *   the window decides which events they are applied to. See
 *   `interventionWindows`.
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

/**
 * Bumped whenever a counter is added, removed, or redefined. An intervention
 * does not redefine one: it opens a new counting window that the same ten
 * formulas are applied inside, so a log with no intervention derives exactly
 * what it derived before this event existed.
 */
export const RELATIONSHIP_VERSION = 1;

/** Version 2 makes a full-memory reset explicit; unversioned events stay counter-only. */
export const MEMORY_CONTRACT_VERSION = 2;
export const MEMORY_SCOPES = Object.freeze(["counters", "all"]);

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

/**
 * Every counter's name, in the order `emptyCounters` declares them. Exported so
 * a writer can validate a counter set against this version's own vocabulary
 * rather than against a list copied beside it.
 */
export const RELATIONSHIP_COUNTER_NAMES = Object.freeze(Object.keys(emptyCounters()));

/**
 * The event a human intervention is recorded as, and the actions it may state.
 * The experiment's only lever: `clear` resets the named targets' counters from
 * the intervention on, `set`/`seed` also gives them the counters the event
 * states. A `seed` is a `set` that states a run's initial condition; the
 * derivation treats them alike, and the distinction is the writer's, recorded
 * in the event so a reader can tell an opening condition from a mid-run edit.
 */
export const RELATIONSHIP_INTERVENTION_EVENT_TYPE = "relationship.intervention";
export const INTERVENTION_ACTIONS = Object.freeze(["set", "clear", "seed"]);

/**
 * Event types this derivation reads past **on purpose**, and never by falling
 * through.
 *
 * Both belong to the experiment layer: a `run.manifest` states the fixed
 * configuration a run is judged by, and an `injection.cost` states what one
 * turn's relationship injection cost. Neither is evidence about who worked with
 * whom, so neither may move a counter. The manifest's arm *does* change the
 * counters, but through an intervention it appends — the arm's own event — and
 * if the record that measures the injection also counted, the measurement would
 * move the thing it measures.
 *
 * An earlier version of this module achieved the same result by simply not
 * naming these types, which left the decision invisible: a reader could not tell
 * a deliberate exclusion from a type nobody had handled yet. The strings are
 * restated here rather than imported from `lib/experiment.js` because that
 * module imports this one (importing it back would be a cycle); a test locks
 * them to `RUN_MANIFEST_EVENT_TYPE` and `INJECTION_COST_EVENT_TYPE`, so the two
 * lists cannot drift apart.
 */
export const RELATIONSHIP_IGNORED_EVENT_TYPES = Object.freeze(["run.manifest", "injection.cost"]);

/** The same list as a lookup, so the counting pass names each type once. */
const IGNORED_EVENT_TYPES = new Set(RELATIONSHIP_IGNORED_EVENT_TYPES);

/** Code-unit order: locale-free, so the output cannot depend on the OS locale. */
function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The event's tick; an envelope from before ticks existed reads as tick 0. */
export function tickOf(event) {
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
 *
 * Exported so a sibling reader of the same log (the evaluation script's
 * dependent variables) orders events exactly as the counters do, instead of
 * keeping a second copy of the key that could drift from this one.
 */
export function sortEvents(events) {
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

/**
 * The counter set an intervention states, or `null` when the event cannot be
 * read. A missing counter reads as zero so a `set` may name only the counters it
 * changes; a name this version does not define, or a value that is not a
 * non-negative integer, makes the whole event unreadable rather than being
 * guessed at — a counter the writer did not mean is worse than no counter.
 */
function readCounterSet(value) {
  if (value === undefined || value === null) return emptyCounters();
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const counters = emptyCounters();
  for (const [name, raw] of Object.entries(value)) {
    if (!Object.hasOwn(counters, name)) return null;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) return null;
    counters[name] = raw;
  }
  return counters;
}

/**
 * The counting windows an intervention opens, keyed by target: when the window
 * starts (the sorted index of the intervention that governs the target) and what
 * its counters start at.
 *
 * A `clear` starts the window at zero; `set`/`seed` start it at the counters the
 * event states. The last intervention naming a target governs every earlier
 * event, which is why this is read off the whole sorted log before anything is
 * counted rather than applied as the pass reaches it: an event between two
 * interventions is inside the later window, not the earlier one.
 *
 * `observerId` is deliberately not a window key. A counter describes its target
 * and is identical under every observer (see the module comment), so an
 * observer-scoped intervention would either rename that property or silently do
 * nothing; the writer records the field, and this reader states that the target
 * is what a counter belongs to.
 *
 * An intervention past the horizon opens nothing (R46), and one this module
 * cannot read is deliberately ignored rather than guessed at, exactly like an
 * unreadable snapshot.
 */
function interventionWindows(sorted, tickCap, targets) {
  const windows = new Map();
  sorted.forEach((event, index) => {
    if (event.type !== RELATIONSHIP_INTERVENTION_EVENT_TYPE) return;
    if (tickOf(event) > tickCap) return;
    const given = event.payload ?? {};
    if (!INTERVENTION_ACTIONS.includes(given.action)) return;
    const base = given.action === "clear" ? emptyCounters() : readCounterSet(given.counters);
    if (base === null) return;
    const named = typeof given.targetId === "string" && given.targetId ? given.targetId : null;
    for (const target of named === null ? targets : [named]) windows.set(target, { fromIndex: index, base });
  });
  return windows;
}

/** Whether an event at `index` sits inside the target's current counting window. */
function inWindow(windows, target, index) {
  const window = windows.get(target);
  return window === undefined || index > window.fromIndex;
}

/**
 * Record that `event` was read as evidence about `target`.
 *
 * `counted` is false for an event the target's counting window has closed over:
 * such an event is not evidence for the counters that window produced, so it is
 * not part of the basis that explains them either. An intervention that opens a
 * window is passed `true` by its own caller — it is the evidence for the restart
 * even though it is the window's first index, not one after it.
 */
function note(rows, target, event, counted) {
  if (!counted) return;
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
  // The counting windows are settled before anything is counted: the last
  // intervention naming a target governs every event before it, so an event
  // between two interventions belongs to the later window, not the earlier one.
  const windows = interventionWindows(sorted, tickCap, members);
  for (const [id, row] of rows) {
    const window = windows.get(id);
    // A `set`/`seed` opens its window from the counters it states; a `clear`
    // states none, so the row starts at zero.
    if (window) row.counters = { ...window.base };
  }
  // Blocked reports and the events that can retire one, both grouped by entry in
  // the same pass; the proposal ids this log records, so a replacement can be
  // attributed to the proposer of the proposal it replaced.
  const blockedReports = new Map();
  const confirmations = new Map();
  const finalStatus = new Map();
  const proposalProposer = new Map();
  const supersededBy = new Map();

  sorted.forEach((event, index) => {
    const given = event.payload ?? {};
    if (event.type === "turn.scheduled") {
      if (tickOf(event) > tickCap) return;
      for (const id of [...(given.executed ?? []), ...(given.recipients ?? [])]) {
        if (typeof id !== "string" || !id) continue;
        if (!rows.has(id)) {
          rows.set(id, targetRow());
          const window = windows.get(id);
          if (window) rows.get(id).counters = { ...window.base };
        }
        note(rows, id, event, inWindow(windows, id, index));
      }
      return;
    }
    if (tickOf(event) > tickCap) return;

    if (IGNORED_EVENT_TYPES.has(event.type)) {
      // Deliberately ignored: see `RELATIONSHIP_IGNORED_EVENT_TYPES`. The return
      // is written out so the exclusion is a decision at this branch rather than
      // an accident of the branches below not matching.
      return;
    }

    if (event.type === RELATIONSHIP_INTERVENTION_EVENT_TYPE) {
      // Deliberately handled: the windows above were read from exactly these
      // events, and each one is evidence for the counters it restarted even
      // though its index is the window's first rather than one after it (R45's
      // rule applied to the experiment's own lever).
      const named = typeof given.targetId === "string" && given.targetId ? given.targetId : null;
      for (const target of named === null ? members : [named]) note(rows, target, event, true);
      return;
    }

    if (event.type === "delivery.sent") {
      const member = given.member;
      if (typeof member !== "string" || !rows.has(member)) return;
      const counted = inWindow(windows, member, index);
      if (counted) rows.get(member).counters.deliveriesOffered += 1;
      note(rows, member, event, counted);
      return;
    }

    if (event.type === "delivery.settled") {
      const member = given.member;
      if (typeof member !== "string" || !rows.has(member)) return;
      const counted = inWindow(windows, member, index);
      // `failed` and `delivered` are the two counted outcomes; any other status
      // is read and counted by neither, yet still belongs to the basis.
      if (counted && given.status === "failed") rows.get(member).counters.deliveryFailures += 1;
      else if (counted && given.status === "delivered") rows.get(member).counters.deliverySuccesses += 1;
      note(rows, member, event, counted);
      return;
    }

    if (event.type === "message.created") {
      const author = event.provenance?.actorId;
      if (typeof author !== "string" || !rows.has(author)) return;
      const counted = inWindow(windows, author, index);
      if (counted) rows.get(author).counters.messagesAuthored += 1;
      note(rows, author, event, counted);
      return;
    }

    if (event.type === "ledger.transition") {
      const entry = String(given.entryId);
      if (given.entryId !== undefined) {
        // The dispute's establishing event is remembered alongside its final
        // status: a counted disagreement is read from *both* — the status fixes
        // whether it counts and the dispute transition fixes what it is — so
        // both belong in the basis that explains the count (R45). Its index is
        // kept too, because the window is decided per event position.
        const prior = finalStatus.get(entry);
        // `disputeEvent` records the entry's *establishing* dispute transition
        // and is kept across later ones; `event` moves to each new last
        // transition, since the final status is what decides whether it counts.
        const disputeEvent = prior?.disputeEvent ?? (given.kind === "dispute" ? event : null);
        const disputeIndex = prior?.disputeIndex ?? (given.kind === "dispute" ? index : -1);
        finalStatus.set(entry, { kind: given.kind, status: given.status, owner: given.ownerSessionId,
          disputeEvent, disputeIndex, event, index });
      }
      // Recorded before the `replacesProposalId` early-read below: a proposer
      // must still be resolvable for a proposal this event did not replace.
      if (given.entryId !== undefined && typeof given.proposerSessionId === "string") {
        proposalProposer.set(entry, { proposer: given.proposerSessionId, event, index });
      }
      if (typeof given.replacesProposalId === "string" && given.replacesProposalId) {
        supersededBy.set(given.replacesProposalId, { event, index });
      }
      if (given.reviewerSessionId === undefined && given.proposerSessionId === undefined
        && given.ownerSessionId === undefined) return;

      const reviewer = given.reviewerSessionId;
      if (rows.has(reviewer)) {
        const counted = inWindow(windows, reviewer, index);
        if (counted && given.verdict === "approve") {
          rows.get(reviewer).counters.reviewsApproved += 1;
          note(rows, reviewer, event, true);
        } else if (counted && given.verdict === "request_changes") {
          rows.get(reviewer).counters.reviewsChangesRequested += 1;
          note(rows, reviewer, event, true);
        }
      }

      // A blocked report is retired by a later resume (`progress` +
      // `in_progress`) or a recorded disposition for the same entry. Both are
      // collected here, in sorted order, so pairing them costs one walk.
      const resumes = given.action === "progress" && given.state === "in_progress";
      if (resumes || typeof given.dispositionAction === "string") {
        if (!confirmations.has(entry)) confirmations.set(entry, []);
        confirmations.get(entry).push({ event, index });
      }

      const owner = given.ownerSessionId;
      if (typeof owner !== "string") return;
      if (given.action === "progress" && given.state === "blocked") {
        // The report is itself evidence about its owner; a confirmation is only
        // evidence once it actually retires a report, so that note waits for
        // the pairing pass below.
        const counted = inWindow(windows, owner, index);
        if (counted && rows.has(owner)) rows.get(owner).counters.blockedReports += 1;
        note(rows, owner, event, counted);
        if (!blockedReports.has(entry)) blockedReports.set(entry, []);
        blockedReports.get(entry).push({ owner, event, index });
      } else if (resumes || typeof given.dispositionAction === "string") {
        note(rows, owner, event, inWindow(windows, owner, index));
      }
      return;
    }

    // Currently unreachable from production code: no writer in this plugin
    // emits a `charter.*` event, so every proposal fact arrives on a
    // `ledger.transition` (the `kind === "charter"` handling above) instead.
    // The branch is kept because the derivation is also run over logs it did
    // not write — an older format, or a hand-built fixture — and a proposal
    // spelled that way must still count rather than be silently dropped.
    if (String(event.type ?? "").startsWith("charter.")) {
      if (given.proposalId !== undefined && typeof given.proposerSessionId === "string") {
        proposalProposer.set(String(given.proposalId), { proposer: given.proposerSessionId, event, index });
      }
      if (typeof given.replacesProposalId === "string" && given.replacesProposalId) {
        supersededBy.set(given.replacesProposalId, { event, index });
      }
      // The act of replacing is evidence about the proposer who filed the new
      // draft as well as about the proposer it replaced.
      note(rows, given.proposerSessionId, event, inWindow(windows, given.proposerSessionId, index));
      return;
    }
  });

  addConfirmedBlockers(rows, blockedReports, confirmations, windows);
  addUnresolvedDisagreements(rows, finalStatus, windows);
  addSupersededProposals(rows, proposalProposer, supersededBy, sorted, tickCap, windows);
  return { members, rows, membershipIds };
}

/**
 * Pair each blocked report with the earliest later confirmation for its entry: a
 * resume (`progress` + `in_progress`) or a recorded disposition. Pairing walks
 * the sorted log rather than measuring elapsed time, so a report and its
 * confirmation can share a tick and still pair by sequence, and each
 * confirmation can retire at most one report.
 *
 * A report the owner's counting window has closed over is not counted, and
 * neither is a confirmation that only lives before that window: a reset retires
 * both halves of the pair.
 */
function addConfirmedBlockers(rows, blockedReports, confirmations, windows) {
  for (const [entryId, reports] of blockedReports) {
    const qualifiers = confirmations.get(entryId) ?? [];
    // Both lists were pushed while walking the sorted log, so they are already
    // in sequence; a comparator here would only reintroduce the ordering
    // question this function exists to answer.
    let cursor = 0;
    for (const report of reports) {
      if (!inWindow(windows, report.owner, report.index)) continue;
      while (cursor < qualifiers.length) {
        const candidate = qualifiers[cursor];
        cursor += 1;
        if (!follows(candidate.event, report.event)) continue;
        if (rows.has(report.owner) && inWindow(windows, report.owner, candidate.index)) {
          rows.get(report.owner).counters.blockedConfirmed += 1;
          note(rows, report.owner, candidate.event, true);
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
 *
 * The count is read from the *establishing* dispute transition, so a reset
 * closes over a dispute that began before it: a later resolution cannot
 * resurrect a disagreement the window no longer contains.
 */
function addUnresolvedDisagreements(rows, finalStatus, windows) {
  for (const facts of finalStatus.values()) {
    if (facts.kind !== "dispute") continue;
    if (CLOSED_LEDGER_STATUSES.has(facts.status)) continue;
    if (!rows.has(facts.owner)) continue;
    if (!inWindow(windows, facts.owner, facts.disputeIndex)) continue;
    rows.get(facts.owner).counters.unresolvedDisagreements += 1;
    note(rows, facts.owner, facts.event, true);
    note(rows, facts.owner, facts.disputeEvent, true);
  }
}

/**
 * A superseded proposal counts against the proposer of the proposal replaced.
 *
 * Both events that state the fact — the replaced proposal's own record and the
 * replacement that names it — must fall inside that proposer's counting window,
 * or a reset would leave a counter derived from a proposal the window no longer
 * contains.
 */
function addSupersededProposals(rows, proposalProposer, supersededBy, sorted, tickCap, windows) {
  for (const [replacedId, replaced] of supersededBy) {
    const proposal = proposalProposer.get(replacedId);
    if (!proposal || !rows.has(proposal.proposer)) continue;
    if (!inWindow(windows, proposal.proposer, proposal.index)) continue;
    if (!inWindow(windows, proposal.proposer, replaced.index)) continue;
    rows.get(proposal.proposer).counters.charterProposalsSuperseded += 1;
    // The replaced proposal's own record is what identifies its proposer, so it
    // is part of the basis that explains the count (R45).
    note(rows, proposal.proposer, proposal.event, true);
  }
  // The act of replacing is evidence about the proposer of the proposal that was
  // replaced, whether the replacement arrived as a ledger transition or as a
  // charter event. Capped here as well as in the counting walk (R46): an event
  // past the horizon is not evidence on any path, and noting it would raise
  // `pair.tick` and enter the basis while changing no counter. It is capped by
  // the counting window for the same reason.
  sorted.forEach((event, index) => {
    if (tickOf(event) > tickCap) return;
    const given = event.payload ?? {};
    if (typeof given.replacesProposalId !== "string") return;
    const proposer = proposalProposer.get(given.replacesProposalId)?.proposer;
    note(rows, proposer, event, inWindow(windows, proposer, index));
  });
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
      // one target genuinely sees the same numbers, because a counter is read
      // from the room's event record alone and no appraisal can enter one, but a
      // caller that amends one pair must not thereby rewrite another.
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

/**
 * The A overlay's closed vocabulary: the stances an appraisal may state. The
 * three values are the decision the plan's Task 4.1 leaves open, and they are
 * exported so the writer validates against the same set the reader interprets.
 */
export const APPRAISAL_STANCES = Object.freeze(["trust", "distrust", "neutral"]);

/** `[0,1]` inclusive: one confidence unit is "certain", 0 is "no confidence". */
export const APPRAISAL_CONFIDENCE_MIN = 0;
export const APPRAISAL_CONFIDENCE_MAX = 1;

/** A claim's and a perceived role's hard length, so one appraisal stays bounded. */
export const APPRAISAL_CLAIM_MAX_CHARS = 2_000;

/**
 * Part of the A layer's event vocabulary: the event a member's appraisal of
 * another member is recorded as, and the one a revocation is recorded as (a new
 * `appraisal` event, never a deletion — the record it revokes stays in the log).
 */
export const APPRAISAL_EVENT_TYPE = "appraisal";

/** One appraisal event's own `validFrom`, or the event's tick when it states none. */
function validFromOf(event) {
  const stated = event.payload?.validFrom;
  return Number.isFinite(stated) ? stated : tickOf(event);
}

/** One appraisal event's stated `validTo`, or `null` while it is open-ended. */
function validToOf(event) {
  const stated = event.payload?.validTo;
  return stated === undefined || stated === null || !Number.isFinite(stated) ? null : stated;
}

/** The closed vocabulary of actions an `appraisal` event may state. */
const APPRAISAL_ACTIONS = Object.freeze(["record", "revoke"]);

/** Whether one event is an appraisal this module can read rather than skip. */
function isReadableAppraisal(event) {
  if (event.type !== APPRAISAL_EVENT_TYPE) return false;
  const given = event.payload ?? {};
  if (typeof given.observerId !== "string" || !given.observerId) return false;
  if (typeof given.aboutAgentId !== "string" || !given.aboutAgentId) return false;
  const action = given.action ?? "record";
  if (!APPRAISAL_ACTIONS.includes(action)) return false;
  if (!APPRAISAL_STANCES.includes(given.stance)) return false;
  if (typeof given.confidence !== "number" || !Number.isFinite(given.confidence)) return false;
  if (given.confidence < APPRAISAL_CONFIDENCE_MIN || given.confidence > APPRAISAL_CONFIDENCE_MAX) return false;
  if (typeof given.claim !== "string" || !given.claim) return false;
  return true;
}

/** One readable appraisal as the plain value a caller may hold. */
function appraisalValue(event) {
  const given = event.payload ?? {};
  return {
    appraisalId: String(event.id),
    stance: given.stance,
    confidence: given.confidence,
    claim: given.claim,
    perceivedRole: typeof given.perceivedRole === "string" && given.perceivedRole ? given.perceivedRole : null,
    evidenceCount: Array.isArray(given.evidenceEventIds) ? given.evidenceEventIds.length : 0,
    validFrom: validFromOf(event),
    validTo: validToOf(event)
  };
}

/** The order a statement is applied in: its own interval's start, then the fact. */
function appraisalOrder(event) {
  return [validFromOf(event), tickOf(event), atOf(event), String(event.id)];
}

function compareOrders(a, b) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || compareStrings(a[3], b[3]);
}

/**
 * The state of one pair's interval at `horizon`, replayed from the statements
 * that apply to it in their own order of application.
 *
 * The statements are replayed rather than selected one by one, because a
 * revocation is a statement *about* an interval and not a value of its own: it
 * closes the interval that is open when it applies and opens none. The last
 * statement whose interval has started by `horizon` is therefore the one in
 * force, and a revocation leaves `revoked: true` behind it rather than the
 * record it retired — which is what makes "the projection no longer contains the
 * revoked appraisal" true **and** the record still readable in the log.
 *
 * A revocation that applies before the horizon is a fact like any other: unlike
 * a record, whose `validFrom` alone decides whether it has started, a revocation
 * decides the state for every later tick.
 */
function reduceInterval(statements, horizon) {
  let state = null;
  let starts = false;
  for (const event of statements) {
    // A record is in force from the tick it states; a revocation only applies
    // once its own tick has been reached, because that tick is the first tick
    // the interval it closes is no longer in force.
    const action = event.payload?.action ?? "record";
    if (action === "revoke") {
      if (tickOf(event) > horizon) continue;
      state = null;
      starts = false;
      continue;
    }
    if (validFromOf(event) > horizon) continue;
    if (state === null || !starts) {
      state = event;
      starts = true;
      continue;
    }
    if (compareOrders(appraisalOrder(event), appraisalOrder(state)) >= 0) state = event;
  }
  return state;
}

/**
 * Appraisal statements inside the current memory window. Old interventions had
 * only counter semantics, so neither their presence nor a future unknown
 * version may silently revoke beliefs when replayed by this build. A version-2
 * full clear closes every earlier belief about its target, under every observer,
 * while retaining every source event. A later statement at the same tick is in
 * the new window because the boundary is an event position, not just a tick.
 */
function currentAppraisalStatements(sorted, horizon) {
  let allFrom = -1;
  const targetFrom = new Map();
  sorted.forEach((event, index) => {
    const given = event.payload ?? {};
    if (tickOf(event) > horizon || event.type !== RELATIONSHIP_INTERVENTION_EVENT_TYPE
      || given.action !== "clear" || given.memoryScope !== "all"
      || given.memoryVersion !== MEMORY_CONTRACT_VERSION) return;
    if (typeof given.targetId === "string" && given.targetId) targetFrom.set(given.targetId, index);
    else allFrom = index;
  });
  return sorted.filter((event, index) => isReadableAppraisal(event)
    && tickOf(event) <= horizon && validFromOf(event) <= horizon
    && index > Math.max(allFrom, targetFrom.get(event.payload.aboutAgentId) ?? -1));
}

/** Facts and beliefs sampled from the same room prefix and tick, as separate values. */
export function sampleRelationshipMemory({ events, roomId, asOfTick } = {}) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array of event envelopes");
  if (typeof roomId !== "string" || !roomId) throw new TypeError("roomId must name the sampled room");
  const inRoom = events.filter((event) => roomOf(event) === null || roomOf(event) === roomId);
  const horizon = Number.isFinite(asOfTick) ? asOfTick : inRoom.reduce((tick, event) => Math.max(tick, tickOf(event)), 0);
  const prefix = inRoom.filter((event) => tickOf(event) <= horizon);
  return { memoryVersion: MEMORY_CONTRACT_VERSION, asOfTick: horizon,
    derived: deriveRelationships({ events: prefix, roomId, asOfTick: horizon }),
    appraisals: effectiveAppraisals(prefix, roomId, horizon) };
}

/**
 * Every effective appraisal, keyed by observer and then by target, read from one
 * room's log. This is the A layer's projection.
 *
 * Appraisal events carry no counter: a `claim` is somebody's judgement, and
 * folding it into a count would present a judgement as a measurement. They are
 * therefore derived here, on their own path, and `deriveRelationships` never
 * reads the event type at all — an `appraisal` in the log changes no counter,
 * which is asserted by test.
 *
 * The projection follows the C projection's shape and ordering rules: keys are
 * emitted in code-unit order, so the result and its serialised text do not
 * depend on the order the caller passed the log in, nor on `Map`/`Set`
 * iteration order. `asOfTick` is an inclusive horizon like the derivation's: a
 * statement whose interval has not started by then is not yet in force.
 *
 * A pair that is currently revoked projects to `null` rather than to the record
 * it retired — the key is present and carries no judgement. That is what lets a
 * reader tell "this member has no current judgement about that one" (the key is
 * absent) from "this member withdrew the judgement they had" (the key is there,
 * with `null`), without either reading the retired record as if it still stood.
 *
 * Only the fields a reader needs travel: the appraisal's own event id (so a
 * revocation can name exactly the statement it revokes), the stance, the
 * confidence, the claim, the perceived role, the interval and the number of
 * evidence events the statement cited. The evidence ids themselves stay in the
 * log, where the statement's own record carries them.
 */
export function effectiveAppraisals(events, roomId, asOfTick) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array of event envelopes");
  if (typeof roomId !== "string" || !roomId) throw new TypeError("roomId must name the room whose log is being projected");

  const inRoom = events.filter((event) => {
    const declared = roomOf(event);
    return declared === null || declared === roomId;
  });
  const sorted = sortEvents(inRoom);
  const horizon = Number.isFinite(asOfTick)
    ? asOfTick
    : (sorted.length === 0 ? 0 : Math.max(...sorted.map(tickOf)));

  // Observer -> target -> that interval's statements, in the log's total order.
  // Grouping over the sorted log means the replay below sees each pair's
  // statements in exactly the order the log fixes, not in the order the caller
  // happened to pass them in.
  const intervals = new Map();
  for (const event of currentAppraisalStatements(sorted, horizon)) {
    const given = event.payload;
    let row = intervals.get(given.observerId);
    if (!row) { row = new Map(); intervals.set(given.observerId, row); }
    if (!row.has(given.aboutAgentId)) row.set(given.aboutAgentId, []);
    row.get(given.aboutAgentId).push(event);
  }

  const result = {};
  for (const observer of [...intervals.keys()].sort(compareStrings)) {
    const row = intervals.get(observer);
    const targets = {};
    for (const target of [...row.keys()].sort(compareStrings)) {
      const current = reduceInterval(row.get(target), horizon);
      targets[target] = current === null ? null : appraisalValue(current);
    }
    result[observer] = targets;
  }
  return result;
}

/**
 * The appraisal one observer may revoke, or `null`.
 *
 * The statement the pair's interval currently holds is the one a revocation may
 * name. This answers with the event that **stated** it, so the writer can tell
 * an already-revoked interval from an open one and refuses to revoke twice: a
 * `null` state is exactly "there is nothing open to revoke". The replay is the
 * projection's own, so the appraisal a caller is told to revoke is the one
 * `chat_relationships` showed them.
 *
 * A statement whose interval has not started by `asOfTick` — a hand-written
 * fixture, never the writer — is not yet in force and stays unrevocable, the
 * same way it is invisible to the projection.
 */
export function revocableAppraisal(events, roomId, observerId, aboutAgentId, asOfTick) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array of event envelopes");
  if (typeof roomId !== "string" || !roomId) throw new TypeError("roomId must name the room whose log is being read");
  if (typeof observerId !== "string" || !observerId) return null;
  if (typeof aboutAgentId !== "string" || !aboutAgentId) return null;

  const inRoom = events.filter((event) => {
    const declared = roomOf(event);
    return declared === null || declared === roomId;
  });
  const sorted = sortEvents(inRoom);
  const horizon = Number.isFinite(asOfTick)
    ? asOfTick
    : (sorted.length === 0 ? 0 : Math.max(...sorted.map(tickOf)));

  const statements = currentAppraisalStatements(sorted, horizon).filter((event) =>
    event.payload.observerId === observerId && event.payload.aboutAgentId === aboutAgentId);
  return reduceInterval(statements, horizon);
}

/** Whether a revocation for `event` would state an interval that is not empty. */
export function revocableInterval(event, tick) {
  return typeof tick === "number" && Number.isFinite(tick) && tick > validFromOf(event);
}
