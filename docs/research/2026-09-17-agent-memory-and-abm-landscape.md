# 长期记忆与 ABM 基座：领域调研与架构判断

> 歷史資料（2026-09-17）。保留當時的問題與方案；本文的狀態、目標和實作步驟不作為目前待辦。現行行為請從[文件索引](../README.md)查閱。

日期：2026-09-17　　状态：调研结论（**不是**实现规范）
范围：为 `dsh-chat-local` 判断「跨对话长期记忆」应如何建设，以及未来升级为 GABM/ABM 研究平台所必需的原语。

---

## 0. 结论摘要（五分钟版）

1. **不要把这两件事当成两个功能。** 「长期记忆」与「ABM 可复现性」是同一套架构的两面：**不可变的追加日志（研究需要）+ 可重建的派生层（记忆需要）**。四份独立调研在这里完全收敛。
2. **因此顺序是：先建日志，再让记忆成为派生视图。** 记忆是日志的纯函数；没有好日志的记忆是不可审计的产物。反过来做，provenance / 回滚 / 实验语义**在 transcript-first 架构上几乎无法补装**。
3. **今天的状态是「派生视图即唯一存储」。** `rooms.json` 是可变的单块状态；这正是要倒过来的那件事。这也是为什么 `snapshot/restore` 与干预 API 被列为「现在便宜、以后昂贵」。
4. **在自主整理 vs 显式整理的分歧上，我们天然站在 Hermes 一侧。** 本插件已有的原语（章程 = 成员提案 + 全员批准 + 版本化；台账 = `operationId` + `expectedRevision` + `sourceMessageIds`）就是「可审计 packet/patch」的形状。OpenClaw 式的后台 dreaming 会制造不可归属、不可复现的写入 —— 对研究是毒药。
5. **关系状态是当前最大的空白，也恰好是「agent 长期互动」的核心。** 台账记录了*事件*，但完全没有*评价*（每个观察者对他人的信念）与*关系*（有向、带有效期）。这个 `event / appraisal` 的分离是本次调研中**最值得照搬的一条**。
6. **七条不可事后补装的决策**见 §5；其中只有两条今天需要真正动手，其余是「现在记下来、别把路堵死」。
7. **对研究的纪律**：只做探索性/机制性主张 + 必须带对照臂；单模型单次运行不可发表（"one model is not a population"）。

---

## 1. 领域地图

三条谱系：

| 谱系 | 代表 | 主张强度 |
|---|---|---|
| 硅样本（silicon samples） | Argyle et al. 2022/2023（algorithmic fidelity，子群体响应分布） | 分布层面复现，非个体 |
| 生成式 agent | Park et al. 2023（25 个 agent，仅面效度） | 演示级 |
| GABM 框架 | Concordia（Game Master 把"语言提议的行动"与"可行性检查后的状态转移"分离）、AgentTorch（LLM archetypes，百万级）、OASIS（10^6）、AgentSociety（10^4 agent / 5×10^6 交互） | 工程级 |

2025–26 的分裂：乐观派（Anthis et al., ICML 2025）对批评派。最强的综合是 Taillandier et al.，它给三个失效模式起了名字：**fluency fallacy**（流畅被当作有效推理）、**micro-to-macro validity gap**（个体误差在群体尺度放大）、**physics washing**（严谨的环境为未验证的行为层背书）。

### 验证阶梯（审稿人接受的口径）

面效度（最弱）→ **与外部调查/实验的聚合匹配**（AgentSociety 对 GSS/WVS；Park et al. 2024 的访谈+调查 agent 达到真人两周重测一致性的 83–86%，而仅人口学基线 74% —— 注意天花板是**人的自一致性**，不是真值）→ **过程/机制验证（决定性的一级；仅聚合匹配被明确拒绝）**→ 消融（LLM 层 vs 规则控制臂）→ 敏感性分析（种子、初始条件**与提示词改写**）→ 持续的行为多样性检查。

### 已知的领域污点（必须记住）

Mem0/Zep 的 LoCoMo 争议（[zep-papers#5](https://github.com/getzep/zep-papers/issues/5)）：**分母算错 + 单次运行报数**，把头条数字从 84% 变成 58.44%，最后承认 75.14%。→ 任何单篇头条数字只作方向性证据；正确应对是把**可复现性做成基建**。

---

## 2. 记忆架构：可迁移的设计决策

（完整对照表见 `~/Documents/llm-agent-memory-comparison.md`）

覆盖 MemGPT/Letta、A-MEM、Zep/Graphiti、Mem0、Cognee、LangMem、Generative Agents、MemOS，以及 2026 年的多 agent 工作（MAP-Graph、MAPLE-Guard、TEPA）。

| # | 决策 | 依据 |
|---|---|---|
| 1 | **不可变 episode 日志 + 可重建的 fact 层** | 只有 fact 无法从坏抽取中恢复；只有 episode 会淹没提示词 |
| 2 | **写入 = 确定性捕获原始回合，再由一次窄接口的 `remember`/`supersede` 落事实** | 纯工具调用会漏，纯后台抽取会写下没人要求的东西 |
| 3 | **只追加本身不安全** | TEPA：完全反转下 append-only 与 last-write-wins 都是 0.210，**低于完全不用记忆的 0.309**；按键撤销 0.950 |
| 4 | **矛盾处理用「按键撤销 + 证据链」** | 否则反转不可审计 |
| 5 | **不做 embedding 也站得住** | Zep 自己就是 BM25 与向量融合；FTS5 + 标签 + 时效 + 重要度 + LLM 查询扩展即可 |
| 6 | **检索公式照抄 Generative Agents** | 归一化后的 recency（0.995^Δt，命中即重置）+ importance（1–10）+ relevance，再 MMR，最后硬性字符上限 |
| 7 | **整理触发用「重要度累加阈值」而非定时** | GA 用最近 100 条里累加 150；定时任务浪费算力 |
| 8 | **作用域是安全问题，不是便利问题** | 两篇 2026 MAS 论文都把共享记忆当作投毒与权限泄漏通道 |
| 9 | **provenance 从第一天就要有** | 事后补装不可能 |

### 对 §3 第 3 条的修正（读一手摘要后）

TEPA 原文（[arXiv:2608.07429](https://arxiv.org/abs/2608.07429)）在**干净**的 MemoryAgentBench SH-6k 上**只是与强 last-write-wins 打平**，并明说 **"current-key replacement is the decisive operation for single-hop fact consolidation"**；失效/撤销只在世界反转时拉开差距。且它明确承认**多跳与超长上下文仍未解决**（瓶颈在检索链与上下文选择）。

→ 正确读法：**「键 + 有效期 + 保留历史」三者合起来才是 0.950**，而不是「弃用删除就赢了」。**键（key）怎么设计，比失效策略更早决定成败。**

---

## 3. 多 agent：状态分类与最小 schema

最好的公开框架是 Always-On Agents 综述的六条**诊断轴**：authority / scope / mutability / provenance / recoverability / actionability，加生命周期（write → validate → organize → retrieve → act → update → forget → audit → rollback）。但它**不区分关系状态**，因此下列六分法是本调研构造的：

| 类别 | 代表实现 |
|---|---|
| ① 每 agent 私有 | AutoGen `TeamState.agent_states[].llm_context`；MetaGPT 每 Role `Memory` |
| ② 每 agent 对**他人**的信念 | Concordia `PlayerState` 同时带真值 `role`/`alignment` **与** `perceived_role`；`SocialDeceptionGameLedger` 记录 claims、信任分与推理 |
| ③ 二元关系（边本身） | AgentSociety 存有向带权边 `target_id / kind / strength(0–1)` |
| ④ 共享任务状态 | AutoGen manager 持有的 `message_thread`；MetaGPT `Environment` 池 |
| ⑤ 制度/规范 | Concordia `state_formation` 持久化协商出的条约；跨局策略文档注入每个 agent 提示词 |
| ⑥ 程序性 | 技能库（AG2 `EpisodicMemoryPolicy`、MIRIX procedural） |

### 最小可用 schema（**本报告的核心建议**）

关键动作是每个框架都做错的那一步：**把客观事件与每个 agent 对它的评价分开。**

```
agent(id, created_at)
episode(id, started_at, ended_at, cast[], institutional_context_id)
event(id, episode_id, t, actor_id, action_type, channel,          -- public|dm|tool
      content_ref, recipients[], in_reply_to, observable_by[])    -- 追加、不可变
appraisal(event_id, observer_id, about_agent_id,
      stance∈{trust,distrust,neutral}, confidence∈[0,1],
      claim, perceived_role, evidence_event_ids[])
relationship(observer_id, target_id, episode_id?, valid_from, valid_to,
      trust∈[0,1], role_label, obligation, unresolved_disagreement_count)
norm(id, episode_id, text, ratified_by[], ratified_at)
```

理由：`event` 不可变 + 带时间戳 = 可复现记录；`appraisal` 必须独立，因为同一事件在不同观察者处产生不同信念；`confidence` + `evidence_event_ids` 让信念**可被日志证伪**；`valid_from/valid_to` 是最小失效语义；`relationship` 有向、以 `(observer, target)` 为键；`unresolved_disagreement_count` 让"先前分歧"可查询。

少于这个 schema（例如扁平的每 agent 日志）就无法回答：**「A 对 B 的信任是否在事件 E 之后变化，且该变化有证据支撑？」** —— 这是最低限度的科学可用查询。

### 不持久化关系状态会坏在哪（有实证）

- **MAST**（1600+ trace、7 框架、κ=0.88）十四类失效模式中包含 **FM-1.4 对话历史丢失、FM-2.1 对话重置、FM-2.4 信息隐藏、FM-2.5 忽略他方输入** —— 正是持久化交互 schema 能压制的。
- **泄漏**：AgentLeak（4979 trace）—— **agent 间消息泄漏 68.8%**，而最终输出 27.2%；**只看输出的审计漏掉 41.7% 的违规**。
- **语义漂移**：重复 n 人博弈中，模型对"公开声明是否有约束力"理解不一致，payoff 差距**在第 0 轮就出现并持续 10 轮**。
- **"recall is not compliance"**：被召回的正确纠正仍会被违反 —— 记忆注入 ≠ 行为改变。
- **跨 agent 传播**：坏状态经共享基底扩散**快于单 agent 安全检查的遏制速度，因为每个 agent 都信任基底**；共享写入**只能收窄或保持作用域，绝不能静默放宽**。
- **正面证据（相关性，非随机）**：188 局 Avalon + 跨局记忆 → 声誉自发涌现且**依角色而变**（同一 agent 当好人时"直率"、当坏人时"圆滑"），高声誉玩家**被选入队伍多 46%**。

### 共享 vs 私有的代价

| 设计 | 代价 |
|---|---|
| 单一共享黑板 | 泄漏最大，除 `sent_from` 外无归属 |
| 共享 + LLM 推断作用域 | 作用域质量由 LLM 判，无硬授权 |
| 命名空间存储（LangGraph store） | 命名空间要自己设计，无撤销语义 |
| 私有 + 选择性视图 | 重复存储、视图发散 |
| **共享 + 治理门**（GateMem, arXiv:2606.18829） | **没有方法能同时拿到强效用 + 稳健访问控制 + 可靠遗忘** —— 未解 |
| 事务式提交（MemTX, arXiv:2607.23929） | 协议开销（记录带 evidence/permissions/provenance/validity，快照隔离 + 校验提交 + 撤回时类型化级联修复） |

→ **GateMem 的结论意味着作用域/租户模型是一次设计承诺，不是一个调参旋钮。**

---

## 4. 插件现状审计（按 GABM 四个承重原语实测）

| 原语 | 现状 | 判定 |
|---|---|---|
| 有序调度（**不得用到达时序**） | `#recipients()` 按 `room.members` 配置序依次征询；单轮内不并发抢同一上下文 | ✅ 已有且正确 |
| 显式 tick / 仿真时钟 | 无。`room.epoch` 是**回合作废计数器**，不是仿真步；87 处 `Date.now()`，时间权威是墙钟 | ❌ 缺 |
| 每次 LLM 调用的持久事件日志 | 有 `messages[]`（`roomSeq`/`causedByMessageId`/`deliveries`）与 `ledger[].history[]`（actor/at/revision/operationId/fingerprint）；**但没有 model/provider、解码参数、token/cost、call id，且 `#participantPrompt` 从不落盘** | ⚠️ 半有 |
| snapshot / restore | `exportRoomSnapshot()` 有 JSON 导出并带 `contentHash`；**没有导入/回滚路径**；`restoreRoom`/`restoreLedgerEntry` 只是逻辑"取消删除" | ⚠️ 只有一半，且缺的正是难补的一半 |
| 干预 API | 有大量人类操作入口（`setRoomPolicy`/`setRoomDetails`/`updateParticipants`/`chat_manage`/`triageLedgerEntry`/`retryFailedDeliveries`），但**没有实验语义**（无 treatment arm、无"第 k 步对谁施加了哪个机制"） | ❌ 作为研究原语缺 |

---

## 5. 我的架构建议

### 5.1 分层（日志为第一性，状态为派生）

```
L3 实验控制   臂/treatment、干预日志、run manifest、snapshot/restore、评测工具、成本核算
L2 注入装配   给定 日志 + 配置哈希 → 确定性产出"这个回合成员看到什么"（= 实验的自变量）
L1 派生读模型 房间状态（消息/台账/章程）、记忆事实（带 key + 有效期）、appraisal、relationship、digest
L0 事件日志   追加且不可变：人类消息、agent 回复、工具调用、记忆注入、台账操作、干预、调度决策
              （每条带 event_id / tick / wall_clock / actor / type / payload / causes / provenance）
```

今天 `rooms.json` 把 L1 当唯一存储；ABM 级版本要把它倒过来：**L0 是主存储，L1 是其纯函数**。

### 5.2 七条不可事后补装的决策

| # | 决策 | 今天要做什么 |
|---|---|---|
| 1 | 日志不可变、追加写 | 消息纠正改为**新记录引用旧记录**，不是原地改 |
| 2 | provenance 是结构化列，**绝不由模型撰写** | 每条派生记录带 `source_ids` + `content_hash` |
| 3 | 显式 `tick` 与墙钟分离 | 加一个单调计数器；调度顺序显式落日志 |
| 4 | 每次 LLM 调用记 model/版本/解码参数/提示词哈希/token/成本 | 现在没有，且历史数据补不回来 |
| 5 | 被注入的那一段单独落盘 | 它**就是**实验的自变量，不是遥测 |
| 6 | snapshot/restore 必须成对 | 导出已有，**导入/回滚要补** |
| 7 | 作用域/租户是承诺不是旋钮 | 私有为默认；共享只能经显式 promotion 进带类型的共享存储，并在读取侧过滤 |

### 5.3 现在便宜、以后昂贵

**现在便宜（paper-facing 运行前必须有）**：① 每次调用的持久事件日志（含模型/参数/提示词/成本）② 显式 tick + 调度顺序落盘 ③ 派生记录的 provenance 列 ④ 不可变 observation ⑤ 导出**与**导入/回滚 ⑥ 注入块日志 + 栅栏标记（"这不是新的用户输入"）+ 硬字符上限 ⑦ 确定性优先检索（FTS5 + 标签 + 时效 + 重要度；不做 embedding、不做查询期 LLM 排序）。

**以后昂贵（现在只要别堵死路）**：⑧ 带 treatment arm 语义的干预 API（匹配初始条件、记录"什么/哪些 agent/第几步/哪个机制"）⑨ 从第 k 步确定性重放与时间旅行 ⑩ agent 身份跨模型版本持久化（persona 作为数据而非提示词散文）⑪ 台账区分**外生 vs 内生**事件 ⑫ 规模化的分片与确定性合并、LLM 调用缓存。

**记忆专属（可以晚于日志）**：⑬ `appraisal` + `relationship`（有效期区间、按键撤销）⑭ digest/consolidation 作为日志的**纯函数 + 版本化配置哈希**，阈值触发 ⑮ 撤销而非删除。

### 5.4 我明确不建议做的

- 现在不引入向量库 / embedding 流水线（Zep 自己都融合 BM25；FTS5 + 标签站得住）。
- 不做自主 "dreaming" 后台改写（摧毁可审计性）。
- 不让模型写 provenance。
- 不在没有硬租户过滤的情况下跨房间/跨实验共享一个记忆库。
- 不用单一模型、单次运行去写论文。

### 5.5 对研究的纪律（写进任何将发表的运行）

- 只做**探索性/机制性**主张；明确声明不做预测。
- 必须带**对照臂**（消融 LLM 层 vs 规则臂）。
- 单模型 ≠ 群体：至少两个模型家族/版本，报告组内 vs 组间方差；以 **run/seed 为分析单位**，预先指定独立运行次数。
- 冻结评测工具：固定数据集、**≥10 次运行、报方差**。
- 记录十类可复现产物（模型快照与端点、逐字提示词含检索到的记忆、解码参数、记忆状态与追加日志、回合顺序与打破平局规则、环境配置、干预日志、完整事件轨迹含 call id/时间戳/token/成本、代码提交与 lockfile、分析代码与预注册估计量）。
- 伦理：报告子群体误差、限定推断范围、不用硅样本替代所研究的真实人群。

---

## 6. 建议的分解（这是程序性工作，不是单个功能）

| 子项目 | 内容 | 为什么这个顺序 |
|---|---|---|
| **P1 基础（推荐先做）** | L0 事件日志 + provenance + tick/顺序 + 注入块日志 + snapshot/restore + 导入导出 | P2–P4 全部依赖它；且它是唯一**不可补装**的部分 |
| P2 记忆 | L1 记忆事实层（键 + 有效期 + 撤销）+ FTS5 检索 + 显式 digest（非自主）+ 注入装配 | 建在 P1 上即为纯函数 |
| P3 关系 | `appraisal` + `relationship` + 成员间信念进入回合提示词；章程作为制度状态 | 用户最关心的"长期互动"核心 |
| P4 研究控制 | 干预 API、run manifest、评测工具、成本核算、多模型臂 | 只在要发表时才必须 |

---

## 7. 来源

**综述与领域**（均于 2026-09-17 在线核验）
- Always-On Agents 综述 arXiv:2606.30306 · 记忆形态/功能综述 arXiv:2512.13564
- MAST 失效模式 arXiv:2503.13657 · AgentLeak 泄漏 arXiv:2602.11510 · Avalon 声誉 arXiv:2604.20582 · 宣告语义漂移 arXiv:2607.05132

**记忆架构**
- MemGPT arXiv:2310.08560 · A-MEM arXiv:2502.12110 · Zep/Graphiti arXiv:2501.13956 · Mem0 arXiv:2504.19413 · Generative Agents arXiv:2304.03442 · MemOS arXiv:2507.03724 · MemoryAgentBench arXiv:2507.05257 · TEPA arXiv:2608.07429 · MAP-Graph arXiv:2608.10509
- Letta 文档（memory blocks 已标记 deprecated，转向 git-backed MemFS）· Graphiti repo · LangMem 概念指南 · Cognee 文档

**GABM / ABM**
- Concordia arXiv:2312.03664 · AgentTorch repo + arXiv:2409.10568 · OASIS arXiv:2411.11581 · AgentSociety arXiv:2502.08691
- 批评：arXiv:2501.08579 · Taillandier arXiv:2507.19364（fluency fallacy / micro-macro gap / physics washing）· NeurIPS position arXiv:2506.06958
- 验证：Park et al. 2024 arXiv:2411.10109 · POSIX 提示词敏感性 aclanthology 2024.findings-emnlp.852
- 可复现：AgentOps arXiv:2411.05285 · trace-anchored protocol arXiv:2608.20729

**运行时（Hermes / OpenClaw）**
- NousResearch/hermes-agent + docs · `smarzola/hermes-local-memory` 设计文档 · `aliasocracy/hermes-memory-mcp` · openclaw/openclaw + docs（memory-architecture / dreaming / session schema / cron payloads）
- 跨 agent 共享记忆：Alibaba Cloud Tablestore use case（2026-05-14）

## 8. 未核实 / 保留

- Mem0 与 Zep 的 LoCoMo 类分数仍有争议（本报告两边都引，不选边）。
- Letta 的 memory-block 文档仍在线但已标记 deprecated，实际云行为可能不同。
- §3 的六分类是**本调研构造**，综述只提供诊断轴。
- Avalon 的 46% 是相关性证据，不是随机分配。
- 若干 2602.x–2607.x 的 arXiv 条目只核验了标题与摘要，未读全文，也未核验发表会场。
- MDPI 的 protocolizing 论文与 *Artificial Intelligence Review* 的批评文章被付费墙拦下，其内容仅通过 Taillandier 的引用间接进入本报告。
