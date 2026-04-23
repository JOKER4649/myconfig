# orchestrator_append.md 設計決策

本檔記錄 `orchestrator_append.md` 的設計取捨，供未來調整時回溯。
**本檔不會被 Slim 載入到 prompt context** (Slim 僅認 `{agent}.md` / `{agent}_append.md` 兩種精確檔名)。

## 背景

### Slim base orchestrator prompt 結構

由 `buildOrchestratorPrompt()` 動態組裝 (oh-my-opencode-slim `dist/index.js:18880`)：

```
<Role>        一句話角色定義
<Agents>      動態過濾啟用的 agent 描述 (explorer/librarian/oracle/designer/fixer/council/observer)
<Workflow>    6 步驟 (Understand → Path Selection → Delegation Check → Split/Parallelize → Execute → Verify)
<Communication>  簡潔 / 不奉承 / 誠實反對
```

### 注入機制

`loadAgentPrompt("orchestrator")` 從 `<configDir>/oh-my-opencode-slim/` 目錄搜 `orchestrator_append.md`，由 `resolvePrompt()` 以雙換行追加在 base 之後 (`dist/index.js:18684`, `18799`)。

### 舊版 append 的問題

```markdown
## 成本效率最大化
- 積極的善用你的隊友來完成任務，而不是單打獨鬥
- 積極善用 SKILL，而不是每次都重新發明輪子
```

鼓勵語氣、無機制、無檢查點 → LLM 對這類軟約束忽略率高，尤其 base 的 `## 3. Delegation Check` 僅寫 `STOP. Review specialists` 也未強制化。

## 設計目標 (對應用戶三項需求)

1. **提高 subagent / SKILL 調用率** — 把鼓勵改成機制 + 檢查點
2. **減少意圖誤判** — 引入 OmO Intent Gate，首句口頭化意圖與路徑
3. **確保變更品質** — 五步開發流程，強制 @oracle 驗證非瑣碎變更

## 關鍵取捨

### 1. 用 append 而非完全取代 base

- **取代 (`orchestrator.md`)** 需自行維護 `<Agents>` 區塊；Slim 升級後 agent 描述/能力變動無法自動跟進
- **追加 (`orchestrator_append.md`)** 讓 Slim 負責維護 base，自訂部分只管「補充 / 凌駕」
- 符合「減法優於加法」原則

### 2. 開發流程 5 步而非 OmO 的 7 步

OmO Execution Loop = `EXPLORE → PLAN → ROUTE → EXECUTE → VERIFY → RETRY → DONE` (`oh-my-openagent dist/index.js:138233`)

砍 2 步理由：

- **ROUTE 合併進 PLAN** — Slim base `## 3. Delegation Check` 已強制路由檢查
- **RETRY / DONE 壓縮為「失敗回復」單段 + 「交付」單步** — base `## 6. Verify` 已處理驗證閉環，只需補 3 次失敗後的升級路徑

### 3. 保留 Turn-Local Reset

源自 OmO (`dist/index.js:138582`)，是被低估但最實用的設計：

- 防止 LLM 把前輪「已進入實作模式」的假設帶入當下訊息
- 典型反模式：用戶說「再補充一下需求」被誤判為「繼續實作」

### 4. 保留 Context-Completion Gate

源自 OmO (`dist/index.js:138596`) — 實作前三條件 (實作動詞 / 範圍具體 / 無待決 specialist) 必須同時成立。

防止在「評估」意圖下誤動檔。

### 5. 強制 @oracle 驗證非瑣碎邏輯

對應用戶明確要求：「完成後交給 @oracle 驗證結果，完成後才是可以交付給用戶的程式碼」。

硬化為「不是可選」，不留模糊空間。

### 6. 不加全大寫 MANDATORY / NEVER 轟炸

- base 已用 `STOP.` 與 `!!! !!!` 強調，再疊加邊際效果遞減
- 改用中文硬詞 (「強制」「必須」「不是可選」) 達到等效強度但視覺更乾淨

### 7. 不加「Default Bias: DELEGATE」標語

- OmO 有此標語 (`dist/index.js:138617`)
- 但會與 Slim base 的 `@fixer` rule of thumb (`Explaining > doing? → yourself`) 直接矛盾
- Slim 的平衡點更精細 (按任務規模決定)，保留即可

### 8. SKILL 優先原則的成本論述

用「載入不相關 skill ≈ 免費 / 漏用相關 skill = 高成本」框架，比抽象「善用 SKILL」有效：

- LLM 對明確成本 / 收益對比的遵守率 > 對鼓勵句的遵守率
- 源自 OmO `dist/index.js:138264` 的 skills 段落

## 驗收方法

### 行為驗收 (下個 session)

1. **意圖宣告**：我的第一句話應是「我判斷這是 **[意圖]**, 採用 **[路徑]**」
2. **實作任務**：非瑣碎實作應自動走「調查 (@librarian/@explorer) → 計畫 → @fixer → @oracle → 交付」
3. **Turn-Local Reset**：當用戶在實作到一半補充 context，我應停下實作，重新確認意圖

### 失敗情況排查

| 症狀 | 可能原因 | 調整方向 |
|---|---|---|
| 沒出現意圖宣告 | append 未被 Slim 載入 | 檢查 `oh-my-opencode-slim.jsonc` preset 欄位、檔案路徑 |
| 有意圖宣告但仍 solo 執行 | 「開發流程」五步強度不足 | 加「非瑣碎 = 必須委派」硬規則 |
| 過度委派瑣碎任務 | `< 20 行` 閾值過低 | 調整 `## 開發流程` 第 3 步的閾值 |
| @oracle 驗證被跳過 | 「不是可選」強度不夠 | 加「若未 @oracle 驗證，交付訊息必須標 `[未經 review]`」 |

## 參考來源

### OmO (oh-my-openagent)

- **Intent Gate / Phase 0**: `dist/index.js:138547`
- **Intent verbalization 映射表**: `dist/index.js:138556`
- **Turn-Local Intent Reset**: `dist/index.js:138582`
- **Context-Completion Gate**: `dist/index.js:138596`
- **Execution Loop (7 步)**: `dist/index.js:138233`
- **Default Bias: DELEGATE**: `dist/index.js:138617`
- **SKILL 成本論述**: `dist/index.js:138264`

### Slim (oh-my-opencode-slim)

- **buildOrchestratorPrompt**: `dist/index.js:18880`
- **resolvePrompt (append 注入機制)**: `dist/index.js:18799`
- **loadAgentPrompt (檔案搜尋邏輯)**: `dist/index.js:18684`
- **PROMPTS_DIR_NAME = "oh-my-opencode-slim"**: `dist/index.js:18593`
- **DEFAULT_DISABLED_AGENTS = ["observer"]**: `dist/index.js:18323`

## 變更歷史

- **初版** (2026-04-23): 從 3 行鼓勵語升級為「意圖門 + 開發流程 + SKILL 優先」三區塊機制
