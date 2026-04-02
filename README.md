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
| `backup/` | 每日自動備份腳本（cron 排程，自動 commit + push） |
| `systemd/` | systemd user service 設定（opencode-web 等） |

## 新增工具設定

建立以工具名稱命名的新子目錄，將設定檔放入其中。若有需要排除的檔案，在子目錄內建立 `.gitignore`。
