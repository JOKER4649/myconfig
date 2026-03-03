---
name: skill-authoring
description: >
  This skill should be used when the user asks to "create a skill",
  "add a new skill", "update a skill", "improve skill description",
  "write a prompt", "update AGENTS.md", "edit system prompt",
  or needs guidance on skill structure, progressive disclosure,
  prompt engineering best practices, or SKILL.md authoring.
---

# Skill 與提示詞撰寫指南

建立或更新 skill、AGENTS.md、command 等提示詞檔案時的作業程序。

---

## 最新最佳實踐（必讀）

Claude 提示詞最佳實踐隨模型版本演進。
每次撰寫或更新提示詞前，先查閱最新官方文件：

1. **Claude 提示詞最佳實踐**：https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices
2. **Agent Skills 概覽**：https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills/overview
3. **Skills 最佳實踐**：https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills/best-practices
4. **System Prompt 指南**：https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/system-prompts

使用 `webfetch` 工具讀取上述 URL 以取得最新內容。
不要依賴記憶中的舊版最佳實踐。

---

## Skill 結構規範

### 目錄結構

```
skill/<skill-name>/
├── SKILL.md              # 必要：metadata + 核心指令
└── references/            # 選用：詳細參考文件（按需載入）
    ├── <detail-1>.md
    └── <detail-2>.md
```

### 三層漸進載入

| 層級 | 載入時機 | Token 成本 | 內容 |
|------|---------|-----------|------|
| Metadata | 永遠（啟動時） | ~100 tokens | `name` + `description` |
| SKILL.md body | Skill 觸發時 | <5k tokens | 核心流程與指令 |
| references/ | 按需 | 無上限 | 詳細指令、範例、腳本 |

### Frontmatter 規範

```yaml
---
name: skill-name          # 小寫、連字號、<=64 字元
description: >            # 第三人稱 + 具體觸發短語
  This skill should be used when the user asks to
  "trigger phrase 1", "trigger phrase 2", "trigger phrase 3",
  or when <scenario description>.
---
```

**Description 要點**：
- 第三人稱（「This skill should be used when...」）
- 包含使用者會說的具體短語
- 去除同義重複（「create a PR」和「open a PR」只保留一個）
- 最大 1024 字元

### Body 撰寫規範

- **祈使句/不定式**：「To accomplish X, do Y」而非「You should do X」
- **精簡**：目標 1,500-2,000 字，上限 3,000 字
- **詳細內容移至 references/**：GraphQL 指令、決策框架、範例等
- **明確引用 references/**：讓 Agent 知道額外資源存在

---

## Skill 建立流程

### 第一步：釐清使用情境

確認具體的使用場景和觸發條件：
- 使用者會說什麼來觸發這個 skill？
- 這個 skill 要解決什麼問題？
- 哪些操作會重複執行？

### 第二步：規劃內容分層

判斷哪些內容放在 SKILL.md body，哪些放在 references/：

| 放在 SKILL.md | 放在 references/ |
|---------------|-----------------|
| 核心流程步驟 | 詳細 API 指令 |
| 快速參考表格 | 完整的決策框架 |
| references/ 的索引 | 範例與模板 |
| 常用指令速查 | 進階技巧與邊界案例 |

### 第三步：撰寫 Description

列出 5-8 個不重複的觸發短語，涵蓋使用者可能的表達方式。

### 第四步：撰寫 Body 與 References

先查閱最新的 Claude 提示詞最佳實踐（見「最新最佳實踐」章節的 URL）。
然後根據最新指南撰寫內容。

### 第五步：驗證

- [ ] Frontmatter 有 `name` 和 `description`
- [ ] Description 使用第三人稱 + 具體觸發短語
- [ ] Body 使用祈使句，非第二人稱
- [ ] Body 字數在 1,500-3,000 字之間
- [ ] 詳細內容已移至 references/
- [ ] SKILL.md 中有引用 references/ 檔案
- [ ] 所有引用的檔案確實存在

---

## AGENTS.md 與其他提示詞

AGENTS.md 是注入到所有 agent 的全局 system prompt。
更新時遵循相同的提示詞原則，並額外注意：

- 保持精簡——每個 agent 都會載入這份檔案
- 只放全局適用的規則（語言偏好、品質標準等）
- 特定領域的指令放在對應的 skill 或 command 中

---

## 補充資源

### Reference Files

- **`references/local-skill-examples.md`** — 本專案現有 skill 的結構分析，作為撰寫新 skill 的參考

### 外部文件（查閱最新版）

- Anthropic 官方提示詞指南：https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/claude-4-best-practices
- Agent Skills 文件：https://docs.anthropic.com/en/docs/agents-and-tools/agent-skills/overview
