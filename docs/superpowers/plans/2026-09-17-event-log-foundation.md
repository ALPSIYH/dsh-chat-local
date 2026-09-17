# 事件日志与不可变审计基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让群聊里每一个可观测动作都以追加且不可变的事件形式落盘，并带上来源、逻辑时钟与调度顺序，使「谁在第几步对谁做了什么」事后可精确重建。

**Architecture:** 新增一个独立的事件日志层（`lib/event-log.js` + 每房间一个 JSONL 文件），由现有的写入路径**旁路发射**事件；`rooms.json` 继续作为读模型，不改其语义。日志是主存储的**追加副本**，读模型将来可由它重建。另加：回合提示词的注入块日志（实验的自变量）、逻辑 tick、以及快照/恢复。

**Tech Stack:** Node.js ESM（无构建步骤）、`node:fs/promises` 追加写、`node:crypto` 做哈希链、`node:test` + `node:assert/strict`。**不引入任何新依赖。**

**Spec:** `docs/superpowers/specs/2026-09-17-relational-long-term-memory-design.md`

## Global Constraints

- 插件版本从 `0.16.2-local.1` 升到 `0.16.3-local.1`；`package.json`、`package-lock.json`（两处）、`CHANGELOG.md` 首条必须同步（`test/version-consistency.test.js` 会锁死这四处）。
- 房间状态版本 `STATE_VERSION` 从 `14` 升到 `15`；迁移前必须写 `rooms.json.v14.bak`（该逻辑已存在，见 `lib/room-store.js` 的 `#load`）。
- **绝不在任何文件里出现真实 home 路径**；`test/version-consistency.test.js` 现在会递归扫描仓库内所有文件。
- 事件日志**只追加**：任何代码路径都不得改写或删除已写入的事件行。
- 单行事件必须是**合法 JSON 且不含换行**（写入前 `JSON.stringify`，并断言不含 `\n`）。
- 日志写入失败**不得**使房间操作失败：日志是旁路，失败只记录并降级（`logger` 不可用时静默）；但**不得静默丢失**——失败计数必须暴露给 `/health`。
- 所有新代码遵循仓库既有风格：ESM、纯函数优先、模块小而聚焦、注释解释「为什么」。
- 每个任务结束都要通过 `npm run check`（含客户端 bundle 的 `--check` 与 276+ 项测试）。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `lib/event-log.js`（新建） | 事件信封、哈希链、序列化、路径推导、追加写入器。**纯函数 + 一个薄写入器**，不 import `room-store.js` |
| `lib/room-store.js`（修改） | 在既有写入路径旁路发射事件；加 `room.tick`；记录调度顺序；记录注入块 |
| `lib/room-export.js`（修改） | 快照增加事件段与配置哈希；新增**校验式导入** |
| `lib/index.js`（修改） | `/health` 暴露日志健康计数；新增 `GET /rooms/:id/snapshot` 与 `POST /rooms/:id/restore-from-snapshot`（**不能**用 `POST /rooms/:id/restore`：该路径已被「恢复软删除房间」占用，见 Task 6 的裁定 R26） |
| `test/event-log.test.js`（新建） | 信封/哈希链/序列化/追加/损坏检测的单元测试 |
| `test/event-emission.test.js`（新建） | 服务层事件发射的集成测试 |
| `test/snapshot-restore.test.js`（新建） | 快照与恢复的往返测试 |
| `CHANGELOG.md`、`package.json`、`package-lock.json`（修改） | 版本与说明 |

**为什么单独一个模块**：`room-store.js` 已经 2800+ 行。日志是横切关注点，但它的规则（信封形状、哈希、追加）是纯粹的，放在独立文件里可以单独测试，也让 `room-store.js` 只增加「调用点」。

---

### Task 1: 事件信封与哈希链（纯函数）

**Files:**
- Create: `lib/event-log.js`
- Test: `test/event-log.test.js`

**Interfaces:**
- Consumes: 无
- Produces:
  - `EVENT_LOG_VERSION: 1`
  - `createEvent({type, actor, payload, causes, provenance, tick, at}): Event`
  - `Event = {v, id, at, tick, type, actor, payload, causes, provenance, prev, hash}`
  - `serializeEvent(event): string`（无换行的单行 JSON）
  - `hashEvent(event): string`（对除 `hash` 外的字段做规范化哈希）
  - `verifyChain(events): {ok: boolean, brokenAt: number|null}`

- [ ] **Step 1: 写失败的测试**

```js
// test/event-log.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { createEvent, serializeEvent, verifyChain, EVENT_LOG_VERSION } from "../lib/event-log.js";

test("an event carries version, provenance and a hash over its own content", () => {
  const event = createEvent({
    type: "message.created", tick: 7, at: 1_700_000_000_000,
    actor: { kind: "session", id: "s1" },
    payload: { messageId: "m1", text: "你好" },
    causes: ["m0"],
    provenance: { originClass: "agent", sessionKind: "interactive", roomId: "r1" }
  });
  assert.equal(event.v, EVENT_LOG_VERSION);
  assert.equal(event.tick, 7);
  assert.equal(typeof event.id, "string");
  assert.equal(event.prev, null);
  assert.equal(typeof event.hash, "string");
  assert.equal(event.hash.length, 64);
});

test("serialization is one line and round-trips", () => {
  const event = createEvent({ type: "t", actor: { kind: "human", id: "human:me" },
    payload: { text: "多行\n内容" }, provenance: { roomId: "r1" } });
  const line = serializeEvent(event);
  assert.ok(!line.includes("\n"));
  assert.deepEqual(JSON.parse(line).payload, { text: "多行\n内容" });
});

test("a tampered event breaks the chain at its index", () => {
  const a = createEvent({ type: "a", actor: { kind: "human", id: "human:me" }, payload: {}, provenance: { roomId: "r" } });
  const b = createEvent({ type: "b", actor: { kind: "human", id: "human:me" }, payload: {}, provenance: { roomId: "r" }, prev: a.hash });
  const c = createEvent({ type: "c", actor: { kind: "human", id: "human:me" }, payload: {}, provenance: { roomId: "r" }, prev: b.hash });
  assert.deepEqual(verifyChain([a, b, c]), { ok: true, brokenAt: null });
  const tampered = { ...b, payload: { sneaky: true } };
  assert.deepEqual(verifyChain([a, tampered, c]), { ok: false, brokenAt: 1 });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/event-log.test.js`
Expected: FAIL — `Cannot find module '../lib/event-log.js'`

- [ ] **Step 3: 写最小实现**

```js
// lib/event-log.js
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

/**
 * Event log version. Bump this whenever the envelope shape changes: readers
 * must refuse a log they cannot interpret rather than guess at missing fields.
 */
export const EVENT_LOG_VERSION = 1;

const HASHED_FIELDS = ["v", "id", "at", "tick", "type", "actor", "payload", "causes", "provenance", "prev"];

/**
 * Canonical JSON: keys sorted at every depth, so a hash never depends on the
 * order a caller happened to build an object in.
 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function hashEvent(event) {
  const material = Object.fromEntries(HASHED_FIELDS.map((field) => [field, event[field] ?? null]));
  return createHash("sha256").update(canonical(material)).digest("hex");
}

/**
 * Build one immutable event. `prev` chains to the previous event's hash so a
 * rewritten history is detectable; `provenance` is never model-authored.
 */
export function createEvent({ type, actor, payload, causes = [], provenance, tick = 0, at = Date.now(), prev = null }) {
  const event = {
    v: EVENT_LOG_VERSION,
    id: randomUUID(),
    at,
    tick,
    type: String(type),
    actor: actor ?? { kind: "system", id: "system" },
    payload: payload ?? {},
    causes: [...causes],
    provenance: provenance ?? {},
    prev
  };
  event.hash = hashEvent(event);
  return event;
}

/** One event per line; embedded newlines are impossible because JSON escapes them. */
export function serializeEvent(event) {
  const line = JSON.stringify(event);
  if (line.includes("\n")) throw new Error("event log line must not contain a raw newline");
  return line;
}

/** Walk a chain and report the first index whose link does not verify. */
export function verifyChain(events) {
  let previous = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.prev !== previous) return { ok: false, brokenAt: index };
    if (hashEvent(event) !== event.hash) return { ok: false, brokenAt: index };
    previous = event.hash;
  }
  return { ok: true, brokenAt: null };
}

/** Per-room log path: `<state dir>/events/<roomId>.jsonl`. */
export function eventLogPath(statePath, roomId) {
  return join(dirname(statePath), "events", `${roomId}.jsonl`);
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/event-log.test.js`
Expected: PASS（3 项）

- [ ] **Step 5: 提交**

```bash
git add lib/event-log.js test/event-log.test.js
git commit -m "feat: event envelope and hash chain for the immutable audit log"
```

---

### Task 2: 追加写入器（原子追加 + 损坏检测）

**Files:**
- Modify: `lib/event-log.js`
- Test: `test/event-log.test.js`（追加）

**Interfaces:**
- Consumes: Task 1 的 `createEvent` / `serializeEvent` / `verifyChain` / `eventLogPath`
- Produces:
  - `class EventLog { constructor(statePath); append(roomId, eventInput): Promise<Event>; read(roomId): Promise<Event[]>; health(): {appended: number, failed: number, lastError: string|null} }`
  - `append` 串行化（内部 promise 链），保证同一时刻只有一次写入

- [ ] **Step 1: 写失败的测试**

```js
// test/event-log.test.js（追加）
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog } from "../lib/event-log.js";

test("append chains events and read returns them in order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-events-"));
  const log = new EventLog(join(directory, "rooms.json"));
  await log.append("r1", { type: "a", actor: { kind: "human", id: "human:me" }, payload: {} });
  await log.append("r1", { type: "b", actor: { kind: "human", id: "human:me" }, payload: {} });
  const events = await log.read("r1");
  assert.deepEqual(events.map((event) => event.type), ["a", "b"]);
  assert.equal(events[1].prev, events[0].hash);
  assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
});

test("concurrent appends stay serialized and never interleave", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-events-"));
  const log = new EventLog(join(directory, "rooms.json"));
  await Promise.all(Array.from({ length: 20 }, (_v, index) =>
    log.append("r1", { type: `t${index}`, actor: { kind: "system", id: "system" }, payload: { index } })));
  const events = await log.read("r1");
  assert.equal(events.length, 20);
  assert.deepEqual(verifyChain(events), { ok: true, brokenAt: null });
  assert.deepEqual(events.map((event) => event.payload.index).sort((a, b) => a - b), [...Array(20).keys()]);
});

test("a truncated or corrupt line is reported, not silently skipped", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-events-"));
  const log = new EventLog(join(directory, "rooms.json"));
  await log.append("r1", { type: "a", actor: { kind: "system", id: "system" }, payload: {} });
  const path = join(directory, "events", "r1.jsonl");
  await writeFile(path, (await readFile(path, "utf8")) + "{\"half\":");
  await assert.rejects(() => log.read("r1"), /event log is corrupt at line 2/);
});

test("an append failure degrades without throwing and is counted", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-events-"));
  const log = new EventLog(join(directory, "rooms.json"));
  // Make the events directory un-creatable by occupying the path with a file.
  await writeFile(join(directory, "events"), "not a directory");
  await assert.doesNotReject(() => log.append("r1", { type: "a", actor: { kind: "system", id: "system" }, payload: {} }));
  assert.equal(log.health().appended, 0);
  assert.ok(log.health().failed >= 1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/event-log.test.js`
Expected: FAIL — `EventLog is not a constructor`

- [ ] **Step 3: 写最小实现**

```js
// lib/event-log.js（追加）
import { appendFile, mkdir, readFile } from "node:fs/promises";

/**
 * Append-only per-room event log. Writes are chained through a promise so two
 * concurrent callers can never interleave a partial line, and a write failure
 * degrades the audit trail without failing the room operation it observed —
 * but it is counted, because a silently missing audit trail is worse than a
 * visible one.
 */
export class EventLog {
  #statePath;
  #tails = new Map();
  #lastHash = new Map();
  #appended = 0;
  #failed = 0;
  #lastError = null;

  constructor(statePath) {
    this.#statePath = statePath;
  }

  health() {
    return { appended: this.#appended, failed: this.#failed, lastError: this.#lastError };
  }

  async #lastHashFor(roomId) {
    if (!this.#lastHash.has(roomId)) {
      const existing = await this.read(roomId).catch(() => []);
      this.#lastHash.set(roomId, existing.at(-1)?.hash ?? null);
    }
    return this.#lastHash.get(roomId);
  }

  /** Serialize appends per room; returns the written event. */
  append(roomId, input) {
    const previous = this.#tails.get(roomId) ?? Promise.resolve();
    const next = previous.then(async () => {
      try {
        const prev = await this.#lastHashFor(roomId);
        const event = createEvent({ ...input, prev });
        const path = eventLogPath(this.#statePath, roomId);
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await appendFile(path, `${serializeEvent(event)}\n`, { encoding: "utf8", mode: 0o600 });
        this.#lastHash.set(roomId, event.hash);
        this.#appended += 1;
        return event;
      } catch (error) {
        this.#failed += 1;
        this.#lastError = String(error?.message ?? error);
        return null;
      }
    });
    this.#tails.set(roomId, next.catch(() => {}));
    return next;
  }

  /** Read and verify the whole log; a corrupt line is an error, never skipped. */
  async read(roomId) {
    const text = await readFile(eventLogPath(this.#statePath, roomId), "utf8").catch((error) => {
      if (error?.code === "ENOENT") return "";
      throw error;
    });
    const events = [];
    for (const [index, line] of text.split("\n").entries()) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); }
      catch { throw new Error(`event log is corrupt at line ${index + 1}`); }
    }
    return events;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/event-log.test.js`
Expected: PASS（7 项）

- [ ] **Step 5: 提交**

```bash
git add lib/event-log.js test/event-log.test.js
git commit -m "feat: serialized append-only writer with corruption detection"
```

---

### Task 3: 消息与投递事件发射

**Files:**
- Modify: `lib/room-store.js`（`constructor`、`send`、`#commitSend`、`#setDelivery`）
- Test: `test/event-emission.test.js`

**Interfaces:**
- Consumes: `EventLog`（Task 2）
- Produces:
  - `DshChatLocalService` 新方法 `eventsFor(roomId): Promise<Event[]>`
  - 事件类型：`message.created`、`delivery.sent`、`delivery.settled`
  - 每条事件 `provenance = {roomId, originClass, sessionKind, messageId?, actorId}`
  - `originClass ∈ {"owner","agent","untrusted","system"}` 由 `authorKind` 映射：`human→owner`、`session→agent`、`system→system`

- [ ] **Step 1: 写失败的测试**

```js
// test/event-emission.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DshChatLocalService } from "../lib/room-store.js";

async function harness() {
  const directory = await mkdtemp(join(tmpdir(), "dcl-emit-"));
  const ctx = {
    agents: { get: () => ({ cancel() {} }) },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async () => {} },
    get(name) { return this[name]; }
  };
  const service = new DshChatLocalService(ctx, { path: join(directory, "rooms.json"), maxRounds: 1, replyTimeoutMs: 800 });
  await service.ready;
  const room = await service.createRoom({ name: "事件测试", autoDeliver: false,
    members: [{ kind: "session", sessionId: "s1", alias: "成员" }] });
  return { directory, service, room };
}

test("sending a message appends an immutable message.created event with provenance", async () => {
  const h = await harness();
  const message = await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "第一条" });
  const events = await h.service.eventsFor(h.room.id);
  const created = events.filter((event) => event.type === "message.created");
  assert.equal(created.length, 1);
  assert.equal(created[0].payload.messageId, message.id);
  assert.equal(created[0].payload.text, "第一条");
  assert.equal(created[0].provenance.originClass, "owner");
  assert.equal(created[0].provenance.roomId, h.room.id);
});

test("events are append-only: a replay of the same operation adds no second event", async () => {
  const h = await harness();
  const message = await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human",
    text: "重试", clientOperationId: "op-1" });
  await h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human",
    text: "重试", clientOperationId: "op-1" });
  const events = await h.service.eventsFor(h.room.id);
  assert.equal(events.filter((event) => event.type === "message.created").length, 1);
  assert.equal(events[0].payload.messageId, message.id);
});

test("a log write failure does not fail the send itself, and is counted", async () => {
  const h = await harness();
  // Occupy the events directory path with a regular file, so every append fails.
  await writeFile(join(h.directory, "events"), "not a directory");
  await assert.doesNotReject(() => h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "仍然成功" }));
  assert.ok(h.service.logHealth().failed >= 1, "the side channel must count the failure it degraded over");
  // The room operation itself is intact: a second send still succeeds.
  await assert.doesNotReject(() => h.service.send({ roomId: h.room.id, author: "human:me", authorKind: "human", text: "第二条" }));
});
```

> 需要在测试文件顶部把 `writeFile` 加入 `node:fs/promises` 的 import（`mkdtemp` 已在）。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/event-emission.test.js`
Expected: FAIL — `service.eventsFor is not a function`

- [ ] **Step 3: 写最小实现**

在 `lib/room-store.js` 顶部加 import：

```js
import { EventLog } from "./event-log.js";
```

在 `constructor` 里（`this.path` 赋值之后）加：

```js
    // Audit log is a side channel: it observes writes, it never gates them.
    this.eventLog = new EventLog(this.path);
```

新增两个公开方法（放在 `close()` 附近）：

```js
  /** Read a room's immutable event log, oldest first. */
  async eventsFor(roomId) {
    await this.ready;
    return this.eventLog.read(this.#room(roomId).id);
  }

  /** Side-channel health, surfaced through /health. */
  logHealth() {
    return this.eventLog.health();
  }

  /** Map an author kind onto the closed origin-class vocabulary. */
  #originClass(kind) {
    return kind === "human" ? "owner" : kind === "system" ? "system" : "agent";
  }

  /** Fire-and-forget audit append; failures are counted, never thrown. */
  #record(room, event) {
    return this.eventLog.append(room.id, {
      ...event,
      tick: room.tick ?? 0,
      provenance: { roomId: room.id, ...(event.provenance ?? {}) }
    });
  }
```

在 `#commitSend(messageId)` 中，`await this.#save();` 之后紧接：

```js
        await this.#record(room, { type: "message.created",
          actor: { kind: message.authorKind, id: message.author },
          payload: { messageId: message.id, roomSeq: message.roomSeq, text: message.text,
            authorKind: message.authorKind, mentions: [...(message.mentions ?? [])],
            clientOperationId: message.clientOperationId ?? null,
            correctsMessageId: message.correctsMessageId ?? null },
          causes: message.causedByMessageId ? [message.causedByMessageId] : [],
          provenance: { originClass: this.#originClass(message.authorKind),
            sessionKind: message.clientOperationId ? "interactive" : "interactive" } });
```

先把 `#setDelivery(delivery, status, extra)` 的签名改为携带房间。**不要**在函数内部用 `this.state.rooms.find()` 猜房间 —— 并发下会取到错误的房间。

**注意参数名**：**所有调用点传的是 `capture`，不是 `delivery`**（早先写的那段片段把第二个形参当成 delivery 来解引用，照抄会在第一次状态转换时抛 `TypeError`）。delivery 从 `capture.delivery` 取：

```js
  #setDelivery(room, capture, status, extra = {}) {
    const delivery = capture.delivery;
    const previous = delivery.status;
    Object.assign(delivery, { status, ...extra });
    return this.#record(room, status === "sent"
      ? { type: "delivery.sent", actor: { kind: "session", id: delivery.member },
          payload: { member: delivery.member, status },
          provenance: { originClass: "agent", sessionKind: "interactive" } }
      : { type: "delivery.settled", actor: { kind: "session", id: delivery.member },
          payload: { member: delivery.member, status, previous, error: extra.error ?? null },
          provenance: { originClass: "agent", sessionKind: "interactive" } });
  }
```

然后同步更新**全部**既有调用点，把 `room` 作为第一个实参传入。**先用搜索确定实际数量，不要相信文档里的数字**：早先写的「4 处」其实是四个**状态名**，不是站点数 —— 真实文件里有 **12 处**（`failed` 5 处、`superseded` 2 处，其余各 1）。缩窄到四个状态会让审计日志丢掉 `working`/`replied`/`passed` 等转换，那是**不完整**的日志，因此全部保留、不得缩窄：

```js
      this.#setDelivery(room, capture, "superseded", { completedAt: Date.now(), error: "superseded by a newer room message" });
      this.#setDelivery(room, capture, "failed", { completedAt: Date.now(), error: "Agent reply timed out" });
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/event-emission.test.js`
Expected: PASS（3 项）

- [ ] **Step 5: 全量回归并提交**

Run: `npm run check`
Expected: 全部通过（新增测试计入，不得有既有测试破坏）

```bash
git add lib/room-store.js test/event-emission.test.js
git commit -m "feat: emit immutable message and delivery events from the write paths"
```

---

### Task 4: 逻辑 tick 与调度顺序记录

**Files:**
- Modify: `lib/room-store.js`（`#normalizeRoom`、`#runTurn`、`#recipients`）
- Test: `test/event-emission.test.js`（追加）

**Interfaces:**
- Consumes: Task 3 的 `#record`
- Produces:
  - `room.tick: number`（单调、持久化、随 `STATE_VERSION` 15 引入，迁移时对旧房间初始化为 `0`）
  - 事件 `turn.scheduled`，`payload = {rootMessageId, epoch, recipients: string[], order: "configured", rotationStart: number, executed: string[]}`（`recipients` 是配置序输入；`rotationStart` 与本回合实际执行的 `executed` 顺序用于让该事件**单独**即可证明「第几步是谁」——这是本事件存在的理由。计算 `executed` 的纯运算必须提到 `#record` 之前，且不得改变调度行为）

**为什么**：顺序目前按 `room.members` 配置序（这是我们已经做对的唯一可复现性要素），但它**没有被记录下来**。事后要证明「第 3 步是 B 而不是 C」，必须有这一条。

- [ ] **Step 1: 写失败的测试**

```js
test("a scheduled turn records its tick and the exact recipient order", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-tick-"));
  const calls = [];
  const ctx = {
    agents: { get: () => ({ cancel() {} }) },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async (from, to) => { calls.push(to); } },
    get(name) { return this[name]; }
  };
  const service = new DshChatLocalService(ctx, { path: join(directory, "rooms.json"), maxRounds: 1, replyTimeoutMs: 800 });
  await service.ready;
  const room = await service.createRoom({ name: "顺序", autoDeliver: true, members: [
    { kind: "session", sessionId: "s1", alias: "甲" },
    { kind: "session", sessionId: "s2", alias: "乙" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "开始" });
  const deadline = Date.now() + 2000;
  while (calls.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  const scheduled = (await service.eventsFor(room.id)).filter((event) => event.type === "turn.scheduled");
  assert.equal(scheduled.length, 1);
  assert.deepEqual(scheduled[0].payload.recipients, ["s1", "s2"]);
  assert.equal(scheduled[0].payload.order, "configured");
  assert.ok(scheduled[0].tick >= 1);
});

test("the tick is persisted and keeps increasing across a restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-tick-"));
  const deliveries = [];
  const ctx = { agents: { get: () => undefined },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async () => { deliveries.push(1); } },
    get(n) { return this[n]; } };
  const path = join(directory, "rooms.json");
  const first = new DshChatLocalService(ctx, { path, maxRounds: 1, replyTimeoutMs: 800 });
  await first.ready;
  // autoDeliver must be true: the tick advances per *scheduled turn*, so a room
  // that never schedules one has no ticks to compare.
  const room = await first.createRoom({ name: "t", autoDeliver: true, members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await first.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  const firstDeadline = Date.now() + 2000;
  while (!deliveries.length && Date.now() < firstDeadline) await new Promise((resolve) => setTimeout(resolve, 5));
  const ticks = async (service) => (await service.eventsFor(room.id))
    .filter((event) => event.type === "turn.scheduled").map((event) => event.tick);
  assert.deepEqual(await ticks(first), [1]);
  await first.close();
  const second = new DshChatLocalService(ctx, { path, maxRounds: 1, replyTimeoutMs: 800 });
  await second.ready;
  await second.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "二" });
  const secondDeadline = Date.now() + 2000;
  while (deliveries.length < 2 && Date.now() < secondDeadline) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(await ticks(second), [1, 2]);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/event-emission.test.js`
Expected: FAIL — 没有 `turn.scheduled` 事件

- [ ] **Step 3: 写最小实现**

`STATE_VERSION` 从 `14` 改为 `15`。

`#normalizeRoom` 的返回对象里加（与 `roomSeq` 同一处）：

```js
    tick: Math.max(0, Number(input.tick) || 0),
```

在 `#runTurn` 的最开头（拿到 `room` 之后）：

```js
    // Record the schedule *before* anything can fail: the ordering is an
    // experimental input, so it must survive a crashed run.
    room.tick = (room.tick ?? 0) + 1;
    await this.#save();
    await this.#record(room, { type: "turn.scheduled",
      actor: { kind: "system", id: "system" },
      payload: { rootMessageId, epoch, recipients: [...recipientIds], order: "configured" },
      provenance: { originClass: "system", sessionKind: "interactive" } });
```

`recipientIds` 就是 `#recipients(room, message)` 已经算好的输出，**直接记录它**：不要重新计算，也**不得**为了记录而改变调度行为。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/event-emission.test.js`
Expected: PASS（5 项）

- [ ] **Step 5: 全量回归并提交**

Run: `npm run check`
Expected: PASS（注意：`STATE_VERSION` 变化会触发 `test/version-upgrade.test.js` 的迁移路径，必须同步更新该测试里写死的版本号）

```bash
git add lib/room-store.js test/event-emission.test.js test/version-upgrade.test.js
git commit -m "feat: persist a logical tick and record scheduled turn ordering"
```

---

### Task 5: 回合提示词的注入块日志

**Files:**
- Modify: `lib/room-store.js`（`#runTurn` 调用 `deliverExternal` 之前）
- Test: `test/event-emission.test.js`（追加）

**Interfaces:**
- Consumes: Task 3 的 `#record`
- Produces: 事件 `turn.prompt`，`payload = {deliveryId, memberSessionId, promptHash, promptChars, prompt}`

**为什么**：这段文本就是实验的**自变量**。今天它从不落盘，历史无法重建。

- [ ] **Step 1: 写失败的测试**

```js
test("the exact prompt handed to a member is recorded by hash and by content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-prompt-"));
  const prompts = [];
  const ctx = {
    agents: { get: () => ({ cancel() {} }) },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async (_from, to, text) => { prompts.push({ to, text }); } },
    get(name) { return this[name]; }
  };
  const service = new DshChatLocalService(ctx, { path: join(directory, "rooms.json"), maxRounds: 1, replyTimeoutMs: 800 });
  await service.ready;
  const room = await service.createRoom({ name: "提示词", autoDeliver: true,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "议题" });
  const deadline = Date.now() + 2000;
  while (!prompts.length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  const recorded = (await service.eventsFor(room.id)).filter((event) => event.type === "turn.prompt");
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].payload.memberSessionId, "s1");
  assert.equal(recorded[0].payload.prompt, prompts[0].text);
  assert.equal(recorded[0].payload.promptChars, prompts[0].text.length);
  assert.match(recorded[0].payload.promptHash, /^[0-9a-f]{64}$/);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/event-emission.test.js`
Expected: FAIL — 没有 `turn.prompt` 事件

- [ ] **Step 3: 写最小实现**

在 `#runTurn` 里 `bridge.deliverExternal(...)` 之前，先把 prompt 取到局部变量：

```js
      const promptText = this.#participantPrompt(room, member, task);
      // The injected text is this experiment's independent variable: record it
      // verbatim so a later run can be compared against what was actually seen.
      await this.#record(room, { type: "turn.prompt",
        actor: { kind: "session", id: member.sessionId },
        payload: { deliveryId: capture.id, memberSessionId: member.sessionId,
          promptHash: createHash("sha256").update(promptText).digest("hex"),
          promptChars: promptText.length, prompt: promptText },
        provenance: { originClass: "system", sessionKind: "interactive" } });
      await bridge.deliverExternal(
        `room:${room.id}`,
        member.sessionId,
        promptText,
        { id: capture.id, transport: ROOM_TRANSPORT }
      );
```

（`createHash` 已在 `lib/room-store.js` 顶部 import。）

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/event-emission.test.js`
Expected: PASS（6 项）

- [ ] **Step 5: 全量回归并提交**

Run: `npm run check`
Expected: PASS

```bash
git add lib/room-store.js test/event-emission.test.js
git commit -m "feat: record the exact per-turn prompt as the experiment's independent variable"
```

---

### Task 6: 快照与恢复（导出 → 可校验导入）

**Files:**
- Modify: `lib/room-export.js`（新增 `exportRunSnapshot` / `restoreFromSnapshot`）
- Modify: `lib/index.js`（`GET /rooms/:id/snapshot`、`POST /rooms/:id/restore-from-snapshot` —— **不是** `/restore`，那条路径属于既有的「恢复软删除房间」路由，字面使用会破坏它，已在真实处理器上验证；裁定 R26）
- Test: `test/snapshot-restore.test.js`

**Interfaces:**
- Consumes: `EventLog.read`（Task 2）、`exportRoomSnapshot`（既有）
- Produces:
  - `exportRunSnapshot({room, version, events, configHash, exportedAt}): {filename, mimeType, content}`
  - `validateSnapshot(parsed): {ok: boolean, reason?: string, snapshot?}`
  - `DshChatLocalService.snapshotRun(roomId, configHash): Promise<{filename, content}>`
  - `DshChatLocalService.restoreFromSnapshot(snapshot, {confirm}): Promise<{roomId, eventsWritten: number}>`（`confirm !== true` 时抛错）

**为什么**：研究需要「从第 k 步重启并改一个变量」；今天导出是单向的，无法回滚。

### Task 6 必须一并实现的头部锚点（裁定 R10 + R12）

`verifyChain` 没有头部锚点，因此把某个房间 JSONL 的**尾部截断**——最坏截到零行，此时 `verifyChain([])` 返回 `{ok:true}`——目前不可检测。**Task 2 曾把这个决策上交，裁定为归 Task 6**（Task 6 拥有唯一合法的截断者 `replace()`）**；Task 2 的审查另补充了一条必须遵守的约束（R12）。**

实现要求：

- **`EventLog.append`**：写完该行之后，把最新 hash 原子地写入 `eventLogPath(statePath, roomId) + ".head"`（单行 hex 文本）。
- **`EventLog.replace(roomId, events)`**：必须在**同一个 temp+rename** 里一并写出锚点，并且**重置该房间的 `#lastHash` 缓存**。原因：`#lastHash` 只播种一次、永不失效，若不重置，恢复后的下一次 `append` 会从**恢复前**的 head 继续，把哈希链分叉。
- **`EventLog.read(roomId)`** 把锚点当**高水位线**：仅当锚点文件存在、且它**不出现在任何已解析事件的 `hash` 中**时才报截断，错误信息要同时给出期望 head 与读到的 head。这样能捕获「截到零行」与「截掉 ≥2 行」，且**不会**对完好日志误报。
- **已知残余（必须在报告中写明，不得静默略过）**：若进程在「写行」与「写锚」之间崩溃，锚点会落后一行；此后若恰好再截掉最后一行，锚点仍在已解析集合中，**这一行的截断不可见**。这是**已接受的残余**。
- **新增测试**（写进 `test/event-log.test.js`）：①截到零行 → 报截断；②截掉 ≥2 行 → 报截断；③完好日志 → 不报且 `read` 不抛错；④`replace()` 之后紧接一次 `append`，链仍然连续（这正是不重置 `#lastHash` 会失败的用例）。

- [ ] **Step 1: 写失败的测试**

```js
// test/snapshot-restore.test.js
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSnapshot } from "../lib/room-export.js";
import { DshChatLocalService } from "../lib/room-store.js";

async function serviceAt(directory) {
  const ctx = { agents: { get: () => undefined },
    dshBridge: { status: async () => ({ state: "idle" }), deliverExternal: async () => {} }, get(n) { return this[n]; } };
  const service = new DshChatLocalService(ctx, { path: join(directory, "rooms.json"), maxRounds: 1, replyTimeoutMs: 800 });
  await service.ready;
  return service;
}

test("a snapshot round-trips a room with its event log", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-"));
  const service = await serviceAt(directory);
  const room = await service.createRoom({ name: "快照", autoDeliver: false,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  const snapshot = await service.snapshotRun(room.id, "cfg-abc");
  const parsed = JSON.parse(snapshot.content);
  assert.deepEqual(validateSnapshot(parsed).ok, true);
  assert.equal(parsed.configHash, "cfg-abc");
  assert.ok(parsed.events.length >= 2);
  assert.equal(parsed.room.messages.length, 1);
});

test("a tampered snapshot is rejected with a reason", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-"));
  const service = await serviceAt(directory);
  const room = await service.createRoom({ name: "快照", autoDeliver: false,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  const parsed = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  parsed.room.messages[0].text = "被篡改";
  const result = validateSnapshot(parsed);
  assert.equal(result.ok, false);
  assert.match(result.reason, /hash/);
});

test("restoring requires an explicit confirmation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dcl-snap-"));
  const service = await serviceAt(directory);
  const room = await service.createRoom({ name: "快照", autoDeliver: false,
    members: [{ kind: "session", sessionId: "s1", alias: "甲" }] });
  await service.send({ roomId: room.id, author: "human:me", authorKind: "human", text: "一" });
  const parsed = JSON.parse((await service.snapshotRun(room.id, "cfg")).content);
  await assert.rejects(() => service.restoreFromSnapshot(parsed, {}), /confirm/);
  const result = await service.restoreFromSnapshot(parsed, { confirm: true });
  assert.equal(result.roomId, room.id);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/snapshot-restore.test.js`
Expected: FAIL — `validateSnapshot is not a function`

- [ ] **Step 3: 写最小实现**

`lib/room-export.js` 追加：

```js
/**
 * A run snapshot is the whole experimental unit: the read model, the immutable
 * event log, and the configuration hash that produced them. Restoring one is
 * how a counterfactual run is set up, so the hash must cover both halves.
 */
export function exportRunSnapshot({ room, version, events, configHash, exportedAt = new Date().toISOString() }) {
  const body = { format: "dsh-chat-local-run-snapshot", stateVersion: version, exportedAt, configHash, room, events };
  const contentHash = createHash("sha256").update(JSON.stringify({ room, events, configHash })).digest("hex");
  return {
    filename: `${(room.name || "room").replace(/[<>:"/\\|?*\x00-\x1f]/gu, "_").slice(0, 80)}_${exportedAt.slice(0, 10)}.snapshot.json`,
    mimeType: "application/json",
    content: JSON.stringify({ ...body, contentHash }, null, 2)
  };
}

/** Verify a snapshot before it is allowed to overwrite anything. */
export function validateSnapshot(parsed) {
  if (!parsed || parsed.format !== "dsh-chat-local-run-snapshot") return { ok: false, reason: "not a run snapshot" };
  if (!parsed.room || !Array.isArray(parsed.room.messages)) return { ok: false, reason: "snapshot has no room" };
  if (!Array.isArray(parsed.events)) return { ok: false, reason: "snapshot has no event log" };
  const expected = createHash("sha256")
    .update(JSON.stringify({ room: parsed.room, events: parsed.events, configHash: parsed.configHash }))
    .digest("hex");
  if (expected !== parsed.contentHash) return { ok: false, reason: "content hash mismatch; the snapshot was modified" };
  return { ok: true, snapshot: parsed };
}
```

`lib/event-log.js` 追加原子替换（**仅恢复路径使用**，正常写入永不调用）：

```js
  /** Atomically replace one room's log (restore path). Normal writes never call this. */
  async replace(roomId, events) {
    const path = eventLogPath(this.#statePath, roomId);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, events.map((event) => `${serializeEvent(event)}\n`).join(""), { encoding: "utf8", mode: 0o600 });
    await rename(temporary, path);
    this.#lastHash.set(roomId, events.at(-1)?.hash ?? null);
  }
```

（`lib/event-log.js` 的 import 补 `randomUUID`、`rename`、`writeFile`。）

`lib/room-store.js` 的 import 改为：

```js
import { exportRoomSnapshot, exportRunSnapshot, validateSnapshot } from "./room-export.js";
```

追加两个方法：

```js
  /** Snapshot one room together with its immutable log and the run's config hash. */
  async snapshotRun(roomId, configHash) {
    await this.ready;
    const room = this.#room(roomId);
    const events = await this.eventLog.read(room.id);
    return exportRunSnapshot({ room: copy(room), version: STATE_VERSION, events, configHash });
  }

  /**
   * Restore a run snapshot. This is the counterfactual primitive: it replaces
   * the room and its log with the snapshot's, after keeping what is here now.
   */
  async restoreFromSnapshot(snapshot, { confirm } = {}) {
    await this.ready;
    if (confirm !== true) throw new Error("restoring a snapshot requires confirm: true");
    const checked = validateSnapshot(snapshot);
    if (!checked.ok) throw new Error(`invalid snapshot: ${checked.reason}`);
    const index = this.state.rooms.findIndex((room) => room.id === checked.snapshot.room.id);
    if (index < 0) throw new Error("snapshot room does not exist in this state file");
    await copyFile(this.path, `${this.path}.pre-restore.bak`).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
    this.state.rooms[index] = this.#normalizeRoom(checked.snapshot.room, []);
    await this.#save();
    await this.eventLog.replace(checked.snapshot.room.id, checked.snapshot.events);
    return { roomId: checked.snapshot.room.id, eventsWritten: checked.snapshot.events.length };
  }
```

`lib/index.js` 加两条路由（放在既有 `rooms` 路由附近，注意 `parts.length` 匹配顺序）：

```js
          if (req.method === "GET" && parts.length === 3 && parts[0] === "rooms" && parts[2] === "snapshot") {
            const room = await service.resolveRoom(parts[1]);
            return sendOk(res, await service.snapshotRun(room.id, url.searchParams.get("configHash") ?? ""));
          }
          if (req.method === "POST" && parts.length === 3 && parts[0] === "rooms" && parts[2] === "restore") {
            const body = await readJson(req);
            return sendOk(res, await service.restoreFromSnapshot(body.snapshot, { confirm: body.confirm === true }));
          }
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test test/snapshot-restore.test.js`
Expected: PASS（3 项）

- [ ] **Step 5: 全量回归并提交**

Run: `npm run check`
Expected: PASS

```bash
git add lib/room-export.js lib/room-store.js lib/index.js test/snapshot-restore.test.js
git commit -m "feat: run snapshots with validated restore for counterfactual runs"
```

---

### Task 7: `/health` 暴露日志健康、版本与文档收尾

**Files:**
- Modify: `lib/index.js`（`/health`）
- Modify: `lib/room-store.js`（`configHash` 的单一来源）
- Modify: `package.json`、`package-lock.json`、`CHANGELOG.md`、`README.md`
- Test: `test/version-consistency.test.js`（该文件已有 `boot` 辅助，直接追加断言；**不要**新建文件，也不要重写那个辅助）

**Interfaces:**
- Consumes: `logHealth()`（Task 3）
- Produces: `/health` 响应新增 `audit: {appended, failed, lastError}` 与 `stateVersion: 15`

- [ ] **Step 1: 写失败的测试**

```js
test("health reports the audit side channel and the state version", async (t) => {
  // `boot` already exists in this file and boots the real plugin against a
  // temporary state file; reuse it instead of writing a second one.
  const request = await boot(t);
  const health = await request("/health");
  assert.equal(health.status, "ok");
  assert.equal(health.stateVersion, 15);
  assert.equal(typeof health.audit.appended, "number");
  assert.equal(typeof health.audit.failed, "number");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/reliability-regressions.test.js`
Expected: FAIL — `health.audit` 为 undefined

- [ ] **Step 3: 写最小实现**

`lib/index.js` 的 `/health` 分支：

```js
            return sendOk(res, { name: "dsh-chat-local", version: packageVersion(), status: "ok",
              stateVersion: service.stateVersion(), audit: service.logHealth() });
```

`lib/room-store.js` 加：

```js
  /** The state format the running service reads and writes. */
  stateVersion() { return STATE_VERSION; }
```

版本同步（四处，全部必要 —— `test/version-consistency.test.js` 会逐处锁死）：

1. `package.json` 第 3 行：`"version": "0.16.2-local.1"` → `"version": "0.16.3-local.1"`
2. `package-lock.json`：顶层 `"version"`（第 3 行）与 `packages[""].version`（第 9 行）都改为 `0.16.3-local.1`
3. `CHANGELOG.md`：顶部新增 `## [0.16.3-local.1] — 2026-09-17`（内容见下）
4. `README.md`：**不用**改插件版本号（它只声明 DSH 兼容范围），但要做两件事：
   (a) 把「已知边界」里两处陈旧的**状态版本**改对：`README.md:145` 的「当前状态版本 **v14**」→ **v15**，`README.md:148` 的「旧版程序不能读取 v14」→ **v15**。（Task 4 的审查发现：**没有任何测试覆盖 README 的状态版本**，所以漏了就永远错着 —— 这条指令是唯一的保障。）
   (b) 补一条「已知边界」，见下。

Run: `node --test test/version-consistency.test.js`
Expected: PASS。若漏改任一处，会以 `CHANGELOG 首条必须等于当前发布版本` 或 `锁文件必须记录同一版本` 明确报错。

`CHANGELOG.md` 顶部新增 `## [0.16.3-local.1] — 2026-09-17`，写明：新增不可变事件日志（消息/投递/调度/提示词）、逻辑 tick、快照与恢复、`/health` 暴露日志健康；状态版本 14 → 15，迁移前自动写 `rooms.json.v14.bak`。

`README.md` 的「已知边界」补一条：事件日志是附加层，`rooms.json` 仍是当前读模型；日志文件位于状态目录的 `events/` 子目录，可单独备份与离线校验。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run check`
Expected: PASS（≥283 项；无既有测试破坏）

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: expose audit health, bump state to 15, document the event log"
```

---

## 验证收尾（不属于任何任务，执行者最后做）

- [ ] `npm run check` 全绿。
- [ ] **真实数据冒烟**：把线上状态目录复制到临时目录（**不要动真文件**），用新代码加载，确认房间数与之前一致、`events/` 被创建、`/health` 报告 `stateVersion: 15`。
- [ ] **迁移备份**：确认 `rooms.json.v14.bak` 被写出且内容等于迁移前字节。
- [ ] **负向验证**：手工把某房间 JSONL 的一行改一个字符，确认 `verifyChain` 报出 `brokenAt`，且 `read()` 不静默跳过。
- [ ] 确认仓库内**没有**任何真实 home 路径（`node --test test/version-consistency.test.js`）。

## 后续计划（不在本计划内，按依赖顺序）

| 计划 | 内容 | 前置 |
|---|---|---|
| Plan 2 | C 层：从事件确定性派生关系快照 + 回填现有台账 | 本计划（回填部分可先做） |
| Plan 3 | 治理门：行动钩子（低信任对象的高影响动作需额外确认/独立验收）+ `action_gate` 日志 | Plan 2 |
| Plan 4 | A 层：模型 appraisal（带 `evidence_event_ids`、有效期、撤销）+ 注入到回合提示词 | Plan 2 |
| Plan 5 | 实验脚手架：持久化臂/重置臂、run manifest、评测工具、成本核算、多模型臂 | Plan 1–4 |

**关于顺序的一处诚实说明**：Plan 2 的原料（台账历史）今天就在 `rooms.json` 里，因此 Plan 2 **可以**先于本计划开工并立刻产生产品价值。代价是：那时派生的关系历史**无法回溯到事件层**，研究可用性会打折（产品可用性不受影响）。若以研究为目标，建议按本计划的顺序。
