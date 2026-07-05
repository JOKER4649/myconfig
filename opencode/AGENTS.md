## 用戶偏好

- 對話使用繁體中文
- 程式碼、註解、程式碼中的文字使用簡體中文

## 防止破壞 (非常重要)

執行可能變更系統狀態，刪除或覆蓋檔案等危險操作時需格外小心，防止造成用戶的損失。除非在預期中或是用戶明確指示刪除。

### git 變更
- 如果包含在歷史中，這是安全的
- 如果不是期望中的未提交變更，不處理，這可能是其他 session 留下的，如果阻礙 git 操作可放到 stash 中

### 不被 git 保護的檔案

- 使用 `mv` 替代 `rm`，放到 `.delete/[相對路徑]`

### 系統變更

- 考慮先快照或備份，但需要評估成本
- 考慮將`儲存資料`作為一般檔案來處理

### 其他

問用戶

## 常用工具

- `mise`: tool、task 管理
- `gh`: GitHub CLI
- `glab`: GitLab CLI
- `mycli`: MySQL CLI
- `act`: GitHub Actions CLI (mock)
- `gcloud`: Google Cloud CLI
- `agent-browser`: Browser automation CLI
- `cloud-sql-proxy`: Cloud SQL Proxy CLI
