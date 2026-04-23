# myconfig

備份與同步個人常用工具設定檔的倉庫。

## 結構

| 目錄 | 說明 |
|------|------|
| `opencode/` | [OpenCode](https://opencode.ai) AI 編碼助手設定 |
| `zsh/` | Zsh shell 設定（基於 [Oh My Zsh](https://ohmyz.sh)） |
| `mise/` | [mise](https://mise.jdx.dev) 開發工具版本管理器設定 |
| `starship/` | [Starship](https://starship.rs) 跨 shell 提示字元設定 |
| `tmux/` | [tmux](https://github.com/tmux/tmux) 終端多工器設定 |
| `zellij/` | [Zellij](https://zellij.dev) 終端多工器設定 |
| `biome/` | [Biome](https://biomejs.dev) 全局 formatter 配置（TS/JS/JSON/CSS） |
| `prettier/` | [Prettier](https://prettier.io) 全局 formatter 配置 + plugins（Vue/Astro/Svelte/MD/YAML） |
| `ruff/` | [Ruff](https://docs.astral.sh/ruff/) 全局 Python formatter 配置 |
| `formatters/` | Formatter wrapper scripts（專案配置優先於全局） |
| `backup/` | 每日自動備份腳本（cron 排程，自動 commit + push） |
| `systemd/` | systemd user service 設定（opencode-web、portless-proxy 等） |
| `environment.d/` | systemd user 環境變數（`~/.config/environment.d/`） |
| `fcitx5/` | [Fcitx5](https://fcitx-im.org) 輸入法 XDG autostart 設定 |

## Formatter 架構

opencode 編輯檔案後透過 `formatters/` 下的 wrapper scripts 自動調用：

| Formatter | 處理副檔名 | 全局配置 |
|-----------|-----------|----------|
| **Biome** | `.ts .tsx .js .jsx .mjs .cjs .mts .cts .json .jsonc .css`（含 import 排序） | `biome/biome.jsonc` |
| **Prettier** | `.vue .astro .svelte .md .mdx .yaml .yml .html .scss .sass .less .graphql` | `prettier/.prettierrc.json` |
| **Ruff** | `.py .pyi` | `ruff/ruff.toml` |

**配置優先序**：wrapper 會從檔案所在目錄往上 find-up，找到專案層級的 config 就用專案的，沒找到才 fallback 到全局：

- Biome: 找 `biome.json` / `biome.jsonc`
- Prettier: 找 `.prettierrc*` / `prettier.config.*` / `package.json` 的 `"prettier"` 欄位
- Ruff: 找 `ruff.toml` / `.ruff.toml` / `pyproject.toml` 的 `[tool.ruff]`

詳見 `opencode/opencode.jsonc` 的 `formatter` 欄位與 `formatters/` 下的 shell scripts。

## 新增工具設定

建立以工具名稱命名的新子目錄，將設定檔放入其中。若有需要排除的檔案，在子目錄內建立 `.gitignore`。
