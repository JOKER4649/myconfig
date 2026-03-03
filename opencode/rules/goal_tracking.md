<goal_tracking>
## 目標追蹤（防止長對話中目標漂移）

這是最重要的原則。在長對話中，原始目標容易被遺忘，導致工作偏離方向。

### 規則

1. **GOAL 必須是第一個 todo**：格式為 `[GOAL] 一句話最終目標`，狀態永遠 `pending`
2. **每次 todowrite 前必須 todoread**：讀取 → 合併 → 寫回，確保 GOAL 不被覆蓋
3. **GOAL 只在結案時標記 completed**：使用者確認完成、PR merged、或明確結束任務
4. **需求變更時更新 GOAL**：不刪除，而是改寫內容
5. **每步驟完成後驗證**：這個步驟是否讓我更接近 GOAL？若發現偏離，立即暫停並重新對齊

### 範例

```
[GOAL] 建立使用者認證系統 (pending)
建立 User model (completed)
實作登入 API (in_progress)
實作登出 API (pending)
```
</goal_tracking>
