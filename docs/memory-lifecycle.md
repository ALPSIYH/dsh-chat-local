# 個人記憶生命週期（0.18.0-local.1）

本版將個人記憶的索引、整理、休眠、明確抑制與容量控制接入實際插件。原始事件仍是證據來源；人格 Markdown、原始經歷、目前信念和對他人的 appraisal 分開保存。這些機制不等於已實現完整的人類記憶，也不證明真實模型具有穩定人格。

## 觀察、索引與自動整理

收到可歸屬於本人的文字觀察後，先持久化收據，再排入背景整理；預設合併 50 ms 內的通知，每批最多處理 8 個 Agent。查詢也會處理尚未整理的變更。`AgentMemoryIndex` 接收已驗證的來源版本及追加差量，來源被替換或恢復時重建該來源；暖查詢不再逐次對全部相關事件重新投影。

整理是 **extractive equivalence 去重**：同來源、同種類、完全相同內容雜湊的本人材料，召回時可合成一條代表記憶及重複數。不同人的材料、不同來源及不同內容不能合成同一事實；原始日誌保持不變。這不是語義摘要，不推理出新結論，也不自動改寫人格。代表條目保留來源、證據和觀察收據，完整歷史仍可從原始日誌追查。

個人索引是可重建的進程內快取，不保存為新的權威資料庫。重啟、首次讀取或快取淘汰後，仍要讀取並驗證相關來源。日誌層另有已驗證來源快取；來源簽名、head 或版本改變會使原視圖失效。索引上限與日誌快取上限是兩套資料預算，**不是整個 Node 程序的 RSS 上限**。

召回按文字匹配、相關對象、釘選和觀察時間排序，保留確定性的來源／證據次序。沒有向量搜尋或模型語義重排。預設每次最多檢查 2,000 個候選；達上限、來源不可用或權威資料不完整時明示 `partial`。`totals` 是本次已檢查且符合條件的候選數，不能當作全歷史精確總數。`limit` 同時限制 experiences、judgements、beliefs 的合計條數；完整 JSON 另受 byte 上限約束，`omittedByBudget` 包含各次限額省略，`serializedBytes` 是實際序列化長度。

## 休眠與抑制

預設啟用可逆的召回衰減，半衰期 30 日，活化程度為 `2^(-age/halfLife)`；低於 0.2 的未釘選項目成為 dormant。這是工程預設，未經真實使用或心理學資料校準。時間使用日誌記錄的觀察 `at`；邏輯時間可領先牆鐘，因此不能把它解釋為精確心理時間。

- **active**：可進入預設注入和查詢候選，仍受來源、排序及容量限制。
- **dormant**：預設注入省略；`chat_recall` 的相關明確查詢可再次取出。
- **pinned**：抵抗時間衰減並提升優先度，但不繞過權限、來源失效、reset 或輸出預算。
- **suppressed**：明確查詢也不能取出；須明確 restore 才恢復候選資格。這不刪除原始證據。

再次實際看到材料可更新接觸時間；讀回本插件的摘要或個人查詢結果不構成新觀察。reset、撤回、恢復後的來源版本與抑制規則在查詢、提示注入和 belief 證據核驗時共同生效。某個控制來源不可讀時，不得從另一份快取把已抑制內容復活。

## 本人記憶操作與目前信念

`chat_memory_update` 以執行工具的 Session 解析本人身分，接受 `action` 和唯一 `operationId`。同一操作重試返回既有結果；同鍵不同內容拒絕。可用操作：

| action | 必要資料 | 行為 |
| --- | --- | --- |
| `pin` / `unpin` | `sourceRoomId`、`evidenceId` | 調整本人已觀察材料的召回優先度 |
| `suppress` / `restore` | `sourceRoomId`、`evidenceId` | 停用／恢復該材料的召回資格 |
| `belief` | `claim`、1–8 個原始觀察 `evidence` | 記錄本人目前的待核查結論 |
| `belief` 加 `supersedes` | 原 belief id 及新主張／證據 | 追加修訂，舊信念不再是目前信念 |
| `revoke_belief` | `beliefId` | 追加撤回；保留歷史 |

`evidence` 每项是 `{sourceRoomId,evidenceId}`。主張最多 2,000 UTF-16 碼元；證據必須本人實際見過，不能以另一條信念或主觀 appraisal 代替原始材料。寫入保留內容 hash 與觀察收據；再次讀到同內容不會令原來仍有效的證據失效，真正 reset、替換、抑制或刪去原收據則會使該信念失去有效支持。`belief` 是本人解釋，不是已驗證事實，亦不自動變成對別人的評價、工作指令或授權。

操作只追加 `memory.control`／`memory.belief` 事件，不修改人格或原始文本。活動群聊操作仍綁定當前房間、回合及 reset 範圍；省略房間不能繞過這些限制。

## 容量與冷檔

同一服務的狀態、事件、人格、備份、導出及維護寫入共用 `StorageCapacity`。入場與結算串行；實際 I/O 可並行，但預估峰值和已提交的待發布義務持續佔用額度。容量不足會拒絕新增工作，不以丟棄證據換取成功回覆。既有超額資料可讀；完成已提交義務可動用恢復預留，健康資訊記錄超額債務。

| `storage` 設定 | 預設 |
| --- | --- |
| `softBytes` | 1 GiB，回報壓力 |
| `hardBytes` | 2 GiB，限制新寫入 |
| `recoveryReserveBytes` | 128 MiB，保留給既有義務完成 |
| `minFreeBytes` | 16 MiB，普通寫入須保留的磁碟空間 |
| `agentObservationBytes` | 256 MiB，每 Agent 歸屬事件的邏輯 bytes |

容量計算是檔案邏輯大小，不是磁碟 blocks；每人額度按带 `observerAgentId` 的事件計費，不代表已精確分攤人格、每份共享檔案和所有程序記憶體。跨進程或其他軟體可改變磁碟；沒有跨進程配額鎖。請使用專屬狀態目錄，不要將無關大型檔案放入其下。

本機管理 API `POST /api/dsh-chat-local/storage/maintain` 接受：

```json
{"sourceRoomId":"實際房間或原生觀察來源 id","action":"archive"}
```

`action` 可為 `archive`、`thaw`、`cleanup`。它不註冊為 Agent 工具，沿用本機管理 API 的存取邊界，**不認證本地呼叫者**。

`archive` 對整個來源作無損 gzip，保存壓縮檔、校驗過的 `.jsonl.cold` manifest、原始 bytes/hash、事件數和 head。manifest 持久生效後才清空熱 `.jsonl`，後者保留作來源發現入口。冷讀須先核驗內容；追加前需整份 thaw 回熱日誌。`cleanup` 只在目前來源驗證成功後移除不再被 manifest 引用的生成壓縮副本，不刪目前證據。房間快照、離線驗證和評測使用共同冷檔讀取入口。

目前是**手動、整份來源壓縮**，不是自動分段輪替、按需分頁或保留期刪除。單次 archive 預設拒絕超過 256 MiB 的來源；冷讀解壓存在 2 GiB 上限。冷讀／thaw 仍須完整解壓和足夠暫存空間；因此不能藉冷檔宣稱固定讀取成本。原始歷史和人格歷史沒有自動物理刪除策略。容量不足時須由管理者調整容量或維護資料，插件不偷偷裁剪它們。

## 設定與健康觀察

插件 `memoryLifecycle` 預設：

```json
{
  "consolidation": true,
  "decay": true,
  "halfLifeDays": 30,
  "maxRecallBytes": 65536,
  "maxIndexBytes": 268435456,
  "maxAgentIndexBytes": 268435456,
  "maxCandidateCount": 2000
}
```

每人索引使用量還受目前參與快取的 Agent 數量分攤全域預算，因此 `maxAgentIndexBytes` 不是最低保留額度。上述為可重建資料的計算額度；淘汰後需重新讀來源。`personalMemory:false` 停用個人召回／注入、原生觀察及記憶更新，不停用人格，也不刪除已存資料。`appraisalDigest:false` 停用自動注入 appraisal，並不撤銷它。

`GET /api/dsh-chat-local/health` 的 `audit` 包含：

- `storage`：已用、預留、待發布義務、恢復債務、每人計費、拒絕／失敗及壓力。
- `memory.index`：來源、條目、計算用 bytes、候選工作量、淘汰和權威資料缺口。
- `memory.maintenance`：背景整理次數、失敗與排隊狀態。
- `memory.coverage`：本進程收到的文字觀察收據／失敗、未綁定或歧義身分、非文字事件和排除的回讀。

coverage 是 **this-service-process** 計數，重啟重新計算；不掃描掛載前原生歷史，不提取圖片／音訊內容，也不知道宿主未發給插件的事件。`memory_incomplete` 揭露本進程已知的收據失敗；零失敗或 `ok` 不是所有現實經歷完整的證明。外部模型收到內容與本地收據落盤仍不是同一個原子事務。

## 測試與驗證界限

```sh
node --test --test-timeout=45000 test/agent-memory-index.test.js test/memory-index-independent.test.js test/memory-lifecycle-service.test.js
node --test --test-timeout=45000 test/persona-longitudinal.test.js
```

索引反例測試涵蓋跨來源抑制、snapshot override、來源失效、reset、重讀證據、信念修訂、容量淘汰與省略計數。人格工具提供兩人各 12 個持續工作 episode、三個 Session、兩次重啟、0/3/6/12 凍結 checkpoint；probe 只在副本執行，不能流回主軌跡。完整方法見 [縱向人格試驗](persona-longitudinal.md)。32 次真實請求的實測結果由對應 run 檔案另行報告，本文不預先宣稱完成或人格已通過驗證。

仍未完成：語義層自動歸納與矛盾解析、非文字知覺記憶、掛載前歷史的授權導入、分段冷檔／大來源分頁、物理刪除與保留期治理、多寫入程序協調，以及足夠獨立軌跡和人工盲評支持的人格穩定性結論。
