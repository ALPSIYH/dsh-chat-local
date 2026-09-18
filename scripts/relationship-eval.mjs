#!/usr/bin/env node
/**
 * Read-only evaluation of one state directory's relationship experiment.
 *
 * The event log is the dataset. This script opens the state directory (or a
 * copy of it), splits each room's log into runs at its `run.manifest` events,
 * and reports each run's dependent variables plus the cross-run dispersion of
 * every group of runs whose configuration is identical. It never writes: it
 * reads the logs and their head anchors, and nothing else.
 *
 * Two rules are script behaviour rather than advice, because both were learned
 * the expensive way:
 *
 * - **At least `MIN_RUNS` runs per group before anything is concluded.** With
 *   fewer, the script refuses to state a conclusion: by default it prints the
 *   per-run observations, reports the sample as insufficient, and exits
 *   non-zero. `--observation` switches to the explicit observation-only mode,
 *   which prints descriptive statistics clearly labelled as observations and
 *   still asserts nothing. The threshold cannot be lowered: `--min-runs` may
 *   only raise it. **The gate counts runs that hold an interaction**, not
 *   manifest-delimited segments: ten `startRun` calls in an idle room are ten
 *   restarts, not ten observations, and they conclude nothing.
 * - **Dispersion, never only a mean.** Every concluded group reports the
 *   sample variance, the standard deviation, the minimum and the maximum beside
 *   the mean, together with how many runs contributed a value.
 *
 * Runs are pooled only when they are genuinely comparable: the pool key is the
 * arm, the injection config hash, the state version and the models actually in
 * use. Two runs whose config hash differs injected different text, so their
 * difference is not the arm's effect; the groups are reported separately.
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
 * Exits 0 when it stated a conclusion (or ran in observation mode), 1 on a
 * usage or read error, 2 when the state directory holds no run, 3 when the
 * sample is insufficient and conclusions were refused.
 */
import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { EventLog, eventLogPath, verifyChain } from "../lib/event-log.js";
import { MIN_RUNS, DEPENDENT_VARIABLE_VERSION, dependentVariables, dispersion, hasInteraction,
  runSegments } from "../lib/experiment.js";

const USAGE = "usage: node scripts/relationship-eval.mjs [--state <rooms.json>] [--room <roomId>] [--min-runs <n>] [--observation] [--json]";
export const EVAL_FORMAT = "dsh-chat-local-relationship-eval";
export const EVAL_VERSION = 1;
/** The exit code that means "the sample is too small; conclusions were refused". */
export const INSUFFICIENT_EXIT = 3;

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
        if (!Number.isSafeInteger(runs) || runs < MIN_RUNS) {
          throw new Error(`--min-runs may only raise the ${MIN_RUNS}-run gate, never lower it\n${USAGE}`);
        }
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

/** A stable key for the models a run actually used. */
function modelsKey(models) {
  return JSON.stringify(Object.keys(models).sort().map((member) => [member, models[member].provider, models[member].model]));
}

/** The pool key: runs that may be compared share all of this. */
function groupKey(run) {
  return JSON.stringify([run.arm, run.configHash, run.initialStateVersion, modelsKey(run.models)]);
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
      if (segment.arm === null) { invalid.push({ roomId, reason: "run manifest states no arm this version knows" }); continue; }
      if (segment.configHash === null) { invalid.push({ roomId, reason: "run manifest states no config hash" }); continue; }
      const values = dependentVariables({ events: segment.events, roomId });
      runs.push({ roomId, runIndex: position, manifestId: segment.manifestId, arm: segment.arm,
        configHash: segment.configHash, initialStateVersion: segment.initialStateVersion,
        startedAtTick: segment.startedAtTick, tickEnd: segment.tickEnd, models: segment.models,
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
      shares.get(member).push(total === 0 ? 0 : (run.dependentVariables.handoffSelection[member] ?? 0) / total);
    }
  }
  return shares;
}

/** The pooled distribution and the per-member share dispersion of one group. */
function handoffStatistics(runs, members) {
  const pooled = {};
  for (const member of members) {
    pooled[member] = runs.reduce((total, run) => total + (run.dependentVariables.handoffSelection[member] ?? 0), 0);
  }
  const shares = handoffShares(runs, members);
  const byMember = {};
  for (const member of members) byMember[member] = dispersion(shares.get(member));
  return { pooled, byMember };
}

/** The scalars one group's runs report, each with its cross-run dispersion. */
function statisticsFor(runs) {
  const members = [...new Set(runs.flatMap((run) => Object.keys(run.models)))].sort();
  const column = (key) => dispersion(runs.map((run) => run.dependentVariables[key]));
  return {
    reviewRejectionRate: column("reviewRejectionRate"),
    refusedActions: column("refusedActions"),
    unresolvedDisputes: column("unresolvedDisputes"),
    unresolvedDisputeMeanTicks: column("unresolvedDisputeMeanTicks"),
    injectedDigestCharsMean: column("injectedDigestCharsMean"),
    injectedTurns: column("injectedTurns"),
    handoffSelection: handoffStatistics(runs, members)
  };
}

/** One group's report: its pool key, its runs, and whether it may conclude. */
function groupsOf(runs, minRuns, observation) {
  const buckets = new Map();
  for (const run of runs) {
    const key = groupKey(run);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(run);
  }
  const groups = [];
  for (const [, bucket] of buckets) {
    // The gate counts runs that hold an interaction, never manifest-delimited
    // segments: a room restarted ten times in silence holds ten segments and no
    // observations, and a group of restarts must not be able to stand in for a
    // study. The statistics are read from the runs that carry the interaction,
    // so a stray restart that added no data cannot move a mean either.
    const analysable = bucket.filter((run) => run.analysable);
    const sufficient = analysable.length >= minRuns;
    const first = bucket[0];
    const group = { arm: first.arm, configHash: first.configHash, initialStateVersion: first.initialStateVersion,
      modelsKey: modelsKey(first.models), models: first.models, runCount: bucket.length,
      analysableRunCount: analysable.length, sufficient,
      runIndexes: bucket.map((run) => ({ roomId: run.roomId, runIndex: run.runIndex, analysable: run.analysable })),
      statistics: sufficient ? statisticsFor(analysable) : null,
      observation: !sufficient && observation && analysable.length > 0 ? statisticsFor(analysable) : null };
    if (!sufficient) {
      group.insufficientReason = `this group holds ${analysable.length} run(s) with an interaction; ${minRuns} are required before it states anything`;
    }
    groups.push(group);
  }
  // Deterministic order: largest group first, then by pool key.
  groups.sort((a, b) => b.runCount - a.runCount || (groupKey(a) < groupKey(b) ? -1 : 1));
  return groups;
}

/** The number formatter the text report uses; a missing value is `—`. */
function number(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "—";
}

/** The whole evaluation as one plain value. */
export async function evaluate({ statePath, roomId, minRuns = MIN_RUNS, observation = false },
  log = new EventLog(statePath)) {
  const { runs, skipped, invalid } = await collectRuns(statePath, roomId, log);
  const groups = groupsOf(runs, minRuns, observation);
  const concluded = groups.filter((group) => group.sufficient);
  const status = concluded.length > 0 ? "conclusive" : (observation ? "observation" : "insufficient-sample");
  const notes = [
    "Runs are pooled only when arm, injection config hash, state version and models all match.",
    `Only runs holding an interaction count toward the ${minRuns}-run gate: a manifest-delimited segment in which no member turn was ever injected is a restart, and states nothing.`,
    "Every duration is measured in ticks, never in the event stamp `at`.",
    "A group reports sample variance (n-1) and is `null` for a single run."
  ];
  if (concluded.length === 0 && runs.length > 0) {
    notes.push(observation
      ? `Observation only: no group holds ${minRuns} runs with an interaction, so these statistics are descriptive and no conclusion is asserted.`
      : `Refused: no group holds ${minRuns} runs with an interaction. Re-run with --observation to print descriptive statistics labelled as observations.`);
  }
  return { format: EVAL_FORMAT, version: EVAL_VERSION,
    dependentVariableVersion: DEPENDENT_VARIABLE_VERSION,
    state: statePath, requiredRuns: minRuns, status,
    assertsConclusions: concluded.length > 0, runs, skipped, invalid, groups, notes };
}

/** One line per run, then one block per group. */
export function renderText(report) {
  const lines = [];
  lines.push(`relationship evaluation — ${report.state}`);
  lines.push(`runs ${report.runs.length}   required per group ${report.requiredRuns}   status ${report.status}`);
  for (const item of report.invalid) lines.push(`invalid  ${item.roomId}: ${item.reason}`);
  for (const item of report.skipped) lines.push(`skipped  ${item.roomId}: ${item.reason}`);
  if (report.runs.length > 0) {
    lines.push("");
    lines.push("run  room                      arm                 reviewReject  refused  disputes  disputeTicks  injectedChars/turn");
    report.runs.forEach((run, index) => {
      const dv = run.dependentVariables;
      lines.push(`${String(index + 1).padEnd(4)} ${run.roomId.padEnd(24)} ${String(run.arm).padEnd(19)} ${number(dv.reviewRejectionRate).padStart(12)}  ${String(dv.refusedActions).padStart(7)}  ${String(dv.unresolvedDisputes).padStart(8)}  ${number(dv.unresolvedDisputeMeanTicks).padStart(12)}  ${number(dv.injectedDigestCharsMean, 1).padStart(17)}${run.analysable ? "" : "  (no interaction: states nothing)"}`);
    });
  }
  for (const group of report.groups) {
    const stats = group.statistics ?? group.observation;
    lines.push("");
    lines.push(`group arm=${group.arm} configHash=${group.configHash.slice(0, 12)}… stateVersion=${group.initialStateVersion}`);
    lines.push(`  runs ${group.runCount} (${group.analysableRunCount} with an interaction)${group.sufficient ? " (sufficient)" : ` — ${group.insufficientReason}`}`);
    if (!stats) {
      lines.push(group.analysableRunCount === 0
        ? "  no statistics: this group's runs hold no interaction to analyse"
        : "  no statistics: a conclusion needs more runs than this group holds");
      continue;
    }
    const label = group.statistics ? "result" : "observation (not a conclusion)";
    for (const name of ["reviewRejectionRate", "refusedActions", "unresolvedDisputes",
      "unresolvedDisputeMeanTicks", "injectedDigestCharsMean", "injectedTurns"]) {
      const value = stats[name];
      lines.push(`  ${label}  ${name.padEnd(28)} mean ${number(value.mean)}  sd ${number(value.sd)}  variance ${number(value.variance)}  min ${number(value.min)}  max ${number(value.max)}  n ${value.n} missing ${value.missing}`);
    }
    const handoff = stats.handoffSelection;
    lines.push(`  ${label}  handoffSelection (pooled counts, then each member's per-run share)`);
    for (const member of Object.keys(handoff.pooled).sort()) {
      const share = handoff.byMember[member];
      lines.push(`      ${member.padEnd(24)} pooled ${String(handoff.pooled[member]).padStart(4)}  share mean ${number(share.mean)}  sd ${number(share.sd)}  variance ${number(share.variance)}`);
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
    process.stderr.write(`relationship-eval: ${report.runs.length} run(s) found, ${withInteraction} holding an interaction; at least ${report.requiredRuns} are required per group before any conclusion. Pass --observation to print observations only.\n`);
    return INSUFFICIENT_EXIT;
  }
  return 0;
}

// Importable for tests: the CLI runs only when this file is the entry point.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((status) => { process.exitCode = status; })
    .catch((error) => { process.stderr.write(`relationship-eval: ${String(error?.message ?? error)}\n`); process.exitCode = 1; });
}
