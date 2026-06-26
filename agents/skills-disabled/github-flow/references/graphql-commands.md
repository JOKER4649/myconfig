# GraphQL 指令參考：PR Review Threads

GitHub REST API 不支援 review thread 的解決狀態操作。
以下所有操作都必須透過 `gh api graphql` 執行。

---

## 前置：取得 PR 資訊

```bash
REPO_OWNER=$(gh repo view --json owner --jq '.owner.login')
REPO_NAME=$(gh repo view --json name --jq '.name')
PR_NUMBER=$(gh pr view --json number --jq '.number')
```

---

## 查詢所有 Review Threads

取得 PR 上的所有 review threads，包含解決狀態、檔案路徑、評論內容與作者。

```bash
gh api graphql -f query='
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 10) {
            nodes {
              body
              author {
                login
              }
              createdAt
            }
          }
        }
      }
    }
  }
}' -f owner="$REPO_OWNER" -f repo="$REPO_NAME" -F pr="$PR_NUMBER"
```

### 回應結構

```json
{
  "data": {
    "repository": {
      "pullRequest": {
        "reviewThreads": {
          "nodes": [
            {
              "id": "PRRT_kwDOxxxxxxx",
              "isResolved": false,
              "isOutdated": false,
              "path": "src/auth/login.ts",
              "line": 42,
              "comments": {
                "nodes": [
                  {
                    "body": "Consider adding error handling here...",
                    "author": { "login": "gemini-code-assist[bot]" },
                    "createdAt": "2026-01-28T00:00:00Z"
                  }
                ]
              }
            }
          ]
        }
      }
    }
  }
}
```

### 關鍵欄位

| 欄位 | 說明 |
|------|------|
| `id` | Thread 的全域 ID（`PRRT_` 前綴），用於解決對話 |
| `isResolved` | 是否已解決 |
| `isOutdated` | 是否已過時（程式碼已變更） |
| `path` | 評論所在檔案路徑 |
| `line` | 評論所在行號 |
| `comments.nodes[].body` | 評論內容 |
| `comments.nodes[].author.login` | 評論作者 |

---

## 解決單一 Thread

```bash
gh api graphql -f query='
mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) {
    thread {
      id
      isResolved
    }
  }
}' -f threadId="PRRT_kwDOxxxxxxx"
```

### 成功回應

```json
{
  "data": {
    "resolveReviewThread": {
      "thread": {
        "id": "PRRT_kwDOxxxxxxx",
        "isResolved": true
      }
    }
  }
}
```

驗證 `isResolved` 為 `true` 表示解決成功。

---

## 取消解決 Thread（如需重新開啟）

```bash
gh api graphql -f query='
mutation($threadId: ID!) {
  unresolveReviewThread(input: { threadId: $threadId }) {
    thread {
      id
      isResolved
    }
  }
}' -f threadId="PRRT_kwDOxxxxxxx"
```

---

## 回覆 Review Thread

在解決對話前，先回覆說明處理方式（修復了什麼、為何不採納等）：

```bash
# 先取得 PR 的 review ID（取最新一個）
REVIEW_ID=$(gh api graphql -f query='
query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviews(last: 1) {
        nodes { id }
      }
    }
  }
}' -f owner="$REPO_OWNER" -f repo="$REPO_NAME" -F pr="$PR_NUMBER" \
  --jq '.data.repository.pullRequest.reviews.nodes[0].id')
```

或直接使用 `gh pr comment` 在 PR 層級回覆。

---

## 批次處理工作流程

完整的「查詢 → 處理 → 解決」循環：

```bash
# 1. 查詢未解決的 threads
THREADS=$(gh api graphql -f query='...' --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)')

# 2. 對每個 thread 進行處理（修復/追蹤/不採納）

# 3. 逐一解決
echo "$THREADS" | jq -r '.id' | while read THREAD_ID; do
  gh api graphql -f query='
  mutation($threadId: ID!) {
    resolveReviewThread(input: { threadId: $threadId }) {
      thread { id isResolved }
    }
  }' -f threadId="$THREAD_ID"
done

# 4. 驗證全部解決
gh api graphql -f query='...' --jq '[.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)] | length'
# 預期輸出：0
```
