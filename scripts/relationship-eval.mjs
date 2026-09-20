#!/usr/bin/env node
/**
 * Read-only evaluation of one state directory's relationship experiment.
 *
 * The event log is the dataset. This script opens the state directory (or a
 * copy of it), splits each room's log into runs at its `run.manifest` events,
 * and reports each run's dependent variables plus the cross-run dispersion of
 * every group of runs whose configuration is identical. It never writes: it
 * reads the logs, their head anchors, and — so the report can name the
 * fingerprints this build hashes a config with — the plugin's own fingerprinted
 * source modules.
 *
 * Current manifests retain the config terms as well as `configHash`; legacy
 * manifests may carry only the hash. This build's fingerprint is context, not
 * a reconstruction of a legacy run's settings. A change to *what* the
 * hash covers splits every pre-existing manifest from post-upgrade runs even
 * when the injected bytes are unchanged, so an in-flight experiment has to
 * restart after such an upgrade.
 *
 * This is a descriptive report, not an estimator of a causal treatment effect.
 * A run is a manifest-delimited log segment; segments from one room can share
 * history, and separate rooms do not establish independent assignment either.
 * No number of segments changes `independence: "unverified"` or authorises a
 * conclusion. One supplied arm is reported as one supplied arm.
 *
 * By default at least `MIN_RUNS` valid segments with reached interactions are
 * required per group before cross-run summaries are printed. Each outcome also
 * needs that many observed values: ten deliveries do not imply ten reviews.
 * `--observation` permits smaller descriptive samples and remains observation
 * mode at every sample size. `--min-runs` can only raise this reporting threshold.
 * Every printed mean travels with its n, missingness and sample dispersion.
 *
 * Pooling matches recorded arm, config hash, state version and models only.
 * Matching these fields is not proof of comparability or independence. Different
 * config hashes are kept separate, even when a source-only change produced them.
 * Unknown models remain unpooled. Invalid measurements are explicitly excluded.
 *
 * Durations are measured in `tick`s, never in `at`. The event stamp `at` is
 * nudged forward once per same-millisecond append to stay strictly increasing,
 * so under a programmatic burst it can lead the wall clock by seconds; a
 * duration taken from it would describe the writer's batch size rather than the
 * interaction. See `unresolvedDisputeMeanTicks` in `lib/experiment.js`.
 *
 * Usage:
 *   node scripts/relationship-eval.mjs [--state <rooms.json>] [--room <id>]
 *                                      [--min-runs <n>] [--observation] [--json]
 *
 * Exits 0 when a descriptive report is available, 1 on usage/read errors or a
 * report with excluded invalid input, 2 when no valid run was found, and 3 when
 * the default reporting threshold was not met. Exit 0 never means a causal
 * conclusion or verified independent replication.
 */
import { readdir } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { EventLog, eventLogPath, verifyChain } from "../lib/event-log.js";
import { MIN_RUNS, RESET_CONTRACT, DEPENDENT_VARIABLE_VERSION, dependentVariables, dispersion, hasInteraction,
  injectionConfigFor, runSegments } from "../lib/experiment.js";

const USAGE = "usage: node scripts/relationship-eval.mjs [--state <rooms.json>] [--room <roomId>] [--min-runs <n>] [--observation] [--json]";
export const EVAL_FORMAT = "dsh-chat-local-relationship-eval";
// v2 removes causal/conclusive claims and separates metric coverage from run count.
export const EVAL_VERSION = 2;
/** The default descriptive reporting threshold was not met. */
export const INSUFFICIENT_EXIT = 3;

const SCALAR_METRICS = Object.freeze(["reviewRejectionRate", "refusedActions", "unresolvedDisputes",
  "unresolvedDisputeMeanTicks", "injectedDigestCharsMean", "injectedTurns"]);
const nonemptyText = (value) => typeof value === "string" && value.trim().length > 0;
const nonnegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;

function validateMinimum(minRuns) {
  if (!Number.isSafeInteger(minRuns) || minRuns < MIN_RUNS) {
    throw new Error(`--min-runs may only raise the ${MIN_RUNS}-run gate, never lower it`);
  }
}

function parseArgs(argv) {
  const options = { statePath: undefined, roomId: undefined, minRuns: MIN_RUNS, observation: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") return { help: true };
    if (arg === "--observation") { options.observation = true; continue; }
    if (arg === "--json") { options.json = true; continue; }
    if (arg === "--state" || arg === "--room" || arg === "--min-runs") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("-")) throw new Error(`${arg} needs a value\n${USAGE}`);
      index += 1;
      if (arg === "--state") options.statePath = value;
      else if (arg === "--room") options.roomId = value;
      else {
        const runs = Number(value);
        validateMinimum(runs);
        options.minRuns = runs;
      }
      continue;
    }
    throw new Error(`unknown option ${arg}\n${USAGE}`);
  }
  if (options.statePath === undefined) {
    options.statePath = join(homedir(), ".dsh", "dsh-chat-local", "rooms.json");
  }
  return options;
}

/** Every room whose log sits in the state directory, in code-unit order. */
async function roomIdsIn(statePath) {
  const directory = dirname(eventLogPath(statePath, "room"));
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return names.filter((name) => name.endsWith(".jsonl"))
    .map((name) => name.slice(0, -".jsonl".length))
    .filter((roomId) => roomId.length > 0)
    .sort();
}

/** A stable key for the model configuration recorded at an observation. */
function modelsKey(models) {
  return JSON.stringify(Object.keys(models).sort().map((member) => [member, models[member].provider,
    models[member].model, models[member].reasoningEffort ?? null]));
}

/**
 * Whether the runtime reported a provider and a model for every member.
 *
 * `null` is what the writer records when the runtime could not report a member's
 * model, and it is recorded rather than guessed so a reader can see that the
 * model is unknown. The grouping key can match only recorded conditions; it
 * cannot establish that two unread model assignments were equal.
 */
function modelsKnown(models) {
  const members = Object.keys(models ?? {});
  return members.length > 0 && members.every((member) => nonemptyText(models[member]?.provider)
    && nonemptyText(models[member]?.model));
}

/**
 * The pool key: runs that may be compared share all of this.
 *
 * The models term is a run's own manifest id when the models are unknown, so
 * such a run is pooled with no other run at all — not with other unknown-model
 * runs either, since "both models are unknown" is not evidence that they were
 * the same. A group of one can never satisfy the `MIN_RUNS` gate, which is the
 * point: unknown recorded model conditions cannot satisfy descriptive pooling.
 */
function groupKey(run) {
  const models = modelsKnown(run.models) ? modelsKey(run.models)
    : JSON.stringify(["unread", run.roomId, run.runIndex, run.manifestId]);
  return JSON.stringify([run.arm, run.configHash, run.initialStateVersion, models]);
}

function manifestConfig(segment) {
  return segment.events.find((event) => event.type === "run.manifest" && event.id === segment.manifestId)?.payload?.config;
}

function contractCoverageFor(segment) {
  const costs = segment.events.filter((event) => event.type === "injection.cost");
  if (costs.length === 0) return "no-injections";
  const config = manifestConfig(segment);
  return costs.some(({ payload }) => !Object.hasOwn(payload, "configHash")
    || !Object.hasOwn(payload, "modelAtDelivery")
    || config?.version >= 2 && (payload.memorySampleStatus === undefined
      || config.personalMemory?.enabled === true && payload.personalMemoryStatus === undefined))
    ? "legacy-unverified" : "per-injection-checked";
}

function combinedCoverage(runs) {
  if (runs.some((run) => run.contractCoverage === "legacy-unverified")) return "legacy-unverified";
  return runs.some((run) => run.contractCoverage === "per-injection-checked") ? "per-injection-checked" : "no-injections";
}

/** Validate the fields the dependent-variable reader would otherwise coerce or skip. */
function invalidSegmentReason(segment) {
  if (segment.arm === null) return "run manifest states no arm this version knows";
  if (!nonemptyText(segment.configHash)) return "run manifest states no config hash";
  if (!Number.isSafeInteger(segment.initialStateVersion) || segment.initialStateVersion < 1) {
    return "run manifest states no valid initial state version";
  }
  if (!nonnegativeInteger(segment.startedAtTick)) return "run manifest states no valid startedAtTick";
  const config = manifestConfig(segment);
  const injectionIds = new Set();
  for (const event of segment.events) {
    if (!nonnegativeInteger(event.tick)) return `event ${event.id} has an invalid tick`;
    const payload = event.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return `event ${event.id} has an invalid payload`;
    }
    if (event.type === "injection.cost") {
      if (!nonnegativeInteger(payload.digestChars) || !nonemptyText(payload.deliveryId)) {
        return `injection.cost ${event.id} needs a nonnegative integer digestChars and deliveryId`;
      }
      if (injectionIds.has(payload.deliveryId)) return `duplicate injection.cost for delivery ${payload.deliveryId}`;
      if (Object.hasOwn(payload, "configHash") && payload.configHash !== segment.configHash) {
        return `injection.cost ${event.id} configHash differs from its run manifest`;
      }
      if (Object.hasOwn(payload, "modelAtDelivery")) {
        const model = payload.modelAtDelivery, member = payload.memberSessionId;
        if (!model || typeof model !== "object" || Array.isArray(model) || !nonemptyText(member)
          || !Object.hasOwn(segment.models, member)
          || ![model.provider, model.model].every(value => value === null || nonemptyText(value))
          || model.reasoningEffort != null && typeof model.reasoningEffort !== "string") {
          return `injection.cost ${event.id} has an invalid before-delivery model observation`;
        }
        if (modelsKey({ [member]: model }) !== modelsKey({ [member]: segment.models[member] })) {
          return `injection.cost ${event.id} modelAtDelivery differs from its run manifest`;
        }
      }
      if (config?.version >= 2 && payload.memorySampleStatus === "unavailable") {
        return `injection.cost ${event.id} memory sample was unavailable`;
      }
      if (config?.version >= 2 && config.personalMemory?.enabled === true && payload.personalMemoryStatus === "partial") {
        return `injection.cost ${event.id} enabled personal memory was only partially available`;
      }
      injectionIds.add(payload.deliveryId);
    }
    if (event.type === "delivery.settled" && (!nonemptyText(payload.deliveryId)
      || !["queued", "sent", "delivered", "working", "replied", "passed", "failed", "superseded"].includes(payload.status))) {
      return `delivery.settled ${event.id} has an invalid deliveryId or status`;
    }
    if (event.type === "ledger.transition") {
      if (!nonemptyText(payload.entryId)) return `ledger.transition ${event.id} has no entryId`;
      if (payload.verdict != null && !["approve", "request_changes"].includes(payload.verdict)) {
        return `ledger.transition ${event.id} has an unknown review verdict`;
      }
      if (payload.kind === "dispute" && !nonemptyText(payload.status)) {
        return `dispute ${event.id} has no status`;
      }
    }
  }
  return null;
}

/** Read every run the state directory holds, and everything that is not one. */
async function collectRuns(statePath, only, log = new EventLog(statePath)) {
  const runs = [];
  const skipped = [];
  const invalid = [];
  for (const roomId of await roomIdsIn(statePath)) {
    if (only !== undefined && roomId !== only) continue;
    let events;
    try {
      // `read` parses the file and enforces the head anchor, so a truncated tail
      // is reported here rather than being walked as a complete log.
      events = await log.read(roomId);
    } catch (error) {
      invalid.push({ roomId, reason: `log unreadable: ${String(error?.message ?? error)}` });
      continue;
    }
    // A chain that does not verify is a record whose order or content cannot be
    // trusted, so it is refused rather than analysed: a rewritten log would
    // silently become the dataset.
    const chain = verifyChain(events);
    if (!chain.ok) {
      invalid.push({ roomId, reason: `event chain does not verify: ${chain.reason} at line ${chain.brokenAt + 1}` });
      continue;
    }
    const segments = runSegments(events, roomId);
    if (segments.length === 0) {
      skipped.push({ roomId, reason: "no run.manifest in this room's log" });
      continue;
    }
    for (const [position, segment] of segments.entries()) {
      const reason = invalidSegmentReason(segment);
      if (reason) { invalid.push({ roomId, runIndex: position, manifestId: segment.manifestId, reason }); continue; }
      const values = dependentVariables({ events: segment.events, roomId });
      runs.push({ roomId, runIndex: position, manifestId: segment.manifestId, arm: segment.arm,
        configHash: segment.configHash, initialStateVersion: segment.initialStateVersion,
        startedAtTick: segment.startedAtTick, tickEnd: segment.tickEnd, models: segment.models,
        contractCoverage: contractCoverageFor(segment),
        modelsKnown: modelsKnown(segment.models),
        chain: chain.ok, analysable: hasInteraction(values), dependentVariables: values });
    }
  }
  return { runs, skipped, invalid };
}

/** The per-run shares of one member's handoff selections. */
function handoffShares(runs, members) {
  const shares = new Map(members.map((member) => [member, []]));
  for (const run of runs) {
    const total = run.dependentVariables.handoffSelectionTotal;
    for (const member of members) {
      // No choice was made, so a share is undefined, not evidence of zero share.
      shares.get(member).push(total === 0 ? null : (run.dependentVariables.handoffSelection[member] ?? 0) / total);
    }
  }
  return shares;
}

/** The pooled distribution and the per-member share dispersion of one group. */
function handoffStatistics(runs, members, minRuns, observation) {
  const pooled = {};
  const observed = runs.filter((run) => run.dependentVariables.handoffSelectionTotal > 0).length;
  for (const member of members) {
    pooled[member] = observation || observed >= minRuns
      ? runs.reduce((total, run) => total + (run.dependentVariables.handoffSelection[member] ?? 0), 0) : null;
  }
  const shares = handoffShares(runs, members);
  const byMember = {};
  for (const member of members) byMember[member] = describeColumn(shares.get(member), minRuns, observation);
  return { pooled, byMember };
}

/** A metric's usable values, with a reporting gate distinct from the run gate. */
function coverageOf(values, minRuns) {
  const observedN = values.filter(Number.isFinite).length;
  return { observedN, missingN: values.length - observedN, requiredN: minRuns,
    thresholdMet: observedN >= minRuns, independentN: null };
}

function describeColumn(values, minRuns, observation) {
  const coverage = coverageOf(values, minRuns);
  if (!observation && !coverage.thresholdMet) {
    return { n: coverage.observedN, missing: coverage.missingN, mean: null, variance: null,
      sd: null, min: null, max: null, coverage, withheld: true };
  }
  return { ...dispersion(values), coverage, withheld: false };
}

/** The scalars one group's runs report, each with its cross-run dispersion. */
function statisticsFor(runs, minRuns, observation) {
  const members = [...new Set(runs.flatMap((run) => [
    ...Object.keys(run.models), ...Object.keys(run.dependentVariables.handoffSelection)
  ]))].sort();
  const statistics = Object.fromEntries(SCALAR_METRICS.map((key) =>
    [key, describeColumn(runs.map((run) => run.dependentVariables[key]), minRuns, observation)]));
  statistics.handoffSelection = handoffStatistics(runs, members, minRuns, observation);
  return statistics;
}

function metricCoverage(runs, minRuns) {
  const result = Object.fromEntries(SCALAR_METRICS.map((key) =>
    [key, coverageOf(runs.map((run) => run.dependentVariables[key]), minRuns)]));
  result.handoffSelection = coverageOf(runs.map((run) =>
    run.dependentVariables.handoffSelectionTotal > 0 ? run.dependentVariables.handoffSelectionTotal : null), minRuns);
  return result;
}

/** Observed clustering is not a count of independently assigned experimental units. */
function continuityOf(runs) {
  const rooms = new Map();
  for (const run of runs) rooms.set(run.roomId, (rooms.get(run.roomId) ?? 0) + 1);
  return { unit: "manifest-delimited room segment", roomCount: rooms.size,
    segmentsByRoom: [...rooms].sort(([a], [b]) => a.localeCompare(b))
      .map(([roomId, segments]) => ({ roomId, segments })),
    hasRepeatedRoomSegments: [...rooms.values()].some((count) => count > 1),
    independentRunCount: null };
}

/** One group's descriptive eligibility and outcome-specific coverage. */
function groupsOf(runs, minRuns, observation) {
  const buckets = new Map();
  for (const run of runs) {
    const key = groupKey(run);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(run);
  }
  const groups = [];
  for (const [, bucket] of buckets) {
    // The gate counts runs that hold an interaction the member received, never
    // manifest-delimited segments and never a bare `injection.cost`: a room
    // restarted ten times in silence holds ten segments, and ten deliveries the
    // transport refused hold ten cost records, and neither is a study. The
    // statistics are read from the runs that carry the interaction, so a stray
    // restart that added no data cannot move a mean either.
    const analysable = bucket.filter((run) => run.analysable);
    const first = bucket[0];
    const known = modelsKnown(first.models);
    const sufficient = known && analysable.length >= minRuns;
    const group = { arm: first.arm, configHash: first.configHash, initialStateVersion: first.initialStateVersion,
      modelsKey: modelsKey(first.models), models: first.models, modelsKnown: known, runCount: bucket.length,
      poolId: groupKey(first),
      analysableRunCount: analysable.length, sufficient,
      sampleReadiness: sufficient ? "sample-ready" : "insufficient-sample",
      contractCoverage: combinedCoverage(bucket),
      comparison: "descriptive-only", independence: "unverified", assertsConclusions: false,
      continuity: continuityOf(analysable), metricCoverage: metricCoverage(analysable, minRuns),
      runIndexes: bucket.map((run) => ({ roomId: run.roomId, runIndex: run.runIndex, analysable: run.analysable })),
      statistics: sufficient && !observation ? statisticsFor(analysable, minRuns, false) : null,
      observation: observation && analysable.length > 0 ? statisticsFor(analysable, minRuns, true) : null };
    if (!sufficient) {
      // The reason a group lacks default summaries says which gate stopped it. A group of
      // one exists because its models are unknown, and the ten-run count is then
      // not what an operator needs to hear: no sample size could fix it.
      group.insufficientReason = !known
        ? "this run's models are unknown, so it is pooled with no other run; matching provider/model conditions are unverified"
        : `this group holds ${analysable.length} run(s) with an interaction; ${minRuns} are required for default descriptive summaries`;
    }
    groups.push(group);
  }
  // Deterministic order: largest group first, then by pool key.
  groups.sort((a, b) => b.runCount - a.runCount || (a.poolId < b.poolId ? -1 : 1));
  return groups;
}

/** The number formatter the text report uses; a missing value is `—`. */
function number(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

/** The whole evaluation as one plain value. */
export async function evaluate({ statePath, roomId, minRuns = MIN_RUNS, observation = false },
  log = new EventLog(statePath)) {
  validateMinimum(minRuns);
  const { runs, skipped, invalid } = await collectRuns(statePath, roomId, log);
  const groups = groupsOf(runs, minRuns, observation);
  const ready = groups.filter((group) => group.sufficient);
  const status = observation ? "observation" : ready.length > 0 ? "sample-ready" : "insufficient-sample";
  const armsSupplied = [...new Set(runs.map((run) => run.arm))].sort();
  const config = injectionConfigFor({});
  const currentConfig = { version: config.version, algorithm: config.algorithm,
    source: config.source, relationshipVersion: config.relationshipVersion };
  const notes = [
    "Descriptive only: sample-ready means the reporting count threshold was met, never a causal effect, significance finding or independent replication.",
    "Runs are pooled only when recorded arm, injection config hash, state version and models all match; matching recorded fields does not establish exchangeability or treatment assignment.",
    "Model configuration is observed at the manifest and before each recorded delivery, including reasoning effort when known. Matching observations do not prove constant runtime settings during token generation.",
    "A run with unknown provider/model is pooled with no other run, including other unknown-model runs. Both models being unknown is not evidence that they match.",
    `Only valid runs holding a reached interaction count toward the ${minRuns}-run descriptive gate. A bare injection.cost, an empty restart or failed transport is not a reached interaction.`,
    "Runs are manifest-delimited room segments. Segments from the same room can share history; room counts and segment counts do not establish independent experimental units. Independent n is unknown.",
    "Reset changes plugin C/A/personal memory overlays only. Native runtime context is not purged and shared room conversation persists; the reset arm is not an independent or memory-free counterfactual.",
    "Coverage is outcome-specific: reviews, handoff shares and dispute durations are missing when their denominators are absent, not zero. Below-threshold outcomes are withheld by default and shown only with --observation.",
    "Every duration is measured in ticks, never in the event stamp `at`.",
    "Variance uses n-1 and is null for one observed value. It describes dispersion, not uncertainty under verified independent sampling.",
    "Current manifests retain config terms; legacy manifests may record only configHash. Different hashes stay separate, including source-only changes; the displayed current build fingerprint cannot reconstruct missing past configuration."
  ];
  if (armsSupplied.length < 2) notes.push("Single arm: the supplied data contain no between-arm comparison.");
  else notes.push("Multiple arms supplied: they are described separately. No randomisation, paired design, independence or causal contrast is inferred from their presence.");
  if (observation) notes.push("Observation only at every sample size: descriptive summaries are allowed below the reporting threshold and no conclusion is asserted.");
  else if (ready.length === 0 && runs.length > 0) {
    notes.push(`Refused: no group holds ${minRuns} valid runs with an interaction. Re-run with --observation to print descriptive statistics labelled as observations.`);
  }
  if (invalid.length > 0) notes.push("Invalid input was excluded and is listed in invalid. This is a partial report, not a clean dataset validation.");
  if (runs.some((run) => run.contractCoverage === "legacy-unverified")) {
    notes.push("Legacy injection.cost records lack per-injection configuration, runtime-model or memory availability coverage. Their within-run configuration is unverified; descriptive acceptance does not certify configuration constancy or a fully delivered memory treatment.");
  }
  return { format: EVAL_FORMAT, version: EVAL_VERSION,
    dependentVariableVersion: DEPENDENT_VARIABLE_VERSION,
    state: statePath, requiredRuns: minRuns, status,
    mode: observation ? "observation" : "thresholded-descriptive",
    comparison: "descriptive-only", independence: "unverified", assertsConclusions: false,
    resetContract: { ...RESET_CONTRACT },
    dataQuality: invalid.length > 0 ? "partial" : "complete",
    contractCoverage: combinedCoverage(runs),
    groupsSupplied: groups.length, groupsSampleReady: ready.length, armsSupplied,
    singleArm: armsSupplied.length === 1, continuity: continuityOf(runs.filter((run) => run.analysable)),
    currentConfig, runs, skipped, invalid, groups, notes };
}

/** One line per run, then one block per group. */
export function renderText(report) {
  const lines = [];
  lines.push(`relationship evaluation — ${report.state}`);
  lines.push(`runs ${report.runs.length}   required per group ${report.requiredRuns}   status ${report.status}`);
  lines.push(`comparison ${report.comparison}   independence ${report.independence}   data ${report.dataQuality}`);
  lines.push(`groups supplied ${report.groupsSupplied}   arms ${report.armsSupplied.join(", ") || "none"}   independent n unknown`);
  lines.push(`reset scope ${report.resetContract.resetScope}   native context reset ${report.resetContract.runtimeContextReset}   shared conversation reset ${report.resetContract.sharedConversationReset}`);
  if (report.currentConfig) {
    const config = report.currentConfig;
    lines.push(`current config  version ${config.version}  algorithm ${String(config.algorithm).slice(0, 12)}…  `
      + `source ${String(config.source).slice(0, 12)}…  relationshipVersion ${config.relationshipVersion}`);
  }
  for (const item of report.invalid) lines.push(`invalid  ${item.roomId}: ${item.reason}`);
  for (const item of report.skipped) lines.push(`skipped  ${item.roomId}: ${item.reason}`);
  if (report.runs.length > 0) {
    lines.push("");
    lines.push("run  room                      arm                 reviewReject  refused  disputes  disputeTicks  injectedChars/turn");
    report.runs.forEach((run, index) => {
      const dv = run.dependentVariables;
      // A run whose injections were all constructed but never received is the
      // failure mode the gate exists for, so the count is named on the line
      // rather than left for a reader to infer from `injectedChars/turn` being 0.
      const unreached = dv.unreachedInjections > 0
        ? `  (${dv.unreachedInjections} injection(s) never reached a member)` : "";
      lines.push(`${String(index + 1).padEnd(4)} ${run.roomId.padEnd(24)} ${String(run.arm).padEnd(19)} ${number(dv.reviewRejectionRate).padStart(12)}  ${String(dv.refusedActions).padStart(7)}  ${String(dv.unresolvedDisputes).padStart(8)}  ${number(dv.unresolvedDisputeMeanTicks).padStart(12)}  ${number(dv.injectedDigestCharsMean, 1).padStart(17)}${unreached}${run.analysable ? "" : "  (no interaction: states nothing)"}`);
    });
  }
  for (const group of report.groups) {
    const stats = group.statistics ?? group.observation;
    lines.push("");
    const members = Object.keys(group.models ?? {}).sort();
    const models = group.modelsKnown
      ? members.map((member) => `${member}=${group.models[member].provider}/${group.models[member].model}`).join(" ")
      : "unknown (not pooled with any other run)";
    lines.push(`group arm=${group.arm} configHash=${group.configHash.slice(0, 12)}… stateVersion=${group.initialStateVersion}`);
    lines.push(`  models ${models}`);
    lines.push(`  runs ${group.runCount} (${group.analysableRunCount} with an interaction) — ${group.sampleReadiness}`);
    lines.push(`  room clusters ${group.continuity.roomCount}   repeated room segments ${group.continuity.hasRepeatedRoomSegments}   independence unverified`);
    lines.push(`  configuration coverage ${group.contractCoverage}`);
    if (!group.sufficient) lines.push(`  ${group.insufficientReason}`);
    for (const [name, coverage] of Object.entries(group.metricCoverage)) {
      lines.push(`  coverage ${name} observed n ${coverage.observedN} missing ${coverage.missingN} required ${coverage.requiredN} independent n unknown`);
    }
    if (!stats) {
      // A group of one whose models are unknown has no statistics because the
      // grouping key could not match its models, not because it holds no interaction.
      lines.push(!group.modelsKnown
        ? "  no statistics: this run's models are unknown, so it stands alone and cannot reach the gate"
        : group.analysableRunCount === 0
          ? "  no statistics: this group's runs hold no interaction to analyse"
          : "  no statistics: default descriptive summaries need more runs than this group holds");
      continue;
    }
    const label = group.statistics ? "descriptive (not a conclusion)" : "observation (not a conclusion)";
    for (const name of SCALAR_METRICS) {
      const value = stats[name];
      lines.push(`  ${label}  ${name.padEnd(28)} mean ${number(value.mean)}  sd ${number(value.sd)}  variance ${number(value.variance)}  min ${number(value.min)}  max ${number(value.max)}  n ${value.n} missing ${value.missing}${value.withheld ? " (withheld: outcome below threshold)" : ""}`);
    }
    const handoff = stats.handoffSelection;
    lines.push(`  ${label}  handoffSelection (pooled counts, then each member's per-run share)`);
    for (const member of Object.keys(handoff.pooled).sort()) {
      const share = handoff.byMember[member];
      lines.push(`      ${member.padEnd(24)} pooled ${number(handoff.pooled[member], 0).padStart(4)}  share mean ${number(share.mean)}  sd ${number(share.sd)}  variance ${number(share.variance)}  n ${share.n} missing ${share.missing}${share.withheld ? " (withheld: outcome below threshold)" : ""}`);
    }
  }
  for (const note of report.notes) lines.push(`note: ${note}`);
  return `${lines.join("\n")}\n`;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${String(error?.message ?? error)}\n`);
    return 1;
  }
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  let report;
  try {
    report = await evaluate(options);
  } catch (error) {
    process.stderr.write(`relationship-eval: ${String(error?.message ?? error)}\n`);
    return 1;
  }
  if (report.runs.length === 0) {
    process.stderr.write(`relationship-eval: no run found in ${report.state}\n`);
    // Why there is no run is the actionable half: a refused log (a broken chain,
    // a path that is not a regular file) is named here rather than only in the
    // text report, which this branch does not print.
    for (const item of report.invalid) {
      process.stderr.write(`relationship-eval: invalid  ${item.roomId}: ${item.reason}\n`);
    }
    if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 2;
  }
  if (options.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else process.stdout.write(renderText(report));
  if (report.status === "insufficient-sample") {
    const withInteraction = report.runs.filter((run) => run.analysable).length;
    process.stderr.write(`relationship-eval: ${report.runs.length} run(s) found, ${withInteraction} holding an interaction; at least ${report.requiredRuns} are required per group for default descriptive summaries. Pass --observation to print observations only.\n`);
    return INSUFFICIENT_EXIT;
  }
  if (report.invalid.length > 0) {
    process.stderr.write(`relationship-eval: ${report.invalid.length} invalid input(s) excluded; partial descriptive report only.\n`);
    return 1;
  }
  return 0;
}

/**
 * Whether this file is the process's entry point, so the CLI runs when it is
 * invoked and the module stays importable for tests when it is not.
 *
 * `node` resolves the executed module's own URL through symlinks but keeps
 * `process.argv[1]` as it was typed, so comparing the two raw URLs made a
 * symlinked invocation — macOS `/tmp` → `/private/tmp`, or a symlinked install —
 * evaluate nothing and exit 0 with no output: a gate script reporting success for
 * a run it never performed. Both sides are resolved before they are compared, so
 * the answer describes the file rather than the name it was reached by.
 *
 * An entry path that cannot be resolved is not this file, and an importing
 * process is left unlaunched; but the reason is printed and the exit code is set
 * rather than swallowed, so the failure mode is never again "nothing happened,
 * exit 0".
 */
function isEntryPoint() {
  const given = process.argv[1];
  if (given === undefined) return false;
  let invoked;
  try { invoked = realpathSync(given); }
  catch (error) {
    process.stderr.write(`relationship-eval: cannot resolve the entry path ${given}: ${String(error?.message ?? error)}\n`);
    process.exitCode = 1;
    return false;
  }
  return realpathSync(fileURLToPath(import.meta.url)) === invoked;
}

if (isEntryPoint()) {
  main().then((status) => { process.exitCode = status; })
    .catch((error) => { process.stderr.write(`relationship-eval: ${String(error?.message ?? error)}\n`); process.exitCode = 1; });
}
