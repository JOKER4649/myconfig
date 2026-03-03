# opencode-config

OpenCode 和 Oh-My-OpenCode 的個人配置儲存庫。

## 安裝

```bash
git clone git@github.com:JOKER4649/opencode-config.git ~/.config/opencode
```

## 目錄結構與用途

### 📁 根目錄配置檔

| 檔案 | 用途 | 修改時機 |
|------|------|----------|
| `opencode.jsonc` | OpenCode 主配置：模型、權限、工具、MCP 服務 | 需要變更 AI 模型、調整工具權限、啟用 MCP 服務 |
| `oh-my-opencode.jsonc` | Oh-My-OpenCode 插件配置：各 agent 的模型設定 | 需要為不同 agent 指定不同模型 |
| `AGENTS.md` | 全局 system prompt 注入（所有 agent 共用） | 需要變更語言偏好或添加全局行為規則 |

### 📁 `agent/` - 自訂 Agent 定義

**用途**：存放自訂的 subagent 定義，每個 `.md` 檔案定義一個 agent。

**格式**：
```markdown
---
description: Agent 觸發條件說明
mode: subagent
tools:
  write: false
  edit: false
---
Agent 的 system prompt
```

**現有 Agent**：
- `git-committer.md` - Git commit 訊息產生
- `review.md` - 程式碼審查

**何時新增**：需要創建專門處理特定任務的 agent 時。

### 📁 `command/` - 自訂指令定義

**用途**：存放自訂的 slash command，透過 `/指令名` 觸發。

**格式**：
```markdown
---
agent: agent
---
指令的執行邏輯和流程
```

**現有指令**：
- `pr.md` - Pull Request 建立流程

**何時新增**：需要定義可重複使用的工作流程時。

## 文檔查詢指南

### OpenCode 官方文檔

**配置檔案格式**：
- JSON Schema: `https://opencode.ai/config.json`
- 直接閱讀本儲存庫的 `opencode.jsonc` 查看實際範例

**可配置項目**：
- `model`: AI 模型選擇
- `plugin`: 插件列表
- `permission`: 工具權限管理（allow/ask/deny）
- `agent`: 特定 agent 的權限覆寫
- `tools`: 工具啟用/停用
- `mcp`: Model Context Protocol 服務配置
- `keybinds`: 快捷鍵設定

### Oh-My-OpenCode 文檔

**配置檔案格式**：
- JSON Schema: `https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/assets/oh-my-opencode.schema.json`
- 直接閱讀本儲存庫的 `oh-my-opencode.jsonc` 查看實際範例

**可配置項目**：
- `auto_update`: 自動更新開關
- `sisyphus_agent`: Sisyphus agent 設定
- `agents`: 各 agent 的模型映射

**可用的 Agent 類型**：
- `Sisyphus` - 主要協調 agent
- `oracle` - 第二意見提供
- `librarian` - 程式碼/文件分析
- `explore` - 網路搜尋
- `frontend-ui-ux-engineer` - 前端 UI/UX
- `document-writer` - 文件撰寫
- `multimodal-looker` - 視覺理解

### 自訂 Agent/Command 範例

需要了解如何撰寫自訂 agent 或 command 時：

1. **參考現有檔案**：
   - Agent 範例：`agent/git-committer.md`
   - Command 範例：`command/pr.md`

2. **查看 YAML frontmatter 格式**：
   - Agent 使用 `description`、`mode`、`tools` 欄位
   - Command 使用 `agent` 欄位

## 快速修改指南

### 變更 AI 模型

```bash
# 方法 1: 變更預設模型（影響所有 agent）
vim opencode.jsonc
# 修改: "model": "github-copilot/claude-sonnet-4.5"

# 方法 2: 為特定 agent 設定模型
vim oh-my-opencode.jsonc
# 在 "agents" 下添加或修改對應的 agent
```

### 新增權限規則

```bash
vim opencode.jsonc
# 在 "permission" > "bash" 下添加規則
# 格式: "指令模式": "allow" | "ask" | "deny"
```

### 啟用 MCP 服務

```bash
vim opencode.jsonc
# 在 "mcp" 下找到對應服務，設定 "enabled": true
# 設定必要的環境變數（如 API token）
```

### 添加全局行為規則

```bash
vim AGENTS.md
# 添加新的規則，會自動注入到所有 agent
```

## 同步配置

```bash
# 提交修改
git add .
git commit -m "描述變更內容"
git push

# 在其他機器同步
git pull
```
