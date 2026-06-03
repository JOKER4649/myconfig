// ============================================================
// HTTP Server — OpenAI-compatible /v1/chat/completions → ACP
// ============================================================
import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { execSync } from "node:child_process";
import { AcpClient, type PromptChunk } from "./acp-client";
import { textChunk, finishChunk, doneEvent, errorChunk } from "./sse";

// ---- 型別 ----

interface ChatCompletionRequest {
  model?: string;
  messages?: Array<{ role: string; content: string | unknown }>;
  stream?: boolean;
}

/** 結構化文字格式選項 */
export type FormatStyle = "concise" | "detailed";

export interface AcpHttpServerOptions {
  debug?: boolean;
  /** 顯示工具呼叫與結果（default: true） */
  showTools?: boolean;
  /** 顯示思考/推理 chunk（default: true） */
  showThinking?: boolean;
  /** 格式風格（default: "concise"） */
  format?: FormatStyle;
}

// ---- chunk → 結構化文字 formatter ----

interface FormatterContext {
  showTools: boolean;
  showThinking: boolean;
  format: FormatStyle;
}

/** 將 PromptChunk 轉為使用者可讀的結構化文字；null 表示略過 */
export function formatChunk(ctx: FormatterContext, chunk: PromptChunk): string | null {
  switch (chunk.type) {
    case "text":
      return chunk.text;

    case "tool_start":
      if (!ctx.showTools) return null;
      return ctx.format === "concise"
        ? `\n🔧 ${chunk.kind}: ${chunk.title}\n`
        : `\n[Tool: ${chunk.kind}] ${chunk.title}\n`;

    case "tool_progress":
      if (!ctx.showTools) return null;
      return ctx.format === "concise"
        ? `  ⏳ ${chunk.status}\n`
        : `[Tool: ${chunk.status}]\n`;

    case "tool_done":
      if (!ctx.showTools) return null;
      return ctx.format === "concise"
        ? `  ${chunk.status === "failed" ? "✗" : "✓"} ${chunk.status}\n`
        : `[Tool result: ${chunk.status}]\n`;

    case "tool_output":
      if (!ctx.showTools) return null;
      // tool output 內部通常已有換行（如 "HELLO\nDONE\n"）
      // 我們加 \n 包圍確保與其他內容分開
      return ctx.format === "concise"
        ? `\n${chunk.text}\n`
        : `\n[Tool Output]\n${chunk.text}\n`;

    case "thinking":
      if (!ctx.showThinking) return null;
      return ctx.format === "concise"
        ? `💭 ${chunk.text}\n`
        : `[Thinking] ${chunk.text}\n`;
  }
}

// ============================================================

export class AcpHttpServer {
  private server: Server | null = null;
  private acp: AcpClient;
  private debug: boolean;
  private showTools: boolean;
  private showThinking: boolean;
  private format: FormatStyle;
  private logPrefix = "[acp-http]";
  private port = 0;

  constructor(acp: AcpClient, opts?: AcpHttpServerOptions) {
    this.acp = acp;
    this.debug = opts?.debug ?? false;
    this.showTools = opts?.showTools ?? true;
    this.showThinking = opts?.showThinking ?? true;
    this.format = opts?.format ?? "concise";
  }

  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  get baseUrl(): string {
    return `${this.url}/v1`;
  }

  async start(preferredPort?: number): Promise<number> {
    this.server = createServer((req, res) => this.handleRequest(req, res));

    const port = await new Promise<number>((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE" && preferredPort) {
          // fallback to random port
          this.server!.listen(0, "127.0.0.1", () => {
            const addr = this.server!.address();
            resolve(typeof addr === "object" ? addr.port : 0);
          });
        } else {
          reject(err);
        }
      };

      this.server!.once("error", onError);
      this.server!.listen(preferredPort ?? 0, "127.0.0.1", () => {
        this.server!.removeListener("error", onError);
        const addr = this.server!.address();
        resolve(typeof addr === "object" ? addr.port : 0);
      });
    });

    this.port = port;
    this.info(`listening on http://127.0.0.1:${port}`);
    return port;
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  // ---- request routing ----

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    try {
      if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/v1/health")) {
        this.sendJson(res, 200, { ok: true, ready: this.acp.ready });
        return;
      }

      if (req.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
        await this.handleModels(res);
        return;
      }

      if (
        req.method === "POST" &&
        (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")
      ) {
        await this.handleChatCompletion(req, res);
        return;
      }

      // 404
      this.sendJson(res, 404, { error: `Unsupported: ${req.method} ${url.pathname}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.warn(`unhandled error: ${msg}`);
      if (!res.headersSent) {
        this.sendJson(res, 500, { error: msg });
      }
    }
  }

  // ---- models endpoint ----

  private async handleModels(res: ServerResponse): Promise<void> {
    try {
      const raw = execSync("cursor-agent models", { encoding: "utf-8", timeout: 15000 });
      const models: Array<{ id: string; object: string; created: number; owned_by: string }> = [];
      for (const line of raw.split("\n")) {
        const m = line.match(/^([a-z0-9._-]+)\s+-/i);
        if (m) {
          models.push({
            id: m[1],
            object: "model",
            created: Math.floor(Date.now() / 1000),
            owned_by: "cursor",
          });
        }
      }
      this.sendJson(res, 200, { object: "list", data: models });
    } catch {
      this.sendJson(res, 500, { error: "Failed to fetch models" });
    }
  }

  // ---- chat completions ----

  private async handleChatCompletion(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);
    let parsed: ChatCompletionRequest;
    try {
      parsed = JSON.parse(body);
    } catch {
      this.sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const model = parsed.model ?? "auto";
    const messages = parsed.messages ?? [];
    const stream = parsed.stream !== false; // default stream=true

    // build text prompt from messages
    const prompt = this.buildPrompt(messages);
    if (!prompt) {
      this.sendJson(res, 400, { error: "No prompt content" });
      return;
    }

    if (!stream) {
      // non-stream: call acp, collect all text (含結構化 prefix), return single response
      try {
        const sessionId = await this.acp.createSession(process.cwd());
        let fullText = "";
        const ctx: FormatterContext = {
          showTools: this.showTools,
          showThinking: this.showThinking,
          format: this.format,
        };
        await this.acp.prompt(sessionId, prompt, (chunk) => {
          const formatted = formatChunk(ctx, chunk);
          if (formatted) fullText += formatted;
        });
        const payload = {
          id: `acp-${Date.now()}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: fullText },
              finish_reason: "stop",
            },
          ],
        };
        this.sendJson(res, 200, payload);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.sendJson(res, 500, { error: msg });
      }
      return;
    }

    // stream mode
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    const id = `acp-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const sseOpts = { id, created, model };
    let streamEnded = false;

    const safeWrite = (data: string) => {
      if (!streamEnded && !res.writableEnded) {
        res.write(data);
      }
    };

    const ctx: FormatterContext = {
      showTools: this.showTools,
      showThinking: this.showThinking,
      format: this.format,
    };

    try {
      const sessionId = await this.acp.createSession(process.cwd());
      await this.acp.prompt(sessionId, prompt, (chunk) => {
        const formatted = formatChunk(ctx, chunk);
        if (formatted === null) return; // 略過此 chunk（被 option 關閉）
        safeWrite(textChunk(sseOpts, formatted));
      });
      // session/prompt resolve 才 emit 結束事件，不在工具執行中提前結束
      safeWrite(finishChunk(sseOpts));
      safeWrite(doneEvent());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.warn(`prompt error: ${msg}`);
      safeWrite(errorChunk(sseOpts, msg));
      safeWrite(doneEvent());
    } finally {
      streamEnded = true;
      if (!res.writableEnded) res.end();
    }
  }

  // ---- helpers ----

  private buildPrompt(messages: Array<{ role: string; content: string | unknown }>): string {
    const lines: string[] = [];
    for (const msg of messages) {
      const role = msg.role ?? "user";
      if (role === "system") {
        lines.push(`Instructions: ${this.extractText(msg.content)}`);
      } else if (role === "tool") {
        lines.push(`Tool result: ${this.extractText(msg.content)}`);
      } else {
        const text = this.extractText(msg.content);
        if (text) lines.push(text);
      }
    }
    return lines.join("\n\n");
  }

  private extractText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((p: any) => (p?.type === "text" ? p.text : ""))
        .filter(Boolean)
        .join("\n");
    }
    return "";
  }

  private sendJson(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  private info(msg: string): void {
    if (this.debug) console.error(`${this.logPrefix} ${msg}`);
  }

  private warn(msg: string): void {
    console.error(`${this.logPrefix} WARN ${msg}`);
  }
}

// ---- utils ----

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
