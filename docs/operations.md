# 安裝與運維

本文件依序說明安裝、升級、健康檢查、備份、驗鏈與恢復。資料格式、端點和設定以目前程式為準；不假定你的安裝已完成某次部署。日常群聊操作見 [README](../README.md)，容量內部契約見[儲存容量](storage-capacity.md)。

## 安裝與首次啟動

1. 準備 DeepSeek Harness 與 [`dsh-bridge`](https://github.com/baixianger/dsh-bridge)。`package.json` 宣告的 DSH 範圍是 `>=0.1.7-rc.2 <0.1.8-0`（已實測 `0.1.7-rc.2`），同時寫入原生載入器使用的 `peerDependencies` 與第三方安裝器使用的 `dsh.engines`；其他宿主系列須重新驗證。peer 設為 optional，避免 npm 額外安裝一份 DSH。使用與 DSH 相同的 Node 執行版本。
2. 安裝到實際使用的 profile。以下使用 `web`；GitHub 與本地 link 二擇一。

   ```sh
   dsh plugin --profile web add github:ALPSIYH/dsh-chat-local
   dsh plugin --profile web add link:/path/to/dsh-chat-local
   ```

   使用 link 時，目標是已備妥依賴的插件目錄；修改該目錄就會改變下次載入的程式。插件以 `cordis.patch.yml` 註冊，不需修改 DSH 原始碼。
3. 透過原本的啟動方式重新啟動 DSH。直接在終端機啟動時可用 `dsh web`；若由服務管理器執行，沿用該管理器，避免另開第二個寫入程序。重啟會中斷目前 Session 的插件執行。
4. 開啟側欄「群聊」，再執行下一節的健康檢查。首次使用既有資料會觸發遷移；請先閱讀升級流程。

## 資料位置與內容

預設狀態檔為 `~/.dsh/dsh-chat-local/rooms.json`；插件設定 `path` 可改變它。其父目錄就是容量計費與備份範圍，應專供此插件使用。目前狀態格式為 **17**。載入既有檔案時會將狀態目錄設為 `0700`、rooms.json 設為 `0600`；新建人格、事件等檔案使用受限權限，但這不是資料加密。

| 相對狀態目錄的路徑 | 用途 |
| --- | --- |
| `rooms.json` | 群組、房間、訊息、台帳、Agent 身分與 Session 關聯；可能含已提交待發布的 `_journal` |
| `rooms.json.v*.bak`、`rooms.json.pre-restore.bak` | 自動遷移／房間快照恢復前的狀態備份；不包含完整資料目錄 |
| `events/*.jsonl`、`.head`、`.pending`、`.operations` | 房間及原生觀察來源、head anchor、待恢復意圖、替換收據 |
| `events/*.jsonl.cold`、`*.jsonl.cold-*.gz` | 冷檔 manifest 及其引用的完整壓縮來源；熱 JSONL 可合法為空 |
| `agents/<SHA-256(agentId)>/PERSONA.md`、`history/` | 持續身分的人格 Markdown 及按內容 hash 保存的舊版 |
| `exports/` | 使用者要求保存的 JSON／Markdown 房間匯出 |

人格文字上限為 8,000 個 UTF-16 碼元；空白待設定模板不當作已配置人格注入。人格舊版與原始事件沒有自動保留期刪除。刪除房間是軟刪除，不會清除其日誌。

事件可包含原樣群聊提示詞、已觀察內容、人格與讀到的文件摘錄；它不是脫敏匯出。插件備份也不包含狀態目錄外的完整 DSH Session 儲存、模型憑證或被引用的原始檔案；需要整體災難復原時，須另外備份宿主自身資料與設定。

## 啟動後與日常健康檢查

將 `DCL_BASE` 設為實際 DSH 位址，勿假定固定 port。下面只讀取健康資訊：

```sh
DCL_BASE='http://127.0.0.1:PORT/api/dsh-chat-local'
curl --fail --silent --show-error "$DCL_BASE/health"
```

成功回應為 `{ "ok": true, "value": { "name", "version", "status", "stateVersion", "audit" } }`。`version` 讀取插件 `package.json`，`stateVersion` 應為 17。載入失敗時會回傳錯誤，而不是以空狀態冒充成功。

`status` 按下表由上而下判定；先解決較高順位不代表其他問題已消失。

| 狀態 | 目前判定依據 | 處理 |
| --- | --- | --- |
| `recovery_pending` | event pending、journal pending／checkpoint，或 journal 最近錯誤／syncError | 保留完整資料，檢查磁碟及錯誤；依故障恢復流程處理 |
| `capacity_limited` | `audit.storage.pressure === "hard"` | 查全域／每人用量、在途預留、計費錯誤、磁碟剩餘空間與最近 I/O 錯誤 |
| `memory_incomplete` | 已知觀察收據失敗、不可用來源、背景整理錯誤、索引淘汰或策略歷史缺口 | 查看對應欄位；召回可能為 `partial`，不可宣稱全部經歷可用 |
| `ok` | 未觸發上述訊號 | 仍需按需驗鏈與檢查詳細錯誤；不是完整歷史證明 |

另外查看 `audit.failed`、`droppedCount`／`dropped`、`lastError`、`journal`、`memory.coverage`、`memory.reads` 和 `storage`。GET 不會掃遍所有事件；容量數字以 `checkedAt` 為準，觀察 coverage 是本程序計數，不涵蓋宿主未傳送或插件掛載前的內容。重啟使部分計數重置，不等於補回資料。

健康端點使用穩定 ETag，正常用量／成功次數改變不一定更換 ETag。需要新的數值時不要附帶舊 `If-None-Match`；304 只適合判斷所選健康狀態是否變化。

## 原生會話的上下文與工具模式

參與者與 `chat_identity` 的 `nativeContext` 描述本程序最近一次提示組裝所見的能力：`available` 是宿主允許注入，`suppressed` 是預設停用，`unavailable` 是服務不可用，`not_observed` 是尚未觀察。這些值不證明模型採用了人格或記憶；修改預設後，需等下一次組裝才更新。健康資訊的 `audit.memory.nativeContext` 保留有界的能力計數，重啟會清空。

`minimal` 的 `includeRuntimeContext: false` 會停用原生人格／記憶自動注入。插件尊重此設定，群聊投遞中的摘要與 `chat_identity`／`chat_recall` 仍可使用。需要原生自動延續時，在參與者面板開啟會話並明確選擇支援執行期上下文的預設。

PTC 模式原本會將工具收合成 `run_code`，與群聊唯讀守衛衝突。受限群聊被宿主領取時，插件只在該回合暫用原生工具介面，結束或取消後釋放；`run_code` 仍不放行。原生 Team 的 `list_agents`、`team_task_list`、`team_task_get`、`wait_agent` 是該會話子團隊的工具，不是群聊成員與台帳的替代品。建立子成員不會自動授予群聊身分或繼承私人記憶。

## 升級：先停寫，再備份與預檢

1. 記錄目前插件版本／程式 revision、Node 與 DSH 版本、profile 設定、link 目標及自訂 `path`。等待回合完成或停止它們；記錄仍未完成的投遞、handoff 與啟用的 task monitor。
2. 用原啟動方式停止 DSH，確認沒有另一個程序寫入同一狀態目錄。停止後才建立下一節的完整備份。一般熱複製不是跨檔案一致快照。
3. 在獨立目錄準備候選版本與依賴，以相同 Node 執行版本檢查；從完整資料備份建立**副本**測試遷移。不要用候選程式直接開正式檔案試跑。首次載入即可能寫入，不必等使用者發訊息。
4. 核對副本的房間／群組／Agent 數量、訊息 ID／內容／次序、已完成投遞、備份與來源完整性；關閉後再次載入，確認沒有額外重播。可採用下方的隔離載入方式。
5. 預檢通過後更新實際 profile 使用的插件，仍只啟動一個 DSH writer。確認健康版本、schema 17、資料數量及恢復結果，再開始新工作。

目前載入流程可直接將 v15 正規化為 v17，無需先啟動 v16。遇到不支援的未來版本、無效頂層結構、歧義身分或不可恢復的已提交義務時會拒絕載入，不以空房間覆蓋原檔。其他歷史版本仍應用自己的資料副本驗證。

遷移會建立缺少的人格模板，並在改寫狀態前保存 `rooms.json.v<原版本>.bak`；無版本檔使用 `.vunversioned.bak`。部分意圖恢復及人格建立先於此備份，同名檔也可被後續遷移覆蓋，因此不能只依賴自動備份。不支援 v17 的舊版不能讀取這份新狀態；不要只把 JSON 的 version 改回舊數字。

啟動恢復會把 queued／running 回合、pending handoff 和未終止投遞標成中斷／失敗，保留原因，不自動重播舊任務。不過啟用且到期的任務監控可發送新提醒並喚醒 coordinator；維護前應核對監控設定。

### 完整備份

以下命令在**已停寫後**執行；將 `DCL_STATE_FILE` 設為實際插件 `path`。備份涵蓋該檔的整個父目錄，放在狀態目錄外，以免被容量計費，也避免複製到自己之中。範例拒絕不存在或為 symlink 的狀態檔；自訂連結佈署應先查清實際資料位置。`&&` 讓封存失敗時不繼續產生 hash；任何非零狀態都應先處理，不繼續預檢。

```sh
umask 077
DCL_STATE_FILE="$HOME/.dsh/dsh-chat-local/rooms.json"
DCL_STATE_DIR="$(dirname "$DCL_STATE_FILE")" &&
test -f "$DCL_STATE_FILE" &&
test ! -L "$DCL_STATE_FILE" &&
DCL_BACKUP_DIR="$(mktemp -d "$HOME/dsh-chat-backup.XXXXXX")" &&
tar -cpf "$DCL_BACKUP_DIR/state.tar" -C "$DCL_STATE_DIR" . &&
node --input-type=module - "$DCL_BACKUP_DIR/state.tar" > "$DCL_BACKUP_DIR/state.tar.sha256" <<'NODE'
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
const digest = createHash('sha256');
for await (const chunk of createReadStream(process.argv[2])) digest.update(chunk);
console.log(digest.digest('hex'));
NODE
```

另存上述版本與 profile 資訊。核對封存檔可解開、雜湊一致，並保留停寫來源的逐檔清單以比較複製內容；只有 tar 本身的 hash，不能證明原資料已完整或邏輯一致。切勿只備份 rooms.json、空熱 JSONL 或 `.jsonl.cold` 而漏掉其壓縮來源。

### 隔離載入預檢

先把完整備份解到新的目錄，再於候選插件根目錄執行；沿用上段的 `DCL_STATE_FILE`、`DCL_BACKUP_DIR`，會以實際 basename 找副本，缺檔即停止。將已核對的插件設定填入 `candidateConfig`，尤其是自訂 `storage` 額度；空物件使用預設值，可能與正式配置不同。`path` 最後強制指定副本，不能改成正式路徑。這會修改**副本**並可能完成其中的已提交恢復義務；不提供真實 Host services，不掛載 HTTP 路由，立即取消任務監控計時器。

```sh
DCL_PREFLIGHT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/dsh-chat-preflight.XXXXXX")" &&
tar -xpf "$DCL_BACKUP_DIR/state.tar" -C "$DCL_PREFLIGHT_DIR" &&
DCL_PREFLIGHT_FILE="$DCL_PREFLIGHT_DIR/$(basename "$DCL_STATE_FILE")" &&
test -f "$DCL_PREFLIGHT_FILE" &&
test ! -L "$DCL_PREFLIGHT_FILE" &&
node --input-type=module - "$DCL_PREFLIGHT_FILE" <<'NODE'
import { DshChatLocalService } from './lib/room-store.js';
const candidateConfig = {}; // 填入已核對的插件設定，不含真實 Host services。
const service = new DshChatLocalService({}, { ...candidateConfig, path: process.argv[2] });
clearInterval(service.monitorTimer);
try {
  await service.ready;
  await service.settledAudit();
  console.log(JSON.stringify({ stateVersion: service.stateVersion(), audit: service.logHealth() }, null, 2));
} finally {
  await service.close();
}
NODE
```

接著在副本驗鏈，並比較升級前後資料；再對同一副本執行一次隔離載入，檢查穩定狀態。這段程式只完成載入／恢復，不自動證明所有資料不變，也不驗證 DSH 介面相容性。保留預檢輸出與副本，避免錯把副本 path 設成正式 path。

## 唯讀驗鏈與房間匯出

驗鏈 CLI 位於插件根目錄。對停寫後副本執行，將參數換成真實來源 id 與副本路徑：

```sh
node scripts/verify-event-log.mjs SOURCE_ID --state /path/to/copy/rooms.json
```

它檢查指定來源的事件鏈與 head anchor；冷檔透明讀取並檢查 manifest。exit 0 代表此次檢查通過，1 代表驗證／讀取失敗，2 代表參數或非預期執行錯誤。`headAnchor.matches: null` 表示沒有可比較的 anchor；沒有日誌會報錯，不能解釋為已驗證的空歷史。

**跨程序唯讀不等於原子快照。** 離線工具依次讀取 rooms.json、日誌和 anchor，沒有與線上 writer 共用鎖。活動目錄可能讀到不同時點的資料，產生暫時 mismatch／truncated；應先停寫複製，再重新判定。工具不會修復未完成意圖或 outbox；遇到它們時先依故障恢復流程在副本恢復，然後再次驗鏈。鏈自洽不證明每次現實互動都曾被記錄，也不是來源身分認證。

需要關係實驗的描述報表時，使用相同穩定副本：

```sh
node scripts/relationship-eval.mjs --state /path/to/copy/rooms.json --observation --json
```

它不修改資料；退出 0 不表示因果結論或獨立重複試驗成立。關係實驗的命令、分組與輸出解讀見[實驗指南](experiments.md)；人格測試另見[人格縱向試驗](persona-longitudinal.md)。

| 方式 | 內容與用途 |
| --- | --- |
| 完整狀態目錄備份 | 還原此插件的狀態、來源、人格、冷檔及待恢復操作 |
| UI 匯出或 `GET /rooms/:id/export?format=json` | 房間讀模型、章程／台帳歷史及 hash；不含獨立事件日誌 |
| `format=markdown` | 完整對話與目前台帳，便於閱讀 |
| `POST /rooms/:id/export`，body `{"format":"json"}` | 將匯出寫至狀態目錄 `exports/`，產生唯一檔名、不覆蓋舊匯出 |
| `GET /rooms/:id/snapshot?configHash=…` | 已提交房間＋整份該來源事件＋指定 configHash 的 run snapshot；不含其他來源、人格或完整原生 Session |

表中短路徑均接在 `/api/dsh-chat-local` 後。房間匯出與 run snapshot 都不等於完整備份，普通 export 也不是 restore-from-snapshot 可接受的格式。這些匯出不額外讀取私聊或引用文件。

## 故障恢復、房間快照恢復與回退

### 程序中斷或來源錯誤

1. 查看 health 與 DSH 錯誤，先區分容量、磁碟空間、權限、未完成提交、檔案損壞；不要刪除 `.pending`、`.head`、`.operations`、cold manifest 或 `_journal` 來消除報錯。
2. 停止 writer 並備份全部故障現場。在副本上以相容版本載入；`EventLog` 恢復已持久化的追加／替換意圖，`RoomJournal` 按固定操作 id 發布已提交 outbox，再開放房間。已確認的操作不靠重播模型來補齊。
3. 檢查恢復後健康、資料與驗鏈結果。無法恢復的來源保持不可用；原始觀察在寫入意圖落盤前的遺失、舊版漏記或宿主未送出的事件，不能由哈希鏈補回。
4. 驗證後才將同樣處置用於正式資料；若副本仍失敗，保留現場並由可驗證備份恢復。已超額時可完成的既有恢復有界，仍可能因真實磁碟耗盡而失敗。

### 恢復指定房間快照

這是**替換房間及其事件來源**，會捨棄快照之後該房間的變更；不是合併，也不回退其他房間或人格。先建立完整目錄備份，核對 snapshot 的 `room.id`、內容和來源版本。

GET snapshot 的 HTTP envelope 是 `{ok,value}`，其中 `value.content` 才是序列化 snapshot JSON 字串。保存／使用前要先解開它；不要直接將整份 HTTP 回應當成 snapshot。恢復請求為：

```http
POST /api/dsh-chat-local/rooms/ROOM_ID/restore-from-snapshot
Content-Type: application/json

{"snapshot": {"format": "dsh-chat-local-run-snapshot", "...": "匯出 snapshot 的完整內容"}, "confirm": true}
```

上面是結構示意，不能以省略號代替真實 snapshot。實際恢復對象以 body 中 `snapshot.room.id` 為準，請讓它與 URL 的 `ROOM_ID` 一致。程式驗證 content hash 及事件鏈，保存 `rooms.json.pre-restore.bak`，作廢舊回合，然後經 journal 串行替換。已安裝狀態的恢復會在關閉時完成；尚未安裝／仍排隊的恢復會被拒絕。該自動備份只有狀態檔且可能被下一次恢復覆蓋，不能保全被替換的獨立事件來源。

HTTP JSON 請求上限為 **1,000,000 bytes**，包括 envelope；較大 snapshot 無法透過此端點提交。目前沒有附帶的 snapshot 恢復 CLI，也沒有可透過請求調高此上限的欄位。不要刪減事件或重算 hash 來繞過限制；完整目錄回復則依下一節處理。

### 回退程式版本或完整資料

1. 停止目前 DSH writer。
2. 將升級／故障後的**整個資料目錄另存**，保留其新增訊息、人格、事件與待恢復操作。
3. 還原同一備份時點的程式版本／依賴／profile 設定及完整資料目錄，再確認權限和設定的 path。
4. 只啟動一個 writer，核對 health、房間數量與未完成工作。

回退到不支援 v17 的舊版時，只有切換 git revision 不構成可用回退。本版沒有無損降級工具；即使目標也支援 v17，仍須核對其事件、人格與恢復格式相容性。還原舊資料會使備份之後新增內容不再出現在目前線上狀態，所以須保留第二步的整份新資料供後續修復或搬遷，不能覆蓋掉它。

## 冷檔維護

冷檔是無損壓縮，不是遺忘或刪除。先查看容量與來源健康；需要恢復能力時先完整備份。選擇已存在的房間 id，或已知 Agent 的原生觀察來源 id。原生來源命名為 `agent-observations-<SHA-256(agentId)>`，亦可核對召回結果的 `sourceRoomId`；不要傳檔案路徑。

```sh
curl --fail --silent --show-error \
  -H 'Content-Type: application/json' \
  --data '{"sourceRoomId":"SOURCE_ID","action":"archive"}' \
  "$DCL_BASE/storage/maintain"
```

此端點只接受 `sourceRoomId` 與 `action`，來源須對應現有房間或工作區 Agent；不是 Agent 工具。它沿用本機管理 HTTP 的存取邊界，不另行認證本地呼叫者。

| action | 結果與後續檢查 |
| --- | --- |
| `archive` | 整份來源壓縮；檢查 `value.archived`，不能只看 HTTP 200。超過預設 256 MiB 可回傳 `archived:false`／`archive-size-limit` |
| `thaw` | 完整解封為熱日誌；`thawed:false` 可表示原本就是熱來源 |
| `cleanup` | 目前來源驗證成功後，只刪未被引用的生成 gzip 副本，回傳 `removed` |

封存需先寫出壓縮副本，不能在完全沒空間時保證成功。解封與下一次追加需足夠空間容納整份熱檔；若已無額度，可能先被准入拒絕。可以調整已核對的容量設定或處理狀態目錄外的磁碟佔用，但不要把原始證據當快取手動清掉。每人觀察額度不因壓縮減少。

完成後重新讀取 health，必要時在停寫副本驗鏈。冷檔損壞時先處理來源，不以刪 manifest 強制退回熱來源。`cleanup` 不刪人格舊版、狀態暫存檔或一般備份，也沒有自動保留期、分段輪替或無限容量保證。具體准入與崩潰邊界見[儲存容量](storage-capacity.md)。
