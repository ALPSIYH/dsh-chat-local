import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { EventLog } from "../lib/event-log.js";

const run = promisify(execFile);
const script = fileURLToPath(new URL("../scripts/verify-event-log.mjs", import.meta.url));

/** A real log on disk, in its own temp state directory. */
async function logFor(...types) {
  const directory = await mkdtemp(join(tmpdir(), "dcl-verify-"));
  const statePath = join(directory, "rooms.json");
  const log = new EventLog(statePath);
  for (const type of types) {
    await log.append("r1", { type, actor: { kind: "system", id: "system" }, payload: { type } });
  }
  return { directory, statePath, logPath: join(directory, "events", "r1.jsonl") };
}

const verify = (statePath, roomId = "r1") => run(process.execPath, [script, roomId, "--state", statePath]);

test("the offline verifier reports a healthy chain and the head anchor it matches", async () => {
  const { statePath } = await logFor("a", "b");
  const { stdout } = await verify(statePath);
  const report = JSON.parse(stdout);
  assert.equal(report.ok, true);
  assert.equal(report.lines, 2);
  assert.deepEqual(report.chain, { ok: true, brokenAt: null });
  assert.equal(report.headAnchor.matches, true);
  assert.equal(report.headAnchor.recorded, report.headAnchor.lastEvent);
});

test("the offline verifier fails on a truncated tail, which only the anchor can see", async () => {
  const { statePath, logPath } = await logFor("a", "b");
  const lines = (await readFile(logPath, "utf8")).split("\n").filter(Boolean);
  await writeFile(logPath, `${lines.slice(0, 1).join("\n")}\n`);
  // A surviving prefix verifies against itself, so the exit code has to come
  // from the anchor check rather than from the chain walk.
  await assert.rejects(verify(statePath), (error) => {
    assert.equal(error.code, 1);
    const report = JSON.parse(error.stdout);
    assert.equal(report.ok, false);
    assert.match(report.error, /truncated/);
    return true;
  });
});

test("the offline verifier fails on a rewritten middle, with the index that broke", async () => {
  const { statePath, logPath } = await logFor("a", "b", "c");
  const lines = (await readFile(logPath, "utf8")).split("\n").filter(Boolean);
  const second = JSON.parse(lines[1]);
  lines[1] = JSON.stringify({ ...second, payload: { ...second.payload, type: "tampered" } });
  await writeFile(logPath, `${lines.join("\n")}\n`);
  await assert.rejects(verify(statePath), (error) => {
    assert.equal(error.code, 1);
    const report = JSON.parse(error.stdout);
    assert.deepEqual(report.chain, { ok: false, brokenAt: 1, reason: "hash-mismatch" });
    assert.equal(report.ok, false);
    return true;
  });
});

test("the offline verifier refuses a missing log instead of reporting an empty one as healthy", async () => {
  const { statePath } = await logFor("a");
  await assert.rejects(verify(statePath, "no-such-room"), (error) => {
    assert.equal(error.code, 1);
    assert.equal(JSON.parse(error.stdout).ok, false);
    return true;
  });
});
