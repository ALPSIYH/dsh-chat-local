# 房間記憶實驗與描述性評測

插件可以記錄房間的記憶條件、人工干預、實際注入與互動結果，再從事件日誌產生描述性報告。它不負責隨機分派，也不會因樣本數達標就宣告因果效果或人格穩定。

[文件總覽](README.md) · [使用指南](guide.md) · [人格縱向手冊](persona-longitudinal.md) · [運維](operations.md) · [記憶架構](agent-memory-architecture.md)

## 選擇要做的試驗

| 問題 | 工具 | 記憶條件 |
| --- | --- | --- |
| 房間在累積或重置插件記憶時，互動記錄有何差異？ | run manifest、人工干預 API、`relationship-eval.mjs` | `persistent`、`reset_per_episode` |
| 同一 Agent 跨 Session、工作與重啟後，能否使用本人記憶？ | `persona-longitudinal.mjs` | `disabled`、`raw`、`consolidated`、`decay`；另可用 `current` |

兩套條件名稱不能互換。人格試驗的 32 次請求、四臂、fake adapter 與 checkpoint 隔離方式，見[縱向試驗手冊](persona-longitudinal.md)。

## 先分清三種記錄

| 記錄 | 表示什麼 | 不表示什麼 |
| --- | --- | --- |
| 房間運作計數（C 層） | 某位成員在本房間留下的結構化事件 | 觀察者對他的私人信任或人格 |
| 主觀評價 appraisal（A 層） | 本人寫下的立場、把握、主張與證據 | 房間已確認的客觀事實 |
| 本人記憶 | 該穩定身分實際看過或自己產生的材料 | 全房間、所有檔案或其他人的全部經歷 |

### 房間的十個計數

同一對象在各觀察者行下的 C 計數相同；這些數字描述對象在本房間的運作記錄。

| 計數器 | 記錄內容 |
| --- | --- |
| `deliveriesOffered` | 發給該成員的投遞 |
| `deliveryFailures` / `deliverySuccesses` | 投遞失敗與成功到達 |
| `reviewsApproved` / `reviewsChangesRequested` | 該成員親自提交的驗收結論 |
| `blockedReports` / `blockedConfirmed` | 報告的阻斷與後續確認，按事項配對 |
| `unresolvedDisagreements` | 尚未閉環的分歧 |
| `charterProposalsSuperseded` | 該成員提出、後來被取代的章程提案 |
| `messagesAuthored` | 該成員署名的房間訊息 |

`lib/relationship.js` 依事件前綴純函式派生，事件按 `(tick, at, id)` 排序。每回合的 `relationship.snapshot` 保存當次結果，提示詞與治理門使用同一次取樣。`GET /api/dsh-chat-local/rooms/:id/relationships` 回傳各對最近保存的快照；沒有可讀快照時為 `{}`，不是已觀察到的零。

治理門預設關閉，開啟後只收緊工具執行。是否開啟及房間動作模式都應固定並記錄，避免把權限差異誤當成記憶差異。操作方式見[使用指南](guide.md)。

### 記錄與撤銷本人評價

Agent 可在有效、未被取代的本房間回合使用 `chat_appraise`：

| 欄位 | `record` 的要求 |
| --- | --- |
| `room` | 房間名稱或 ID |
| `aboutAgentId` | **目標成員的 Session ID**；這是現行 API 的歷史欄名，不能填任意穩定 Agent ID |
| `stance` | `trust`、`distrust` 或 `neutral` |
| `confidence` | 0–1 的數值 |
| `claim` | 本人寫下的主張，最多 2,000 個 UTF-16 碼元 |
| `evidenceEventIds` | 工具接受 1–32 個本房間事件 ID，且材料必須已被本人觀察或由本人署名 |
| `perceivedRole` | 選填的角色判斷 |

先用 `chat_memory` 或 `chat_read_document` 讀取相關材料，可留下觀察收據；只知道某個 ID 存在不代表有權引用，其他人的私人 appraisal 也不能充當自己的證據。不能評價自己。

撤銷使用 `action: "revoke"`、`room`、`aboutAgentId`，可附 `chat_relationships` 回傳的現行 `appraisalId`。撤銷會追加事件並保留舊記錄。新評價同時保存 Session 與穩定 Agent 身分；主觀評價不增加 C 計數，也不改寫人格。

`chat_relationships` 只回傳呼叫者自己的計數行與現行評價。管理 API 的 `GET /rooms/:id/relationships` 和 `GET /rooms/:id/appraisals` 可讀完整矩陣，路徑前綴均為 `/api/dsh-chat-local`。本地管理 API 不認證呼叫者；Agent 工具的私人隔離不等於對有本機檔案或管理 API 存取權的程序保密。

## 開始一段房間試驗

建議流程：

1. 用獨立試驗房間及資料目錄，固定成員、人格、章程、模型、權限與記憶設定。
2. 房間空閒時建立 run manifest；一次 run 是兩個 manifest 之間的日誌片段。
3. 讓成員實際接收提示並互動。只有建立 manifest、空跑或投遞失敗，都不構成已到達成員的互動。
4. 保存原始提示、事件與設定；如需人工干預，先停止回合並記錄干預原因。
5. 在停寫的完整狀態目錄副本上校驗及評測，將原始資料與報告一起保存。

### 建立 manifest

向目前 DSH 的本地 API 送出：

```http
POST /api/dsh-chat-local/rooms/:id/run-manifest
Content-Type: application/json

{"arm":"persistent","appliedBy":"human"}
```

`arm` 的行為如下：

| 條件 | 行為 |
| --- | --- |
| `persistent` | 累積插件記憶投影；沒有 manifest 時也採此行為，但評測仍需要 manifest 切分 run |
| `reset_per_episode` | 每個根訊息 episode 開頭追加一次版本化的全記憶 `clear`；同一 run 重試該根訊息不重複清除 |

manifest 由執行環境讀取模型，不接受呼叫者自報模型。它記錄模型／推理設定、狀態版本、配置內容與 `configHash`；未知模型為 `null`。這兩個實驗寫入端點不是 Agent 工具，且房間有回合執行時會拒絕。`appliedBy: "human"` 是呼叫聲明，不是本地身分認證。

**重置只作用於插件記憶投影。** 它關閉房間 C/A 的舊窗口，並將該條件下的個人查詢／注入限定為本房間、本 episode 後實際觀察的材料。不刪除原始日誌、不清空人格、不清空 DSH 原生上下文，也不移除共享對話歷史；成員仍可能從當前提示或重新讀取歷史得到舊內容。因此 reset 不能被解讀成「沒有記憶的人」或獨立對照。

### 人工干預

全房間清除插件記憶窗口的例子：

```http
POST /api/dsh-chat-local/rooms/:id/relationship-intervention
Content-Type: application/json

{
  "appliedBy": "human",
  "mechanism": "manual-pre-registered-reset",
  "action": "clear",
  "memoryScope": "all",
  "note": "在下一個 episode 前按預定流程重置"
}
```

| 欄位 | 規則 |
| --- | --- |
| `appliedBy` | 必須為 `human` |
| `mechanism` | 必填的機制名稱，最多 200 碼元 |
| `action` | `clear`、`set`、`seed` |
| `memoryScope` | 預設 `counters`，只改 C；`all` 僅允許全房間 `clear` |
| `targetId` | 選填的本房間成員 Session ID，縮小計數干預對象 |
| `observerId` | 選填，只記錄呼叫意圖，不將對象計數變成觀察者的私有值 |
| `counters` | `set`／`seed` 使用的非負整數；只接受上表計數器名稱，未列的計數從零開始 |
| `note` | 選填說明，最多 2,000 碼元 |

`clear` 不能帶 `counters`。`memoryScope: "all"` 不能指定 `observerId` 或 `targetId`。`seed` 與 `set` 的計數效果相同，前者用來表達初始條件；兩者都開啟新的計數窗口，不偽造過去互動。事件保留干預前的 `countersBefore` 與舊日誌。

## 配置、注入與資料保存

| 記錄 | 可以核對的內容 |
| --- | --- |
| `run.manifest` | 該段試驗宣告的條件、模型與配置 |
| `relationship.snapshot` | 當回合取樣的關係計數與配置 |
| `turn.prompt` | 實際準備投遞的完整提示詞及 hash |
| `injection.cost` | 關係摘要、個人摘要、人格的字元數與估算 token；投遞前模型快照 |
| `delivery.settled` | 是否真正到達成員及後續結果 |

成本事件是在投遞前寫入，單有它不代表成員已收到。評測會以 `deliveryId` 連接已到達狀態；token 估算也不是供應商帳單。

`configHash` 涵蓋房間指令、成員標籤／職責、治理門、記憶開關、人格 hash、渲染／派生版本，以及明確列出的本地模組原始碼。註解或排版也可能拆分原本相近的組別。第三方依賴、宿主全部提示詞、模型隱藏狀態與隨機性不在此指紋內。

每次投遞前的 `modelAtDelivery` 與 manifest 模型會被比較，但這只觀察投遞前設定，不能證明生成期間完全不變。評測會報告或排除配置漂移、已知模型變動、無效測量及已開啟卻不可用的記憶；缺少完整逐投遞欄位的舊資料標為 `legacy-unverified`。相同 hash 不等於完整實驗條件相同。

校驗停寫後的完整資料副本：

```bash
node scripts/verify-event-log.mjs ROOM_ID --state /path/to/copy/rooms.json
```

房間 snapshot API 與全資料目錄備份用途不同：前者不包含其他房間、人格檔或全部原生個人記憶。導出、恢復與健康檢查見[運維](operations.md)，持久化邊界見[記憶架構](agent-memory-architecture.md)。

## 執行描述性評測

```bash
# 查看參數
node scripts/relationship-eval.mjs --help

# 小樣本觀察；只讀資料
node scripts/relationship-eval.mjs \
  --state /path/to/copy/rooms.json --observation

# 預設門檻及 JSON 報告
node scripts/relationship-eval.mjs \
  --state /path/to/copy/rooms.json --json

# 限定一個房間，並提高門檻
node scripts/relationship-eval.mjs \
  --state /path/to/copy/rooms.json --room ROOM_ID --min-runs 20 --json
```

省略 `--state` 時會讀 `~/.dsh/dsh-chat-local/rooms.json`。為了清楚區分正式資料與試驗副本，試驗命令應明確指定路徑。

### 分組與報告門檻

評測按 `(arm, configHash, initialStateVersion, models)` 分組；有記錄的 `reasoningEffort` 也參與分組。provider／model 未知的 run 不會與其他 run 合併。

預設每組至少需要 **10 個有效、且有已到達成員互動的 run 片段**，才展示跨 run 統計。每項指標也需要足夠的有效觀測：十段對話不代表十次驗收。空 run、只有成本事件或失敗投遞不能滿足互動門檻。

`--observation` 允許小樣本描述統計，無論多少樣本都維持觀察模式。`--min-runs` 只能提高預設門檻，不能降低。報告始終標記 `descriptive-only`、`independence: "unverified"`，不輸出因果結論。

### 指標的含義

| 指標 | 計算口徑 |
| --- | --- |
| `handoffSelection` | 台帳記錄的負責人選擇／改派；重複寫相同負責人不多算 |
| `reviewRejectionRate` | `request_changes / (approve + request_changes)`；沒有驗收則缺失 |
| `refusedActions` | 治理門記錄的拒絕次數，不是所有宿主或模型拒絕 |
| `unresolvedDisputes` / `unresolvedDisputeMeanTicks` | run 結束仍未關閉的分歧數，以及從建立到末 tick 的平均長度 |
| `injectedDigestCharsTotal` / `injectedDigestCharsMean` | 已到達投遞中的關係摘要字元數；不等於整條 prompt 成本 |
| `injectedTurns` / `unreachedInjections` | 已到達的注入回合，以及有成本記錄卻未證實到達的注入 |

時長單位是 **tick**，不是牆鐘時間。事件 `at` 是排序時間戳，突發寫入可能領先牆鐘，不適合直接當作行為時長。

報告同時列均值、有效觀測數、缺失數和樣本離散程度；缺少驗收、交接或分歧的分母記為缺失，不填零。樣本方差用 `n−1`，只有一個有效值時為空。這些離散程度不是已驗證獨立抽樣下的推論誤差。

### 退出碼

| 碼 | 含義 |
| --- | --- |
| 0 | 已產生描述性報告 |
| 1 | 參數／讀取錯誤，或報告排除了無效輸入 |
| 2 | 找不到有效 run |
| 3 | 未達預設描述性報告門檻 |

沒有有效 run 或門檻不足時，2／3 優先於無效輸入的 1；所以也要讀 JSON 的 `invalid`、`skipped`、`dataQuality` 和 `contractCoverage`。日誌鏈損壞會被列出；房間歸屬不符的事件不納入該房間的 run。

## 如何解讀結論

`sample-ready` 只表示報告數量門檻已滿足。同一房間的多段 run 可能共享歷史，不同房間也不自動成為獨立樣本；只提供一臂時沒有臂間比較。

若要研究因果效果，需另行設計分派、對照、獨立或配對單位、歷史污染控制、結果指標與分析方法。若要評估人格，需另作工作品質與風格盲評，不能用投遞成功、關係計數或三欄事實分數替代。相關方法見[人格縱向手冊](persona-longitudinal.md#評分與結論)。
