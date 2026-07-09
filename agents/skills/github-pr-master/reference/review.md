# 等待檢查與處理 review

## AI reviewer

組織內主要 AI reviewer 為 `kilo-code-bot`。

- kilo 每次推送都會自動 review；修復並 push 後需用 `wait.py` 重新等待 kilo 完成再檢查 comments
- `gemini-code-assist` 可能仍開啟作為第二視角補充，**不主動等待**；出現的評論按下方「回應原則」一併處理

## 等待工具：`wait.py`

使用本 SKILL 目錄內的 `wait.py` 輪詢等待 CI 完成，以及 kilo review 完成。

- 預設每 30 秒輪詢一次，15 分鐘 timeout；依賴 `gh`
- 選項 `--kilo/--no-kilo`（預設等待 kilo；GitHub repo 未裝 kilo 時用 `--no-kilo`）；另有 `--timeout`、`--interval`、`--pr`
- 退出碼：`0`=CI 全部通過且 kilo review 已完成且無 critical；`1`=CI 失敗 或 kilo 結論為 FAILURE；`2`=超時；`3`=gh 錯誤
- gemini 不在等待範圍
- **不要**用 `sleep` 猜等待時間

## 處理 review comments

取得 kilo（與 gemini）的 review 內容後據此回應。可用以下 MCP 工具操作 review threads：

- `pr-review-thread_list` — 列出 PR 的所有 review threads（含 thread ID 與 resolved 狀態）
- `pr-review-thread_resolve` — 解決 review thread（需提供 thread ID）
- `pr-review-thread_unresolve` — 反向操作

### 回應原則

- **不應盲信** AI review 評論，由於缺少任務的完整上下文，應拒絕不合實際情況的評論
- 明確的 bug 與設計問題 → 修復
- 簡單的改良建議 → 直接採用
- 複雜的改良建議 → 建立 issue 追蹤
- 需要決策的取捨 → 向用戶確認
- 已處理的 thread → resolve；AI 誤判則附說明後 resolve
