# 合作試跑證據：2026-09-28

此目錄公開的是從原始記錄抽取、去除私人本機路徑的摘要，不包含完整房間快照或模型對話。試跑使用隔離 RoomStore 與合成論文案例，不讀寫正式房間。

- [summary.json](summary.json)：原始三組 trial 的結果、保留失敗、實際模型設定、呼叫及 token 核算、當時原始碼指紋。
- [diagnosis.json](diagnosis.json)：輸入超限的組成、去重保留規則、輸出截斷證據，以及兩次獨立驗收診斷。
- [assessment-erratum.json](assessment-erratum.json)：初始階段錯用晚更正評分的勘誤；最終指標未改，原始資料未覆寫。

原記錄分為兩個保留在 repository 外的 evidence bundle：`collaboration-model-pilot-20260928`（本次模型試跑）與 `collaboration-scripted-replay-20260928-v1`（先前合成重播）。JSON 中的檔名均相對於各 bundle 根目錄。`originalEvidence`、`sourceArtifacts` 與勘誤中的雜湊都是**未改寫原始檔案 bytes 的 SHA-256**，不是公開摘要的雜湊；原始檔未隨這個公開目錄提供。雜湊能供持有原檔者核對一致性，不能替代缺少的原始材料或構成獨立效果驗證。

本次模型試跑每組只有一次；方差無法估計。原始三組保留兩次輸出截斷與一次驗收輸入超限。去重後的兩次獨立診斷沒有改寫原 trial，也不能證明新群聊、low 推理設定或多人協作較優。

試跑採測試當時的工作樹，`summary.json` 列出原始碼檔案指紋；後續產品修正不自動取得這次模型試跑的驗證。長期人格穩定性、真實長任務及記憶品質仍未證實。

重現方法與指標定義見[合作對照評估](../../collaboration-evaluation.md)。公開摘要的模型用量沿用 provider 回報的 `totalTokens`；provider build、推理 token 明細與內部傳輸重試未取得可靠資料。
