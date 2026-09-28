# 群聊下一版：GitHub 調研與修改方案

查驗日期：2026-09-28。現有插件基準：`8484fb1f1def52c59bec71126f5ebae13fd442c9`，`0.18.1-local.1`。

本次查看 15 組專案、16 個官方 GitHub 倉庫的文件、相關原始碼與部分測試；Letta 的導引倉與現行實作分開計算。引用固定 commit，表示研究快照，不表示正式穩定發行版。**沒有執行上游測試、安裝框架或進行真實模型對照實驗；下文方案尚未實作。** 不以星數、角色數、測試數量或 README 的效果聲明作為合作品質證據。

## 1. 建議的方向

產品目標宜定為：**一群具有持續身分、各自視角與長期經歷的助手，在共同工作空間交流、分工，交付可核查的成果。** 群聊承載溝通；工作台帳保存責任與進度；成果保存確切版本；個人記憶保存各自實際經歷與形成的看法。

這同時容納「把 Agent 當一個人」與「讓他們把事做好」。但兩者要分別驗證：人格與經驗能否持續，不等於團隊能否產出正確成果；對話像人，也不能證明它是有效的人類行為模型。

建議選擇下表 B，先交付 A 作為第一步：

| 選項 | 改動範圍 | 能解決什麼 | 代價與邊界 |
| --- | --- | --- | --- |
| A．讓現有群聊能收束 | 統一通知／處理請求、減少重複催促、保留整合預算 | 直接處理亂喚醒與最後無人收尾 | 改動較集中，但聊天與成果的連接仍需補齊 |
| **B．有持續成員的協作工作空間** | 在 A 上連接現有台帳、確切交付版本、驗收及任務導向記憶 | 既保留人格與個人經歷，又讓合作有可查驗結果 | 需要資料契約、工具與介面一起調整；宜分段驗收 |
| C．持續運行的組織／社會模擬 | 再加入自主目標、時間、環境、角色關係與制度演化 | 研究一群持續存在的個體如何互動 | 模型成本與評估難度顯著增加；不能假定比工作型協作更有效率 |

目前不建議整套遷移到另一框架。DSH 已承擔模型、Session、工具與審批；插件已有持續身分、個人來源隔離和恢復協議。此次最有用的借鑑是協作規則與資料邊界。

## 2. 先區分歷史失敗與目前程式

兩份歷史失敗對話的既有逐則標註共 37 則 Agent 公開訊息：17 則有新增或必要推進，16 則混有有效增量與大量重述，4 則整則屬於可省略確認／重複。本輪重讀該標註，沒有重新做盲編碼。**不能據此說大部分整則訊息毫無價值，也不能把訊息分類比例當成浪費 token 的比例。**

比較有把握的問題是：有效更正被包在整份報告的重貼裡；同一授權或缺件問題被多人反覆解釋；一般點名與要求接手混在一起；後來的更正到達時，整合者可能已耗完回合。這些是合作安排與交付方式的問題，不能只用「請勿重複」的提示詞處理。現行提示詞其實已要求無新增內容時回覆 `(pass)`。[現行提示與接力規則](https://github.com/ALPSIYH/dsh-chat-local/blob/8484fb1f1def52c59bec71126f5ebae13fd442c9/lib/room-store.js#L4248-L4255)

歷史案例提供需要重播的失效情境，**不表示其中每一個舊缺陷在今天都還存在**。本輪再核對現行程式，得到以下差額：

| 已存在，不應重造 | 下一版真正要補的連接 |
| --- | --- |
| 每項工作已有 owner、獨立 reviewer、提交與驗收；同一 Agent 換 Session 不能自我驗收 | 用現有 task 表示整體交付責任，連接子工作；為整合與部分交付保留預算 |
| 文件預覽已有 `artifactId`、hash、versions、replicas；分段讀取用 `expectedHash` 防混版 | 目前版本主要是 metadata；需要可固定取回的交付內容，並讓 submission／review 指向確切版本 |
| submission 保存 `deliverable`、訊息來源和 revision；review 保存 `submissionRevision` | `deliverable` 仍是非空文字，未強制核對 artifact 的版本／hash；任務 revision 不能代替文件版本 |
| blocker 已有類型、原因、下一步、文件路徑及依賴；handoff 已有操作防重、範圍及回報狀態 | 合併共同阻斷的提醒；只有解除條件有變化才重新交接，避免反覆催問同一問題 |
| 部分系統通知與文件分享已能不喚醒；普通 comment 不重置停滯計時 | 將「通知／請求處理」變成所有訊息路徑一致的語義，而非少數呼叫點的旗標 |
| 排程已區分 `reply_limit`、`member_limit`、`delivery_failed`、`completed`，並保存待處理者 | 排程跑完與成果完成分開呈現；到上限應交付當前成果、缺項與停因 |
| 穩定 agentId、PERSONA.md、觀察收據、跨來源召回、信念修訂／撤回、同文整理、衰減及容量治理已存在 | 改善「此刻需要想起什麼」與「如何從經歷形成可更正的理解」，不要再新增另一套記憶庫 |

對照來源：[獨立驗收](https://github.com/ALPSIYH/dsh-chat-local/blob/8484fb1f1def52c59bec71126f5ebae13fd442c9/lib/room-store.js#L2958-L2986)、[提交／驗收欄位](https://github.com/ALPSIYH/dsh-chat-local/blob/8484fb1f1def52c59bec71126f5ebae13fd442c9/lib/room-store.js#L3382-L3443)、[文件版本登記](https://github.com/ALPSIYH/dsh-chat-local/blob/8484fb1f1def52c59bec71126f5ebae13fd442c9/lib/room-store.js#L3592-L3650)、[恢復與交接](https://github.com/ALPSIYH/dsh-chat-local/blob/8484fb1f1def52c59bec71126f5ebae13fd442c9/lib/room-store.js#L3006-L3100)、[路由](https://github.com/ALPSIYH/dsh-chat-local/blob/8484fb1f1def52c59bec71126f5ebae13fd442c9/lib/room-store.js#L3822-L3832)、[預算與結束](https://github.com/ALPSIYH/dsh-chat-local/blob/8484fb1f1def52c59bec71126f5ebae13fd442c9/lib/room-store.js#L4277-L4374)、[現有記憶生命週期](../memory-lifecycle.md)。

## 3. GitHub 上學到的機制與限制

下表不是框架排名。不同專案處理不同層次，不能拿 checkpoint、共享黑板、向量檢索與人格模擬互相替代。

| 專案／快照 | 查到的具體機制 | 對我們的用途與限制 |
| --- | --- | --- |
| Microsoft Agent Framework · `20c404524b2c` | 廣播用 `should_respond=False`，被選中的成員才收到回應請求 | 直接借鑑知情與回覆義務分離；同時必須保證被喚醒者有最新上下文。[實作](https://github.com/microsoft/agent-framework/blob/20c404524b2c7eb3c4abb75c77af94b232c518ce/python/packages/orchestrations/agent_framework_orchestrations/_base_group_chat_orchestrator.py#L409-L473) |
| AutoGen／Magentic-One · `027ecf0a379b` | 候選人選擇、進度台帳、停滯後重規劃 | 學「何時換工作方式」；模型判斷有進展不等於事實上有進展。官方已標 maintenance mode，不宜據舊聲望直接選作新底座。[進度控制](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/python/packages/autogen-agentchat/src/autogen_agentchat/teams/_group_chat/_magentic_one/_magentic_one_orchestrator.py#L300-L440)、[維護狀態](https://github.com/microsoft/autogen/blob/027ecf0a379bcc1d09956d46d12d44a3ad9cee14/README.md#L14-L24) |
| LangGraph · `07b33185eab8` | `interrupt`／resume 保存等待中的工作；恢復從節點開頭重跑 | 等待是一個可恢復狀態；副作用仍須防重，不能因 checkpoint 存在就宣稱不會重做。[恢復語義](https://github.com/langchain-ai/langgraph/blob/07b33185eab893be2ed031eedae52f09314bf77c/libs/langgraph/langgraph/types.py#L887-L909) |
| OpenAI Agents SDK · `08e5c431eb85` | agents-as-tools 保留整合責任；handoff 轉移控制權 | 必須分清請人協助與把案件交出去；不提供完整的人格與跨工作生活史。[協作模式](https://github.com/openai/openai-agents-python/blob/08e5c431eb85d243b62d904f21bc57b6db1682a1/docs/multi_agent.md#L20-L50) |
| MetaGPT · `11cdf466d042` | Role 依訂閱／收件人取得 news，無新消息便等待 | 借鑑責任事件；這是訊息層去重，不是語義空轉判定。[觀察](https://github.com/FoundationAgents/MetaGPT/blob/11cdf466d042aece04fc6cfd13b28e1a70341b1f/metagpt/roles/role.py#L398-L427)、[等待](https://github.com/FoundationAgents/MetaGPT/blob/11cdf466d042aece04fc6cfd13b28e1a70341b1f/metagpt/roles/role.py#L529-L559) |
| ChatDev 2.0／DevAll · `4fb2db0ea903` | 圖工作流；節點執行前後比較檔案 hash，產生成果事件 | 新聊天與新成品分開；目前 main 已非舊版固定虛擬公司。不必照搬通用 DAG 編輯器。[版本定位](https://github.com/OpenBMB/ChatDev/blob/4fb2db0ea90375ce1059f44fe03ffbd191a7a169/README.md#L15-L34)、[成果事件](https://github.com/OpenBMB/ChatDev/blob/4fb2db0ea90375ce1059f44fe03ffbd191a7a169/workflow/hooks/workspace_artifact.py#L96-L183) |
| CAMEL Workforce · `fc27907e31ea` | 任務傳遞、依賴、失敗與繼續彙整分開；不同模式對失敗依賴有不同處理 | 等待應指向具體缺件與責任人；下游可以彙整部分成果，而非所有人重述失敗。[派遣](https://github.com/camel-ai/camel/blob/fc27907e31ea2074d6b65ceb121573c5fa1ab345/camel/societies/workforce/workforce.py#L4397-L4536) |
| CrewAI · `4ed2abc7bbf5` | 預期輸出、guardrails、TaskOutput；後關返工不重跑前關的行為有直接測試 | 借輸出契約；避免「每一關曾通過」冒充「最後版本全通過」。[任務契約](https://github.com/crewAIInc/crewAI/blob/4ed2abc7bbf504a634d3b733f2a97e0fbe8d44ec/lib/crewai/src/crewai/task.py#L150-L282)、[返工測試](https://github.com/crewAIInc/crewAI/blob/4ed2abc7bbf504a634d3b733f2a97e0fbe8d44ec/lib/crewai/tests/test_task_guardrails.py#L482-L522) |
| Google ADK · `044a1ec3f434` | ArtifactService 按版本保存／取回；Workflow JoinNode 等待所需並行輸出再整合一次 | 借版本成果與有條件的整合；等待所有依賴也需失敗／逾時處理，不能無限等待。[成品服務](https://github.com/google/adk-python/blob/044a1ec3f434cf2e3f7acfdbd52305b60d16f6e5/docs/guides/artifacts/artifact_service/index.md#L108-L176)、[整合範例](https://github.com/google/adk-python/blob/044a1ec3f434cf2e3f7acfdbd52305b60d16f6e5/contributing/samples/workflows/fan_out_fan_in/README.md) |
| OpenHands SDK · `c1d5bee916ee` | 偵測相同 action／observation、重複錯誤及循環；同一錯誤連續段只提醒一次，持續失敗再停下 | 工具失敗不該無限催試；此偵測不能直接辨認措辭不同但沒有進展的群聊。[停滯偵測](https://github.com/OpenHands/software-agent-sdk/blob/c1d5bee916ee6e86b7ae9acc1a562e4144043013/openhands-sdk/openhands/sdk/conversation/stuck_detector.py#L131-L248) |
| Letta／Letta Code · `5bcdd177d70f`／`c864f1532b32` | 同一 agent_id 跨 conversation 經歷；經歷與可修改學習記憶分開；Git MemFS 與反思 worker | 最接近持續個體的工程參考；人格穩定不能由 prompt 或記憶檔存在證實。當前來源已轉向 letta-code。[原倉定位](https://github.com/letta-ai/letta/blob/5bcdd177d70fa2b31a754cfcd801e77b2e1ab16a/README.md)、[上下文契約](https://github.com/letta-ai/letta-code/blob/c864f1532b328aab4bb76cc68a86d5f014de27b8/src/agent/prompts/letta.md#L6-L75)、[身分隔離測試](https://github.com/letta-ai/letta-code/blob/c864f1532b328aab4bb76cc68a86d5f014de27b8/src/backend/message-search.test.ts) |
| Graphiti · `6b4b56ff6f4b` | episode 出處及 `valid_at`／`invalid_at`／`expired_at` | 借來源與適用時間，先補本地契約；不必立刻引進圖資料庫。模型抽取的 fact 仍待核查。[Edge 欄位](https://github.com/getzep/graphiti/blob/6b4b56ff6f4b1e4e69c3c3c5487cf1b8762c483a/graphiti_core/edges.py#L263-L285) |
| Mem0 · `94c3fe9f238f` | 現行 OSS add 走增量抽取與批次新增，仍另有 update／delete；平台 decay 調整排序 | 借歸屬與增量抽取；不能套用舊四操作介紹，也不能把 hosted decay 當 OSS 自動刪除。[實際 add](https://github.com/mem0ai/mem0/blob/94c3fe9f238f3dbf29c9ce98643bd71eb13077cd/mem0/memory/main.py#L881-L1045)、[平台 decay](https://github.com/mem0ai/mem0/blob/94c3fe9f238f3dbf29c9ce98643bd71eb13077cd/docs/platform/features/memory-decay.mdx) |
| Generative Agents · `fe05a71d3e4e` | 有限視野、event／thought／chat、帶 evidence 的反思，以及交談冷卻 | 借個人視角和「有理由才開口」；人物看起來自然不等於工作結果正確。[感知](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/perceive.py#L24-L140)、[交談門檻](https://github.com/joonspk-research/generative_agents/blob/fe05a71d3e4ed7d10bf68aa4eda6dd995ec070f4/reverie/backend_server/persona/cognitive_modules/plan.py#L698-L800) |
| Concordia · `b2bf7dde6469` | 分別提供 observation，再選行動者、解析行動結果、判斷停止 | 借「看見、決定、實際發生」的分離；模擬感知不是安全授權，也不能把每次內心反思都搬進工作回合。[引擎](https://github.com/google-deepmind/concordia/blob/b2bf7dde6469639d40fd3c347b72901cb951ac84/concordia/environment/engines/sequential.py) |

## 4. 合作流程的具體改法

### 4.1 知道一件事，不等於欠大家一段回覆

普通訊息應能表達告知、提問、請求處理、提交成果、提出異議或更正。這些可由工具與介面提供自然入口，不要求使用者填複雜表單。正文提到某人的名字或引用其舊話，不應直接變成派工；明確「請甲核對」才產生相應處理請求。

工作中問「現在做到哪裡」，優先由已知整合者回報台帳和最新成品；沒有負責人時才分流或澄清。只有明確徵詢不同觀點時，才進入多人成員回應。自由討論保留為同一機制上的策略，不另造第二套房間與台帳。

保留以下區別：訊息對某人可見、已排入其待讀材料、實際提供給該 Agent 的上下文，以及現在要求他回應。只有最後一項需要生成回覆；未喚醒不等於已經讀懂，也不能因為「公開」就補造本人觀察收據。被喚醒者須取得所需最新版本及尚未處理的更正。

新證據、驗收失敗、使用者更正與正式異議必須能建立待處理事件，不能由 owner 以「沒有進度」為由壓掉。訊息防重依事件／操作身分；語義相似只能幫助折疊，不能直接刪除歷史或禁止異議。Agents SDK 亦有保留不同邏輯回合相同文字的回歸測試。[不同事件仍保留](https://github.com/openai/openai-agents-python/blob/08e5c431eb85d243b62d904f21bc57b6db1682a1/tests/test_handoff_history_duplication.py#L1675-L1725)

### 4.2 每件合作有交付責任，但不需要人人等主管

沿用既有工作台帳建立「整合交付」事項，指定最後要交什麼、誰整合、誰驗收，以及它依賴哪些子工作。子工作可以並行，各人仍可質疑與提供證據。唯一的是交付責任，不是發言權或判斷權。

排程預留整合與結案份額，避免全花在前面的互評。整合者忙碌、失聯或不能繼續時，按明確條件交接，保留既有成果與未解項。到預算上限時，由已有結構資料形成部分交付；不能把最後一位還在說話的人當作自然的整合者，也不能無限制加回合。

### 4.3 一份成品逐步改，不在群裡反覆重貼全文

延伸現有 artifact registry，對指定交付物保存可取回的不可變內容版本；submission 用結構化引用連接 artifact/version/hash，review 同時綁定成品、輸入材料與驗收標準的版本快照。新版成品發布，或相關材料／標準改變後，舊驗收仍保留為歷史，不能代表目前版本通過；即使成品 hash 沒變也一樣。先採保守規則：交付前重跑全部必要檢查；以後有可靠的變更影響分析再縮小重驗範圍。

聊天回報「改了什麼、為何改、有哪些未解問題」，全文留在最新成品。hash 只辨識內容，重新排版不能自動算成實質進展。可由程式檢查檔案存在、格式、引用可解析與測試結果；內容正確性另由證據與評審判斷。

若任務處於只讀討論模式，可設計插件內受限的草稿成果空間；必須明確定義該工具的窄範圍與容量。產生內部草稿、匯出文件、修改原文件、對外發布是不同操作，不能為了完成交付而默默擴大既有權限。

### 4.4 缺什麼只說清楚一次，條件改了再繼續

沿用 blocker／handoff，將共同缺件或決策關聯到同一待辦，為提醒建立條件指紋。資料、決定、工具結果或依賴狀態沒有改變時，不再因時間到了就自動喚醒多人重述。真正需要期限提醒的監控仍可由使用者啟用，與工作重試分開。

「文件現在可讀」只足以安排重新檢查，不足以直接宣稱問題解決。恢復應核對需要的版本與條件，再走既有交接機制；取消或歸檔的工作不得被記憶召回自動復活。插件內狀態與交接可用持久操作身分防重；外部工具副作用另需接收端冪等鍵或結果核對。結果未知且沒有防重保障時不自動重試，不能僅因存在 journal 就承諾任意外部操作恰好執行一次。

### 4.5 評審先各自看材料，再一起討論

需要獨立判斷的第一輪，提供相同版本的原始材料、相同問題與明確標準，先各自提交判斷，再公開比較差異。該輪他人的評語暫不注入評審上下文，也不能透過共享摘要／記憶繞回來。這只是降低直接互相帶答案的設計，**不等於評審在統計上獨立**；同模型與相同資料可能產生相關錯誤。

每條關鍵判斷應能區分材料原文、可核查事實、推論、尚待確認與已被反駁。多數同意不替代證據。MetaGPT 的特定 Engineer 路徑由作者角色接著呼叫 review、共享 context，正好說明名稱叫 review 不足以證明獨立。[作者內部複查路徑](https://github.com/FoundationAgents/MetaGPT/blob/11cdf466d042aece04fc6cfd13b28e1a70341b1f/metagpt/roles/engineer.py#L116-L149)

## 5. 記憶下一步：從「保存更多」轉向「想起有用的事並能改變看法」

現有實作已把人格、經歷、信念與評價分開；下一版應在這個基礎上增加以下能力，而不是再次建立 PERSONA 或信念表。

1. **按當前工作召回。** 用本次問題、責任、相關人、材料版本和未履行承諾選擇記憶，再在注入預算內同時呈現必要來源與相關看法。當前原生回合的自動記憶注入沒有按使用者問題帶入 query，摘要呈現又分組先放 beliefs／judgements；已有有界摘要不等於挑對內容。先做這個可比較的改動，再評估向量檢索。[目前取樣](https://github.com/ALPSIYH/dsh-chat-local/blob/8484fb1f1def52c59bec71126f5ebae13fd442c9/lib/room-store.js#L858-L897)、[摘要選擇](https://github.com/ALPSIYH/dsh-chat-local/blob/8484fb1f1def52c59bec71126f5ebae13fd442c9/lib/agent-memory.js#L200-L229)
2. **形成有來源的學習候選。** 現在的鞏固主要合併同文。可在一次工作結束或出現更正後，產生少量跨事件的候選理解，例如「上次評審失誤源於材料版本不同」。候選保留原始證據、適用情境及不確定性；無持久增量時不寫入。先試用可撤回的派生層，不自動重寫人格核心。Letta 的反思提示也要求檢查持久性、重複與矛盾，但 prompt 要求本身不是品質保證。[反思契約](https://github.com/letta-ai/letta-code/blob/c864f1532b328aab4bb76cc68a86d5f014de27b8/src/agent/subagents/builtin/reflection-v2.md#L38-L109)
3. **補足信念的適用期與反證。** 已有 supersedes／revoke，仍需能表達「這是某環境版本下的判斷」「有新反證但尚未裁決」。目前 `validEvidence` 檢查來源、內容 hash 與觀察收據，這不等於判斷的語義仍然適用。一次工具被拒絕，不應變成跨所有工作永久無法寫檔的性格；他人說完成，也不能變成自己驗證過完成。對人的評價應綁情境與來源，不應直接變成總體信任分數或工具權限。[目前信念核驗](https://github.com/ALPSIYH/dsh-chat-local/blob/8484fb1f1def52c59bec71126f5ebae13fd442c9/lib/agent-memory-index.js#L386-L396)
4. **把保留策略與召回策略分開。** 現在已有衰減、休眠、釘選、抑制與容量限制。物理刪除／保留期是另一個待設計的需求，須處理摘要、索引、備份和重建路徑；不能把 suppress 或冷檔壓縮改名叫真正遺忘。此項可以獨立排期，不阻擋合作流程先改善。

上述現況以 [記憶生命週期](../memory-lifecycle.md) 與 [人格及來源架構](../agent-memory-architecture.md) 為準。人格長期穩定仍須跨模型、跨房間、壓縮與時間間隔的真實行為評測；穩定注入 MD 不是同一件事。[現有縱向試驗邊界](../persona-longitudinal.md)

有一條不能退步：甲的一次說法，經乙轉述、丙附和後，仍然是一條原始來源；個人的主觀解釋也不能回流成新的獨立證據。共享正式成果是公共參考材料，不是每人的親歷。這是本專案的人格／記憶目標與一般共享黑板的主要差別。

## 6. 分段實作與驗收

### 第一段：修復兩個歷史案例暴露的合作斷點

統一通知與處理請求；用既有 task 建整合事項；保留整合預算；將交付與驗收連到固定成果版本；共同阻斷只建立一次待處理提醒。介面直接展示「最新成品」「現在誰在做什麼」「等什麼」「未完成什麼」，避免用聊天篇幅表示進度。

這些變更宜收斂到可單獨測試的注意力／排程策略、既有工作協議、成果內容版本三個責任範圍，減少繼續往 `room-store.js` 加零散分支。保持 RoomJournal、身分解析、觀察收據與工具守衛的既有契約。相容舊資料時，無確切版本的舊提交標為「版本未固定」，不得補造已驗收證明。

### 第二段：改善記憶如何參與工作

先比較任務導向召回與目前自動注入；再試用有來源、可撤回的學習候選與矛盾狀態；保留人工管理的核心人格。不要同時引入新框架、圖資料庫、自動人格演化與新排程，否則出錯難以歸因。

### 第三段：另行驗證長期個體與社會互動

基於前兩段穩定資料，測量跨工作的承諾履行、改正錯誤、關係理解與人格一致性。若要持續自主社交，另定義環境、時間、干預與研究問題；不要用「看起來聊得像人」作唯一驗收。

### 需要通過的確定性情境

| 情境 | 預期性質 |
| --- | --- |
| 六人成員中只有一位負責進度回報 | 一般狀態詢問只產生必要處理請求；知情通知不額外開模型回合 |
| 同一交接因重試到達三次 | 保持同一操作身分，不重複領取或執行；新證據即使文字相同也不誤刪 |
| 多項工作等同一材料，條件一直未變 | 共享待辦可見；不讓全組反覆催問；條件改變後只恢復受影響工作 |
| v1 通過後 v2 改壞已驗收條件 | v1 驗收不能覆蓋 v2；最後必需檢查重新失敗 |
| 成品 hash 未變，但依據材料或驗收標準已更新 | 舊驗收不能直接沿用；核對新依據後重新驗收 |
| 整合者較早用盡普通回合，後來收到重要更正 | 留有整合／交接路徑；最後成品採納更正或明列尚未處理 |
| 所有人說已完成，但指定產物不存在 | 不能以聊天或多數同意標示整體交付完成 |
| 一名評審提交與多數相反的新證據 | 異議能進入待處理狀態，不能被相似度或 owner 任意壓掉 |
| 事件持久化、交接、寫入成品或驗收中途崩潰 | 插件內狀態轉移與交接防重，不混用版本或沿用過期驗收；外部副作用依冪等鍵／結果核對恢復，無法確認時保留未知且不盲目重試 |
| 私人材料被另一人轉述；同輪評語進入共享記憶 | 來源與實際可見範圍不膨脹；首輪評審隔離不被召回繞過 |
| 相同整理輸入重跑；信念被撤回；工作被取消 | 不新增循環證據，不復活舊信念或已取消工作 |

以上是待實作後執行的驗收條件，不是本輪已通過的測試結果。

### 合作品質必須另做真實模型比較

以相同材料、模型、工具與總預算，比較單 Agent、現行群聊、修改後群聊；既有兩例作回歸案例，再加入未用來調整規則的新任務。優先評估成品正確性、關鍵遺漏、證據可追溯與完成程度，再看無新增資訊的回合、使用者救場、耗時和 token 成本。降低訊息量但漏掉重要異議，不能算改善。

保留失敗、逾時、缺產物及成本耗盡案例；對內容使用可核查答案／證據與盲評抽查，不能全靠另一個模型打分。先以試驗估計變異與失敗型態，再依欲支持的結論決定樣本量；固定「跑十次」不是充分證明。工程回歸、模型效果、人格長期穩定三種結論分開報告。

## 7. 方案本身最容易引入的新問題

- **安靜但漏事：** 過度限制喚醒會壓掉異議。新證據、更正、驗收失敗需有明確入口，且能顯示未處理請求。
- **整合者成為瓶頸：** 唯一交付責任不妨礙子工作並行；需要代管、交接與部分交付規則。
- **把版本變化當進步：** hash 只標識內容；進度依驗收項、證據和依賴解除評估。普通 comment 不重置停滯的現有性質需保留。
- **記憶污染評審與人格：** 親歷、他人主張、本人推論與正式成果保持來源邊界；反思無權自行改變權限、身分或公開範圍。

此次能支持的是：這組修改有具體來源、對應現行程式的實際缺口，也有可反駁的驗收方式。尚不能支持「一定節省多少成本」「一定提高合作品質」或「已完整模擬一個人」。

資料契約、喚醒決策表、模組職責、工作包依賴與遷移方式，見後續 [結構化方案](2026-09-28-group-chat-structured-plan.md)。
