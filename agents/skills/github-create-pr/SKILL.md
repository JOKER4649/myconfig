---
name: github-create-pr
description: 建立 `review ready` 的健壯 github PR
---

## 流程

### 建立 PR

- 當前分支不應該在預設分之上, 通常為 `main` 或 `master`
- PR title, PR body 以繁體中文書寫
- PR 應說明這完成了什麼功能/解決了什麼問題...等, 而不是解釋做了什麼
- push 前在本地完成了檢查, 盡可能的減少 github actions 的負擔

### 檢查 PR

建立 TODO 來確保所有工作完成, 中途臨時任務不可覆蓋當前 TODO, 應使用 update 來插入, 所有 `[MVP]` TODO **必須**在所有其他 TODO 都被完成的情況下, 最後**一次性**完成

- [ ] [MVP] 所有檢查工作**同步**完成
  - PR title, PR body 充足的表達了意圖, 而不是解釋做了什麼
  - CI 全部通過
  - 所有 `AI PR review` 的評論已解決
  - 所有合併衝突已解決
  - 沒有任何阻礙合併的問題存在
  - changes 沒有臨時檔案/測試log之類的垃圾

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

## PR 範本

PR 是給人類看的，應簡潔明瞭地表達這個 PR 的目的與改動，而不是解釋做了什麼，程式碼、註解、文檔本身就該自我表達

### 標題

格式如下：

> <type>(<scope>): <中文描述>

type 只允許三種：

- feat: 新增功能、支援新情境、擴充系統能力
- fix: 修正錯誤行為、避免異常狀態、補齊缺漏邏輯
- maintain: 改善可維護性，例如重構、測試、文件、設定、型別、命名、依賴或內部流程整理

中文描述應該偏向「問題 / 結果 / 行為變化」，不要只描述「做了什麼」。

優先使用這類描述：

- 支援……
- 防止……
- 避免……
- 確保……
- 簡化……
- 分離……
- 統一……
- 移除……
- 補上……
- 收斂……

避免低資訊量描述：

- 更新……
- 調整……
- 修改……
- 改善……
- 處理……
- 整理……

除非後面明確說出具體問題或結果。

好例子：

- feat(billing): 支援依工作區匯出每月用量
- fix(sync): 防止併發觸發時建立重複 provider job
- fix(auth): 避免過期 refresh token 進入 session renewal
- maintain(sync): 分離游標持久化與 provider 執行流程
- maintain(order): 補上付款擷取失敗時的退款流程測試
- maintain(search): 避免預設查詢載入封存資料

### 內文

大致分成兩種類型:

目的為增加類型: 例如 `feat`、`test`、`docs` 等

```markdown
## 目的 / 背景

[簡要說明這個 PR 的目的，為什麼需要這些改動，解決了什麼問題，或是帶來了什麼好處]

## 主要變更
- [列出這個 PR 的主要改動點，可以是功能新增、問題修正、重構等每個改動點可以簡要說明一下]

## 驗證方式
- [說明你是如何驗證這些改動的，可以是測試方法、測試案例、手動測試步驟等]

## 影響範圍 / 風險
- [說明這些改動可能會影響到哪些部分，或者有哪些潛在的風險需要注意]
```

目的為不變或減少類型: 例如 `fix`、`refactor`、`perf` 等

```markdown
## 問題描述

[說明錯誤現象，以及它造成什麼影響]

## 根因 [可選]

[說明目前判斷出的主要原因，讓 reviewer 知道這次修正有對準問題]

## 修正內容

[列出這次改了哪些地方，保持在設計層級，不需要重複 diff]

## 驗證方式

[說明如何重現、如何確認已修好，以及是否確認正常路徑沒壞]

## 影響範圍

[說明這次修正可能影響哪些模組、流程或資料]

## 已知限制

[說明這次沒有處理到的邊界情境，避免誤解修正範圍]
```