# 合作對照評估

此評估使用實際 `RoomStore`、投遞排程、原生回合事件、親歷讀取、固定成果與驗收方法。案例是兩類歷史失敗的合成重建，不是原對話的逐字重播：

- **論文評分**：原始資料缺失、摘要樣本數錯誤，晚到的更正必須取代先前數字；不能編造定量分數。
- **群組整理**：使用者已授權可逆整理，不能要求全員同意；晚更正指出一件工作尚未完成，必須保留開放。案例只交付方案，不操作外部文件。

三組為單 Agent（同舊策略、只有協調者）、三人舊群聊、三人新工作策略。每一案例和重複次數使用相同**總投遞上限**；第一階段最多使用一半，餘額留給晚更正。測試器的總上限跨越產品內兩次執行帳，不因新訊息重置。被中斷或失敗的投遞照樣保留。這是可比較的受控試驗條件，不是產品預設參數的宣稱。

## 先重播機制

```bash
node scripts/collaboration-eval.mjs \
  --output /tmp/collaboration-replay-01 \
  --repetitions 10 --budget 8
```

輸出目錄必須尚無 `manifest.json`；不覆蓋已有試驗。可用 `--cases paper-missing-data,group-cleanup` 和 `--arms single,legacy,work` 縮小診斷範圍。正式比較須保留所有組。重複次數為 1–100，總預算為每案例每組 4–100 次。

CLI 完成但有錯誤／遗漏或失敗 trial 時以 exit 2 結束，設定或啟動錯誤為 exit 1；exit 0 不代表研究結論成立。

未指定 adapter 時使用明示的 `scripted-replay`。合成回應器只看本次實際提供的材料、不按實驗組偷偷選答案，並生成重複確認語句以觸發原有路由。它的成功只支持機制與測試器運作，**不能證明模型能力、人格穩定性或多人合作品質提高**。增加合成重複次數也不能消除這個限制。

## 同案例接模型

```bash
node scripts/collaboration-eval.mjs \
  --output /tmp/collaboration-model-01 \
  --repetitions 10 --budget 8 \
  --adapter-command '["node","/absolute/path/model-adapter.mjs"]' \
  --model exact-model-name \
  --parameters '{"temperature":0}' \
  --timeout-ms 60000
```

每次 adapter 是一個真正啟動的子程序，透過 stdin 接一個 JSON、stdout 回一個 JSON；不使用 shell 解譯。stderr 與原始輸出保留，逾時、非零退出、格式錯誤及截斷不算成功，也不自動重試。輸出總量上限 1 MiB。adapter 的模型、額外工具權限及 provider 內部重試由接線端控制；此測試器不會假稱已封鎖模型工具或已證明實際模型參數。

輸入沿用人格試驗的共同外殼：

```json
{
  "schemaVersion": 1,
  "suite": "collaboration",
  "trialId": "paper-missing-data/0/work/2",
  "model": "requested-model",
  "parameters": {"temperature": 0},
  "messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}],
  "context": {
    "caseId": "paper-missing-data",
    "sessionId": "coordinator",
    "phase": 1,
    "dispatchIndex": 2,
    "pendingRequests": [],
    "sourceMessageIds": []
  }
}
```

`messages` 包含實際群聊提示、當次 `chat_memory` 的現況投影、已提交固定成果與本人請求。實際投遞提示與固定成果不裁剪；只有在投遞提示的同一 message ID 區塊已含完整原文時，才省去 memory 中重複的一份。未完整顯示的更正和異議仍保留。現況投影保留當前契約、輸入引用、提交與驗收，移除歷史請求、逐次預算收據、重複的 `myWork` 和台帳活動歷史；預算改列已消耗與未知次數。它不把省略歷史視為已閱，也不替模型處置請求。

去重後整個請求仍超過 **50,000 bytes** 時，保留原始請求並記錄 `context_rejected`，不偷偷截斷證據。回覆 `reply` 上限為 600 字元，`answer` 必須完整；超限或未闭合的 JSON 計失敗。每次派送的 `contextStats` 保存前後大小與被去重的 message ID。這些是評估器的輸入／輸出政策，適用全部組，並記入 manifest；不是產品原生群聊的通用上下文壓縮器。

adapter 應將生成的 messages 原樣送給選定模型。參數與模型名稱是**要求值**；回應可在 `metadata` 記錄實際 provider 回報及限制，不可把要求值冒充證明。內建 `scripts/dsh-no-tools-adapter.mjs` 可接已安裝 DSH 的預設 provider；它直接呼叫 provider、提供空工具清單且不啟動 Agent 執行迴圈。設定 `DCL_MODEL_BUDGET_FILE` 指向共享持久帳，才會啟用呼叫前占用次數、回傳後記錄實耗的跨程序預算；未知實耗或未決呼叫會阻止續跑。本次真模型試驗全程設有此帳。這是另一項接線能力，不是任意外部 adapter 的保證。

回應格式：

```json
{
  "text": "{\"answer\":{...},\"reply\":\"依據及限制\",\"resolveRequestIds\":[],\"reviewVerdict\":null}",
  "complete": true,
  "finishReason": "stop",
  "model": "reported-model-or-null",
  "parameters": {},
  "usage": {"inputTokens": 100, "outputTokens": 80},
  "metadata": {}
}
```

`text` 中的 `answer` 欄位由每個案例的 system prompt 定義。未完成的答覆不能以 `complete:true` 偽裝。無可靠 token 數時回 `usage:null`；測試器保留未知，不填 0。`resolveRequestIds` 僅能列本人實際取得且已處置的請求。`reviewVerdict` 為 `approve`、`request_changes` 或 `null`。

這是**受控協議 driver**：協調者的結構化答案經真實 acknowledge/publish/submit API 發布，驗收者的明確 verdict 經真實 exact-version review API 處理。不是任意工具代理，也不是自主工具選擇試驗。所有操作失敗另外記錄；有答案不表示固定交付或驗收已成功。單 Agent 沒有獨立驗收者，保留待人類驗收，因此不能直接用「已驗收率」判其輸贏。

## 保存與判讀

每次輸出保留：

- `manifest.json`：案例、組別、要求的模型與參數、預算、案例及執行模組來源指紋。
- 每次 trial 的 `calls.jsonl`：派送前的完整請求、prompt hash、原始 adapter 回應、stderr、耗時及失敗。
- 每次 trial 的 `room.snapshot.json`：可恢復的 RoomStore 與事件、固定成果內容；嚴重初始化失敗可能沒有快照，此時 `result.json` 保留原因。
- `result.json` 與總 `results.jsonl`：所有失敗、最終方案、精確評分、交付和驗收、請求與待閱狀態。
- `summary.json`：各組均值、樣本變異數（分母 n−1）與配對正確率差。只有一次觀察時變異數是 null，不是零。

正式分數只評更正階段最後一份協調者方案；初始回覆不拿尚未提供的晚更正作標準，標記為未評分。

正確性只核對明列的材料事實：樣本數、缺資料、不得編造分數；或應歸檔／保持開放的文件與授權邊界。欄位缺失計入遗漏，錯誤計入 wrong；失敗 trial 不刪除。`unresolvedObjections` 表示晚更正仍未被最終協調者方案正確反映，另列 `protocolPending`，避免把不存在請求台帳的舊組誤當全部處置。

`duplicateReplies` 是空白正規化後的完全重複文本，僅為重複負擔下界，不是語意重複偵測。`dispatches` 與 `adapterCalls` 分列；前者包括已開始卻因階段切換而未呼叫模型的投遞。模型內部 retries 無資料時仍為 unknown。實耗時間包含本機儲存與測試器開銷，不當成純模型延遲。

`accepted` 是一項 task 的驗收狀態，`roomAccepted` 才是房間當下的整體狀態。驗收後的普通回覆可能成為新待阅增量；測試器不把它清掉以美化結果。

真模型試驗至少需同案例同預算的多次配對觀察，逐項檢查失敗與變異，並盲評結論品質。即使十次全過，也不能只靠這两個案例宣稱普遍優於單 Agent；模型供應方及接線未能證實的參數、成本、內部重試要保持明示。

## 本次真模型試跑：2026-09-28

公開的[試跑摘要與證據索引](evidence/collaboration-pilot/README.md)包含去除私人路徑的結果、診斷與勘誤。原始對話及房間快照保留在本機輸出目錄；公開文件記錄其原始 SHA-256，不將摘要冒充完整原始資料。這是測試當時工作樹的記錄，原始碼指紋見摘要；後續產品修正不自動視為已經模型試驗覆蓋。

本次只測 `paper-missing-data`，每組一次，同總投遞上限 6。實際使用 `deepseek-official` / `deepseek-flash`，`maxTokens=2048`，provider prepareCall 確認 `reasoningEffort=high`。試跑採去重修正前的上下文政策。各組樣本變異數均為 null。

| 組別 | 投遞／adapter 嘗試／provider 呼叫 | 更正後最終責任人方案 | 最新固定交付／驗收 | 保留的失敗 | provider totalTokens | trial 耗時 |
|---|---:|---|---|---|---:|---:|
| 單 Agent | 2 / 2 / 2 | 正確 | 有／待人類 | 無 | 12,408 | 22.295 秒 |
| 舊群聊 | 6 / 6 / 6 | 無完整答案，4 欄遺漏 | 無／未完成 | 2 次輸出截斷 | 51,062 | 81.077 秒 |
| 新工作策略 | 5 / 5 / 4 | 正確 | 有／未完成 | 最後驗收輸入超限，未呼叫 provider | 47,202 | 62.715 秒 |

舊群聊的其他成員有採用更正，驗收者也拒絕過期方案；不能把責任人最終 JSON 截斷解釋成所有人都推理錯誤。新策略已重交固定成果，但最後驗收未執行，仍算未完成。單 Agent 沒有獨立驗收者，驗收率也不能直接拿來判輸贏。三組完全重複文本計數都是 0，但此指標不識別換句話重複。

超限來自**評估器**重複附上聊天與請求歷史：65,715 bytes 的請求中，另附的 `chat_memory` 為 40,653 bytes，15 則完整原文已在原投遞提示中出現；固定成果只有 131 bytes。現況投影將同一請求降至 **26,307 bytes**，保留完整成果、更正、契約與來源，上限仍為 50,000 bytes。這不構成「產品原生提示全面超限」的結論。

兩次舊群聊截斷都達 2,048 output tokens，可見文字分別只有 44 和 651 字元，JSON 未閉合。能核實的是輸出預算耗盡，以及原回覆缺少簡短篇幅約束；未取得 reasoning token 明細，不能斷言有多少預算花在未顯示推理。修正要求 reply 最多 600 字元，繼續把截斷計為失敗，沒有只提高上限。

另對保存的失敗驗收輸入做了兩次獨立回放；high / low 推理設定均完整返回、批准更正後的 N=12／原始資料缺失／不給分方案，分別消耗 8,700 / 8,308 totalTokens。這沒有回填原房間，**原 work trial 仍是驗收未完成**，也不能據此比較兩種推理設定。合作原試跑共 12 次／110,672 tokens，加上 2 次診斷與先前人格試跑 6 次／4,247 tokens，共用帳最終為 **20 次／131,927 tokens**，沒有未決 reservation。

另有一項[評分勘誤](evidence/collaboration-pilot/assessment-erratum.json)：原 `answers[]` 曾把初始回覆與尚未提供的晚更正比較，那些初始分數應忽略。現已標為未評分；原正式指標本來就只評更正後最後一份責任人答案，所以表中與最終統計不變。原始結果沒有覆寫。

這些短試驗不能證明合作普遍優於單 Agent，也未驗證長期人格穩定性、自動記憶品質或真實長任務表現。試跑保留的失敗是後續改進與對照的依據，不能刪除後只報成功回放。
