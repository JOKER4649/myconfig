#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["typer"]
# ///
"""輪詢等待 PR 的 CI 完成, 並等待 AI review bots 首次 review 出現。

預設同時等待 gemini-code-assist 與 kilo-code-bot, 兩個 bot 並行 review
以互相補充盲點。
"""

import json
import subprocess
import time
from datetime import datetime
from typing import Annotated

import typer

GEMINI_LOGIN_PREFIX = "gemini-code-assist"
KILO_LOGIN_PREFIX = "kilo-code"

# 視為 "失敗" 的 CheckRun conclusion; 其餘 (NEUTRAL/SKIPPED/STALE) 視為通過。
FAILURE_CONCLUSIONS = {
    "FAILURE",
    "TIMED_OUT",
    "STARTUP_FAILURE",
    "CANCELLED",
    "ACTION_REQUIRED",
}


def _gh_pr_view(pr: str | None) -> dict:
    """呼叫 gh pr view --json 並回傳解析後的字典。"""
    cmd = ["gh", "pr", "view"]
    if pr:
        cmd.append(pr)
    cmd += ["--json", "statusCheckRollup,reviews,comments,number,url"]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def _summarise_checks(rollup: list[dict]) -> tuple[str, bool, bool]:
    """回傳 (摘要字串, 是否全部完成, 是否全部成功)。"""
    if not rollup:
        return "no checks", True, True

    total = len(rollup)
    done = 0
    fail = 0

    for check in rollup:
        if check.get("__typename") == "StatusContext":
            # 舊版 commit status API
            state = (check.get("state") or "").upper()
            if state in {"SUCCESS", "FAILURE", "ERROR"}:
                done += 1
                if state != "SUCCESS":
                    fail += 1
        else:
            # CheckRun (GitHub Actions 等)
            if check.get("status") == "COMPLETED":
                done += 1
                if (check.get("conclusion") or "").upper() in FAILURE_CONCLUSIONS:
                    fail += 1

    summary = f"{done}/{total} done"
    if fail:
        summary += f", {fail} fail"
    return summary, done == total, done == total and fail == 0


def _bot_present(prefix: str, reviews: list[dict], comments: list[dict]) -> bool:
    """偵測指定 login 前綴的 bot 是否已在 reviews 或 comments 中留言。"""
    for item in (reviews or []) + (comments or []):
        login = ((item.get("author") or {}).get("login") or "").lower()
        if login.startswith(prefix):
            return True
    return False


def main(
    pr: Annotated[
        str | None,
        typer.Option(help="PR 編號或 URL (省略則用當前分支的 PR)"),
    ] = None,
    timeout: Annotated[
        int,
        typer.Option(help="超時秒數"),
    ] = 15 * 60,
    interval: Annotated[
        int,
        typer.Option(help="輪詢間隔秒數"),
    ] = 30,
    gemini: Annotated[
        bool,
        typer.Option(
            "--gemini/--no-gemini",
            help="是否等待 gemini-code-assist review (GitHub repo 未裝時用 --no-gemini)",
        ),
    ] = True,
    kilo: Annotated[
        bool,
        typer.Option(
            "--kilo/--no-kilo",
            help="是否等待 kilo-code-bot review (GitHub repo 未裝時用 --no-kilo)",
        ),
    ] = True,
) -> None:
    """輪詢等待 PR 的 CI 完成, 且所有啟用的 AI review bot 都出現首次 review。

    每 --interval 秒透過 gh pr view --json 查詢一次 GitHub。
    預設同時等待 gemini-code-assist 與 kilo-code-bot。

    退出碼:
      0  CI 全部通過且所有啟用的 bot review 已出現
      1  CI 有失敗 (等待條件皆已滿足)
      2  超時
      3  gh CLI 錯誤 (例如當前分支沒有 PR, 或 gh 未安裝)
    """
    deadline = time.time() + timeout
    printed_header = False
    first_iteration = True

    while True:
        try:
            data = _gh_pr_view(pr)
        except (subprocess.CalledProcessError, OSError) as e:
            stderr = getattr(e, "stderr", "") or ""
            msg = stderr.strip() or str(e)
            typer.secho(f"gh pr view 失敗: {msg}", fg="red", err=True)
            raise typer.Exit(3) from e

        if not printed_header:
            typer.echo(f"監看 PR #{data.get('number')} → {data.get('url')}")
            printed_header = True

        rollup = data.get("statusCheckRollup") or []
        reviews = data.get("reviews") or []
        comments = data.get("comments") or []

        ci_summary, ci_done, ci_all_success = _summarise_checks(rollup)

        # 首輪看到空 rollup 不信: GitHub 可能還沒把 CI 註冊進來。
        # 下一輪仍空才視為「真的沒 CI」。
        if first_iteration and not rollup:
            ci_done = False
            ci_summary = "registering…"
        first_iteration = False

        gemini_ready = not gemini or _bot_present(
            GEMINI_LOGIN_PREFIX, reviews, comments
        )
        kilo_ready = not kilo or _bot_present(
            KILO_LOGIN_PREFIX, reviews, comments
        )
        bots_ready = gemini_ready and kilo_ready

        ts = datetime.now().strftime("%H:%M:%S")
        line = f"[{ts}] CI: {ci_summary}"
        if gemini:
            line += f" | gemini: {'ready' if gemini_ready else 'waiting'}"
        if kilo:
            line += f" | kilo: {'ready' if kilo_ready else 'waiting'}"
        typer.echo(line)

        if ci_done and bots_ready:
            break

        if time.time() >= deadline:
            typer.secho(f"⏱ 超時 ({timeout}s), 停止等待", fg="yellow", err=True)
            raise typer.Exit(2)

        time.sleep(interval)

    if ci_all_success:
        typer.secho("✓ CI 全部通過", fg="green")
    else:
        typer.secho("✗ CI 有失敗項目", fg="red")
    if gemini:
        typer.secho("✓ Gemini review 已出現", fg="green")
    if kilo:
        typer.secho("✓ Kilo review 已出現", fg="green")

    raise typer.Exit(0 if ci_all_success else 1)


if __name__ == "__main__":
    typer.run(main)
