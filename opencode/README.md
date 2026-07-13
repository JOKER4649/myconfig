# opencode-config

OpenCode 的個人配置儲存庫。

## 安裝

```bash
git clone git@github.com:JOKER4649/opencode-config.git ~/.config/opencode
```

## 目錄結構與用途

### 📁 根目錄配置檔

| 檔案 | 用途 | 修改時機 |
|------|------|----------|
| `opencode.jsonc` | OpenCode 主配置：模型、權限、工具、MCP 服務 | 需要變更 AI 模型、調整工具權限、啟用 MCP 服務 |
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

### 自訂 Agent/Command 範例

需要了解如何撰寫自訂 agent 或 command 時：

1. **參考現有檔案**：
   - Agent 範例：`agent/` 目錄下的 `.md` 檔案
   - Command 範例：`command/` 目錄下的 `.md` 檔案

2. **查看 YAML frontmatter 格式**：
   - Agent 使用 `description`、`mode`、`tools` 欄位
   - Command 使用 `agent` 欄位

## 快速修改指南

### 變更 AI 模型

```bash
vim opencode.jsonc
# 修改: "model": "<provider>/<model>"
# 為特定 agent 指定模型：在 "agent" 內加對應 entry
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

### Memory MCP（Hindsight 本地 stack）

`services/hindsight/` 跑起來的話，opencode 端的 MCP key 叫 `memory`，
tools 會以 `memory_retain` / `memory_recall` / `memory_reflect` / `memory_list_banks`
等前綴掛進來（multi-bank 模式，走 `http://127.0.0.1:8888/mcp`，loopback only）。

啟動 stack：

```bash
cd ~/myconfig/services/hindsight && docker compose up -d
curl -fsS http://127.0.0.1:8888/health   # 確認 API ready
```

要綁預設 bank（避免每次呼叫都傳 `bank_id`），在 `opencode.jsonc` 的
`mcp.memory` 內加 `headers: { "X-Bank-Id": "<your-bank>" }` 即可。

`reflect` 會打 LLM，可能踩到預設 30s timeout，失敗手動 retry 即可。

### Hindsight Control Plane（Web UI）

除了 MCP，`hindsight` container 還有一個完整的 Next.js 管理介面跑在
`http://127.0.0.1:9999`（loopback only）。功能比 MCP 視覺化得更完整：

- Memory browser：Constellation / Graph / Table / Timeline 四種 view
- Documents：文字與檔案上傳、extraction mode 設定
- Entities：entity graph + list
- Mental models：列表、history diff、refresh trigger (cron / auto / manual)
- Directives、Webhooks、Audit logs、LLM requests、Failed consolidations
- Search debug 與 Think panel（手動 recall / reflect）

第一次訪問會跳 login page，access key 在 `services/hindsight/.env` 的
`HINDSIGHT_CP_ACCESS_KEY`。沒設這變數 = UI 完全 open；設了之後 = 走 cookie
session。

Port `9999` 已透過 docker-compose 綁 `127.0.0.1`，不對外暴露。

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
