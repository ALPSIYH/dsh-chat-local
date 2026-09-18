/**
 * Experiment scaffolding for the relational layer: the injected relationship
 * digest and the terms and algorithm it is built from, the hash of those, the
 * run manifest, the injection cost of one member's turn, and the dependent
 * variables an evaluation reads out of a log.
 *
 * Pure in its arithmetic: no wall clock, no randomness, no model, and no I/O in
 * anything a caller computes with — the one exception is deliberate and bounded.
 * `injectionConfigFor` fingerprints the *source text* of the modules that
 * produce the injected bytes, so it reads those files (once each, cached) at the
 * moment a config is built. The evaluation script reads the logs and renders
 * what this module computes, so the arithmetic a reader is asked to trust can be
 * tested without a running harness — and the config hash cannot depend on when
 * it was computed.
 *
 * There is one source for every digest term *and* for the code that renders
 * them and derives their counters. The injected text is assembled here by the
 * functions below from a `lib/relationship.js` derivation, and
 * `injectionConfigFor` hashes the constants, a fingerprint of the rendering
 * functions, and a fingerprint of the fingerprinted modules' whole source — so
 * neither a term, nor a renderer, nor a helper either of them calls can change
 * the injected text without changing the hash an experiment's comparability
 * rests on. `INJECTION_CONFIG_VERSION` remains the declared, human-readable name
 * of the algorithm's version: the fingerprint makes a change visible, the
 * version says it was intended.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLOSED_LEDGER_STATUSES } from "./work-protocol.js";
import { sortEvents, tickOf, RELATIONSHIP_INTERVENTION_EVENT_TYPE, RELATIONSHIP_VERSION } from "./relationship.js";

/**
 * The version of the *rules* that turn the terms below into injected text. A
 * term change shows up in the hash by itself, and a change to the rendering code
 * shows up in `algorithm`; bump this when a change to the algorithm is intended,
 * so a reader of two manifests can tell an intentional redefinition from an
 * accidental edit. The hash detects either way — the version names it.
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
 * A stance's rendering, as a lookup built from the shared pair list. The closed
 * vocabulary is `APPRAISAL_STANCES`; a value outside it is refused by the
 * writer, and cannot reach here from a log a writer wrote. An unrecognised value
 * that a hand-built log does carry renders as its own text rather than as an
 * invented stance.
 */
const DIGEST_STANCE_LABELS = new Map(RELATIONSHIP_DIGEST_STANCES);

/** Whether a counter is a real, non-zero count rather than a missing value. */
function positiveCount(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** How relevant one counterparty's line is when the digest must be cut short. */
function digestRank(counters) {
  if (positiveCount(counters.unresolvedDisagreements)) return 0;
  if (positiveCount(counters.deliveryFailures)) return 1;
  return 2;
}

/**
 * One label, guaranteed not to break its line. An alias can come from
 * `#sessionAlias`, which is a DSH session title used verbatim, and a session
 * title can contain a newline — so a raw label could forge a second
 * counterparty line inside a digest that is recorded as the experiment's
 * independent variable. This is a fidelity fix at the rendering layer, not a
 * security boundary: `#history` already renders other agents' free text into
 * the same prompt. Runs of whitespace, control characters (`\p{Cc}`) and format
 * characters (`\p{Cf}`, e.g. U+200B) collapse to one space, so a label is
 * always a single line even when a zero-width character would make it look like
 * two.
 */
function digestLabel(value) {
  return String(value ?? "").replace(/[\s\p{Cc}\p{Cf}]+/gu, " ").trim();
}

/**
 * One appraisal as the prompt may quote it. The claim is folded and bounded
 * exactly like a label, and for the same reason: it is free text written by a
 * member and it must not be able to forge a line or a field of the digest. The
 * fold is a rendering fix, not a sanitising pass — the claim is stored verbatim
 * in the log and is quoted, quoted-shortened, or dropped as a whole line.
 */
function digestAppraisalLine(target, label, appraisal, position) {
  const claim = digestLabel(appraisal.claim);
  if (!claim) return null;
  const quoted = claim.length > RELATIONSHIP_DIGEST_CLAIM_MAX_CHARS
    ? `${claim.slice(0, RELATIONSHIP_DIGEST_CLAIM_MAX_CHARS)}…`
    : claim;
  const stance = DIGEST_STANCE_LABELS.get(appraisal.stance) ?? String(appraisal.stance ?? "");
  const confidence = Number.isFinite(appraisal.confidence) ? appraisal.confidence : 0;
  const evidence = Number.isFinite(appraisal.evidenceCount) ? appraisal.evidenceCount : 0;
  const role = appraisal.perceivedRole
    ? fillTemplate(RELATIONSHIP_DIGEST_ROLE_TEMPLATE, { role: digestLabel(appraisal.perceivedRole) })
    : "";
  return {
    rank: 2,
    position,
    target,
    text: fillTemplate(RELATIONSHIP_DIGEST_APPRAISAL_TEMPLATE, { label, stance, confidence, evidence, role, quoted })
  };
}

/**
 * The declarations exactly as they read, or `null` while the derivation cannot
 * be rendered. The body comes in after the heading so the heading's cost is
 * charged whether or not anything fits; see `relationshipDigest`.
 */
function renderDigest(heading, lines) {
  const kept = [];
  for (const line of lines) {
    const body = [...kept.map((item) => item.text), line.text].join("\n");
    if (body.length + 1 + heading.length > RELATIONSHIP_DIGEST_MAX_CHARS) break;
    kept.push(line);
  }
  if (kept.length === 0) return null;
  return [heading, ...kept.map((item) => item.text)].join("\n");
}

/**
 * The bounded relationship digest injected into one member's prompt: the
 * counters read from this room's event log, followed by the appraisals that
 * member has currently in force about the same counterparties, never longer
 * than `RELATIONSHIP_DIGEST_MAX_CHARS`, or `null` when there is nothing to
 * inject.
 *
 * `derived` is a `deriveRelationships` result and `observer` is the member the
 * prompt is built for, so the digest can only ever render pairs that have that
 * member at one end — one observer never sees another pair's counters, and for
 * the same reason it never sees another member's appraisals: they are read out
 * of `appraisals` under this observer's own key only. The observer's own
 * self-row is not a counterparty and is left out. `labelOf` maps a target
 * session id to its display label; a label that is missing, blank, or made
 * entirely of collapsed characters falls back to the session id, and the
 * collapse guarantees one line per counterparty.
 *
 * `appraisals` is an `effectiveAppraisals` result, or `undefined` when the
 * caller has none to render. Each judgement is a single line carrying its own
 * quotative frame — the stance, the confidence, the number of evidence events
 * and the declaring member's own wording — so a `claim` reads as a judgement
 * and never as a fact the room recorded, and a claim containing newlines or
 * instruction-looking text cannot add a line or a field.
 *
 * Truncation drops whole lines, never part of one: a half line would leave a
 * count looking like it belonged to the wrong counterparty, and half a claim
 * would misquote its author. Lines are taken in relevance order (unresolved
 * disagreements, then delivery failures, then the rest; ties by target id), and
 * the first line that would break the cap ends the digest, so a line that is
 * kept always outranks every line that was dropped. The judgement block is
 * charged as one further whole block beyond the counting half: one heading and
 * at most one claim per counterparty, with each claim bounded, is what keeps it
 * affordable.
 */
export function relationshipDigest({ derived, observer, labelOf, appraisals } = {}) {
  if (!derived || !Array.isArray(derived.pairs)) return null;
  if (typeof observer !== "string" || !observer) return null;
  const lines = [];
  const positionOf = new Map();
  const nextPosition = (target) => {
    const next = (positionOf.get(target) ?? 0) + 1;
    positionOf.set(target, next);
    return next;
  };
  for (const pair of derived.pairs) {
    if (pair?.observer !== observer) continue;
    // "You and each counterparty": the self-row is not a counterparty.
    if (pair.target === observer) continue;
    const counters = pair.counters ?? {};
    const fields = [];
    for (const [name, label] of RELATIONSHIP_DIGEST_COUNTERS) {
      if (!positiveCount(counters[name])) continue;
      fields.push(fillTemplate(RELATIONSHIP_DIGEST_FIELD_TEMPLATE, { label, value: counters[name] }));
    }
    // Only non-zero counters travel, so a counterparty with nothing recorded
    // has no line at all rather than a line of zeros.
    if (fields.length === 0) continue;
    const target = String(pair.target);
    const label = digestLabel(labelOf?.(target)) || digestLabel(target) || target;
    lines.push({ rank: digestRank(counters), position: nextPosition(target), target,
      text: fillTemplate(RELATIONSHIP_DIGEST_COUNTER_TEMPLATE, { label, counters: fields.join(RELATIONSHIP_DIGEST_COUNTER_JOIN) }) });
  }
  const ownAppraisals = appraisals && typeof appraisals === "object" ? appraisals[observer] : undefined;
  const judged = [];
  if (ownAppraisals && typeof ownAppraisals === "object") {
    for (const target of Object.keys(ownAppraisals).sort()) {
      if (target === observer) continue;
      const appraisal = ownAppraisals[target];
      // A key present with a null value is "this member withdrew the judgement
      // they had": there is no line for it, and the retired record's claim never
      // reaches the prompt.
      if (!appraisal || typeof appraisal !== "object") continue;
      const label = digestLabel(labelOf?.(target)) || digestLabel(target) || target;
      const line = digestAppraisalLine(target, label, appraisal, nextPosition(target));
      if (!line) continue;
      if (line.text.length + 1 + RELATIONSHIP_DIGEST_APPRAISAL_HEADING.length > RELATIONSHIP_DIGEST_MAX_CHARS) continue;
      judged.push(line);
    }
  }
  if (lines.length === 0 && judged.length === 0) return null;
  lines.sort((a, b) => a.rank - b.rank
    || (a.target < b.target ? -1 : a.target > b.target ? 1 : 0)
    || a.position - b.position);
  // The counting half's heading is charged first. A digest made only of
  // judgements still carries it, because a claim is only readable as a judgement
  // next to the counts it comments on: without the heading the block would read
  // as a section of facts. What the heading says about non-zero counters is then
  // literally true of the digest it heads — no counter line was rendered.
  const counting = renderDigest(RELATIONSHIP_DIGEST_HEADING, lines);
  if (judged.length === 0) return counting;
  // The judged block is charged against whatever room the counting half left —
  // and against the counting heading alone when nothing counted fit, so a full
  // prompt can never displace a judgement the room is meant to carry. It travels
  // whole or not at all: every line of it carries its own stance, confidence,
  // evidence count and attribution, so a partial block would leave a bare claim
  // with no frame saying whose judgement it is.
  const body = judged.map((item) => item.text).join("\n");
  if (body.length + judged.length + RELATIONSHIP_DIGEST_APPRAISAL_HEADING.length + 1
    > RELATIONSHIP_DIGEST_MAX_CHARS) return counting;
  const prefix = counting ?? RELATIONSHIP_DIGEST_HEADING;
  const budget = RELATIONSHIP_DIGEST_MAX_CHARS - prefix.length - 1;
  if (RELATIONSHIP_DIGEST_APPRAISAL_HEADING.length + 1 + body.length > budget) return counting;
  const digest = [prefix, RELATIONSHIP_DIGEST_APPRAISAL_HEADING, ...judged.map((item) => item.text)].join("\n");
  // Re-checked as one string: the arithmetic above and this assertion cannot
  // disagree, and the cap is a property of the returned value rather than of a
  // caller trusting the arithmetic.
  if (digest.length > RELATIONSHIP_DIGEST_MAX_CHARS) return counting;
  return digest;
}

/**
 * The functions that turn the terms above and a derivation into the injected
 * text, in the order they are fingerprinted.
 *
 * The list is named rather than scanned so that adding or removing a renderer is
 * a visible change to a term of the hash, and it is locked by a test. It is
 * deliberately **not** the enforcement: a list can only cover the functions on
 * it, so a helper a listed function started calling — or any line of either
 * module outside these bodies — could change the bytes a member reads while this
 * list's fingerprint stayed identical. `sourceFingerprint` is what covers that;
 * this is the narrowing lens that keeps the rendering path legible.
 */
export const DIGEST_RENDERERS = Object.freeze([
  fillTemplate, relationshipDigest, renderDigest, digestAppraisalLine, digestLabel, digestRank, positiveCount
]);

/**
 * The module sources whose bytes decide the injected text, listed by name
 * relative to this directory.
 *
 * The fingerprint used to be taken over the source text of the functions in
 * `DIGEST_RENDERERS` alone. That closed edits to those functions and nothing
 * else: the derivation in `lib/relationship.js` was versioned by convention
 * only, so `messagesAuthored += 1` could become `+= 2` — rendering different
 * counters, and so different bytes — while the hash stood still; and a helper
 * extracted from a listed function was covered when it was created (the listed
 * function's body changed) but not when someone later edited only the helper.
 * Whole module sources remove both holes: every line of the listed modules is
 * hashed, whether or not it lives in a function anyone thought to enumerate, and
 * the derivation the renderer consumes is listed beside the renderer. The
 * binding is one-way and stays that way: `lib/relationship.js` is not modified
 * to know about this and stays pure — the read happens here, where the config is
 * built.
 *
 * The list is explicit and locked by a test, so a new module that produces
 * injected bytes has to be added deliberately rather than silently falling
 * outside the fingerprint. The cost is that an edit anywhere in these files —
 * including one that changes nothing observable — splits the groups. That is the
 * conservative direction: the alternative is a hash that cannot tell two
 * different renderings apart.
 */
export const SOURCE_FINGERPRINT_MODULES = Object.freeze(["experiment.js", "relationship.js"]);

const SOURCE_DIRECTORY = dirname(fileURLToPath(import.meta.url));

/** One read per module per process; the source of a loaded module cannot change under it. */
const SOURCE_CACHE = new Map();

/** The `[name, source]` pairs of the fingerprinted modules, read from disk once each. */
export function sourceTexts(modules = SOURCE_FINGERPRINT_MODULES) {
  return [...modules].map((name) => {
    if (!SOURCE_CACHE.has(name)) SOURCE_CACHE.set(name, readFileSync(join(SOURCE_DIRECTORY, name), "utf8"));
    return [name, SOURCE_CACHE.get(name)];
  });
}

/**
 * The SHA-256 of the listed modules' own source text, names included so a module
 * moved between files cannot hash the same.
 *
 * `sources` is a parameter so a test can prove that a changed byte anywhere in a
 * module's text changes the fingerprint — including outside every function
 * `DIGEST_RENDERERS` names — instead of asserting a value against itself.
 */
export function sourceFingerprint(sources = sourceTexts()) {
  return createHash("sha256")
    .update([...sources].map(([name, text]) => `${name}\u0000${text}`).join("\u0000"))
    .digest("hex");
}

/**
 * A digest of the rendering algorithm's own source text, over the functions
 * named in `DIGEST_RENDERERS`.
 *
 * The configurable terms are hashed as values, but the algorithm that consumes
 * them is code, not data: the truncation ellipsis, the `"\n"` joins and the
 * label-fold pattern are literals inside it, and until this existed a change to
 * any of them changed the injected text while the config hash stayed identical —
 * so two runs that injected different text could be pooled as comparable. This
 * makes the named renderers part of the hash: any edit inside one of them — a
 * literal, a branch, even a comment — changes it.
 *
 * It is a narrowing lens beside `sourceFingerprint`, not the enforcement; see
 * `DIGEST_RENDERERS` for the class of change a function list cannot see.
 *
 * `renderers` is a parameter so a test can prove the mechanism with functions of
 * its own instead of asserting a value against itself.
 */
export function digestAlgorithmFingerprint(renderers = DIGEST_RENDERERS) {
  return createHash("sha256")
    .update([...renderers].map((renderer) => renderer.toString()).join("\u0000"))
    .digest("hex");
}

/**
 * Every term the injected digest depends on, as one plain value.
 *
 * `gate` is the room's governance-gate switch and `appraisalDigest` is whether
 * the judgement half is injected at all — both change the text a member reads,
 * so both belong here even though neither is part of the digest's own rendering
 * constants. `algorithm` is the fingerprint of the named rendering functions and
 * `source` is the fingerprint of the whole source of `SOURCE_FINGERPRINT_MODULES`
 * — the renderer and the derivation it renders — so a change to a literal, a
 * branch, a helper either of them calls, or the derivation itself moves the
 * hash. `relationshipVersion` is the declared version of the counter derivation:
 * the source fingerprint detects a derivation change, the version names it.
 *
 * What is deliberately **not** here is the log itself: the counters are a
 * function of the room's own history, so two runs necessarily inject different
 * text. The hash answers "would these two runs have rendered the same bytes from
 * the same derivation?", which is the question pooling depends on.
 */
export function injectionConfigFor({ room, appraisalDigest = true } = {}) {
  return {
    version: INJECTION_CONFIG_VERSION,
    algorithm: digestAlgorithmFingerprint(),
    source: sourceFingerprint(),
    relationshipVersion: RELATIONSHIP_VERSION,
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
 * The `delivery.settled` statuses that evidence the member's **own session
 * received** the injected prompt, rather than that an injection was constructed.
 *
 * The writer's lifecycle is `queued -> sent -> delivered -> working ->
 * replied|passed`. `delivered` is recorded when the member's session reports the
 * bridge marker as a user message, so it is the room's own statement that the
 * member was reached; `working`, `replied` and `passed` are all downstream of
 * that observation. `sent` is deliberately absent: it is written when
 * `deliverExternal` returns, which says the transport accepted the prompt, not
 * that the member received it. `failed` and `superseded` are not reach at all.
 *
 * The `injection.cost` record alone cannot carry this: the writer appends it
 * *before* it calls the transport, so a delivery that is rejected or times out
 * still leaves one behind. Counting those would let ten pure transport failures
 * satisfy the ten-run gate — the exact "green but false" outcome the gate exists
 * to prevent.
 */
export const DELIVERY_REACHED_STATUSES = Object.freeze(["delivered", "working", "replied", "passed"]);

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

/**
 * Whether one run holds an interaction the evaluation can read: a member turn
 * that a member's session was recorded as receiving.
 *
 * A run is a manifest-delimited segment of a room's log, and a manifest is a
 * statement, not an observation: ten `startRun` calls in an idle room produce
 * ten segments and nothing that happened. The experiment varies the relationship
 * text injected into a member's turn, so the threshold between "a run was
 * started" and "a run has data" is at least one injection that reached the
 * member — `injectedTurns`, which counts `injection.cost` records joined to a
 * `delivery.settled` reach status and never the cost record alone.
 *
 * The cost record cannot stand in for the join: it is appended before the
 * transport call, so ten delivery failures would each leave one behind. Before
 * this required the join, a room whose bridge refused every delivery printed
 * `status conclusive` and exited 0 on eleven runs in which one member turn had
 * happened.
 *
 * This is a property of the run's own events rather than of its manifest on
 * purpose: the gate exists because a conclusion was once drawn from too small a
 * sample, and a group of restarts must not be able to satisfy it.
 */
export function hasInteraction(dependentVariables) {
  return Number.isFinite(dependentVariables?.injectedTurns) && dependentVariables.injectedTurns > 0;
}

/**
 * Bumped whenever a dependent variable is added, removed, or redefined.
 *
 * 2: `injectedTurns` / `injectedDigestCharsTotal` / `injectedDigestCharsMean`
 * are read from injections whose delivery reached the member's own session,
 * rather than from every `injection.cost` record the run wrote.
 */
export const DEPENDENT_VARIABLE_VERSION = 2;

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
 *   injected **into a member who received them**, summed over the
 *   `injection.cost` records of the segment whose `deliveryId` also carries a
 *   `delivery.settled` reach status (`DELIVERY_REACHED_STATUSES`), and how many
 *   such member turns there were. `null` mean when there were none.
 *   `unreachedInjections` counts the other cost records — injections that were
 *   constructed but whose delivery never reached the member — so a reader can
 *   see them instead of mistaking them for data. The join is what makes the
 *   figure "actually injected": a cost record is written before the transport
 *   call, so on its own it also exists for a delivery that failed.
 */
export function dependentVariables({ events, roomId } = {}) {
  const sorted = readRoom(events, roomId);
  const tickEnd = sorted.length === 0 ? 0 : Math.max(...sorted.map(tickOf));

  const handoffSelection = {};
  const knownOwner = new Map();
  let reviewsApproved = 0;
  let reviewsChangesRequested = 0;
  let refusedActions = 0;
  const injections = [];
  const reachedDeliveries = new Set();
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
        injections.push({ deliveryId: String(given.deliveryId ?? "") || null, chars });
      }
      continue;
    }
    if (event.type === "delivery.settled") {
      const deliveryId = String(given.deliveryId ?? "");
      // Reach is collected first and joined after the pass, so the order the
      // writer happened to flush the cost record and the settle in cannot decide
      // whether the injection counts.
      if (deliveryId && DELIVERY_REACHED_STATUSES.includes(given.status)) reachedDeliveries.add(deliveryId);
    }
  }

  let injectedDigestCharsTotal = 0;
  let injectedTurns = 0;
  let unreachedInjections = 0;
  for (const injection of injections) {
    if (injection.deliveryId === null || !reachedDeliveries.has(injection.deliveryId)) {
      unreachedInjections += 1;
      continue;
    }
    injectedDigestCharsTotal += injection.chars;
    injectedTurns += 1;
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
    unreachedInjections,
    injectedDigestCharsMean: injectedTurns === 0 ? null : injectedDigestCharsTotal / injectedTurns
  };
}
