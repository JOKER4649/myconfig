# Sisyphus Prompt 參考資料

此資料夾包含 [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) 的 Sisyphus Agent system prompt 備份與翻譯。

## 用途

1. **理解 Sisyphus 行為** - 了解 agent 的設計意圖和運作方式
2. **撰寫 AGENTS.md** - 避免與 Sisyphus 預設行為重複或衝突
3. **追蹤上游變更** - 定期同步以了解新功能或行為調整

## 檔案說明

| 檔案 | 說明 |
|------|------|
| `prompt-en.md` | 組裝後的 system prompt（英文原版） |
| `prompt-zh-TW.md` | 繁體中文翻譯 |
| `source/sisyphus.ts` | 原始 TypeScript（含靜態 prompt 片段） |
| `source/sisyphus-prompt-builder.ts` | 動態組裝邏輯（agent/tool 表格等） |

## 同步方式

```bash
# 僅同步英文版
./script/sync-sisyphus-prompt.sh

# 同步 + 產生中文翻譯
./script/sync-sisyphus-prompt.sh --translate
```

## 注意事項

- **動態部分未包含**：實際 system prompt 會根據可用的 agents、tools、skills 動態組裝表格和觸發條件
- **翻譯使用免費模型**：翻譯品質可能有誤差，以英文原版為準
- **不要手動編輯**：此資料夾內容由腳本自動產生，手動修改會被覆蓋
