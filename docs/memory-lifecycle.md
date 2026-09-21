# 個人記憶的使用與生命週期

Agent 可以回想跨工作中本人實際見過的文字、本人輸出、目前信念及對他人的評價。人格由獨立 Markdown 設定；記憶操作保留來源，不自動改寫人格。本文說明召回、整理、衰減與控制。內部資料流見[架構文件](agent-memory-architecture.md)，部署、儲存配置與健康診斷見[維運指南](operations.md)。

## 查詢本人的記憶

`chat_identity` 讀取本人身分與人格；`chat_recall` 查詢本人有權讀取的記憶，例如：

```json
{"query":"測試報告 驗收","limit":12}
```

`query` 最多 2,000 個 UTF-16 碼元；`limit` 為 1–100，預設 24，合計限制 `experiences`、`judgements`、`beliefs` 三類條目。可選 `room` 接受本人參與房間的確切名稱或 ID，用來消除 Session 綁定歧義。活動群聊仍使用當前房間與 reset 範圍，省略房間不會解除限制。

回傳的 `sourceRoomId`、`evidenceId` 和觀察收據標示材料出處。本文的「原始觀察」包含本人曾收到的文字及本人輸出；材料的真實性需另行核驗。

| 回傳資訊 | 如何解讀 |
| --- | --- |
| `status: available` | 本次查詢所需來源可用；條目仍可能受排序與預算限制 |
| `status: partial`、`unavailableSources` | 有來源、權威資料、快取或候選額度缺口 |
| `status: disabled` | 配置已停用個人記憶 |
| `totals` | 本次已檢查且符合條件的候選數，不是全歷史精確總數 |
| `coverage.omittedByBudget` | 因合計條數或 JSON 大小限制省略的數量 |
| `coverage.serializedBytes` | 完整回應實際序列化的 UTF-8 bytes |
| `truncated`、`sourceChars`、`recalledChars` | 文本是否截斷、原始與召回長度 |

每條經歷最多召回 2,000 個 UTF-16 碼元；文件及原生文字收據的保存摘錄最多 20,000 碼元，`chat_memory` 的單項結構化摘要最多 2,000 碼元。完整 JSON 含中繼資料，預設上限 64 KiB。字數與 bytes 是不同限制，含非 ASCII 文字時不可互換。

## 召回與整理

收到可歸屬於本人的文字後，插件先保存收據，再排入背景整理。通知以 50 ms 合併，每批最多處理 8 位 Agent；查詢也會處理尚未整理的變更。索引依已驗證來源版本增量更新，來源替換、恢復或重啟時重建。

整理採抽取式去重：同一 Agent、同來源、同種類、相同內容雜湊及相同本人／他人歸屬的材料，可用一條代表記憶和重複數呈現。評價另按對象分開。證據 ID、收據和原始日誌保留。不同內容不會被歸納成新結論，目前沒有向量搜尋、模型語義摘要或自動矛盾解析。

生命週期策略版本 2 的排序先使用詞項匹配與既有優先分數，再於同分時選擇直接觀察材料，接著才是本人陳述、belief 和 appraisal，最後以接觸時間及穩定來源／證據 ID 排序。較相關的本人陳述仍可優先。釘選與相關對象各有加分，因此這不是純文字相關度排序。

原生 `assistant/message` 明確標為 `authored`；群聊僅在有穩定 `authorAgentId` 時判斷 `authoredByObserver`，缺少作者身分的舊資料不靠名稱或措辭猜測。此偏好用於避免本人重述擠掉可查證來源，不保證外部材料正確。一般召回與固定來源快照使用同一比較器；當前問題和零匹配的活躍條目仍可能進入候選。

索引是可重建的進程內快取。預設每次最多遍歷 2,000 個候選，來源驗證、reset 與抑制先於回傳；到達候選上限時揭露 `partial`。來源或控制規則失效後，舊快取不能單獨恢復材料的可見性。

## 活躍、休眠、釘選與抑制

預設活化程度為 `2^(-age/halfLife)`，半衰期 30 日；低於 0.2 的未釘選材料進入休眠。年齡以觀察時間 `observedAt` 計算，缺少時使用 `at`。這些是日誌邏輯時間，可能領先牆鐘；30 日與 0.2 是工程預設，未經心理學或真實使用資料校準。

| 狀態或控制 | 召回效果 |
| --- | --- |
| `active` | 可進入預設摘要和查詢，仍受排序、來源及輸出預算限制 |
| `dormant` | 預設摘要省略；相關的明確 `chat_recall` 查詢可重新取出 |
| `pin` | 抵抗衰減並增加召回分數；仍遵守來源、reset、抑制和輸出預算 |
| `suppress` | 明確查詢也不返回內容，直到本人執行 `restore`；原始證據保留 |

再次實際看到材料可更新接觸時間，插件自己的摘要和已知個人查詢結果會被排除，避免重複記憶回流。釘選綁定有效觀察；reset 後的新接觸不能沿用已失效的舊釘選。raw 模式下，同文條目的釘選各自計算，不借用同組另一條的優先權。

## 記憶控制與目前信念

`chat_memory_update` 從執行 Session 解析本人身分，接受以下操作。每次提供 1–200 碼元的穩定 `operationId`；在相同身分與寫入來源下重試同一輸入會返回既有結果，同鍵不同內容會拒絕。重試時保留原房間和輸入。

| `action` | 必要資料 | 結果 |
| --- | --- | --- |
| `pin`／`unpin` | `sourceRoomId`、`evidenceId` | 調整已觀察材料的釘選 |
| `suppress`／`restore` | `sourceRoomId`、`evidenceId` | 停用／恢復召回資格 |
| `belief` | `claim`、`evidence` | 記錄目前的待核查解釋 |
| `belief` 加 `supersedes` | 原信念 ID，以及新主張與證據 | 追加修訂，返回新的 `beliefId` |
| `revoke_belief` | `beliefId` | 撤回本人目前信念，保留歷史 |

先從召回結果取得實際 ID，再填入操作。例如，以下佔位 ID 必須替換為本人可見材料：

```json
{
  "action": "belief",
  "operationId": "review-report-001",
  "claim": "依這份測試報告，目前仍有驗收項目待完成。",
  "evidence": [{"sourceRoomId":"來源 ID","evidenceId":"證據 ID"}]
}
```

`claim` 為 1–2,000 個 UTF-16 碼元；`evidence` 需 1–8 項，每項只提供 `sourceRoomId` 與 `evidenceId`。服務核驗本人可見性並補存內容雜湊及觀察收據。可引用本人已觀察材料，不能以另一條信念或 appraisal 替代原始支持。

信念表示本人的解釋。再次讀到同內容且原收據仍有效時，既有支持可繼續成立；reset、來源替換、抑制或原收據消失時重新核驗。修訂與撤回使用明確 ID 關係，避免來源載入順序使舊主張復活。這些操作不改寫原文，不授予工作權限。

活動群聊的記憶操作受當前房間、回合和 episode 邊界約束。`chat_appraise` 另用於對其他成員的主觀評價，其證據與有效回合要求見[架構文件](agent-memory-architecture.md#評價與信念)。

## 配置

在插件配置的 `memoryLifecycle` 下設定；未提供時使用以下值：

```json
{
  "memoryLifecycle": {
    "consolidation": true,
    "decay": true,
    "halfLifeDays": 30,
    "maxRecallBytes": 65536,
    "maxIndexBytes": 268435456,
    "maxAgentIndexBytes": 268435456,
    "maxCandidateCount": 2000
  }
}
```

| 參數 | 接受範圍 | 作用 |
| --- | --- | --- |
| `consolidation` | 布林值 | 合併同文候選及安排背景整理；關閉時返回各原始條目 |
| `decay` | 布林值 | 是否套用時間衰減；關閉仍遵守抑制和來源限制 |
| `halfLifeDays` | 整數 1–36,500 | 時間衰減半衰期 |
| `maxRecallBytes` | 整數 1,024–65,536 | 完整召回 JSON 的 byte 上限 |
| `maxIndexBytes` | 整數 4,096–2,147,483,648 | 全域個人索引計算額度 |
| `maxAgentIndexBytes` | 整數 4,096–2,147,483,648 | 單一 Agent 的索引額度上限 |
| `maxCandidateCount` | 整數 1–2,000 | 每次召回的候選遍歷額度 |

整數超出範圍會截到邊界，非安全整數使用預設值；非布林值也使用預設。正規化後的策略版本由程式提供，目前為 2，參與實驗配置指紋，不需手工設定。

每人索引額度還受目前快取中的 Agent 數量分攤全域預算，並無最低保留額度。來源按容量策略淘汰後可重新載入；索引額度與日誌已驗證快取分別計算，都不等於 Node 程序 RSS 上限。首次讀取、重啟或淘汰後的查詢仍需完整讀取相關來源。

插件頂層 `personalMemory:false` 停用個人召回、注入、原生觀察及記憶更新；人格仍可提供，既有資料和群聊審計收據保留。`appraisalDigest:false` 停用主觀評價的自動注入，保留顯式查詢與原事件。

## 容量與冷檔

狀態、事件、人格歷史、備份、導出和維護寫入共用儲存額度。容量不足時拒絕新增工作，已提交的發布義務使用恢復預留；不自動裁剪原始證據。每 Agent 儲存額度按帶 `observerAgentId` 的事件計費，與上述進程內索引額度不同。

管理者可手動將整份來源無損壓縮為帶校驗 manifest 的冷檔。讀取仍需完整解壓與驗證，追加前先還原熱日誌；預設 archive 來源上限為 256 MiB，解壓上限為 2 GiB。`cleanup` 只移除目前來源驗證成功後、不再被 manifest 引用的壓縮副本。原始歷史與人格舊版沒有自動保留期刪除。

儲存參數、`archive`／`thaw`／`cleanup` 管理入口和健康狀態見[維運指南](operations.md)；寫入預留與冷檔格式細節見[儲存設計](storage-capacity.md)。本機管理 HTTP 不認證本地呼叫者，應連同狀態目錄的存取範圍一起管理。

## 驗證與使用邊界

```sh
node --test --test-timeout=45000 test/agent-memory-index.test.js test/memory-index-independent.test.js test/memory-retrieval-priority.test.js test/memory-lifecycle-service.test.js
```

回歸涵蓋跨來源抑制、固定快照、reset、重讀收據、信念修訂、容量淘汰、排序及省略計數。`available`、健康 `ok` 或零收據失敗，只描述本次服務知道的狀態；掛載前歷史、非文字知覺、未送達插件的事件及寫入意圖持久化前的缺口仍可能存在。

目前尚未提供語義自動歸納、矛盾解析、非文字記憶、授權歷史匯入、分段冷檔、大來源分頁、保留期物理刪除或多寫入程序協調。人格 Markdown 的穩定注入也不能直接證明模型行為穩定；相關實驗需保留獨立軌跡與評估依據，見[縱向人格試驗](persona-longitudinal.md)。
