#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["typer"]
# ///
"""輪詢等待 PR 的 CI 完成, 並等待 kilo-code-bot review 完成。

kilo-code-bot 以 GitHub App 運作, 會在 PR checks 中建立一個 CheckRun
(name 為 "Kilo Code Review")。該 CheckRun 的 status 即判斷 kilo
當前這一輪是否處理完成的唯一可靠訊號 (見 SKILL.md 的「為什麼不能靠
review 出現判斷完成」)。

本工具刻意將 kilo 的 CheckRun 從 CI 統計中隔離出來單獨報告,
避免「kilo 抓到 critical」被混進「CI 失敗」語意。
"""

import json
import subprocess
import time
from datetime import datetime
from typing import Annotated

import typer

# kilo 的 CheckRun name 識別: 不分大小寫的子串比對。
# 實測 name 為 "Kilo Code Review"; kilo 的 CheckRun creator 為 null,
# 無法用 author login 識別, 只能用 name。
KILO_CHECK_NAME_HINT = "kilo"

# 視為 "失敗" 的 CheckRun conclusion; 其餘 (NEUTRAL/SKIPPED/STALE/SUCCESS) 視為通過。
FAILURE_CONCLUSIONS = {
    "FAILURE",
    "TIMED_OUT",
    "STARTUP_FAILURE",
    "CANCELLED",
    "ACTION_REQUIRED",
}

# kilo 未出現時, 多久後提示用戶可能未安裝。
KILO_ABSENT_HINT_SECONDS = 60


def _gh_pr_view(pr: str | None) -> dict:
    """呼叫 gh pr view --json 並回傳解析後的字典。"""
    cmd = ["gh", "pr", "view"]
    if pr:
        cmd.append(pr)
    cmd += ["--json", "statusCheckRollup,number,url"]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def _is_kilo_check(check: dict) -> bool:
    """判斷一個 rollup 條目是否為 kilo 的 CheckRun。

    kilo 的 CheckRun creator 為 null, 只能靠 name 不分大小寫包含 'kilo'。
    """
    if check.get("__typename") != "CheckRun":
        return False
    name = (check.get("name") or "").lower()
    return KILO_CHECK_NAME_HINT in name


def _split_rollup(rollup: list[dict]) -> tuple[list[dict], list[dict]]:
    """將 rollup 拆成 (CI 檢查項, kilo check 項)。"""
    ci: list[dict] = []
    kilo: list[dict] = []
    for check in rollup or []:
        (kilo if _is_kilo_check(check) else ci).append(check)
    return ci, kilo


def _summarise_checks(rollup: list[dict]) -> tuple[str, bool, bool]:
    """回傳 (摘要字串, 是否全部完成, 是否全部成功)。僅處理 CI 部分。"""
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


def _kilo_status(kilo_checks: list[dict]) -> tuple[bool, bool, bool, str]:
    """回傳 (check 是否存在, 是否完成, 是否失敗, 顯示用標籤)。"""
    if not kilo_checks:
        return False, False, False, "absent"

    check = kilo_checks[0]
    status = check.get("status")
    conclusion = (check.get("conclusion") or "").upper()

    if status == "COMPLETED":
        failed = conclusion in FAILURE_CONCLUSIONS
        label = f"completed ({conclusion or 'NONE'})"
        return True, True, failed, label

    label = (status or "unknown").lower()
    if status == "IN_PROGRESS":
        label = "in_progress"
    elif status == "QUEUED":
        label = "queued"
    return True, False, False, label


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
    kilo: Annotated[
        bool,
        typer.Option(
            "--kilo/--no-kilo",
            help="是否等待 kilo-code-bot review (GitHub repo 未裝時用 --no-kilo)",
        ),
    ] = True,
) -> None:
    """輪詢等待 PR 的 CI 完成, 且 kilo-code-bot review 的 CheckRun 已 COMPLETED。

    每 --interval 秒透過 gh pr view --json 查詢一次 GitHub。

    kilo 的 CheckRun (name 為 "Kilo Code Review") 從 CI 統計中隔離,
    單獨報告其狀態; 因 kilo 的 review 物件 body 永遠為空、summary
    comment 為原地更新, 無法靠 review/comment 出現判斷增量是否審完,
    只能靠 CheckRun status=COMPLETED。

    退出碼:
      0  CI 全部通過且 kilo review 完成且無 critical
      1  CI 有失敗, 或 kilo 結論為 FAILURE (等待條件皆已滿足)
      2  超時
      3  gh CLI 錯誤 (例如當前分支沒有 PR, 或 gh 未安裝)
    """
    deadline = time.time() + timeout
    start = time.time()
    printed_header = False
    first_iteration = True
    kilo_absent_warned = False

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
        ci_checks, kilo_checks = _split_rollup(rollup)

        ci_summary, ci_done, ci_all_success = _summarise_checks(ci_checks)
        kilo_exists, kilo_done, kilo_failed, kilo_label = _kilo_status(kilo_checks)

        # 首輪看到空 rollup 不信: GitHub 可能還沒把 CI/kilo 註冊進來。
        # 下一輪仍空才視為「真的沒 CI」。
        if first_iteration and not rollup:
            ci_done = False
            ci_summary = "registering…"
        first_iteration = False

        # kilo 啟用但久未出現其 CheckRun: 提示可能未安裝 (只警告一次)。
        if (
            kilo
            and not kilo_exists
            and not kilo_absent_warned
            and (time.time() - start) >= KILO_ABSENT_HINT_SECONDS
        ):
            typer.secho(
                "⚠ 未偵測到 kilo CheckRun (已等待 "
                f"{KILO_ABSENT_HINT_SECONDS}s); 確認 repo 是否安裝 kilo, "
                "否則改用 --no-kilo",
                fg="yellow",
                err=True,
            )
            kilo_absent_warned = True

        kilo_ready = (not kilo) or kilo_done

        ts = datetime.now().strftime("%H:%M:%S")
        line = f"[{ts}] CI: {ci_summary}"
        if kilo:
            line += f" | kilo: {kilo_label}"
        typer.echo(line)

        if ci_done and kilo_ready:
            break

        if time.time() >= deadline:
            typer.secho(f"⏱ 超時 ({timeout}s), 停止等待", fg="yellow", err=True)
            raise typer.Exit(2)

        time.sleep(interval)

    if ci_all_success:
        typer.secho("✓ CI 全部通過", fg="green")
    else:
        typer.secho("✗ CI 有失敗項目", fg="red")
    if kilo:
        if kilo_failed:
            typer.secho("✗ Kilo review 完成, 但結論為 FAILURE (有 critical findings)", fg="red")
        else:
            typer.secho("✓ Kilo review 完成", fg="green")

    ci_failed = not ci_all_success
    raise typer.Exit(1 if (ci_failed or kilo_failed) else 0)


if __name__ == "__main__":
    typer.run(main)
