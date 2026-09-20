import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { EventLog } from "../lib/event-log.js";
import { EVAL_VERSION, evaluate, renderText } from "../scripts/relationship-eval.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/relationship-eval.mjs", import.meta.url));

async function dataset(t) {
  const directory = await mkdtemp(join(tmpdir(), "dcl-eval-contract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const statePath = join(directory, "rooms.json");
  return { statePath, log: new EventLog(statePath) };
}

async function addRun(data, roomId, { index = 0, arm = "persistent", configHash = "config-a",
  model = "m", review = false, chars = 100, duplicateCost = false, reached = true,
  initialStateVersion = 16, injectionConfigHash = configHash, legacy = false,
  config, memorySampleStatus, personalMemoryStatus, reasoningEffort, deliveryModel, omitDeliveryModel = false } = {}) {
  const tick = index * 10;
  const deliveryId = `${roomId}-${index}`;
  const append = async (type, payload, offset = 0) => {
    const event = await data.log.append(roomId, { type, tick: tick + offset,
      actor: { kind: "system", id: "system" }, payload, provenance: { roomId } });
    assert.ok(event, "the fixture really wrote the event");
  };
  const manifestModel = { provider: model === null ? null : "p", model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }) };
  await append("run.manifest", { arm, configHash, ...(config ? { config } : {}), initialStateVersion, startedAtTick: tick,
    models: { s1: manifestModel } });
  const cost = { deliveryId, digestChars: chars, ...(legacy ? {} : { configHash: injectionConfigHash }),
    ...(legacy || omitDeliveryModel ? {} : { memberSessionId: "s1", modelAtDelivery: deliveryModel ?? manifestModel, modelObservation: "before-delivery" }),
    ...(memorySampleStatus === undefined ? {} : { memorySampleStatus }),
    ...(personalMemoryStatus === undefined ? {} : { personalMemoryStatus }) };
  await append("injection.cost", cost, 1);
  if (duplicateCost) await append("injection.cost", cost, 1);
  await append("delivery.settled", { deliveryId, member: "s1", status: reached ? "delivered" : "failed" }, 2);
  if (review) await append("ledger.transition", { entryId: deliveryId, kind: "task", action: "review",
    status: "in_progress", ownerSessionId: "s1", verdict: "request_changes" }, 3);
}

async function cli(statePath, options = []) {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, "--state", statePath, ...options],
      { encoding: "utf8", timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }));
  });
}

for (const count of [9, 10, 11]) {
  test(`CLI ${count} reached runs is descriptive in both JSON and text, including observation mode`, async (t) => {
    const data = await dataset(t);
    for (let index = 0; index < count; index += 1) await addRun(data, `room-${index}`, { chars: 100 + index });
    for (const observation of [false, true]) {
      const flags = observation ? ["--observation"] : [];
      const output = await cli(data.statePath, [...flags, "--json"]);
      assert.equal(output.code, observation || count >= 10 ? 0 : 3, output.stderr);
      const report = JSON.parse(output.stdout);
      assert.equal(report.version, EVAL_VERSION);
      assert.equal(report.version, 2);
      assert.equal(report.status, observation ? "observation" : count >= 10 ? "sample-ready" : "insufficient-sample");
      assert.equal(report.assertsConclusions, false);
      assert.equal(report.comparison, "descriptive-only");
      assert.equal(report.independence, "unverified");
      assert.deepEqual(report.resetContract, { resetScope: "plugin-memory-overlays", runtimeContextReset: false, sharedConversationReset: false });
      assert.equal(report.singleArm, true);
      const group = report.groups[0];
      assert.equal(group.sufficient, count >= 10);
      assert.equal(group.assertsConclusions, false);
      assert.equal(group.continuity.independentRunCount, null);
      if (observation) {
        assert.equal(group.statistics, null);
        assert.equal(group.observation.injectedDigestCharsMean.mean, 100 + (count - 1) / 2);
      } else if (count >= 10) {
        assert.equal(group.observation, null);
        assert.equal(group.statistics.injectedDigestCharsMean.n, count);
        assert.ok(group.statistics.injectedDigestCharsMean.variance > 0);
      } else assert.equal(group.statistics, null);
      const text = await cli(data.statePath, flags);
      assert.equal(text.code, output.code, text.stderr);
      assert.match(text.stdout, /independence unverified/u);
      assert.match(text.stdout, /native context reset false/u);
      assert.doesNotMatch(text.stdout, /status conclusive|\bresult  /u);
      if (observation) assert.match(text.stdout, /observation \(not a conclusion\)/u);
      else if (count >= 10) assert.match(text.stdout, /descriptive \(not a conclusion\)/u);
    }
  });
}

test("ten sequential segments expose shared room history and outcome-specific missingness", async (t) => {
  const data = await dataset(t);
  for (let index = 0; index < 10; index += 1) await addRun(data, "shared-room", { index, review: index === 0 });
  const report = await evaluate({ statePath: data.statePath });
  const group = report.groups[0];
  assert.equal(report.status, "sample-ready");
  assert.deepEqual(group.continuity.segmentsByRoom, [{ roomId: "shared-room", segments: 10 }]);
  assert.equal(group.continuity.hasRepeatedRoomSegments, true);
  assert.equal(group.continuity.independentRunCount, null);
  assert.deepEqual(group.metricCoverage.reviewRejectionRate,
    { observedN: 1, missingN: 9, requiredN: 10, thresholdMet: false, independentN: null });
  assert.equal(group.statistics.reviewRejectionRate.mean, null, "one review cannot become a ten-review summary");
  assert.equal(group.statistics.reviewRejectionRate.withheld, true);
  assert.equal(group.statistics.handoffSelection.byMember.s1.n, 1, "absence of a handoff is not a zero share");
  assert.equal(group.statistics.handoffSelection.byMember.s1.missing, 9);
  const observed = await evaluate({ statePath: data.statePath, observation: true });
  assert.equal(observed.status, "observation");
  assert.equal(observed.groups[0].observation.reviewRejectionRate.mean, 1);
  assert.equal(observed.groups[0].observation.reviewRejectionRate.n, 1);
  assert.equal(observed.groups[0].observation.reviewRejectionRate.variance, null);
  assert.match(renderText(report), /outcome below threshold/u);
});

test("multiple arms, configurations and unknown models remain visibly separate", async (t) => {
  const data = await dataset(t);
  for (let index = 0; index < 10; index += 1) {
    await addRun(data, `persistent-${index}`);
    await addRun(data, `reset-${index}`, { arm: "reset_per_episode" });
  }
  await addRun(data, "changed-config", { configHash: "config-b" });
  await addRun(data, "changed-model", { model: "other-model" });
  await addRun(data, "unknown-a", { model: null });
  await addRun(data, "unknown-b", { model: null });
  const output = await cli(data.statePath, ["--json"]);
  assert.equal(output.code, 0, output.stderr);
  const report = JSON.parse(output.stdout);
  assert.equal(report.groupsSupplied, 6);
  assert.equal(report.groupsSampleReady, 2);
  assert.deepEqual(report.armsSupplied, ["persistent", "reset_per_episode"]);
  assert.equal(report.singleArm, false);
  assert.equal(report.comparison, "descriptive-only");
  assert.equal(report.assertsConclusions, false);
  assert.equal(report.groups.filter((group) => !group.modelsKnown).length, 2);
  assert.ok(report.groups.filter((group) => !group.modelsKnown).every((group) => group.runCount === 1));
  const text = await cli(data.statePath);
  assert.match(text.stdout, /Multiple arms supplied/u);
  assert.match(text.stdout, /unknown \(not pooled with any other run\)/u);
});

test("malformed measurements and duplicate injections are excluded, not counted toward readiness", async (t) => {
  const data = await dataset(t);
  for (let index = 0; index < 9; index += 1) await addRun(data, `valid-${index}`);
  await addRun(data, "negative-chars", { chars: -1 });
  await addRun(data, "duplicate", { duplicateCost: true });
  await addRun(data, "unknown-state-version", { initialStateVersion: null });
  await addRun(data, "failed", { reached: false });
  const output = await cli(data.statePath, ["--json"]);
  assert.equal(output.code, 3);
  const report = JSON.parse(output.stdout);
  assert.equal(report.dataQuality, "partial");
  assert.equal(report.invalid.length, 3);
  assert.equal(report.runs.length, 10);
  assert.equal(report.groups[0].analysableRunCount, 9);
  assert.equal(report.groups[0].statistics, null);
  assert.equal(report.assertsConclusions, false);
  const observed = await cli(data.statePath, ["--observation", "--json"]);
  assert.equal(observed.code, 1, "partial data must not silently exit successfully");
  assert.equal(JSON.parse(observed.stdout).status, "observation");
  await addRun(data, "valid-tenth");
  const enough = await cli(data.statePath, ["--json"]);
  assert.equal(enough.code, 1, "enough valid rows do not erase excluded input");
  assert.equal(JSON.parse(enough.stdout).status, "sample-ready");
});

test("the callable evaluator also refuses an invalid minimum", async (t) => {
  const data = await dataset(t);
  for (const minRuns of [0, 9, 10.5, NaN, Infinity]) {
    await assert.rejects(evaluate({ statePath: data.statePath, minRuns }), /may only raise/u);
  }
});

test("within-run configuration drift is invalid while missing legacy coverage remains explicit", async (t) => {
  const data = await dataset(t);
  await addRun(data, "matched");
  await addRun(data, "drifted", { injectionConfigHash: "changed-mid-run" });
  await addRun(data, "legacy", { legacy: true });
  const report = await evaluate({ statePath: data.statePath, observation: true });
  assert.equal(report.runs.length, 2);
  assert.equal(report.invalid.length, 1);
  assert.equal(report.invalid[0].roomId, "drifted");
  assert.match(report.invalid[0].reason, /configHash differs/u);
  assert.equal(report.runs.find((run) => run.roomId === "matched").contractCoverage, "per-injection-checked");
  assert.equal(report.runs.find((run) => run.roomId === "legacy").contractCoverage, "legacy-unverified");
  assert.equal(report.groups[0].contractCoverage, "legacy-unverified");
  assert.equal(report.contractCoverage, "legacy-unverified");
  assert.match(renderText(report), /within-run configuration is unverified/u);
});

test("v2 unavailable samples and partial enabled personal memory cannot count as delivered treatments", async (t) => {
  const data = await dataset(t), config = { version: 2, personalMemory: { enabled: true } };
  await addRun(data, "available", { config, memorySampleStatus: "available", personalMemoryStatus: "available" });
  await addRun(data, "unavailable", { config, memorySampleStatus: "unavailable", personalMemoryStatus: "available" });
  await addRun(data, "partial", { config, memorySampleStatus: "available", personalMemoryStatus: "partial" });
  await addRun(data, "disabled", { config: { ...config, personalMemory: { enabled: false } },
    memorySampleStatus: "available", personalMemoryStatus: "partial" });
  await addRun(data, "legacy-status", { config });
  const report = await evaluate({ statePath: data.statePath, observation: true });
  assert.deepEqual(report.invalid.map((run) => run.roomId).sort(), ["partial", "unavailable"]);
  assert.equal(report.runs.length, 3);
  assert.equal(report.runs.find((run) => run.roomId === "legacy-status").contractCoverage, "legacy-unverified");
  assert.equal(report.runs.find((run) => run.roomId === "available").contractCoverage, "per-injection-checked");
  assert.equal(report.dataQuality, "partial");
  assert.equal(report.assertsConclusions, false);
});

test('runtime model and reasoning changes are quarantined while missing old observations stay unverified', async t => {
  const data = await dataset(t);
  await addRun(data, 'matched-low', { reasoningEffort: 'low' });
  await addRun(data, 'matched-high', { reasoningEffort: 'high' });
  await addRun(data, 'changed-model', { deliveryModel: { provider: 'p', model: 'other' } });
  await addRun(data, 'changed-effort', { reasoningEffort: 'low', deliveryModel: { provider: 'p', model: 'm', reasoningEffort: 'high' } });
  await addRun(data, 'runtime-unreadable', { deliveryModel: { provider: null, model: null } });
  await addRun(data, 'legacy-model', { config: { version: 2 }, memorySampleStatus: 'available', omitDeliveryModel: true });
  const report = await evaluate({ statePath: data.statePath, observation: true });
  assert.deepEqual(report.invalid.map(x => x.roomId).sort(), ['changed-effort', 'changed-model', 'runtime-unreadable']);
  assert.ok(report.invalid.every(x => /modelAtDelivery differs/u.test(x.reason)));
  assert.equal(report.groups.length, 3, 'recorded reasoning effort partitions groups');
  assert.equal(report.runs.find(x => x.roomId === 'matched-high').models.s1.reasoningEffort, 'high');
  assert.equal(report.runs.find(x => x.roomId === 'legacy-model').contractCoverage, 'legacy-unverified');
  assert.equal(report.runs.find(x => x.roomId === 'matched-low').contractCoverage, 'per-injection-checked');
  assert.match(renderText(report), /before each recorded delivery/u);
});
