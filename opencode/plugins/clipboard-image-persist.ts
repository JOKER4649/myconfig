// Clipboard Image Persist Plugin
// 拦截粘贴到 OpenChamber 的 data: URL 图片,落盘到 /tmp/clipboard-images/,
// 并在 message 末尾 push 一条 text hint,供主模型不支持视觉时让 vision subagent 读取。
//
// Hook: experimental.chat.messages.transform
// 1.3.3 SDK 的 transform hook input 为空对象,server 侧 Part 已被分配 id。

import type { Plugin } from "@opencode-ai/plugin"
import { createHash } from "node:crypto"
import { mkdir } from "node:fs/promises"

const IMAGE_DIR = "/tmp/clipboard-images"
const DATA_URL_RE = /^data:([^;]+);base64,(.+)$/
const EXT_MAP: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
}

function extFor(mime: string): string {
  return EXT_MAP[mime] ?? "png"
}

function filePathFor(mime: string, base64: string): string {
  const hash = createHash("md5").update(base64).digest("hex").slice(0, 12)
  return `${IMAGE_DIR}/${hash}.${extFor(mime)}`
}

export default (async () => {
  await mkdir(IMAGE_DIR, { recursive: true }).catch(() => {})

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      for (const msg of output.messages) {
        if (msg.info.role !== "user") continue
        if ((msg.info as any).summary === true) continue

        const persisted: string[] = []
        for (const part of msg.parts) {
          if (part.type !== "file") continue
          if (typeof part.mime !== "string" || !part.mime.startsWith("image/")) continue
          if (typeof part.url !== "string" || !part.url.startsWith("data:")) continue

          const m = DATA_URL_RE.exec(part.url)
          if (!m) continue
          const [, mime, base64] = m

          const filePath = filePathFor(mime, base64)
          persisted.push(filePath)

          if (await Bun.file(filePath).exists()) continue

          try {
            await Bun.write(filePath, Buffer.from(base64, "base64"))
          } catch {
            // 写盘失败静默跳过,避免 block 整条 message
          }
        }

        if (persisted.length === 0) continue

        const blocks = persisted.map(
          (p) =>
            `[clipboard-image-persist] 以下 image part 已存到磁碟: ${p}\n` +
            `若你無法直接查看 image part(主模型不支援視覺),可用 vision subagent 讀取此檔案路徑`,
        )
        msg.parts.push({ type: "text", text: blocks.join("\n") } as any)
      }
    },
  }
}) satisfies Plugin
