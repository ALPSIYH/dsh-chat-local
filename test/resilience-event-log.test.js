import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog, createEvent, eventLogPath, serializeEvent, verifyChain } from "../lib/event-log.js";

const moduleUrl = new URL("../lib/event-log.js", import.meta.url).href;
async function fixture() { const directory = await mkdtemp(join(tmpdir(), "dcl-resilient-log-")); return { directory, path: join(directory, "rooms.json") }; }
function child(script, expected) {
  let status;
  try { execFileSync(process.execPath, ["--input-type=module", "-e", script], { timeout: 10000, stdio: "pipe" }); status = 0; }
  catch (error) { status = error.status; }
  assert.equal(status, expected, "child must reach the intended persistence boundary");
}

test("appendOnce survives restart and refuses the same operation id with conflicting contents", async () => {
  const h = await fixture();
  try {
    const input = { type: "message.created", payload: { messageId: "m1", text: "once" }, provenance: { roomId: "r" } };
    const first = await new EventLog(h.path).appendOnce("r", input, "operation-1");
    const reopened = new EventLog(h.path);
    const again = await reopened.appendOnce("r", input, "operation-1");
    assert.deepEqual(again, first);
    assert.equal((await reopened.read("r")).length, 1);
    await assert.rejects(reopened.appendOnce("r", { ...input, payload: { text: "different" } }, "operation-1"), /operation.*conflict/i);
  } finally { await rm(h.directory, { recursive: true, force: true }); }
});

test("restart repairs only the intended partial append after the child exits mid-line", async () => {
  const h = await fixture();
  try {
    await new EventLog(h.path).append("r", { type: "before" });
    child(`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {EventLog,eventLogPath} from ${JSON.stringify(moduleUrl)};
      const path=${JSON.stringify(h.path)},original=fs.promises.appendFile;fs.promises.appendFile=async(file,text,options)=>{if(file===eventLogPath(path,'r')){await original(file,Buffer.from(text).subarray(0,Buffer.from(text).indexOf(Buffer.from('真'))+1),options);process.exit(74);}return original(file,text,options);};syncBuiltinESMExports();await new EventLog(path).append('r',{type:'recovered',payload:{text:'真實部分寫入'}});`, 74);
    const reopened = new EventLog(h.path);
    await assert.rejects(reopened.read("r"), /recovery required/);
    await reopened.recover("r");
    const events = await reopened.read("r");
    assert.deepEqual(events.map(event => event.type), ["before", "recovered"]);
    assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
    assert.ok(await reopened.append("r", { type: "after" }));
  } finally { await rm(h.directory, { recursive: true, force: true }); }
});

test("restart completes a replacement interrupted between log rename and head replacement", async () => {
  const h = await fixture();
  try {
    const log = new EventLog(h.path);
    await log.append("r", { type: "old" });
    const restored = createEvent({ type: "restored" });
    child(`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {EventLog,eventLogPath} from ${JSON.stringify(moduleUrl)};
      const path=${JSON.stringify(h.path)},original=fs.promises.rename;fs.promises.rename=async(from,to)=>{await original(from,to);if(to===eventLogPath(path,'r'))process.exit(75);};syncBuiltinESMExports();await new EventLog(path).replace('r',${JSON.stringify([restored])},'restore-1');`, 75);
    const reopened = new EventLog(h.path);
    await assert.rejects(reopened.read("r"), /recovery required/);
    await reopened.recoverAll();
    assert.deepEqual(await reopened.read("r"), [restored]);
    await reopened.append("r", { type: "later" });
    await reopened.replace("r", [restored], "restore-1");
    assert.deepEqual((await reopened.read("r")).map(event => event.type), ["restored", "later"], "replaying a committed replacement must not erase later events");
  } finally { await rm(h.directory, { recursive: true, force: true }); }
});

for (const mode of ["cold", "primed", "warm"]) test(`${mode} append refuses a tampered chain rather than extending corruption`, async () => {
  const h = await fixture();
  try {
    const initial = new EventLog(h.path);
    await initial.append("r", { type: "original" });
    const events = await initial.read("r");
    const log = mode === "warm" ? initial : new EventLog(h.path);
    events[0].payload = { tampered: true };
    await writeFile(eventLogPath(h.path, "r"), `${serializeEvent(events[0])}\n`);
    if (mode === "primed") await log.prime(["r"]);
    const before = await readFile(eventLogPath(h.path, "r"));
    assert.equal(await log.append("r", { type: "forbidden" }), null);
    assert.match(log.health().lastError, /hash-mismatch|chain.*invalid|verification/i);
    assert.deepEqual(await readFile(eventLogPath(h.path, "r")), before);
  } finally { await rm(h.directory, { recursive: true, force: true }); }
});

test("readonly reads refuse a pending operation without repairing files", async () => {
  const h = await fixture();
  try {
    child(`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {EventLog,eventLogPath} from ${JSON.stringify(moduleUrl)};
      const path=${JSON.stringify(h.path)},original=fs.promises.rename;fs.promises.rename=async(from,to)=>{await original(from,to);if(to===eventLogPath(path,'r')+'.pending')process.exit(76);};syncBuiltinESMExports();await new EventLog(path).appendOnce('r',{type:'once'},'durable-op');`, 76);
    const pending = `${eventLogPath(h.path, "r")}.pending`, before = await readFile(pending);
    const log = new EventLog(h.path);
    await assert.rejects(log.read("r"), /recovery required/);
    assert.deepEqual(await readFile(pending), before);
    await assert.rejects(readFile(eventLogPath(h.path, "r")), { code: "ENOENT" });
    await log.recoverAll();
    const recovered = await log.appendOnce("r", { type: "once" }, "durable-op");
    assert.equal((await log.read("r")).length, 1);
    assert.equal(recovered.type, "once");
    assert.deepEqual(await log.recoverAll(), []);
  } finally { await rm(h.directory, { recursive: true, force: true }); }
});

test("recovery refuses unrelated trailing bytes and preserves them for inspection", async () => {
  const h = await fixture();
  try {
    child(`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {EventLog,eventLogPath} from ${JSON.stringify(moduleUrl)};
      const path=${JSON.stringify(h.path)},original=fs.promises.rename;fs.promises.rename=async(from,to)=>{await original(from,to);if(to===eventLogPath(path,'r')+'.pending')process.exit(76);};syncBuiltinESMExports();await new EventLog(path).append('r',{type:'planned'});`, 76);
    const path = eventLogPath(h.path, "r");
    await writeFile(path, "UNRELATED DATA");
    await assert.rejects(new EventLog(h.path).recover("r"), /unrelated trailing bytes/);
    assert.equal(await readFile(path, "utf8"), "UNRELATED DATA");
  } finally { await rm(h.directory, { recursive: true, force: true }); }
});

test("replacement receipt survives a crash before intent removal and prevents replay over later append", async () => {
  const h = await fixture();
  try {
    const restored = createEvent({ type: "restored" });
    child(`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {EventLog,eventLogPath} from ${JSON.stringify(moduleUrl)};
      const path=${JSON.stringify(h.path)},original=fs.promises.rename;fs.promises.rename=async(from,to)=>{await original(from,to);if(to===eventLogPath(path,'r')+'.operations')process.exit(77);};syncBuiltinESMExports();await new EventLog(path).replace('r',${JSON.stringify([restored])},'restore-once');`, 77);
    const log = new EventLog(h.path);
    await log.recoverAll();
    await log.appendOnce("r", { type: "after" }, "append-after");
    const restarted = new EventLog(h.path);
    await restarted.replace("r", [restored], "restore-once");
    assert.deepEqual((await restarted.read("r")).map(event => event.type), ["restored", "after"]);
    await assert.rejects(restarted.replace("r", [], "restore-once"), /operation.*conflict/);
  } finally { await rm(h.directory, { recursive: true, force: true }); }
});

test("concurrent identical operations and caller mutation cannot alter stored deduplication results", async () => {
  const h = await fixture();
  try {
    const log = new EventLog(h.path), input = { type: "once", payload: { text: "original" } };
    const first = log.appendOnce("r", input, "op");
    const second = log.appendOnce("r", input, "op");
    input.payload.text = "mutated";
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual(a, b);
    a.payload.text = "modified returned event";
    const again = await log.appendOnce("r", { type: "once", payload: { text: "original" } }, "op");
    assert.equal(again.payload.text, "original");
    assert.equal((await log.read("r")).length, 1);
  } finally { await rm(h.directory, { recursive: true, force: true }); }
});

test("a changed head invalidates a warm verified cache and cannot be overwritten by append", async () => {
  const h = await fixture();
  try {
    const log = new EventLog(h.path);
    await log.append("r", { type: "before" });
    const path = eventLogPath(h.path, "r"), before = await readFile(path);
    await writeFile(`${path}.head`, "unknown-head");
    assert.equal(await log.append("r", { type: "must-not-append" }), null);
    assert.match(log.health().lastError, /truncated/);
    assert.deepEqual(await readFile(path), before);
    assert.equal(await readFile(`${path}.head`, "utf8"), "unknown-head");
  } finally { await rm(h.directory, { recursive: true, force: true }); }
});

test("a complete legacy last event without terminal newline stays valid after the next append", async () => {
  const h = await fixture();
  try {
    const log = new EventLog(h.path);
    const first = await log.append("r", { type: "before" });
    await writeFile(eventLogPath(h.path, "r"), serializeEvent(first));
    assert.equal((await log.read("r")).length, 1);
    assert.ok(await log.appendOnce("r", { type: "after" }, "newline-operation"));
    const events = await log.read("r");
    assert.deepEqual(events.map(event => event.type), ["before", "after"]);
    assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
  } finally { await rm(h.directory, { recursive: true, force: true }); }
});

test("an append interrupted after its line remains pending rather than reported as a dropped fact", async () => {
  const h = await fixture();
  const fs = await import("node:fs");
  const { syncBuiltinESMExports } = await import("node:module");
  const original = fs.default.promises.rename;
  try {
    const log = new EventLog(h.path);
    fs.default.promises.rename = async (...args) => {
      if (args[1] === `${eventLogPath(h.path, "r")}.head`) throw Object.assign(new Error("injected anchor failure"), { code: "EIO" });
      return original(...args);
    };
    syncBuiltinESMExports();
    assert.equal(await log.appendOnce("r", { type: "retained" }, "retained-op"), null);
    assert.equal(log.health().failed, 1);
    assert.equal(log.health().droppedCount, 0);
    assert.equal(log.health().pendingRecovery, 1);
    fs.default.promises.rename = original;
    syncBuiltinESMExports();
    await log.recover("r");
    assert.equal(log.health().pendingRecovery, 0);
    assert.equal(log.health().recoveredOperations, 1);
    assert.equal(log.health().lastError, null);
    assert.equal((await log.read("r")).length, 1);
    assert.ok(await log.appendOnce("r", { type: "retained" }, "retained-op"));
    assert.equal((await log.read("r")).length, 1);
  } finally { fs.default.promises.rename = original; syncBuiltinESMExports(); await rm(h.directory, { recursive: true, force: true }); }
});

test("appendOnce returns the same canonical persisted event before and after restart", async () => {
  const h = await fixture();
  try {
    const input = { type: "canonical", payload: { absent: undefined, values: [undefined, , 1] } };
    const first = await new EventLog(h.path).appendOnce("r", input, "canonical-operation");
    const repeated = await new EventLog(h.path).appendOnce("r", input, "canonical-operation");
    assert.deepEqual(first, repeated);
    assert.deepEqual(first.payload, { absent: null, values: [null, null, 1] });
  } finally { await rm(h.directory, { recursive: true, force: true }); }
});

for (const kind of ["directory", "malformed JSON", "null", "invalid checksum"]) {
  test(`recovery reports an unreadable ${kind} intent as pending and failed without changing it`, async () => {
    const h = await fixture();
    try {
      const path = `${eventLogPath(h.path, "r")}.pending`;
      await mkdir(join(h.directory, "events"), { recursive: true });
      const contents = kind === "malformed JSON" ? "{" : kind === "null" ? "null" : JSON.stringify({ version: 1, roomId: "r", kind: "append", checksum: "wrong" });
      if (kind === "directory") await mkdir(path);
      else await writeFile(path, contents);
      const log = new EventLog(h.path);
      await assert.rejects(log.recoverAll(), /not a regular file|intent is corrupt|intent is invalid/);
      assert.equal(log.health().failed, 1);
      assert.equal(log.health().droppedCount, 0, "a failed recovery must not invent a dropped append");
      assert.equal(log.health().pendingRecovery, 1);
      assert.deepEqual(log.health().pendingRooms, ["r"]);
      assert.match(log.health().lastError, /not a regular file|intent is corrupt|intent is invalid/);
      if (kind !== "directory") assert.equal(await readFile(path, "utf8"), contents);
      await rm(path, { recursive: true, force: true });
      assert.deepEqual(await log.recover("r"), { roomId: "r", recovered: false });
      assert.equal(log.health().pendingRecovery, 0, "a removed obstruction must not remain listed as pending");
      assert.equal(log.health().lastError, null);
      assert.equal(log.health().failed, 1, "the failed attempt remains counted after a successful retry");
    } finally { await rm(h.directory, { recursive: true, force: true }); }
  });
}

test("recovery discovery failure is visible in health without inventing a pending room", async () => {
  const h = await fixture();
  try {
    await writeFile(join(h.directory, "events"), "not a directory");
    const log = new EventLog(h.path);
    await assert.rejects(log.recoverAll(), { code: "ENOTDIR" });
    assert.equal(log.health().failed, 1);
    assert.match(log.health().lastError, /ENOTDIR/);
    assert.equal(log.health().pendingRecovery, 0);
    assert.equal(log.health().droppedCount, 0);
  } finally { await rm(h.directory, { recursive: true, force: true }); }
});
