# 本專案 Skill 結構參考

本專案位於 `/home/joker/.config/opencode/`，以下是現有 skill 的結構分析。
建立新 skill 時，參考這些範例以保持一致性。

---

## github-flow

**用途**：GitHub Flow 完整工作流程 SOP（PR、AI Review、合併）。

```
skill/github-flow/
├── SKILL.md
└── references/
    ├── graphql-commands.md      # GraphQL API 指令參考
    └── review-evaluation.md     # AI Review 評估決策框架
```

**Description 風格**：第三人稱 + 觸發短語列表

```yaml
description: >
  This skill should be used when the user asks to "create a PR",
  "push code", "submit for review", "merge a PR", "ship it", "deploy",
  or when completing any code change that goes through the
  branch → PR → AI review → merge workflow.
```

**Body 特點**：
- 四個階段順序執行，每個階段有完成條件
- 詳細指令（GraphQL、決策框架）移至 references/
- Body 中明確引用 references/ 路徑

---

## skill-authoring（本 skill）

**用途**：建立/更新 skill 與提示詞的作業指南。

```
skill/skill-authoring/
├── SKILL.md
└── references/
    └── local-skill-examples.md  # 本檔案
```

**特點**：
- 指向外部 live docs 而非寫死最佳實踐
- 包含驗證清單

---

## 一致性要點

本專案所有 skill 遵循的慣例：

| 項目 | 慣例 |
|------|------|
| 語言 | Body 使用繁體中文，Description 使用英文 |
| Description | 第三人稱 + 5-8 個觸發短語 |
| Body 風格 | 祈使句 |
| 詳細內容 | 移至 references/ |
| 引用 | SKILL.md 中列出 references/ 檔案路徑與用途 |
