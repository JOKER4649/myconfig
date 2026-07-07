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
| `oh-my-openagent.jsonc` | Oh My OpenAgent 插件配置：各 agent、category、Team Mode 的模型與功能設定 | 需要為不同 agent 指定模型或啟用插件功能 |
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

### Oh My OpenAgent 文檔

**配置檔案格式**：
- JSON Schema: `https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json`
- 直接閱讀本儲存庫的 `oh-my-openagent.jsonc` 查看實際範例

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
vim oh-my-openagent.jsonc
# legacy 檔名 oh-my-opencode.jsonc 仍可讀取，但同層存在時優先序可能造成混淆
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

### Oh My OpenAgent Team Mode

Team Mode 由 `oh-my-openagent.jsonc` 的 `team_mode` 控制。啟用後需重啟 `opencode`，才會註冊 `team_*` tools。

目前預設 team 放在：

```text
~/.omo/teams/dev-squad/config.json
```

啟動時可讓 lead agent 呼叫：

```js
team_create({ teamName: "dev-squad" })
```

`~/.omo/teams/{name}/config.json` 是 TeamSpec 宣告檔：

- `name`：team 名稱，只能使用小寫英文、數字與 `-`，需與 `{name}` 目錄一致。
- `description`：給人看的用途說明，選填。
- `lead`：team lead。建議使用 `{ "kind": "subagent_type", "subagent_type": "sisyphus" }`；多成員 team 必須有 lead。
- `members`：worker 清單，最多 8 個，名稱不可重複。
- `kind: "category"`：用 category model 建立 worker，必須填 `category` 與 `prompt`。適合 `deep`、`quick`、`writing`、`visual-engineering` 等任務型成員。
- `kind: "subagent_type"`：直接指定 eligible agent，例如 `sisyphus`、`atlas`、`sisyphus-junior`。`oracle`、`librarian`、`explore`、`momus`、`metis`、`prometheus` 不能放進 team，這些應改用一般 delegation。
- `prompt`：該成員的常駐職責。Team Mode 裡成員靠 `team_send_message` 與 `team_task_*` 協作，不應依賴一般文字回覆。
- `worktreePath`：選填；放在 member 上時，該成員會在指定 git worktree 工作，例如 `"worktreePath": "../wt-deep-scout"`。路徑可相對或絕對，但不能只寫 branch name。

驗證：

```bash
bunx oh-my-opencode@4.0.0 doctor --json
```

若 `tmux_visualization` 為 `true`，請在 tmux session 中啟動 `opencode`；team 建立後每個 member 會以 `opencode attach` 顯示在獨立 pane。非 tmux 環境仍可執行 team，只是不會有 pane 可視化。

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
