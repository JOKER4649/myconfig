---
name: github-flow
description: >
  This skill should be used when the user asks to "create a PR",
  "push code", "submit for review", "merge a PR", "ship it",
  "建立 PR", "推送", "送 review", "合併", "提交功能", "部署",
  or when completing any code change that goes through the
  branch → PR → AI review → merge workflow.
  Covers GitHub Flow with Gemini Code Assist review handling
  and conversation resolution via GraphQL API.
---

# GitHub Flow 工作流程 SOP

可執行的標準作業程序，涵蓋從建立分支到合併 PR 的完整 GitHub Flow 流程。
假設專案啟用了 Gemini Code Assist 作為 AI Reviewer，
且設定了「Require conversation resolution before merging」保護規則。

按照本文件的階段順序執行。每個階段都有明確的完成條件，
跳過步驟或未等待 AI Review 完成就嘗試合併會導致流程失敗。

官方參考：https://docs.github.com/en/get-started/using-github/github-flow

---

## 階段 1：分支與開發

### 1.1 建立工作分支

```bash
git checkout main && git pull origin main
git checkout -b <type>/<short-description>
```

根據變更性質選擇前綴：`feat/`、`fix/`、`refactor/`、`docs/`、`chore/`。

### 1.2 開發與提交

使用 `git-master` skill 進行 atomic commits。確保每個 commit 可獨立編譯並運行。

### 1.3 推送

```bash
git push -u origin <branch-name>
```

**完成條件**：branch 已追蹤遠端，無未提交的變更。

---

## 階段 2：建立 Pull Request

```bash
gh pr create --title "<標題>" --body "$(cat <<'EOF'
## 摘要
<1-3 個重點描述變更內容與原因>

## 變更項目
<列出主要變更>
EOF
)"
```

標題使用祈使句描述變更目的。描述包含「為什麼」做這個變更。
建立後記錄 PR URL 和 PR number，後續步驟需要使用。

**完成條件**：`gh pr view --json url` 回傳有效的 PR URL。

---

## 階段 3：AI Review 循環

PR 建立後，Gemini Code Assist 會自動進行 review。
等待 review 完成、處理所有評論、解決所有對話後，才進入合併階段。

### 3.1 等待 AI Review

使用遞減間隔等待策略：

```bash
sleep 300   # 首次等待 5 分鐘
# 若 review 未出現，後續每次：
sleep 180   # 每 3 分鐘檢查一次
```

每次等待後檢查評論：

```bash
gh pr view --json comments --jq '.comments | length'
```

當評論數大於 0，進入下一步。若超過 15 分鐘仍無 review，改為直接查詢 review threads。

### 3.2 查詢未解決的 Review Threads

使用 GraphQL API 查詢所有 review threads，篩選 `isResolved: false` 的項目。
REST API 不支援 thread 解決狀態，GraphQL 是唯一途徑。

完整 GraphQL 查詢與 mutation 指令見 **`references/graphql-commands.md`**。

### 3.3 評估與處理 Review 評論

對每個未解決的 thread，按照決策框架判斷處理方式。
核心原則：Gemini Code Assist 無法理解專案的整體架構與上下文，
建議僅作參考，與既有模式衝突時優先保持一致性。

完整的評估決策框架見 **`references/review-evaluation.md`**。

### 3.4 推送修復（如有需要）

```bash
git add <modified-files>
git commit -m "<type>: address review feedback"
git push
```

### 3.5 解決所有對話

每個已處理的 thread（無論修復、追蹤、還是不採納），
都透過 GraphQL `resolveReviewThread` mutation 解決對話。
逐一執行，驗證每個回應中 `isResolved` 為 `true`。

完成後重新執行 3.2 查詢，確認無遺漏的未解決對話。

### 3.6 觸發後續 Review（如有需要）

若推送了新的修復 commits：

```bash
gh pr comment --body "/gemini review"
```

回到 3.1 重新開始等待循環。

**完成條件**：所有 review threads 的 `isResolved` 為 `true`，最後一次 review 後無新的未解決評論。

---

## 階段 4：回報並等待合併指示

階段 3 完成後，回報 PR 狀態摘要並**停止**。合併是不可逆操作，必須由使用者明確同意。

### 4.1 回報就緒狀態

向使用者回報以下資訊：

- PR URL
- CI 狀態（`gh pr checks`）
- Review 對話解決狀態
- 是否有未處理的問題

然後等待使用者指示。不要自行執行合併。

### 4.2 執行合併（僅在使用者明確同意後）

使用者同意後：

```bash
gh pr merge --squash --delete-branch
git checkout main && git pull origin main
```

**完成條件**：`gh pr view --json state --jq '.state'` 回傳 `MERGED`。

---

## 緊急修復流程

```bash
git checkout main && git pull
git checkout -b fix/<issue-description>
# 修復、測試、提交、推送
gh pr create --title "fix: <描述>" --body "<說明>"
# 執行完整的階段 3（AI Review 循環）— 不可跳過
```

即使是緊急修復，AI Review 循環仍不可跳過。
加速方式是縮小修復範圍，讓 review 更快完成。

---

## 同步 main 變更

```bash
git fetch origin main
git rebase origin/main
git push --force-with-lease
```

使用 `--force-with-lease` 防止覆寫他人的變更。

---

## 補充資源

### Reference Files

詳細的操作指令與決策指南：

- **`references/graphql-commands.md`** — GraphQL 查詢 review threads 與解決對話的完整指令
- **`references/review-evaluation.md`** — AI Review 評論的評估決策框架與處理策略

### 常用 gh 指令速查

| 操作 | 指令 |
|------|------|
| 查看 PR 狀態 | `gh pr view` |
| 查看 CI 結果 | `gh pr checks` |
| 查看評論 | `gh pr view --comments` |
| 合併 PR | `gh pr merge --squash --delete-branch` |
| 觸發 AI review | `gh pr comment --body "/gemini review"` |
