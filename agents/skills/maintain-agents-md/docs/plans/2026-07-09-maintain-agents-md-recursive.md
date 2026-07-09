# maintain-agents-md 加入遞迴 AGENTS.md 與註解分層 — 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 改寫 `agents/skills/maintain-agents-md/SKILL.md`,把 skill 從「只管 root AGENTS.md」擴展為「管 root + 子目錄 AGENTS.md」,並加入「根 / 子目錄 / 檔案註解」三層分層規則。

**Architecture:** 由於結構變動大(從 66 行 → 約 110 行,新增 5 個段落,改寫 4 個),用 `write` 一次性重寫比用 `edit` 串接多次更易管理。Task 1 重寫 SKILL.md,Task 2 驗證並 commit。

**Tech Stack:** Markdown(SKILL.md 純文件),git。

## Global Constraints

- 語系:繁體中文
- 風格:`**粗體**` 標記關鍵詞、子項用 `-`、表格用 `|` 分隔
- 不要 emoji
- 不要寫註解(除非既有慣例明顯要求)
- `agents/` 目錄透過 `link.py` symlink 到 `~/.agents/`,git tracked 版本在 `myconfig/`
- 既有 SKILL.md 共 66 行,本次重寫後預期約 110 行(增量來自三層分層表、對照表、子目錄觸發口訣)

---

## Reference Files

- 設計規格: `agents/skills/maintain-agents-md/docs/2026-07-09-recursive-agents-md-design.md`
- 既有 SKILL.md: `agents/skills/maintain-agents-md/SKILL.md`(被 Task 1 覆寫)
- link.py: `link.py`(sync 到 `~/.agents/` 用,但本次 commit 後由用戶自行決定是否 sync)

---

### Task 1: 重寫 SKILL.md

**Files:**
- Modify: `agents/skills/maintain-agents-md/SKILL.md`(整檔覆寫)

**介面:** 無(單檔純文件重寫)

**設計來源:** 完整內容以設計規格的「完整 SKILL.md 草稿」section 為準。本任務的實作者應先讀 `agents/skills/maintain-agents-md/docs/2026-07-09-recursive-agents-md-design.md` 的「完整 SKILL.md 草稿」section,然後照寫。

- [ ] **Step 1: 讀設計規格的「完整 SKILL.md 草稿」section**

讀: `agents/skills/maintain-agents-md/docs/2026-07-09-recursive-agents-md-design.md`

定位到「完整 SKILL.md 草稿」section(`## 完整 SKILL.md 草稿` 之下,直到 `## 開放議題` 之前)。裡面有完整可貼上的 SKILL.md 內容。

- [ ] **Step 2: 用 `write` 覆寫 SKILL.md**

把設計規格中「完整 SKILL.md 草稿」section 的內容(從 `---` frontmatter 開始,到「跨層調整時考慮三層分層」那行結束)寫入 `agents/skills/maintain-agents-md/SKILL.md`。

**重要細節**:
- 保留 frontmatter 中的 `name` 為 `maintain-agents-md`
- description 改寫為新版本(含「子目錄 AGENTS.md」「三層分層」關鍵字)
- 段落順序依照設計規格的草稿(1. 適用範圍 → 2. 內容原則 → 3. 抽象層級規則 → 4. 建議章節(共同) → 5. 根 AGENTS.md 專屬 → 6. 子目錄 AGENTS.md 專屬 → 7. 子目錄 AGENTS.md 何時該建 → 8. 工作流程(含子目錄流程差異) → 9. 觸發情境的隱含提醒)
- 三張對照表(抽象層級、根不該寫什麼、子目錄不該寫什麼)都用 markdown table 語法
- 風格:`**粗體**` 標記關鍵詞、子項用 `-`、不寫註解、不用 emoji

- [ ] **Step 3: 重讀 SKILL.md 確認完整**

讀: `agents/skills/maintain-agents-md/SKILL.md`

驗證:
- frontmatter 完整且 description 是新版本
- 9 個段落齊全(適用範圍、內容原則、抽象層級規則、建議章節(共同)、根 AGENTS.md 專屬、子目錄 AGENTS.md 專屬、子目錄 AGENTS.md 何時該建、工作流程、觸發情境的隱含提醒)
- 三張對照表內容正確
- 無 TBD / TODO / placeholder
- 行數預期約 100-115 行

- [ ] **Step 4: 與設計規格草稿做 diff 確認一致**

執行: `diff <(awk '/^## 完整 SKILL.md 草稿/,/^## 開放議題/' agents/skills/maintain-agents-md/docs/2026-07-09-recursive-agents-md-design.md | sed '1d;$d' | sed '/^$/d') <(sed '/^$/d' agents/skills/maintain-agents-md/SKILL.md)`

預期: 無輸出(diff 為空),代表兩者內容一致。

**注意**:這條 diff 命令需要兩份檔案的空白行處理一致。若 diff 有輸出且僅是空白行差異,屬正常;若有實質內容差異,需要修。

---

### Task 2: 提交變更

**Files:**
- Modify: `agents/skills/maintain-agents-md/SKILL.md`(已由 Task 1 重寫)
- Add: `agents/skills/maintain-agents-md/docs/2026-07-09-recursive-agents-md-design.md`(設計規格)
- Add: `agents/skills/maintain-agents-md/docs/plans/2026-07-09-maintain-agents-md-recursive.md`(本計畫)

**介面:** 無

- [ ] **Step 1: 檢查 git status 確認要提交的檔案**

執行: `git status agents/skills/maintain-agents-md/`

預期看到:
- `modified: agents/skills/maintain-agents-md/SKILL.md`
- `new file: agents/skills/maintain-agents-md/docs/2026-07-09-recursive-agents-md-design.md`
- `new file: agents/skills/maintain-agents-md/docs/plans/2026-07-09-maintain-agents-md-recursive.md`

若看到其他不預期的變更,**不要** commit,先跟用戶確認。

- [ ] **Step 2: stage 三個檔案**

執行:
```bash
cd /home/joker/myconfig
git add agents/skills/maintain-agents-md/SKILL.md
git add agents/skills/maintain-agents-md/docs/2026-07-09-recursive-agents-md-design.md
git add agents/skills/maintain-agents-md/docs/plans/2026-07-09-maintain-agents-md-recursive.md
```

- [ ] **Step 3: 確認 staged 內容**

執行: `git diff --cached --stat agents/skills/maintain-agents-md/`

預期: 三個檔案都已 staged,SKILL.md 顯示為 modified 且行數變動約 +40~+50 行。

- [ ] **Step 4: commit**

執行:
```bash
cd /home/joker/myconfig
git commit -m "agents/skills/maintain-agents-md: 加入遞迴 AGENTS.md 與三層分層規則

- 擴展適用範圍到 root + 子目錄 AGENTS.md
- 新增「抽象層級規則(三層分層)」段落:根 / 子目錄 / 檔案註解
- 新增「子目錄 AGENTS.md 何時該建」口訣(跨 3+ 檔案通用 / 領域慣例 / 專屬注意事項)
- 在根 / 子目錄段落加入「不該寫什麼 → 應寫到哪裡」對照表
- 工作流程改為共用 4 步 + 子目錄差異化步驟
- 觸發情境提醒新增「跨層調整時考慮三層分層」"
```

預期: commit 成功,無 hook 阻擋。

- [ ] **Step 5: 驗證 commit**

執行: `git log --oneline -3 -- agents/skills/maintain-agents-md/`

預期: 看到新的 commit 在最上面,訊息符合 Step 4。

---

## Self-Review Checklist

- [x] 規格覆蓋:設計規格的所有段落(1-9 段 + frontmatter)都對應到 Task 1 的內容
- [x] Placeholder 掃描:無 TBD/TODO
- [x] 類型一致性:N/A(純文件,無函數簽名)
- [x] 檔案路徑正確:`agents/skills/maintain-agents-md/SKILL.md` 是 git tracked 位置
- [x] Commit 訊息風格:繁體中文,簡潔,符合既有 `053f54c agents/skills: 新增 maintain-agents-md skill` 風格