# 关系性长期记忆（Phase 2–5）Implementation Plan

> **For agentic workers:** 每个任务按 TDD 步骤执行：写失败的测试 → 确认失败原因正确 → 最小实现 → 确认通过 → 全量回归 → 提交。

**Goal:** 让群聊从「不可变审计地基」长出「关系记忆」——即：**每个成员对每个对手方的印象**，可确定性重算、可追溯、可撤销、可清零，并能作为实验自变量使用。

**Architecture:** 沿用已定稿的方案（C 骨架 + A 覆盖层 + 治理门）。核心决策：**快照即事件**。关系快照由**确定性纯函数**从既有事件派生，作为 `relationship.snapshot` 事件追加进同一日志；"当前关系"由投影得到。这样天然满足 append-only、带溯源、可重放，且**不需要任何新存储**。

**Tech Stack:** Node ESM、`node:test` + `node:assert/strict`、既有事件日志（`lib/event-log.js`）。不新增依赖。

**Spec:** `docs/superpowers/specs/2026-09-17-relational-long-term-memory-design.md`（§4 是该 schema 的出处）
**Research:** `docs/research/2026-09-17-agent-memory-and-abm-landscape.md`
**Predecessor:** `docs/superpowers/plans/2026-09-17-event-log-foundation.md`（已完成并合并）

## Global Constraints

- 无新依赖；`lib/event-log.js` 不得 import `room-store.js`；任何文件不得出现真实 home 路径（递归守卫测试强制）。
- 事件 payload **仅限 JSON 原生数据**；时间戳用 epoch 毫秒。
- **关系状态必须可确定性重算**：给定同一份事件日志，两次派生必须产出**字节相同**的快照；派生过程**不得**读取墙钟、随机数或模型。
- **不得**因关系状态改变而改变**调度**（回合顺序与成员集合）。这是目前唯一已做对的可复现性要素（见 spec §7 默认真决策 #3）。
- 治理门**默认关闭**：关闭时行为必须与今天**逐字节一致**（有测试证明）。
- 印象**不得**由代码凭空写入：只能来自确定性派生（C）或带证据的模型 appraisal（A）。
- 每个阶段结束时 `npm run check` 全绿；状态版本在 Phase 2 升 `15 → 16`（新增事件类型不改变 `rooms.json` 结构，故**不**升版本；只有确实改了状态格式才升）。

---

## Phase 2 — C 骨架：确定性关系派生

### 2.0 事件与字段的对齐（先确认再动手）

| 关系信号 | 来源事件 | 字段 |
|---|---|---|
| 接手/投递结果 | `delivery.sent` / `delivery.settled` | `payload.member`、`payload.status`、`payload.previous`、`provenance.messageId`、`causes[0]` |
| 消息与作者 | `message.created` | `payload.authorKind`、`payload.messageId`、`provenance.actorId`、`payload.roomSeq` |
| 回合与顺序 | `turn.scheduled` / `turn.prompt` | `payload.executed`、`payload.rotationStart`、`payload.memberSessionId`、`tick` |
| **台账状态变迁** | **缺失 → 本阶段补（Task 2.2）** | 见下 |

**Task 2.2 之前**，验收（review verdict）、认领（acknowledgement）、阻断（blocked）、分歧（dispute）、章程提案被取代等事实**只存在于 `rooms.json` 的 `ledger[].history[]` 与 `profileProposals[]`**，没有结构化事件。因此 Phase 2 的第一个动作是把它们变成事件。

### Task 2.1 纯派生模块

**Files:**
- Create: `lib/relationship.js`
- Test: `test/relationship.test.js`

**Interfaces:**
- `RELATIONSHIP_VERSION = 1`
- `deriveRelationships({ events, roomId, asOfTick }): { pairs: Pair[], derivedFrom: string[] }`
- `Pair = { observer, target, tick, counters: Counters, derivedFrom: string[] }`
- `Counters` 的精确定义（**这是本阶段的规范**）：

| 计数器 | 公式 |
|---|---|
| `deliveriesOffered` | 目标为 `payload.member` 的 `delivery.sent` 事件数 |
| `deliveryFailures` | 目标为 member 且 `payload.status === "failed"` 的 `delivery.settled` 数 |
| `deliverySuccesses` | 目标为 member 且 `payload.status === "delivered"` 的 `delivery.settled` 数 |
| `reviewsApproved` | `ledger.transition` 中 `payload.reviewerSessionId === target` 且 `payload.verdict === "approve"` 的条数 |
| `reviewsChangesRequested` | 同上但 `verdict === "request_changes"` |
| `blockedReports` | `ledger.transition` 中 `payload.ownerSessionId === target` 且 `payload.action === "progress"` 且 `payload.state === "blocked"` 的条数 |
| `blockedConfirmed` | 上述那些中后来被 `payload.action === "progress"` 且 `state === "in_progress"` 解除、或被 `disposition.action` 确认的条数（按 entryId 配对；**不得**用时间差猜） |
| `unresolvedDisagreements` | `ledger.transition` 中 `payload.kind === "dispute"` 的条目里、最终 `status` 不属于 `CLOSED_LEDGER_STATUSES` 的条数 |
| `charterProposalsSuperseded` | `ledger.transition`/`charter.*` 中 `payload.proposerSessionId === target` 且被 `replacesProposalId` 取代的提案数 |
| `messagesAuthored` | `message.created` 中 `provenance.actorId === target` 的条数 |

- `observer` 的取值：房间内**每一个**成员（含 target 自己），因为"我对我自己"也是一条可分析的基线。
- 派生必须**与事件顺序无关**（先按 `(tick, at, id)` 排序再做计数），且**不读墙钟**。
- `derivedFrom` 是该对用到的全部 `event.id`，排序去重。

- [ ] **Step 1:** 写失败测试：给定手工构造的事件数组，断言 counters 的每个字段；再写一条**顺序无关**测试（打乱输入顺序，输出必须相同）；再写一条**确定性**测试（同一输入两次调用，`JSON.stringify` 结果相同）。
- [ ] **Step 2:** 运行确认失败（模块不存在）。
- [ ] **Step 3:** 实现纯函数（无 I/O、无 `Date.now()`、无 `crypto.randomUUID`）。
- [ ] **Step 4:** 运行确认通过。
- [ ] **Step 5:** `npm run check` + 提交 `feat: derive per-pair relationship counters from the event log`。

### Task 2.2 台账状态变迁事件

**Files:**
- Modify: `lib/room-store.js`（`#commitLedger` 及其调用点）
- Test: `test/event-emission.test.js`（追加）

**Interfaces:** 事件 `ledger.transition`，`payload = {entryId, revision, kind, action, status, ownerSessionId, reviewerSessionId, verdict, state, dispositionAction?}`，与既有 `message.created` 一样**经队列在 save 成功后 flush**（R20）。

**本任务必须一并满足的三条（controller 裁定，均因 Task 2.1 的审查发现）**

- **R44（计划缺口）**：`payload` 还必须带 **`proposerSessionId` 与 `replacesProposalId`**（章程提案被取代时）。理由：`charterProposalsSuperseded` 计数器（Task 2.1 已实现）读的正是这两个字段，而原计划的 payload 列表把它们漏了 —— 照原样实现会让该计数器**永远读到静默 0**。除此之外，全库没有任何 `charter.*` 事件，因此这两个字段必须落在 `ledger.transition` 上（或另行发射带这两个字段的 `charter.*` 事件）。
- **R41（成员身份）**：新增 **`member.added` / `member.removed`** 事件（含 `sessionId`、`alias`、`role`、`at`）。理由：日志里目前没有成员增删事实，Task 2.1 只能从 `turn.scheduled`/`delivery.sent` **推断**成员集合，代价是「从未出现在回合或交付里的成员不可见」「只在陈旧交付里被点名的会话得到一行全零」。成员身份是关系层的基础事实，必须来自日志本身。
- **R43（去重）**：把 `CLOSED_LEDGER_STATUSES` 从 `lib/room-store.js` 移到中性的 `lib/work-protocol.js`（`room-store.js` 已在 import 它），两侧都 import 它。理由：Task 2.1 因禁止 import `room-store.js` 而**复制**了一份，注释写着"两者必须同步移动"—— 这类注释会腐烂。

- [ ] **Step 1:** 写失败测试：`operateWork` 的每个动作（record/acknowledge/progress/submit/review/comment/amend）产出恰好一条 `ledger.transition`，字段与状态一致；replay 不产生第二条。
- [ ] **Step 2:** 确认失败（无该事件）。
- [ ] **Step 3:** 在 `#commitLedger` 处统一发射（**一处**，不要在每个动作里复制）。
- [ ] **Step 4:** 确认通过。
- [ ] **Step 5:** 全量 + 提交。

### Task 2.3 快照事件与投影

**Files:**
- Modify: `lib/room-store.js`（`#runTurn` 内、`turn.scheduled` 之后）
- Modify: `lib/relationship.js`（`latestRelationships(events, roomId)` 投影）
- Test: `test/relationship.test.js` + `test/event-emission.test.js`

**Interfaces:** 事件 `relationship.snapshot`，`payload = {pairs: Pair[], version, derivedFromCount}`；`latestRelationships` 返回每个有向对的**最新** counters。

- [ ] **Step 1:** 写失败测试：跑一个回合后，日志里出现一条 `relationship.snapshot`，其 pairs 覆盖全部成员对，且 counters 与直接派生一致。
- [ ] **Step 2:** 确认失败。
- [ ] **Step 3:** 发射（每回合一次；`asOfTick` = 当回合 tick）。
- [ ] **Step 4:** 确认通过；加一条"两次派生字节相同"的确定性测试。
- [ ] **Step 5:** 全量 + 提交。

### Task 2.4 只读暴露

**Files:**
- Modify: `lib/index.js`（`GET /rooms/:id/relationships`，加在既有处理器内、CSRF 守卫之后）
- Modify: `lib/index.js`（工具 `chat_relationships`）
- Test: `test/relationship.test.js`

- [ ] 工具只读、无参数写入可能；输出按 observer 分组，字段与 schema 一致。
- [ ] 全量 + 提交。

### Task 2.5 注入（有界）

**Files:** `lib/room-store.js`（`#participantPrompt`）
- 追加一段「你与各参与者的关系摘要」：每个对手方**一行**，只放非零计数，**硬上限 600 字符**，超出按"最相关"（未闭环分歧 > 投递失败 > 其余）截断。
- 测试：断言上限从不被突破；多成员时不泄漏他人之间的对（观察者隔离）。

---

## Phase 3 — 治理门（行动钩子）

**保守默认**：仅当 `room.policy.gate` 显式为真时生效。关闭时必须与今天逐字节一致。

### Task 3.1 判定纯函数
`evaluateGate({pair, action, riskClass, policy}): "allow" | "require_confirmation" | "require_independent_review" | "deny"`，规则：`riskClass === "high"` 且 `pair.counters.deliveryFailures > 0` 且 `deliverySuccesses === 0` → `require_confirmation`；`unresolvedDisagreements > 0` 且动作为评审 → `require_independent_review`；其余 `allow`。

### Task 3.2 接入守卫
`guardToolExecution` 在受限回合的判定之后、执行类回合之前调用判定；命中时**拒绝并说明**（与既有拒绝文案同一风格），并记录 `action_gate` 事件（含 `basis` = 该 pair 的 counters 快照 id）。

### Task 3.3 policy 开关
`setRoomPolicy` 增加 `gate`（默认 `false`），并落 `rooms.json`（状态版本 15 → 16，迁移前写 `.v15.bak`）。

### Task 3.4 测试
默认关时：与今天完全一致（同一组用例在开关关/开两种情况下对比）；开时：低信任 + 高影响动作被拒，且事件被记录。

---

## Phase 4 — A 覆盖层（模型 appraisal）

### Task 4.1 `appraisal` 事件
`payload = {observerId, aboutAgentId, stance ∈ {trust,distrust,neutral}, confidence ∈ [0,1], claim, perceivedRole?, evidenceEventIds[], validFrom, validTo?}`。

### Task 4.2 工具 `chat_appraise`
窄接口：写入前校验 ①`evidenceEventIds` 非空且**每个 id 都在本房间日志中存在**（否则拒绝）②`confidence ∈ [0,1]` ③只能对**本房间成员**表态 ④不能给自己表态（或允许但标记）。写入经审计队列。

### Task 4.3 撤销而非删除
`chat_appraise` 的 `revoke` 动作把既有 appraisal 的 `validTo` 设为当前 tick，**不删记录**；投影只取有效区间内的最新值。

### Task 4.4 合并注入
注入段合并 C counters 与 A 的有效 appraisal；A 的记录必须标注 `claim` 与证据条数（让模型知道这是判断而非事实）。

### Task 4.5 测试
含：无证据的 appraisal 被拒；撤销后投影不再包含它而日志仍保留；注入不被模型文本注入（claim 中的伪指令不改变段落结构）。

---

## Phase 5 — 实验脚手架

### Task 5.1 干预 API
`POST /rooms/:id/relationship-intervention`：`{action: "set"|"clear"|"seed", observerId?, targetId?, counters?, appliedBy: "human", mechanism, note}`。**必须记录** `relationship.intervention` 事件（含 `appliedBy`、`mechanism`、之前的 counters）。这是做"重置臂"的唯一手段。

### Task 5.2 run manifest
`run.manifest` 事件：`{configHash, models: {member: {provider, model}}, initialStateVersion, startedAtTick, arm}`。`configHash` 覆盖**影响注入的全部配置**（注入上限、gate 开关、appraisal 是否启用）。

### Task 5.3 两条臂
run 级开关 `arm ∈ {"persistent", "reset_per_episode"}`；`reset_per_episode` 在每个新对话开始时自动发一条 `clear` 干预。

### Task 5.4 评测
`scripts/relationship-eval.mjs`：给定一个状态目录与 run manifest，输出每 run 的因变量（接手人选择分布、验收退回率、动作被拒次数、争议未解决时长）+ 跨 run 均值与方差；**要求 ≥10 次运行**才输出结论。

### Task 5.5 成本核算
把每回合注入的字符数/估算 token 计入 `relationship.snapshot` payload 或独立 `injection.cost` 事件，供评测对照。

---

## Verification（每阶段结束都做）

- [ ] `npm run check` 全绿。
- [ ] **确定性**：同一份事件日志两次派生，`JSON.stringify` 逐字节相同（自动化测试，不靠人眼）。
- [ ] **只追加**：`grep -rn "appendFile\|writeFile\|rename" lib/` 确认除 `EventLog.replace`（恢复路径）外无第二处改写日志。
- [ ] **真实数据副本冒烟**：复制 `~/.dsh/dsh-chat-local/rooms.json` 到临时目录，用生产代码加载并跑一个回合，确认新事件落盘、链校验通过、**真实数据未被触碰**。
- [ ] 迁移（Phase 3 起）：确认 `rooms.json.v15.bak` 被写出且字节等于迁移前。
- [ ] 仓库内无真实 home 路径。
