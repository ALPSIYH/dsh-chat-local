# 維護指引

`dsh-chat-local` 是 DSH 的本地群聊插件。它負責團隊、對話、工作協議與個體記憶；模型執行、原生 Session、沙箱與審批由 DSH 提供。

## 按修改內容找入口

| 要處理的問題 | 先讀 | 主要程式 |
| --- | --- | --- |
| 組隊、對話、草稿與工作流程 | [使用指南](docs/guide.md) | `collaboration-workspace.js`、`conversation-model.js`、`room-store.js` |
| Agent 身分、人格與來源可見性 | [記憶架構](docs/agent-memory-architecture.md) | `agent-directory.js`、`agent-persona.js`、`agent-memory.js` |
| 召回、整理、衰減與信念 | [記憶生命週期](docs/memory-lifecycle.md) | `agent-memory-index.js`、`memory-lifecycle.js` |
| 提交、崩潰恢復與快照 | [記憶架構的提交邊界](docs/agent-memory-architecture.md) | `room-journal.js`、`event-log.js` |
| 配額、冷檔與維護寫入 | [儲存契約](docs/storage-capacity.md) | `storage-capacity.js`、`cold-log.js` |
| HTTP、工具或原生上下文註冊 | [使用指南](docs/guide.md)、[部署與維護](docs/operations.md) | `index.js` |
| 研究指標、run 或人格評測 | [實驗與評測](docs/experiments.md)、[縱向試驗](docs/persona-longitudinal.md) | `experiment.js`、`relationship.js`、`scripts/*eval*`、`scripts/persona-longitudinal.mjs` |
| 界面 | [使用指南](docs/guide.md) | `client.js`、`group-ui.js`、`team-ui.js`、`workspace-ui.js` |

上表程式位於 `lib/`，另有標明 `scripts/` 的入口。`room-store.d.ts` 和 `index.d.ts` 定義對外型別。

## 修改時要維持的界線

- **身分**：Agent 是持續的參與者；Session 是執行上下文。名稱或 Session 相同不足以推定為同一人。身分歧義時回報缺口，不猜測私人記憶的歸屬。
- **配置**：群組預設影響未來對話；當次參與者和工作環境屬於當次對話。引用同一原生 Session 的例外影響範圍必須在介面中可見。
- **來源**：加入房間只表示可檢查該來源。成為本人經歷仍需實際觀察或作者收據；摘要回讀不能形成循環證據。
- **判斷**：經歷、本人信念、對他人的評價和人格分開保存。房間計數描述運作紀錄，不能直接當作私人信任分數。
- **授權**：人格、記憶、章程和台帳決定不增加執行權限。只讀守衛和可選治理門各守自己的範圍。
- **提交**：狀態與待發布事件經 `RoomJournal` 協調。等待後重新檢查身分、房間及回合；舊回合不能借新回合授權繼續寫入。
- **完成狀態**：回合結束、訊息送達、提交、驗收、取消與歸檔各有不同含義。未知結果保留原操作憑據，不重新製造一次執行。
- **證據**：保留失敗、缺失、部分來源與版本差異。工程測試、傳輸完成和模型回答品質分別評估。

## 開發與驗證

```sh
npm ci
npm run check
```

`check` 檢查生成內容、語法與全部 Node 測試。修改 `lib/text-protocol.js` 或 `lib/work-protocol.js` 後，先執行 `npm run build` 更新 `lib/client.js` 的共享協議區塊。

原生整合測試透過 `DSH_MODULES_DIR` 載入已安裝 DSH 的依賴。指定目錄應是 DSH 套件內的 `node_modules`；報告測試結果時保留跳過項，不能把未執行的原生整合算作通過。

測試依修改範圍選擇：

- 身分或記憶：對應的 identity、agent-memory、memory-lifecycle、persona 測試，以及權限／reset／來源失效情境。
- 持久化：journal、crash-recovery、event-log、cold-log 和 capacity 測試；檢查重開後磁碟內容。
- 協作流程或界面：workspace、work-protocol、group-ui、team-ui、UI shell 等相關測試；真實宿主抽查另行記錄。
- 文件或打包：版本一致性、相對連結、CLI 範例及 `npm pack --dry-run` 的檔案清單。

`scripts/ui-fixture.mjs` 是隔離介面預覽，會阻擋真實 Session、模型與檔案動作。它依賴獨立 React 套件；已驗證的 DSH 預設安裝未提供這個依賴，因此不能把該腳本當成隨裝即用的預覽入口。

## 文件與歷史

目前使用方式以 [README](README.md) 和 [文件索引](docs/README.md) 連到的現行文件為準。參數預設與工具 schema 應同時核對程式，更新公開型別和相關說明。

`docs/superpowers/` 的計畫及 `docs/research/` 的調研保留當時的決策背景；其中未勾選項目、早期目標與實作指令不代表現在仍待執行。版本演進見 [CHANGELOG](CHANGELOG.md)。部署及回退依[運維流程](docs/operations.md)處理，正式資料和測試 fixture 分開。
