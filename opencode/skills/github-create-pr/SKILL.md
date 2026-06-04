---
name: github-create-pr
description: 建立 `review ready` 的健壯 github PR
---

## 建立 PR

- 當前分支不應該在預設分之上, 通常為 `main` 或 `master`
- PR title, PR body 以繁體中文書寫
- PR 應說明這完成了什麼功能/解決了什麼問題...等, 而不是解釋做了什麼
- push 前在本地完成了檢查, 盡可能的減少 github actions 的負擔

## AI PR review

組織內使用 `gemini-code-assist` (免費版)

- 當 **專案位於 gitlab**, 忽略 `gemini-code-assist` 相關流程 (gitlab 不支持)
- `gemini-code-assist` 第一次 review 需要數分鐘, 建立 PR 後使用本 SKILL 的 `wait.py` 輪詢等待 (見下方「工具」), **不要**用 `sleep` 猜等待時間
- **不應**盲信 `AI PR review` 評論, 由於缺少任務的完整上下文, 應拒絕不合實際情況的評論
- 修復明確的 bug 與設計問題, 簡單的改良建議直接採用, 複雜的改良建議建立 issue 來追蹤, 如果需要決策向用戶確認

## 工具

- 使用 `act` 模擬 `github actions`, 減少 github actions 的負擔
- 使用 `~/myconfig/opencode/skills/create-strong-pr/wait.py` 輪詢等待 CI 完成與 gemini review 出現
  - 預設每 30 秒輪詢一次, 15 分鐘 timeout; 依賴 `gh`, 僅支援 GitHub
  - GitHub repo 未裝 gemini 時加 `--no-gemini`
  - 退出碼: `0`=CI 通過+review 已到, `1`=CI 有失敗, `2`=超時, `3`=gh 錯誤
- 使用 `pr-review-thread_list` 列出 PR 的所有 review threads (含 thread ID 與狀態)
- 使用 `pr-review-thread_resolve` 解決 review thread (需提供 thread ID)
- 使用 `pr-review-thread_unresolve` 反向操作

## PR 檢查

建立 TODO 來確保所有工作完成, 中途臨時任務不可覆蓋當前 TODO, 應使用 update 來插入, 所有 `[MVP]` TODO **必須**在所有其他 TODO 都被完成的情況下, 最後**一次性**完成

- [ ] [MVP] 所有檢查工作**同步**完成
  - PR title, PR body 充足的表達了意圖, 而不是解釋做了什麼
  - CI 全部通過
  - 所有 `AI PR review` 的評論已解決
  - 所有合併衝突已解決
  - 沒有任何阻礙合併的問題存在
  - changes 沒有臨時檔案/測試log之類的垃圾
