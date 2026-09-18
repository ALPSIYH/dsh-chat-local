import test from "node:test";
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EventLog } from "../lib/event-log.js";
import {
  DELIVERY_REACHED_STATUSES,
  DEPENDENT_VARIABLE_VERSION, DIGEST_RENDERERS, INJECTION_CONFIG_VERSION, MIN_RUNS,
  RELATIONSHIP_DIGEST_APPRAISAL_HEADING,
  RELATIONSHIP_DIGEST_CLAIM_MAX_CHARS, RELATIONSHIP_DIGEST_COUNTERS, RELATIONSHIP_DIGEST_COUNTER_TEMPLATE,
  RELATIONSHIP_DIGEST_HEADING, RELATIONSHIP_DIGEST_MAX_CHARS, RELATIONSHIP_DIGEST_STANCES,
  TOKEN_ESTIMATE_METHOD, configHashOf, dependentVariables, digestAlgorithmFingerprint, dispersion,
  estimateTokens, hasInteraction, injectionConfigFor, runArm, runManifests, runSegments,
  sourceFingerprint, sourceTexts, SOURCE_FINGERPRINT_MODULES } from "../lib/experiment.js";
import { RELATIONSHIP_VERSION } from "../lib/relationship.js";
import { EVAL_FORMAT, INSUFFICIENT_EXIT, evaluate, renderText } from "../scripts/relationship-eval.mjs";

/**
 * The experiment's pure arithmetic, and the evaluation script's behaviour.
 *
 * The script is exercised as a process (`node scripts/relationship-eval.mjs`)
 * because the properties under test are its own: that it refuses to conclude
 * below ten runs, that it reports dispersion, that it never writes, and that it
 * pools only comparable runs. Its arithmetic is tested directly, so a failure
 * says which definition is wrong.
 */

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "relationship-eval.mjs");

/** Run the script as a process and report its exit code and streams. */
async function runScript(args, timeoutMs) {
  return await new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }) },
      (error, stdout, stderr) => resolve({
        // A process killed by the timeout has no exit code; separating that from
        // "exited 0" is what lets the FIFO test tell a refusal from a hang.
        code: error ? (error.code ?? -1) : 0,
        killed: error?.killed === true, stdout, stderr
      }));
  });
}

/** An event as the log's writer takes it: no `id`, `at`, `prev` or `hash` yet. */
function event(type, tick, payload, actor = { kind: "system", id: "system" }, at) {
  return { type, tick, payload, actor, ...(at === undefined ? {} : { at }) };
}

/** A `run.manifest` as `startRun` writes one. */
function manifest({ tick = 1, arm = "persistent", configHash = "a".repeat(64),
  models = { s1: { provider: "p", model: "m" } }, initialStateVersion = 16, at } = {}) {
  return event("run.manifest", tick, { configHash, models, initialStateVersion, startedAtTick: tick, arm },
    { kind: "human", id: "human:me" }, at);
}

/** Append events to a room's log under a temporary state directory. */
async function writeLog(statePath, roomId, events) {
  const log = new EventLog(statePath);
  for (const item of events) await log.append(roomId, item);
}

/** A content hash of every file under a directory, for the read-only proof. */
async function directoryDigest(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath ?? entry.path, entry.name)).sort();
  const parts = [];
  for (const file of files) {
    parts.push(`${file}:${(await stat(file)).size}:${createHash("sha256").update(await readFile(file)).digest("hex")}`);
  }
  return parts.join("\n");
}

// --- the injection config and its hash ---------------------------------------

test("the config hash ignores key order at every depth", () => {
  const room = { policy: { gate: true, revision: 3 } };
  const first = injectionConfigFor({ room, appraisalDigest: true });
  const reordered = {
    gate: first.gate, appraisalDigest: first.appraisalDigest, version: first.version,
    algorithm: first.algorithm, source: first.source, relationshipVersion: first.relationshipVersion,
    templates: first.templates, stances: first.stances, counters: first.counters,
    headings: first.headings, claimMaxChars: first.claimMaxChars, maxChars: first.maxChars
  };
  assert.equal(configHashOf(reordered), configHashOf(first));
  // A nested object built the other way round still hashes the same, because a
  // room's policy reaches this function as an object.
  assert.equal(configHashOf(injectionConfigFor({ room: { policy: { revision: 3, gate: true } }, appraisalDigest: true })),
    configHashOf(first));
});

test("the config hash covers every injection term, and nothing else", () => {
  const room = { policy: { gate: false } };
  const base = injectionConfigFor({ room, appraisalDigest: true });
  const baseHash = configHashOf(base);
  assert.equal(configHashOf(injectionConfigFor({ room: { policy: { gate: false } }, appraisalDigest: true })), baseHash,
    "an equivalent configuration must hash equally");
  const changed = {
    maxChars: { ...base, maxChars: base.maxChars + 1 },
    claimMaxChars: { ...base, claimMaxChars: base.claimMaxChars + 1 },
    gate: { ...base, gate: true },
    appraisalDigest: { ...base, appraisalDigest: false },
    version: { ...base, version: base.version + 1 },
    algorithm: { ...base, algorithm: `${base.algorithm}0` },
    source: { ...base, source: `${base.source}0` },
    relationshipVersion: { ...base, relationshipVersion: base.relationshipVersion + 1 },
    headings: { ...base, headings: [base.headings[0], base.headings[1] + "。"] },
    counters: { ...base, counters: [...base.counters, ["newCounter", "新计数"]] },
    stances: { ...base, stances: [...base.stances, ["unsure", "不确定"]] },
    templates: { ...base, templates: [...base.templates.slice(1), "与「{label}」:{counters}"] }
  };
  for (const [term, config] of Object.entries(changed)) {
    assert.notEqual(configHashOf(config), baseHash, `changing ${term} must change the hash`);
  }
  // The terms the renderer reads are the terms the hash covers: each constant
  // reaches the config object, so a change to any of them cannot leave the hash
  // alone.
  assert.equal(base.maxChars, RELATIONSHIP_DIGEST_MAX_CHARS);
  assert.equal(base.claimMaxChars, RELATIONSHIP_DIGEST_CLAIM_MAX_CHARS);
  assert.deepEqual(base.headings, [RELATIONSHIP_DIGEST_HEADING, RELATIONSHIP_DIGEST_APPRAISAL_HEADING]);
  assert.deepEqual(base.counters, RELATIONSHIP_DIGEST_COUNTERS.map((entry) => [...entry]));
  assert.deepEqual(base.stances, RELATIONSHIP_DIGEST_STANCES.map((entry) => [...entry]));
  assert.ok(base.templates.includes(RELATIONSHIP_DIGEST_COUNTER_TEMPLATE));
  assert.equal(base.version, INJECTION_CONFIG_VERSION);
  assert.equal(base.algorithm, digestAlgorithmFingerprint());
  assert.equal(base.source, sourceFingerprint());
  assert.equal(base.relationshipVersion, RELATIONSHIP_VERSION);
});

test("the rendering algorithm's own source is part of the hash", () => {
  // The configurable terms are data and were always hashed; the algorithm that
  // consumes them is code, and its literals — the truncation ellipsis, the
  // `"\n"` joins, the label-fold pattern — are what a term change could not
  // reach. This is the mechanism that reaches them: every renderer's own source
  // text is fingerprinted, so editing one changes the hash.
  const first = digestAlgorithmFingerprint([function renderer() { return "与「甲」：发言 1"; }]);
  const second = digestAlgorithmFingerprint([function renderer() { return "与「甲」: 发言 1"; }]);
  assert.notEqual(first, second, "a changed rendering literal must change the fingerprint");
  assert.equal(first, digestAlgorithmFingerprint([function renderer() { return "与「甲」：发言 1"; }]));
  assert.match(first, /^[0-9a-f]{64}$/u);
  // The list is the whole rendering path, named, so a function added to the
  // algorithm without being listed here is a failure rather than a silent hole.
  assert.deepEqual(DIGEST_RENDERERS.map((renderer) => renderer.name).sort(),
    ["digestAppraisalLine", "digestLabel", "digestRank", "fillTemplate", "positiveCount", "relationshipDigest", "renderDigest"]);
  // And the fingerprint is a real term of the hash, not decoration beside it.
  const base = injectionConfigFor({ room: { policy: {} }, appraisalDigest: true });
  assert.equal(base.algorithm, digestAlgorithmFingerprint(DIGEST_RENDERERS));
  assert.notEqual(configHashOf({ ...base, algorithm: `${base.algorithm}0` }), configHashOf(base));
});

test("the whole source of the fingerprinted modules is part of the hash", () => {
  // A function list is a narrowing lens, not the enforcement: it can only cover
  // the functions on it. The fingerprint that closes the class is taken over the
  // module sources themselves, so a changed byte anywhere in them — a helper a
  // listed function started calling, or a line outside every listed function —
  // moves it.
  const base = sourceFingerprint();
  assert.match(base, /^[0-9a-f]{64}$/u);
  const sources = sourceTexts();
  assert.ok(sources.length > 0);
  for (const [name, text] of sources) {
    assert.match(name, /^[A-Za-z0-9._-]+\.js$/u);
    assert.ok(text.length > 0, `${name} must have been read`);
  }
  const [[name, source]] = sources;
  // The module header is fingerprinted and it is outside every function
  // `DIGEST_RENDERERS` names: the old list could not see an edit here at all.
  assert.match(source, /Experiment scaffolding for the relational layer/u);
  const edited = source.replace("Experiment scaffolding", "Experiment scaffolDing");
  assert.notEqual(edited, source);
  assert.notEqual(sourceFingerprint([[name, edited]]), base,
    "an edit outside every listed function must still move the fingerprint");
  // The name travels with the text, so a module moved between files cannot hash
  // the same.
  assert.notEqual(sourceFingerprint([["elsewhere.js", source]]), base);
  // And the fingerprint is a real term of the hash, not decoration beside it.
  const config = injectionConfigFor({ room: { policy: {} }, appraisalDigest: true });
  assert.equal(config.source, base);
  assert.notEqual(configHashOf({ ...config, source: `${base}0` }), configHashOf(config));
  // The list is the modules whose bytes decide the injected text, named, so a
  // new one has to be added deliberately rather than silently falling outside.
  assert.deepEqual([...SOURCE_FINGERPRINT_MODULES], ["experiment.js", "relationship.js"]);
  // The derivation really is inside the fingerprinted text: `messagesAuthored`
  // is incremented in `lib/relationship.js`, which no renderer function list can
  // reach, so a `+= 1` to `+= 2` edit there used to change the rendered counters
  // — and so the injected bytes — while the hash stood still.
  const derivation = sources.find(([name]) => name === "relationship.js")?.[1] ?? "";
  assert.match(derivation, /counters\.messagesAuthored \+= 1;/u,
    "the counter derivation must be inside the fingerprinted bytes");
});

// --- the estimate and the dispersion -----------------------------------------

test("the token figure is an estimate and says so", () => {
  const mixed = estimateTokens("关系 ab");
  assert.equal(mixed.cjkChars, 2);
  assert.equal(mixed.otherChars, 3);
  assert.equal(mixed.tokens, Math.ceil(2 + 3 / 4));
  assert.equal(mixed.exact, false);
  assert.equal(mixed.method, TOKEN_ESTIMATE_METHOD);
  assert.match(mixed.method, /estimate|rounded up/u);
  assert.deepEqual(estimateTokens(""), { tokens: 0, cjkChars: 0, otherChars: 0, method: TOKEN_ESTIMATE_METHOD, exact: false });
  // The code-point counts travel with the figure, so a reader can recompute it.
  assert.equal(estimateTokens("关系 ab").cjkChars + estimateTokens("关系 ab").otherChars, "关系 ab".length);
});

test("dispersion is the sample variance, and a single run states no spread", () => {
  assert.deepEqual(dispersion([1, 2, 3, 4]),
    { n: 4, missing: 0, mean: 2.5, variance: (1.5 ** 2 + 0.5 ** 2 + 0.5 ** 2 + 1.5 ** 2) / 3,
      sd: Math.sqrt(5 / 3), min: 1, max: 4 });
  assert.deepEqual(dispersion([7]), { n: 1, missing: 0, mean: 7, variance: null, sd: null, min: 7, max: 7 });
  assert.deepEqual(dispersion([null, 2, undefined, 4]),
    { n: 2, missing: 2, mean: 3, variance: 2, sd: Math.SQRT2, min: 2, max: 4 });
  assert.deepEqual(dispersion([]), { n: 0, missing: 0, mean: null, variance: null, sd: null, min: null, max: null });
});

// --- the manifest and the runs it splits a log into --------------------------

test("a log splits into runs at its manifests, and the arm is the latest statement", () => {
  const roomId = "room-1";
  const events = [
    { id: "e1", type: "message.created", tick: 1, at: 1, payload: {}, provenance: { roomId } },
    { id: "e2", type: "run.manifest", tick: 2, at: 2, actor: { kind: "human", id: "human:me" },
      payload: { configHash: "aaa", models: { s1: { provider: "p", model: "m" } }, initialStateVersion: 16, startedAtTick: 2, arm: "persistent" },
      provenance: { roomId } },
    { id: "e3", type: "message.created", tick: 3, at: 3, payload: {}, provenance: { roomId } },
    { id: "e4", type: "run.manifest", tick: 4, at: 4, actor: { kind: "human", id: "human:me" },
      payload: { configHash: "bbb", models: { s1: { provider: "p", model: "m" } }, initialStateVersion: 16, startedAtTick: 4, arm: "reset_per_episode" },
      provenance: { roomId } },
    { id: "e5", type: "message.created", tick: 5, at: 5, payload: {}, provenance: { roomId } }
  ];
  const manifests = runManifests(events, roomId);
  assert.deepEqual(manifests.map((item) => item.arm), ["persistent", "reset_per_episode"]);
  assert.deepEqual(manifests.map((item) => item.configHash), ["aaa", "bbb"]);
  assert.equal(runArm(events, roomId), "reset_per_episode");
  // The second run is the second segment: the first run's events are not its
  // evidence, and the manifest itself belongs to the run it opens.
  const segments = runSegments(events, roomId);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0].events.map((item) => item.id), ["e2", "e3"]);
  assert.deepEqual(segments[1].events.map((item) => item.id), ["e4", "e5"]);
  assert.equal(segments[1].tickEnd, 5);
  // A log that states no manifest states no run.
  assert.deepEqual(runSegments([events[0]], roomId), []);
  assert.equal(runArm([events[0]], roomId), "persistent");
});

test("a manifest this version cannot read is reported, not skipped", () => {
  const events = [
    { id: "e1", type: "run.manifest", tick: 1, at: 1, payload: { arm: "sideways" }, provenance: { roomId: "room-1" } }
  ];
  const manifests = runManifests(events, "room-1");
  assert.equal(manifests.length, 1);
  assert.equal(manifests[0].arm, null);
  assert.equal(manifests[0].configHash, null);
});

// --- the dependent variables -------------------------------------------------

test("every dependent variable is read from its own event evidence", () => {
  const roomId = "room-1";
  const ledger = (tick, payload) => ({ id: `l${tick}`, type: "ledger.transition", tick, at: tick, payload, provenance: { roomId } });
  const events = [
    ledger(2, { entryId: "t1", kind: "task", action: "record", status: "open", ownerSessionId: "s1", reviewerSessionId: "r1" }),
    ledger(3, { entryId: "t2", kind: "task", action: "record", status: "open", ownerSessionId: "s2", reviewerSessionId: "r1" }),
    // The same owner repeated by a later transition is not a second selection.
    ledger(4, { entryId: "t2", kind: "task", action: "acknowledge", status: "in_progress", ownerSessionId: "s2", reviewerSessionId: "r1" }),
    ledger(5, { entryId: "t2", kind: "task", action: "review", status: "done", ownerSessionId: "s2", reviewerSessionId: "r1", verdict: "approve" }),
    ledger(6, { entryId: "t3", kind: "task", action: "review", status: "in_progress", ownerSessionId: "s1", reviewerSessionId: "r1", verdict: "request_changes" }),
    // A dispute established at tick 7 and left open; the run's last tick is 12.
    ledger(7, { entryId: "d1", kind: "dispute", action: "record", status: "open", ownerSessionId: "s1" }),
    ledger(9, { entryId: "d2", kind: "dispute", action: "record", status: "resolved", ownerSessionId: "s2" }),
    { id: "g1", type: "action_gate", tick: 10, at: 10, payload: { judgement: "require_confirmation" }, provenance: { roomId } },
    { id: "g2", type: "action_gate", tick: 10, at: 11, payload: { judgement: "deny" }, provenance: { roomId } },
    { id: "c1", type: "injection.cost", tick: 11, at: 11, payload: { deliveryId: "d1", digestChars: 100 }, provenance: { roomId } },
    // The member's own session received that delivery: this is the evidence that
    // makes the injection an interaction rather than a constructed record.
    { id: "c2", type: "delivery.settled", tick: 11, at: 12,
      payload: { deliveryId: "d1", member: "s1", status: "delivered", previous: "sent" }, provenance: { roomId } },
    // A transition that repeats t1's existing owner is not a second selection.
    ledger(12, { entryId: "t1", kind: "task", action: "comment", status: "open", ownerSessionId: "s1", reviewerSessionId: "r1" })
  ];
  const dv = dependentVariables({ events, roomId });
  assert.equal(dv.version, DEPENDENT_VARIABLE_VERSION);
  // One selection per entry's first recorded owner: t1, t3 and d1 for s1; t2
  // and d2 for s2. t2's acknowledge and review repeat the owner it already had.
  assert.deepEqual(dv.handoffSelection, { s1: 3, s2: 2 });
  assert.equal(dv.handoffSelectionTotal, 5);
  assert.equal(dv.reviewsApproved, 1);
  assert.equal(dv.reviewsChangesRequested, 1);
  assert.equal(dv.reviewRejectionRate, 0.5);
  assert.equal(dv.refusedActions, 2);
  assert.equal(dv.unresolvedDisputes, 1);
  assert.deepEqual(dv.unresolvedDisputeTickDurations, [5]);
  assert.equal(dv.unresolvedDisputeMeanTicks, 5);
  assert.equal(dv.injectedDigestCharsTotal, 100);
  assert.equal(dv.injectedTurns, 1);
  assert.equal(dv.injectedDigestCharsMean, 100);
});

test("a dispute duration is measured in ticks even when `at` has run far ahead", () => {
  const roomId = "room-1";
  // The event stamp is nudged forward per same-millisecond append, so a burst
  // can push it seconds ahead of the wall clock. Here `at` and `tick` disagree
  // by seven orders of magnitude: an `at`-based duration would be 8,999,000 ms
  // where the interaction lasted 10 ticks.
  const events = [
    { id: "d1", type: "ledger.transition", tick: 2, at: 1_000,
      payload: { entryId: "d1", kind: "dispute", action: "record", status: "open", ownerSessionId: "s1" }, provenance: { roomId } },
    { id: "d2", type: "ledger.transition", tick: 12, at: 9_000_000,
      payload: { entryId: "d2", kind: "task", action: "comment", status: "open", ownerSessionId: "s2" }, provenance: { roomId } }
  ];
  const dv = dependentVariables({ events, roomId });
  assert.equal(dv.tickEnd, 12);
  assert.equal(dv.unresolvedDisputeMeanTicks, 10);
  assert.ok(!JSON.stringify(dv).includes("9000000"), "no dependent variable may be a difference of event stamps");
});

test("a run with no unresolved dispute and no reviews reports neither", () => {
  const dv = dependentVariables({ events: [], roomId: "room-1" });
  assert.equal(dv.unresolvedDisputeMeanTicks, null);
  assert.equal(dv.reviewRejectionRate, null);
  assert.equal(dv.injectedDigestCharsMean, null);
  assert.equal(dv.injectedTurns, 0);
  assert.equal(dv.tickEnd, 0);
});

// --- the evaluation script ---------------------------------------------------

/** A state directory holding `count` comparable runs, each a room's own log. */
async function stateWithRuns(count, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "dcl-eval-"));
  const statePath = join(directory, "rooms.json");
  for (let index = 1; index <= count; index += 1) {
    const roomId = `run-${String(index).padStart(2, "0")}`;
    const configHash = options.configHash ?? "a".repeat(64);
    const tickOffset = index;
    await writeLog(statePath, roomId, [
      manifest({ tick: 1, arm: options.arm ?? "persistent", configHash,
        models: { s1: { provider: "p", model: "m" }, s2: { provider: "p", model: "m" } } }),
      event("ledger.transition", 2,
        { entryId: `t${index}`, kind: "task", action: "record", status: "open", ownerSessionId: "s1", reviewerSessionId: "s2" },
        { kind: "session", id: "s1" }),
      event("ledger.transition", 3,
        { entryId: `t${index}`, kind: "task", action: "review", status: "done", ownerSessionId: "s1",
          reviewerSessionId: "s2", verdict: index % 2 === 0 ? "approve" : "request_changes" },
        { kind: "session", id: "s2" }),
      // Each run's unresolved disagreement lives a different number of ticks:
      // the dispersion is real, not a constant.
      event("ledger.transition", 4,
        { entryId: `d${index}`, kind: "dispute", action: "record", status: "open", ownerSessionId: "s1" },
        { kind: "session", id: "s1" }),
      event("action_gate", 5, { judgement: "deny" }, { kind: "session", id: "s1" }),
      event("injection.cost", 6, { deliveryId: `d${index}`, digestChars: 100 + index }, { kind: "system", id: "system" }),
      // The delivery reached the member, so the run holds an interaction as the
      // gate defines one: an injection the member's session was recorded as
      // receiving.
      event("delivery.settled", 6, { deliveryId: `d${index}`, member: "s1", status: "delivered" },
        { kind: "session", id: "s1" }),
      event("message.created", 4 + tickOffset, { messageId: `m${index}`, authorKind: "session" },
        { kind: "session", id: "s1" })
    ]);
  }
  return { directory, statePath };
}

test("the script refuses to conclude below ten runs and says why", async () => {
  const { directory, statePath } = await stateWithRuns(3);
  try {
    const refused = await runScript(["--state", statePath, "--json"]);
    assert.equal(refused.code, INSUFFICIENT_EXIT, "a short sample must not exit as a success");
    const report = JSON.parse(refused.stdout);
    assert.equal(report.status, "insufficient-sample");
    assert.equal(report.assertsConclusions, false);
    assert.equal(report.requiredRuns, MIN_RUNS);
    assert.equal(report.runs.length, 3, "the per-run observations are still reported");
    assert.equal(report.groups[0].runCount, 3);
    assert.equal(report.groups[0].sufficient, false);
    assert.equal(report.groups[0].statistics, null, "no cross-run statistics may be stated as a result");
    assert.equal(report.groups[0].observation, null, "and none without the observation flag");
    assert.match(refused.stderr, /at least 10 are required/u);
    // The human-readable form carries the same refusal.
    const text = await runScript(["--state", statePath]);
    assert.equal(text.code, INSUFFICIENT_EXIT);
    assert.match(text.stdout, /status insufficient-sample/u);
    assert.match(text.stdout, /no statistics/u);
    assert.ok(!/mean [0-9]/u.test(text.stdout), "no mean may be printed as usual below the gate");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("observation mode states observations and asserts nothing", async () => {
  const { directory, statePath } = await stateWithRuns(3);
  try {
    const observed = await runScript(["--state", statePath, "--observation", "--json"]);
    assert.equal(observed.code, 0);
    const report = JSON.parse(observed.stdout);
    assert.equal(report.status, "observation");
    assert.equal(report.assertsConclusions, false);
    assert.equal(report.groups[0].statistics, null, "observation is not a result");
    assert.ok(report.groups[0].observation, "the descriptive statistics are available, explicitly labelled");
    assert.ok(report.notes.some((note) => /Observation only/u.test(note)));
    const text = await runScript(["--state", statePath, "--observation"]);
    assert.equal(text.code, 0);
    assert.match(text.stdout, /observation \(not a conclusion\)/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("ten runs conclude, with dispersion and not only a mean", async () => {
  const { directory, statePath } = await stateWithRuns(10);
  try {
    const answered = await runScript(["--state", statePath, "--json"]);
    assert.equal(answered.code, 0, answered.stderr);
    const report = JSON.parse(answered.stdout);
    assert.equal(report.status, "conclusive");
    assert.equal(report.assertsConclusions, true);
    assert.equal(report.format, EVAL_FORMAT);
    assert.equal(report.runs.length, 10);
    const group = report.groups[0];
    assert.equal(group.runCount, 10);
    assert.equal(group.sufficient, true);
    assert.equal(group.observation, null, "a sufficient group reports results, not observations");
    for (const name of ["reviewRejectionRate", "refusedActions", "unresolvedDisputeMeanTicks", "injectedDigestCharsMean"]) {
      const value = group.statistics[name];
      assert.equal(value.n, 10, `${name} must report how many runs contributed`);
      assert.equal(typeof value.mean, "number");
      assert.equal(typeof value.variance, "number", `${name} must report its variance`);
      assert.equal(typeof value.sd, "number");
      assert.equal(typeof value.min, "number");
      assert.equal(typeof value.max, "number");
    }
    // The fixture's disputes really do vary in length, so a zero variance here
    // would mean the script was reading one number ten times.
    assert.ok(group.statistics.unresolvedDisputeMeanTicks.variance > 0);
    assert.equal(group.statistics.injectedDigestCharsMean.mean, 105.5);
    assert.equal(group.statistics.reviewRejectionRate.mean, 0.5);
    const text = renderText(report);
    assert.match(text, /variance/u);
    assert.match(text, /sd/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a FIFO beside the logs is refused with a reason instead of hanging", async (t) => {
  const { directory, statePath } = await stateWithRuns(1);
  try {
    await mkdir(dirname(join(directory, "events", "stuck.jsonl")), { recursive: true });
    try { execFileSync("mkfifo", [join(directory, "events", "stuck.jsonl")]); }
    catch (error) { t.skip(`mkfifo is unavailable: ${String(error?.message ?? error)}`); return; }
    // A named pipe is never a complete log and has no writer here, so an
    // unguarded read waits forever. The timeout is the assertion: a process that
    // had to be killed proves nothing about how the file is handled.
    const refused = await runScript(["--state", statePath, "--json"], 6_000);
    assert.equal(refused.killed, false, "the evaluation must refuse the FIFO, not wait on it");
    assert.equal(refused.code, INSUFFICIENT_EXIT, refused.stderr);
    const report = JSON.parse(refused.stdout);
    assert.equal(report.runs.length, 1, "the regular log beside it is still analysed");
    assert.deepEqual(report.invalid.map((item) => item.roomId), ["stuck"]);
    assert.match(report.invalid[0].reason, /not a regular file/u);
    // A state directory holding nothing but the FIFO has no run to analyse, and
    // the refusal is what an operator needs from stderr — not just "no run".
    const only = await mkdtemp(join(tmpdir(), "dcl-eval-fifo-"));
    try {
      await mkdir(join(only, "events"), { recursive: true });
      execFileSync("mkfifo", [join(only, "events", "stuck.jsonl")]);
      const empty = await runScript(["--state", join(only, "rooms.json")], 6_000);
      assert.equal(empty.killed, false);
      assert.equal(empty.code, 2);
      assert.match(empty.stderr, /no run found/u);
      assert.match(empty.stderr, /not a regular file/u);
    } finally { await rm(only, { recursive: true, force: true }); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("ten restarts in an idle room cannot satisfy the gate", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-eval-restarts-"));
  const statePath = join(directory, "rooms.json");
  try {
    // Ten back-to-back manifests in ONE room, with nothing happening between
    // them: the reviewer's reproduction. A run's sample unit is an interaction,
    // not a manifest-delimited segment, so restarting a room ten times must not
    // stand in for a study — a reader keying on the status or the exit code
    // would otherwise take ten restarts for ten observations.
    const restarts = [];
    for (let index = 1; index <= 10; index += 1) restarts.push(manifest({ tick: index }));
    await writeLog(statePath, "restarted", restarts);
    const refused = await runScript(["--state", statePath, "--json"]);
    assert.equal(refused.code, INSUFFICIENT_EXIT, "ten restarts must not conclude");
    const report = JSON.parse(refused.stdout);
    assert.equal(report.status, "insufficient-sample");
    assert.equal(report.assertsConclusions, false);
    assert.equal(report.runs.length, 10, "every manifest-bearing segment is still reported");
    assert.ok(report.runs.every((run) => run.analysable === false));
    const group = report.groups[0];
    assert.equal(group.runCount, 10);
    assert.equal(group.analysableRunCount, 0);
    assert.equal(group.sufficient, false);
    assert.equal(group.statistics, null, "a group of restarts states no statistics");
    assert.match(refused.stderr, /at least 10 are required/u);
    assert.match(refused.stderr, /0 holding an interaction/u);
    const text = await runScript(["--state", statePath]);
    assert.equal(text.code, INSUFFICIENT_EXIT);
    assert.ok(!/\bresult\b/u.test(text.stdout), "no line may be printed as a result");
    assert.match(text.stdout, /0 with an interaction/u);
    assert.match(text.stdout, /no interaction to analyse/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the gate counts interactions, and the statistics read only those runs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-eval-segments-"));
  const statePath = join(directory, "rooms.json");
  try {
    // One room, ten manifest-delimited segments; only three of them hold an
    // injected member turn the member received. Ten segments are not ten
    // observations, and the three that are must not have their mean diluted by
    // the seven that are not.
    const events = [];
    for (let index = 1; index <= 10; index += 1) {
      events.push(manifest({ tick: index * 2 - 1 }));
      if (index <= 3) {
        events.push(event("injection.cost", index * 2, { deliveryId: `d${index}`, digestChars: index * 100 }));
        events.push(event("delivery.settled", index * 2,
          { deliveryId: `d${index}`, member: "s1", status: "delivered" }));
      }
    }
    await writeLog(statePath, "mixed", events);
    const refused = await runScript(["--state", statePath, "--json"]);
    assert.equal(refused.code, INSUFFICIENT_EXIT, refused.stderr);
    const report = JSON.parse(refused.stdout);
    assert.equal(report.runs.length, 10);
    assert.equal(report.runs.filter((run) => run.analysable).length, 3);
    const group = report.groups[0];
    assert.equal(group.runCount, 10);
    assert.equal(group.analysableRunCount, 3);
    assert.equal(group.sufficient, false);
    assert.equal(group.statistics, null);
    const observed = await runScript(["--state", statePath, "--observation", "--json"]);
    assert.equal(observed.code, 0, observed.stderr);
    const statistics = JSON.parse(observed.stdout).groups[0].observation;
    assert.equal(statistics.injectedDigestCharsMean.n, 3, "the seven empty segments contribute no value");
    assert.equal(statistics.injectedDigestCharsMean.mean, 200);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("an interaction is an injection the member received, not one that was constructed", () => {
  const roomId = "room-1";
  const cost = (tick, deliveryId, chars) => ({ id: `c${tick}-${deliveryId}`, type: "injection.cost", tick, at: tick,
    payload: { deliveryId, digestChars: chars }, provenance: { roomId } });
  const settle = (tick, deliveryId, status) => ({ id: `s${tick}-${deliveryId}`, type: "delivery.settled", tick, at: tick,
    payload: { deliveryId, status }, provenance: { roomId } });
  // The writer appends the cost record before it calls the transport, so a
  // refused delivery leaves one behind. On its own it is not an interaction.
  const refused = dependentVariables({ events: [cost(2, "d1", 66), settle(3, "d1", "failed")], roomId });
  assert.equal(refused.injectedTurns, 0);
  assert.equal(refused.unreachedInjections, 1);
  assert.equal(refused.injectedDigestCharsTotal, 0);
  assert.equal(refused.injectedDigestCharsMean, null);
  assert.equal(hasInteraction(refused), false, "a constructed injection is not a member turn");
  // The same record, with the member's own session recorded as receiving it.
  const received = dependentVariables({ events: [cost(2, "d1", 66), settle(3, "d1", "delivered")], roomId });
  assert.equal(received.injectedTurns, 1);
  assert.equal(received.unreachedInjections, 0);
  assert.equal(received.injectedDigestCharsTotal, 66);
  assert.equal(hasInteraction(received), true);
  // A zero-character injection still counts once the member was reached: the
  // criterion is "a member turn happened", not "a digest was injected".
  const empty = dependentVariables({ events: [cost(2, "d1", 0), settle(3, "d1", "delivered")], roomId });
  assert.equal(empty.injectedTurns, 1);
  assert.equal(empty.injectedDigestCharsMean, 0);
  assert.equal(hasInteraction(empty), true);
  // Two injections, one of which no member ever saw: the mean is read only from
  // the received one, so text nobody read cannot move it.
  const mixed = dependentVariables({ events: [cost(1, "d1", 100), settle(2, "d1", "delivered"),
    cost(3, "d2", 900), settle(4, "d2", "failed")], roomId });
  assert.equal(mixed.injectedTurns, 1);
  assert.equal(mixed.unreachedInjections, 1);
  assert.equal(mixed.injectedDigestCharsMean, 100);
  // The join is by `deliveryId`, so a received delivery cannot vouch for another
  // delivery's cost record — which a run-level "some delivery succeeded" test
  // would let it do.
  const crossed = dependentVariables({ events: [cost(1, "d1", 100), cost(2, "d2", 200),
    settle(3, "d2", "delivered")], roomId });
  assert.equal(crossed.injectedTurns, 1);
  assert.equal(crossed.injectedDigestCharsTotal, 200);
  // `sent` is not reach: it is written when the transport call returns, not when
  // the member's session has seen the prompt. `failed`/`superseded` are not
  // either.
  assert.deepEqual([...DELIVERY_REACHED_STATUSES], ["delivered", "working", "replied", "passed"]);
});

test("ten refused deliveries cannot satisfy the gate, and the report names them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-eval-refused-"));
  const statePath = join(directory, "rooms.json");
  try {
    // Ten runs, each one manifest followed by a constructed injection whose
    // delivery the member never received — the exact shape a bridge that refuses
    // every call leaves behind. Before the join, this printed `conclusive`.
    const events = [];
    for (let index = 1; index <= 10; index += 1) {
      events.push(manifest({ tick: index * 2 - 1 }));
      events.push(event("injection.cost", index * 2, { deliveryId: `d${index}`, digestChars: 66 }));
      events.push(event("delivery.settled", index * 2, { deliveryId: `d${index}`, member: "s1", status: "failed" }));
    }
    await writeLog(statePath, "refused", events);
    const refused = await runScript(["--state", statePath, "--json"]);
    assert.equal(refused.code, INSUFFICIENT_EXIT, "ten refused deliveries must not conclude");
    const report = JSON.parse(refused.stdout);
    assert.equal(report.status, "insufficient-sample");
    assert.equal(report.assertsConclusions, false);
    assert.equal(report.runs.length, 10);
    assert.ok(report.runs.every((run) => run.analysable === false));
    assert.ok(report.runs.every((run) => run.dependentVariables.unreachedInjections === 1));
    const group = report.groups[0];
    assert.equal(group.runCount, 10);
    assert.equal(group.analysableRunCount, 0);
    assert.equal(group.statistics, null);
    assert.equal(group.observation, null, "no member was reached, so there is nothing to observe");
    // The constructed injections are named rather than silently discarded.
    const text = await runScript(["--state", statePath]);
    assert.equal(text.code, INSUFFICIENT_EXIT);
    assert.ok(!/\bresult\b/u.test(text.stdout), "no line may be printed as a result");
    assert.match(text.stdout, /injection\(s\) never reached a member/u);
    assert.match(text.stdout, /no interaction to analyse/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the script is read-only: the state directory is byte-identical afterwards", async () => {
  const { directory, statePath } = await stateWithRuns(10);
  try {
    const before = await directoryDigest(directory);
    const answered = await runScript(["--state", statePath, "--json"]);
    assert.equal(answered.code, 0, answered.stderr);
    assert.equal(await directoryDigest(directory), before,
      "the evaluation must not write, rename, or touch anything under the state directory");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("runs are pooled only when their configuration matches, and a broken chain is refused", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-eval-mixed-"));
  const statePath = join(directory, "rooms.json");
  try {
    // Two comparable runs and one that injected a different config.
    await writeLog(statePath, "same-1", [manifest({ tick: 1 }),
      event("injection.cost", 2, { deliveryId: "d1", digestChars: 10 }),
      event("delivery.settled", 2, { deliveryId: "d1", member: "s1", status: "delivered" })]);
    await writeLog(statePath, "same-2", [manifest({ tick: 1 }),
      event("injection.cost", 2, { deliveryId: "d2", digestChars: 12 }),
      event("delivery.settled", 2, { deliveryId: "d2", member: "s1", status: "delivered" })]);
    await writeLog(statePath, "other", [manifest({ tick: 1, configHash: "b".repeat(64) }),
      event("injection.cost", 2, { deliveryId: "d3", digestChars: 900 }),
      event("delivery.settled", 2, { deliveryId: "d3", member: "s1", status: "delivered" })]);
    // A log whose chain does not verify is not analysable: its record's order or
    // content cannot be trusted, so it must be refused rather than pooled.
    await writeLog(statePath, "broken", [manifest({ tick: 1 })]);
    await writeLog(statePath, "not-a-run", [event("message.created", 1, { messageId: "m" })]);
    const report = await evaluate({ statePath, observation: true });
    assert.equal(report.runs.length, 4, "every log that holds a manifest is a run");
    // Three logs injected the same configuration text, so they pool; the fourth
    // hashed a different one and is reported on its own rather than averaged in.
    const pooled = report.groups.find((group) => group.configHash === "a".repeat(64));
    const alone = report.groups.find((group) => group.configHash === "b".repeat(64));
    assert.equal(pooled.runCount, 3);
    assert.equal(alone.runCount, 1);
    assert.equal(alone.observation.injectedDigestCharsMean.mean, 900);
    assert.deepEqual(report.skipped.map((item) => item.roomId), ["not-a-run"]);
    assert.equal(report.invalid.length, 0);
    // Now break the chain of one log on disk: its last line's hash no longer
    // matches what it hashes to.
    const brokenPath = join(directory, "events", "broken.jsonl");
    const lines = (await readFile(brokenPath, "utf8")).trim().split("\n");
    const tampered = JSON.parse(lines[0]);
    tampered.payload = { ...tampered.payload, configHash: "c".repeat(64) };
    await writeFile(brokenPath, `${JSON.stringify(tampered)}\n`);
    const after = await evaluate({ statePath, observation: true });
    assert.deepEqual(after.invalid.map((item) => item.roomId), ["broken"]);
    assert.match(after.invalid[0].reason, /chain does not verify/u);
    assert.ok(!after.runs.some((run) => run.roomId === "broken"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the run gate cannot be lowered, and a directory with no run exits 2", async () => {
  const { directory, statePath } = await stateWithRuns(2);
  try {
    const lowered = await runScript(["--state", statePath, "--min-runs", "2"]);
    assert.equal(lowered.code, 1);
    assert.match(lowered.stderr, /may only raise the 10-run gate/u);
    const raised = await runScript(["--state", statePath, "--min-runs", "12"]);
    assert.equal(raised.code, INSUFFICIENT_EXIT);
    const filtered = await runScript(["--state", statePath, "--room", "run-01", "--json"]);
    assert.equal(filtered.code, INSUFFICIENT_EXIT);
    assert.equal(JSON.parse(filtered.stdout).runs.length, 1);
    const empty = await runScript(["--state", join(directory, "empty", "rooms.json"), "--json"]);
    assert.equal(empty.code, 2);
    assert.match(empty.stderr, /no run found/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
