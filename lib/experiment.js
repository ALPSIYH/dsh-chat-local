/**
 * Experiment scaffolding for the relational layer: the terms the injected
 * relationship digest is built from and the hash of those terms, the run
 * manifest, the injection cost of one member's turn, and the dependent
 * variables an evaluation reads out of a log.
 *
 * Pure on purpose: no I/O, no wall clock, no randomness, no model. The
 * evaluation script reads the logs and renders what this module computes, so
 * the arithmetic a reader is asked to trust can be tested without a running
 * harness — and the config hash cannot depend on when it was computed.
 *
 * There is one source for every digest term. The injected text is assembled in
 * `room-store.js` from the constants below, and `injectionConfigFor` hashes
 * exactly those constants, so a term can never change the injected text without
 * changing the hash an experiment's comparability rests on. A change to the
 * digest *algorithm* (which lines are kept, how truncation picks them) is not a
 * term and must bump `INJECTION_CONFIG_VERSION`; that convention is stated here
 * because it is the one part of this guarantee code cannot enforce.
 */
import { createHash } from "node:crypto";
import { CLOSED_LEDGER_STATUSES } from "./work-protocol.js";
import { sortEvents, tickOf, RELATIONSHIP_INTERVENTION_EVENT_TYPE } from "./relationship.js";

/**
 * The version of the *rules* that turn the terms below into injected text. A
 * term change shows up in the hash by itself; bump this when the algorithm
 * changes, so two runs whose text was assembled differently do not look
 * comparable.
 */
export const INJECTION_CONFIG_VERSION = 1;

/**
 * Hard cap on the injected relationship digest, in UTF-16 code units — the same
 * unit `turn.prompt`'s recorded `promptChars` counts. The digest is part of the
 * experiment's independent variable and is recorded verbatim, so its size must
 * be bounded by construction rather than by whoever happens to be in the room.
 */
export const RELATIONSHIP_DIGEST_MAX_CHARS = 600;

/** How much of one appraisal's claim travels, so one claim cannot fill the budget. */
export const RELATIONSHIP_DIGEST_CLAIM_MAX_CHARS = 120;

/**
 * The heading of the counting half of the digest. The wording converges on one
 * term for the ten counters across every surface that names them — this heading,
 * the `chat_relationships` tool description and `README.md` all say 「本房间事件记录」
 * — because three names for one thing read as three things. The other claims are
 * equally deliberate: these are counts read from the room's log, not a stance,
 * not a claim that every count came from a public message (delivery failures and
 * ledger transitions are counted too), and only non-zero counters are listed.
 */
export const RELATIONSHIP_DIGEST_HEADING =
  "你与各参与者的关系计数（按本房间事件记录计数，不代表任何人的态度或评价；仅列非零项）：";

/**
 * The heading of the appraisal half, printed once before the first piece of
 * judgement. Two claims carry the whole point of the A layer: these lines are
 * the member's own judgement rather than a fact the room recorded, and each one
 * states the confidence it was held with and how many evidence events it cited.
 */
export const RELATIONSHIP_DIGEST_APPRAISAL_HEADING =
  "成员本人至今对自己眼中的对象作过的判断（这是本人表态，不是本房间的事实记录；仅列现行有效项，附把握与证据条数）：";

/**
 * Counter label and display order, fixed so the same derivation always renders
 * the same bytes. The first two entries also set the truncation order: an
 * unresolved disagreement outranks a delivery failure, which outranks the rest.
 */
export const RELATIONSHIP_DIGEST_COUNTERS = Object.freeze([
  ["unresolvedDisagreements", "未闭环分歧"],
  ["deliveryFailures", "投递失败"],
  ["deliveriesOffered", "投递次数"],
  ["deliverySuccesses", "投递成功"],
  ["messagesAuthored", "发言"],
  ["reviewsApproved", "评审通过"],
  ["reviewsChangesRequested", "评审退回"],
  ["blockedReports", "报告阻断"],
  ["blockedConfirmed", "阻断解除"],
  ["charterProposalsSuperseded", "章程提案被替换"]
]);

/**
 * A stance's rendering. The closed vocabulary is `APPRAISAL_STANCES`; a value
 * outside it is refused by the writer, and cannot reach the renderer from a log
 * a writer wrote. An unrecognised value that a hand-built log does carry renders
 * as its own text rather than as an invented stance.
 */
export const RELATIONSHIP_DIGEST_STANCES = Object.freeze([
  ["trust", "信任"],
  ["distrust", "不信任"],
  ["neutral", "中立"]
]);

/** One line's shape, as a substitution template rather than a literal in code. */
export const RELATIONSHIP_DIGEST_COUNTER_TEMPLATE = "与「{label}」：{counters}";
export const RELATIONSHIP_DIGEST_APPRAISAL_TEMPLATE =
  "（判断）对「{label}」：{stance}，把握 {confidence}，证据 {evidence} 条{role}——他本人的说法「{quoted}」";
export const RELATIONSHIP_DIGEST_ROLE_TEMPLATE = "，他自认的角色「{role}」";
export const RELATIONSHIP_DIGEST_FIELD_TEMPLATE = "{label} {value}";
export const RELATIONSHIP_DIGEST_COUNTER_JOIN = "、";

/** Fill one `{name}` template. An unknown name renders as nothing, never as the braces. */
export function fillTemplate(template, values) {
  return String(template).replace(/\{([A-Za-z]+)\}/gu, (_match, key) => String(values?.[key] ?? ""));
}

/**
 * Every term the injected digest depends on, as one plain value.
 *
 * `gate` is the room's governance-gate switch and `appraisalDigest` is whether
 * the judgement half is injected at all — both change the text a member reads,
 * so both belong here even though neither is part of the digest's own rendering
 * constants.
 */
export function injectionConfigFor({ room, appraisalDigest = true } = {}) {
  return {
    version: INJECTION_CONFIG_VERSION,
    maxChars: RELATIONSHIP_DIGEST_MAX_CHARS,
    claimMaxChars: RELATIONSHIP_DIGEST_CLAIM_MAX_CHARS,
    headings: [RELATIONSHIP_DIGEST_HEADING, RELATIONSHIP_DIGEST_APPRAISAL_HEADING],
    counters: RELATIONSHIP_DIGEST_COUNTERS.map((entry) => [...entry]),
    stances: RELATIONSHIP_DIGEST_STANCES.map((entry) => [...entry]),
    templates: [RELATIONSHIP_DIGEST_COUNTER_TEMPLATE, RELATIONSHIP_DIGEST_APPRAISAL_TEMPLATE,
      RELATIONSHIP_DIGEST_ROLE_TEMPLATE, RELATIONSHIP_DIGEST_FIELD_TEMPLATE,
      RELATIONSHIP_DIGEST_COUNTER_JOIN],
    appraisalDigest: appraisalDigest !== false,
    gate: room?.policy?.gate === true
  };
}

/**
 * Canonical JSON for the config hash: object keys sorted at every depth, so a
 * config a caller assembled in another order hashes the same. `Array.from` (not
 * `map`) so a sparse array's holes materialise as `null` rather than being
 * skipped. The rule is the event log's own; it is restated here because this
 * module is imported by a read-only script that must not pull in the log writer.
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${Array.from(value, canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The SHA-256 of one injection config, insensitive to key order at every depth. */
export function configHashOf(config) {
  return createHash("sha256").update(canonicalJson(config)).digest("hex");
}

/** The hash of the injection config a room is currently judged by. */
export function relationshipConfigHash({ room, appraisalDigest } = {}) {
  return configHashOf(injectionConfigFor({ room, appraisalDigest }));
}

/** The event a run's fixed configuration is recorded as. */
export const RUN_MANIFEST_EVENT_TYPE = "run.manifest";

/** The run-level arms: relationship state carried across episodes, or reset per episode. */
export const RUN_ARMS = Object.freeze(["persistent", "reset_per_episode"]);

/**
 * The mechanism the automatic per-episode reset records itself under. It is not
 * a human's intervention (`appliedBy: "arm"`) and it opens one episode: see
 * `episodeResetRecorded`.
 */
export const ARM_RESET_MECHANISM = "arm:reset_per_episode";

/**
 * Whether the run the log is currently in has already opened `episodeId` with an
 * automatic reset.
 *
 * An episode is one root message's turn sequence. A retry of a failed delivery
 * re-runs that same root message — `retryFailedDeliveries` starts another
 * `#runTurn` for it rather than a new episode — so the arm's `clear`, defined
 * "per episode", may be appended only once per (run, root message). Without this
 * check the recovery path would reset twice and the arm would in fact be "reset
 * per turn attempt", which is not what its name, its mechanism or the README
 * say it is.
 *
 * The search starts after the last `run.manifest`: a run is the unit the
 * evaluation pools, so a new manifest opens a new run in which the same root
 * message is a new episode. A reset that states no `episodeId` (none is written
 * by this version) never matches, and cannot suppress a reset that is owed.
 */
export function episodeResetRecorded(events, roomId, episodeId) {
  if (typeof episodeId !== "string" || !episodeId) return false;
  const sorted = readRoom(events, roomId);
  let start = 0;
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (sorted[index].type === RUN_MANIFEST_EVENT_TYPE) { start = index + 1; break; }
  }
  return sorted.slice(start).some((event) => event.type === RELATIONSHIP_INTERVENTION_EVENT_TYPE
    && event.payload?.appliedBy === "arm"
    && event.payload?.mechanism === ARM_RESET_MECHANISM
    && event.payload?.episodeId === episodeId);
}

/** The event one member's turn records the injected relationship text's cost as. */
export const INJECTION_COST_EVENT_TYPE = "injection.cost";

/**
 * What a token estimate means here, stated once and carried in every record it
 * produces. It is a *heuristic*, not a measurement: this repository has no
 * tokenizer, so presenting a number as exact would be a claim nothing supports.
 */
export const TOKEN_ESTIMATE_METHOD =
  "one token per CJK/kana/hangul code point plus one per four other code points, rounded up";

/** CJK, kana, hangul and their fullwidth/CJK punctuation blocks. */
const CJK_CODEPOINT = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/u;

/**
 * Estimate the tokens one string costs, and say how: the exact code-point counts
 * travel with the estimate so a reader can recompute it under another rule
 * rather than having to trust this one. `exact` is always false.
 */
export function estimateTokens(text) {
  let cjkChars = 0;
  let otherChars = 0;
  // `for...of` iterates code points, so an astral character counts once.
  for (const character of String(text ?? "")) {
    if (CJK_CODEPOINT.test(character)) cjkChars += 1;
    else otherChars += 1;
  }
  return { tokens: Math.ceil(cjkChars + otherChars / 4), cjkChars, otherChars,
    method: TOKEN_ESTIMATE_METHOD, exact: false };
}

/** One member's provider/model as the manifest records it, never as a caller claims it. */
function readModels(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const models = {};
  for (const member of Object.keys(value).sort()) {
    const entry = value[member];
    const provider = typeof entry?.provider === "string" && entry.provider ? entry.provider : null;
    const model = typeof entry?.model === "string" && entry.model ? entry.model : null;
    models[member] = { provider, model };
  }
  return models;
}

/** Every room-scoped event, in the order the derivation counts in. */
function readRoom(events, roomId) {
  if (!Array.isArray(events)) throw new TypeError("events must be an array of event envelopes");
  if (typeof roomId !== "string" || !roomId) throw new TypeError("roomId must name the room whose log is being read");
  return sortEvents(events.filter((event) => {
    const declared = event?.provenance?.roomId ?? event?.roomId;
    return declared === undefined || declared === null || declared === "" || declared === roomId;
  }));
}

/**
 * Every run manifest one room's log states, oldest first, as plain values.
 *
 * A manifest the module cannot read is reported with `arm: null` rather than
 * skipped: an evaluation must be able to say "this run's arm is unknown" instead
 * of analysing a segment as though a manifest had never been written.
 */
export function runManifests(events, roomId) {
  const manifests = [];
  readRoom(events, roomId).forEach((event, index) => {
    if (event.type !== RUN_MANIFEST_EVENT_TYPE) return;
    const given = event.payload ?? {};
    manifests.push({
      index,
      manifestId: String(event.id),
      tick: tickOf(event),
      arm: RUN_ARMS.includes(given.arm) ? given.arm : null,
      configHash: typeof given.configHash === "string" && given.configHash ? given.configHash : null,
      models: readModels(given.models),
      initialStateVersion: Number.isInteger(given.initialStateVersion) ? given.initialStateVersion : null,
      startedAtTick: Number.isFinite(given.startedAtTick) ? given.startedAtTick : null
    });
  });
  return manifests;
}

/** The arm a log currently states, or the default when it states none. */
export function runArm(events, roomId) {
  const manifests = runManifests(events, roomId);
  return manifests.length === 0 ? "persistent" : (manifests.at(-1).arm ?? "persistent");
}

/**
 * Split one room's log into runs.
 *
 * A run begins at its `run.manifest` and ends where the next one begins: an
 * event is evidence about the run whose manifest precedes it, so a room that was
 * started twice is two runs over one log rather than one run over both. Every
 * segment carries its own events (the manifest included) and the tick it ends
 * at, which is the horizon a duration measured in ticks is taken against.
 *
 * A log with no manifest has no runs: the evaluation reports it as skipped
 * rather than inventing a run whose configuration nobody recorded.
 */
export function runSegments(events, roomId) {
  const sorted = readRoom(events, roomId);
  const manifests = runManifests(sorted, roomId);
  return manifests.map((manifest, position) => {
    const next = manifests[position + 1];
    const segment = sorted.slice(manifest.index, next === undefined ? sorted.length : next.index);
    return { ...manifest,
      events: segment,
      tickEnd: segment.length === 0 ? 0 : Math.max(...segment.map(tickOf)) };
  });
}

/** How many runs one group needs before the evaluation states a conclusion. */
export const MIN_RUNS = 10;

/** Bumped whenever a dependent variable is added, removed, or redefined. */
export const DEPENDENT_VARIABLE_VERSION = 1;

/** The arithmetic mean of the finite numbers, or null for none. */
function mean(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return null;
  return finite.reduce((total, value) => total + value, 0) / finite.length;
}

/**
 * Descriptive statistics for one dependent variable across runs.
 *
 * The variance is the **sample** variance (`n - 1`) and is `null` for a single
 * observation: one run cannot state a spread. Reporting a mean without this, or
 * a spread from one run, is exactly the failure this shape exists to prevent, so
 * both travel together and the count is always visible.
 */
export function dispersion(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  const average = mean(finite);
  const variance = finite.length > 1
    ? finite.reduce((total, value) => total + (value - average) ** 2, 0) / (finite.length - 1)
    : null;
  return { n: finite.length, missing: values.length - finite.length, mean: average,
    variance, sd: variance === null ? null : Math.sqrt(variance),
    min: finite.length === 0 ? null : Math.min(...finite),
    max: finite.length === 0 ? null : Math.max(...finite) };
}

/**
 * One run's dependent variables, read from that run's own events.
 *
 * Every one is a pure function of the segment, and every definition is stated
 * here because a reader must be able to recompute it:
 *
 * - `handoffSelection` — who was chosen to own work. A `ledger.transition`
 *   counts one selection for a member when it records an entry's owner as a
 *   non-empty session that differs from that entry's previously recorded owner,
 *   so a re-assignment counts and a transition that merely repeats the current
 *   owner (a comment, a progress note) does not.
 * - `reviewRejectionRate` — `request_changes` over all recorded review verdicts
 *   (`approve` + `request_changes`) in the segment, or `null` when no review was
 *   recorded: "no reviews" is not "no rejections".
 * - `refusedActions` — the number of `action_gate` events. The gate only ever
 *   records a non-allow judgement, so this is the count of executions it refused.
 * - `unresolvedDisputeMeanTicks` — the mean, over dispute entries whose final
 *   status is not closed, of `(endTick - establishingTick)`, in **ticks**: the
 *   run's last tick for an entry that never closed, or the tick of the closed
 *   status that retired it. `at` is never used: it is nudged forward per
 *   same-millisecond append and can lead the wall clock by seconds under a burst,
 *   so a duration taken from it would describe the writer's batch size. `null`
 *   when the segment holds no unresolved dispute.
 * - `injectedDigestCharsTotal` / `injectedTurns` — the characters actually
 *   injected, summed over the `injection.cost` events of the segment, and how
 *   many member turns carried one. `null` mean when there were none.
 */
export function dependentVariables({ events, roomId } = {}) {
  const sorted = readRoom(events, roomId);
  const tickEnd = sorted.length === 0 ? 0 : Math.max(...sorted.map(tickOf));

  const handoffSelection = {};
  const knownOwner = new Map();
  let reviewsApproved = 0;
  let reviewsChangesRequested = 0;
  let refusedActions = 0;
  let injectedDigestCharsTotal = 0;
  let injectedTurns = 0;
  const disputes = new Map();

  for (const event of sorted) {
    const given = event.payload ?? {};
    if (event.type === "ledger.transition") {
      const entry = given.entryId === undefined ? null : String(given.entryId);
      const owner = typeof given.ownerSessionId === "string" && given.ownerSessionId ? given.ownerSessionId : null;
      if (entry !== null && owner !== null && knownOwner.get(entry) !== owner) {
        knownOwner.set(entry, owner);
        handoffSelection[owner] = (handoffSelection[owner] ?? 0) + 1;
      }
      if (given.verdict === "approve") reviewsApproved += 1;
      else if (given.verdict === "request_changes") reviewsChangesRequested += 1;
      if (entry !== null && given.kind === "dispute") {
        const facts = disputes.get(entry) ?? { establishedTick: tickOf(event), lastStatus: null };
        facts.lastStatus = given.status;
        disputes.set(entry, facts);
      }
      continue;
    }
    if (event.type === "action_gate") {
      refusedActions += 1;
      continue;
    }
    if (event.type === INJECTION_COST_EVENT_TYPE) {
      const chars = given.digestChars;
      if (Number.isFinite(chars) && chars >= 0) {
        injectedDigestCharsTotal += chars;
        injectedTurns += 1;
      }
    }
  }

  const unresolvedTickDurations = [];
  for (const facts of disputes.values()) {
    if (facts.lastStatus !== null && CLOSED_LEDGER_STATUSES.has(facts.lastStatus)) continue;
    // Only a dispute that is still open at the end of the run is measured, and
    // it is measured to that end: a disagreement that was closed and then
    // reopened is open again, so its duration runs to the horizon rather than to
    // the close that a later transition undid.
    unresolvedTickDurations.push(tickEnd - facts.establishedTick);
  }
  const reviewVerdicts = reviewsApproved + reviewsChangesRequested;

  return {
    version: DEPENDENT_VARIABLE_VERSION,
    roomId,
    tickEnd,
    handoffSelection,
    handoffSelectionTotal: Object.values(handoffSelection).reduce((total, count) => total + count, 0),
    reviewsApproved,
    reviewsChangesRequested,
    reviewRejectionRate: reviewVerdicts === 0 ? null : reviewsChangesRequested / reviewVerdicts,
    refusedActions,
    unresolvedDisputes: unresolvedTickDurations.length,
    unresolvedDisputeMeanTicks: mean(unresolvedTickDurations),
    unresolvedDisputeTickDurations: unresolvedTickDurations,
    injectedDigestCharsTotal,
    injectedTurns,
    injectedDigestCharsMean: injectedTurns === 0 ? null : injectedDigestCharsTotal / injectedTurns
  };
}
