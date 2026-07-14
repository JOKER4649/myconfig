// 当 bash 工具执行 `gh pr` 命令时，在 tool_result 追加提醒，
// 引导 agent 先读取 skill://github-pr-master 并遵循其流程。

import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/** 匹配 `gh pr` 命令（词边界，避免 gh preview / gh projects）。 */
export const GH_PR_RE = /\bgh\s+pr\b/;

/** 提醒文本（简体中文），导出供测试断言。 */
export const GH_PR_REMINDER =
  "提醒：检测到 `gh pr`，请先读取 `skill://github-pr-master` 并遵循其流程。";

interface TextChunk {
  type: string;
  text?: string;
  [key: string]: unknown;
}

export default function (pi: ExtensionAPI): void {
  pi.on("tool_result", async (event) => {
    if (event.toolName !== "bash" || event.isError) return;

    const cmd = String(event.input?.command ?? "");
    if (!GH_PR_RE.test(cmd)) return;

    const content = event.content as TextChunk[];
    return { content: [...content, { type: "text", text: GH_PR_REMINDER }] };
  });
}
