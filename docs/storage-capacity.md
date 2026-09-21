# 儲存容量、已驗證讀取與冷檔

本文件說明儲存層的契約與限制。安裝、備份、故障處理及維護步驟見[運維指南](operations.md)；個人記憶的整理與召回規則見[記憶生命週期](memory-lifecycle.md)。

一個狀態目錄由**一個服務實例**擁有。狀態、事件、人格、匯出、備份及維護寫入共用同一個 `StorageCapacity`。這不是跨程序鎖；不可讓多個 DSH 程序共用目錄寫入。其他程式仍可耗盡磁碟或修改檔案，容量預留不能排除實際 I/O 失敗。

## 容量設定與計費範圍

下列為插件設定中的 `storage` 欄位；單位都是 bytes，必須是非負安全整數。`softBytes` 與 `recoveryReserveBytes` 均不得大於 `hardBytes`。1 MiB = 1,048,576 bytes；1 GiB = 1,073,741,824 bytes。

| 欄位 | 預設 | 含義 |
| --- | ---: | --- |
| `softBytes` | 1 GiB | 達到此量時回報軟壓力，不單獨拒絕寫入 |
| `hardBytes` | 2 GiB | 一般容量上限；普通寫入還須扣除恢復預留 |
| `recoveryReserveBytes` | 128 MiB | 留給已提交義務與恢復程序的空間 |
| `minFreeBytes` | 16 MiB | 普通寫入完成預留後，檔案系統至少須剩餘的空間 |
| `agentObservationBytes` | 256 MiB | 每個 Agent 歸屬事件的邏輯大小上限 |

```json
{
  "storage": {
    "softBytes": 1073741824,
    "hardBytes": 2147483648,
    "recoveryReserveBytes": 134217728,
    "minFreeBytes": 16777216,
    "agentObservationBytes": 268435456
  }
}
```

全域計費範圍是 `path` 所指 rooms.json 的父目錄及其子目錄，包含狀態、事件、待恢復意圖、備份、匯出、人格歷史、暫存檔、壓縮檔及操作收據。把外部備份放在這個目錄內仍會計入額度。計量使用檔案**邏輯大小**，不是磁碟實際配置的 blocks；symlink 只計連結本身的大小，不追蹤目標。檔案系統剩餘空間另外使用可用 blocks 檢查。

每人額度計算帶有 `payload.observerAgentId` 的事件行 bytes，跨房間與原生觀察來源累加。沒有此歸屬欄位的共享訊息只計全域額度；人格 Markdown 也由全域額度管理。冷檔壓縮可降低全域檔案用量，但**不降低每人原始觀察的邏輯計費**。重啟或來源簽名改變時重新讀取計費；已知追加則增量更新。待發布 outbox 中的本人觀察也預留每人額度。

## 寫入准入與恢復預留

內部介面為：

```js
capacity.run(
  { peakBytes, recovery, claimId, obligations, agentId, agentBytes },
  operation
)
```

准入與結算依序執行，先預留此次 I/O 的額外檔案峰值，再執行實際寫入。I/O 本身不佔住全域准入佇列，因此不同房間不會因等待容量鎖而與 restore 互相等待。在途預留持續計費；已經寫到磁碟的部分可能同時出現在實際用量和預留中。這種保守計算可能暫時拒絕一個稍後重試可完成的操作。

普通寫入必須使「目前用量＋在途預留＋待發布義務＋本次峰值」不超過 `hardBytes - recoveryReserveBytes`，並保留 `minFreeBytes` 的檔案系統可用空間。因此預設不會一直寫滿 2 GiB 才拒絕；備份、暫存新檔、冷檔封存／解封的峰值也可能先觸及限制。

`RoomJournal` 把狀態和未發布事件義務一起原子保存。成功替換狀態檔時，未來事件發布的容量義務隨之生效；發布得到確認才釋放。重啟從帶校驗值的 outbox 重建這些義務，不依當下狀態猜測原事件。

恢復已提交操作及 checkpoint 可使用恢復預留；即使目錄原本已超額，也可在此次恢復准入的有限預留內完成既有義務。健康資訊中的 `recoveryDebtBytes` 是目前實際用量超過 `hardBytes` 的部分。這個例外不供新投遞、一般備份或新觀察使用。降低額度不會刪除既有資料；既有來源仍可讀，但啟動若還需建立人格、遷移備份等新檔，仍可能因准入不足而失敗。

## 拒絕、錯誤與健康資訊

全域額度不足使用 `STORAGE_CAPACITY`；本人觀察超額使用 `AGENT_STORAGE_CAPACITY`。若來源損壞或不可讀，無法確認每人計費，則拒絕**新增本人計費**並暴露底層計費錯誤碼。沒有新增本人計費的狀態變更，以及已提交觀察義務，仍可在全域限制內保存／恢復；不能因此把破損來源當成可引用證據。

實際 I/O 仍可能出現 `ENOSPC`、權限或其他錯誤。`EventLog.append()` 回傳 `null` 不代表持久化成功。狀態檔在 rename 前失敗時仍以舊檔為權威；rename 已完成而目錄 fsync 失敗時，新檔已生效，journal 回報 `syncError`，不能倒退成未提交。沒有配額政策會靜默刪除原始證據。

`GET /api/dsh-chat-local/health` 回應的 `value.audit.storage` 包含：

| 欄位 | 解讀 |
| --- | --- |
| `usedBytes`、`freeBytes`、`checkedAt` | 最近一次計量的目錄用量、磁碟可用量和時間；不是 GET 當下重新掃描 |
| `reservedBytes`、`obligationBytes`、`obligations` | 在途預留，以及已提交待發布義務 |
| `agentObservationBytes`、`agentObservationLimitBytes` | 各 Agent 已知計費及每人上限 |
| `agentAccountingError` | 本人觀察計費是否無法確認 |
| `recoveryDebtBytes` | 已有資料超過硬限額的 bytes |
| `pressure` | `normal`、`soft` 或 `hard`；最近錯誤／計費錯誤也可使其為 `hard` |
| `rejected`、`failed`、`lastError` | 本程序的拒絕次數、已准入操作失敗次數及最近錯誤 |
| `active` | 是否有尚未結算的預留 |

`pressure` 是健康訊號，不是下一次寫入的准入保證；實際准入還檢查在途峰值、每人額度與磁碟空間。完整健康狀態的優先順序與處置見[運維指南](operations.md#啟動後與日常健康檢查)。

## 已驗證來源與追加差量

`EventLog.readView(roomId, { after })` 和 `RoomJournal.readEventView(roomId, { after })` 回傳：

```js
{
  verified: true,
  revision: { generation, count, head },
  baseRevision: previousRevisionOrNull,
  appendOnly,
  events
}
```

首次讀取或來源替換時，`events` 是完整來源；只有 `appendOnly: true` 時才是相對 `baseRevision` 的新事件。沒有變更時為空陣列。事件、陣列及版本物件不可變。

首次讀取及外部檔案變更後，重新核驗整條事件鏈。本實例完成的持久追加保留 generation 並更新快取；每次暖讀仍檢查裝置、inode、size、奈秒 mtime／ctime，以及 head、冷檔 manifest 和壓縮來源的簽名。替換、冷熱狀態切換、淘汰或重啟會產生新 generation。待恢復意圖或壞來源不能返回舊快取證據；`RoomJournal` 再隔離已提交但尚未發布的 outbox。

EventLog 快取以 LRU 淘汰，預設按來源序列化大小限額 256 MiB。`clearCache()` 只移除可重建來源快取，下次讀取重新驗證；它不是 HTTP 或 Agent 工具。`cacheBytes` 是 EventLog 建構參數，未暴露成插件 `storage` 設定。健康欄位有 `fullReads`、`viewHits`、`cacheSourceBytes`、`cacheEvictions`。

個人記憶索引另有 `memoryLifecycle.maxIndexBytes` 等額度。兩種額度均不是 Node 的 RSS／V8 heap 硬上限：字串、物件、Map、解壓及驗證緩衝區另佔記憶體。也沒有跨程序快照鎖；離線驗鏈對活動目錄的讀取仍可能遇到不同時點的狀態／日誌／anchor，應依運維流程使用停寫副本。

## 無損冷檔

`EventLog.archive(roomId, { maxBytes: 256 * 1024 * 1024 })` 對整份已驗證來源 gzip 壓縮；省略選項也使用此上限。先持久保存唯一壓縮檔並驗證解壓結果，再持久發布 `<source>.jsonl.cold` manifest，最後把熱 JSONL 清空。空 `.jsonl` 保留作來源發現入口；不是日誌已被刪除。

manifest 記錄 codec、原始長度、內容 hash、事件數、head 及壓縮檔 basename；checksum 覆蓋這些欄位。拒絕路徑穿越。既有 `.head` 仍參與核驗。讀取先核對解壓長度／hash、事件數／head；已驗證視圖還須核驗鏈。SHA-256 與 checksum 提供可檢查的一致性，**不是加密、身分認證或防止有權改檔者重算整條鏈的機制**。

manifest 發布前中斷時，原 JSONL 仍為權威；發布後則以已核驗冷檔為權威，即使熱副本尚未清空。一般讀取不修復、不刪檔。manifest 或壓縮檔損壞／缺失會拒絕讀取，不退回不明完整性的熱副本。

`thaw(roomId)` 在切回熱來源前核對完整鏈、manifest 範圍及 anchor；寫入並同步熱檔後再次核驗，才撤除冷 manifest。追加會自動解封，完整熱檔的暫存峰值也須通過准入。restore 經既有替換意圖寫入所選來源，再撤除舊冷 manifest，避免恢復前證據重新出現。

`cleanupArchives(roomId)` 先驗證目前來源，只移除未被目前 manifest 引用、符合生成命名規則的 gzip 副本。它保留目前權威冷檔／熱證據，也不清除一般狀態暫存檔。中斷封存或解封留下的舊壓縮副本可用此方法整理。

目前是手動、整份來源維護，沒有分段隨機讀取或自動保留期刪除。封存需同時持有原文、壓縮及驗證緩衝區；已封存來源追加時需整份解封。預設 archive 超過 256 MiB 會回傳 `archived: false, reason: "archive-size-limit"`；現有冷檔重新封存不受這項新封存大小判定影響。冷讀解壓上限為 2 GiB。這些是來源大小界限，不是精確峰值記憶體保證。

管理 HTTP 介面只接受 `sourceRoomId` 與 `action`，不接受 `maxBytes` 或任意路徑；具體維護步驟見[冷檔維護](operations.md#冷檔維護)。壓縮降低可壓縮來源的檔案佔用，不改變證據內容、召回抑制規則或每人原始觀察額度，也不保證歷史可以無限增長。

## 回歸測試與適用界限

`test/storage-capacity.test.js` 涵蓋並行准入、恢復預留、I/O 錯誤、拒絕後狀態不變、每人分離／重啟／冷檔計費與不同房間的活性；`test/event-view.test.js` 涵蓋不可變差量、restore／外部變更失效與 outbox 隔離。冷檔測試涵蓋透明讀取、損壞、restore、manifest 範圍、孤立副本清理，以及封存／解封／restore 六個子程序 SIGKILL 邊界。

這些有限回歸不構成硬體斷電、磁碟控制器快取、網路檔案系統或惡意多寫入器的證明。檔案檢查與打開之間仍有 TOCTOU 窗口；使用專屬資料目錄和單寫入程序，保留獨立備份。
