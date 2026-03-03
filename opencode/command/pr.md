---
agent: agent
---

<goal>
按照 GitHub Flow SOP 建立 Pull Request 並完成完整的 AI Review 循環。
確保 PR 的品質和正確性，主動處理所有 review 評論、解決所有對話，直到 PR 可合併為止。
</goal>

<context>
載入 `github-flow` skill 作為流程參考。該 skill 定義了完整的 GitHub Flow SOP，
包含分支管理、PR 建立、AI Review 等待與處理、對話解決、以及合併的所有步驟。
GraphQL 指令和 review 評估框架分別在 skill 的 `references/` 目錄下。

變更重點：
```
$ARGUMENTS
```
</context>

<execution_flow>

## 1. 前置檢查

執行專案的 lint 和 test 指令，確認通過後再繼續。
若專案未配置這些工具，跳過此步驟。

## 2. 分支管理

- 若在 `main`：根據變更性質建立對應前綴的分支（`feat/`、`fix/`、`refactor/` 等）
- 若已在工作分支：繼續使用

## 3. 提交變更

使用 `git-master` skill 進行 atomic commits。合理分組，確保每個 commit 可獨立編譯。

## 4. 推送與建立 PR

```bash
git push -u origin <branch-name>
gh pr create --title "<標題>" --body "<描述>"
```

建立後記錄 PR URL 和 PR number。

## 5. AI Review 循環

嚴格按照 `github-flow` skill 的「階段 3」執行：

1. **等待**：`sleep 300`（首次），之後每 `sleep 180` 重試
2. **查詢**：使用 GraphQL API 取得所有未解決的 review threads（參考 `references/graphql-commands.md`）
3. **評估**：對每個 thread 判斷處理方式（參考 `references/review-evaluation.md`）
4. **修復**：如有需要，修改程式碼、commit、push
5. **解決對話**：使用 `resolveReviewThread` GraphQL mutation 逐一解決所有已處理的 threads
6. **驗證**：重新查詢確認所有 threads 已解決
7. **重新 review**：若推送了新 commits，使用 `/gemini review` 觸發新一輪 review，回到步驟 1

重複此循環直到所有對話解決且無新的未解決評論。

## 6. 回報就緒狀態

回報 PR URL、CI 狀態、對話解決狀態，然後**停止並等待使用者同意合併**。
不要自行執行合併。

## 7. 合併（僅在使用者明確同意後）

```bash
gh pr merge --squash --delete-branch
```

</execution_flow>

<guidelines>
- 每次 commit 前確保程式碼可運行
- 若 CI 失敗，優先修復
- Gemini Code Assist 的建議僅作參考，無法理解專案全貌，與既有模式衝突時優先保持一致性
- 工作量大的建議用 TODO 註解或 Issue 追蹤，不在本次 PR 處理
- 使用 `gh api graphql` 操作 review threads，REST API 不支援解決對話
</guidelines>
