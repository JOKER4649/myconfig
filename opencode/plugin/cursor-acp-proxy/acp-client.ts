// ============================================================
// ACP JSON-RPC Client — 管理 cursor-agent acp 持久 process
// ============================================================
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import type {
  InitializeParams,
  SessionNewResult,
  SessionPromptResult,
  SessionUpdateNotification,
} from "./types";

// ---- pending request ----

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ---- notification handler ----

type NotificationHandler = (params: unknown) => void;

// ---- public result types ----

/** 工具呼叫狀態 */
export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

/** prompt streaming chunk — server 端依據 type 格式化為 SSE 文字 */
export type PromptChunk =
  | { type: "text"; text: string }
  | {
      type: "tool_start";
      toolCallId: string;
      title: string;
      kind: string;
      rawInput: unknown;
    }
  | { type: "tool_progress"; toolCallId: string; status: ToolCallStatus }
  | { type: "tool_done"; toolCallId: string; status: ToolCallStatus }
  | { type: "tool_output"; toolCallId: string; text: string }
  | { type: "thinking"; text: string };

export interface PromptResult {
  stopReason: string;
}

// ============================================================

export class AcpClient {
  private proc: ChildProcess | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private notifHandlers = new Map<string, NotificationHandler[]>();
  private logPrefix: string;
  private debug: boolean;
  private _ready = false;
  private exitCleanupRegistered = false;

  constructor(opts?: { debug?: boolean }) {
    this.debug = opts?.debug ?? false;
    this.logPrefix = "[acp-client]";
  }

  // ---- public API ----

  get ready(): boolean {
    return this._ready && this.proc !== null && !this.proc.killed;
  }

  /** 啟動 cursor-agent acp process 並完成 initialize + authenticate */
  async start(): Promise<void> {
    if (this.ready) return;

    const cmd = "cursor-agent";
    const args = ["acp"];
    this.info(`spawning: ${cmd} ${args.join(" ")}`);

    this.proc = spawn(cmd, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    this.registerExitCleanup();

    // readline on stdout
    const rl = createInterface({ input: this.proc.stdout! });
    rl.on("line", (line: string) => this.handleLine(line));

    // stderr logging
    if (this.debug && this.proc.stderr) {
      this.proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (text) this.info(`stderr: ${text.slice(0, 200)}`);
      });
    }

    // crash handler
    this.proc.on("exit", (code) => {
      this.warn(`process exited with code ${code}`);
      this._ready = false;
      this.rejectAllPending(new Error(`cursor-agent acp exited (code ${code})`));
    });

    this.proc.on("error", (err) => {
      this.warn(`process error: ${err.message}`);
      this._ready = false;
      this.rejectAllPending(err);
    });

    // initialize
    const initParams: InitializeParams = {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: "opencode-cursor-acp-proxy", version: "0.1.0" },
    };
    await this.send("initialize", initParams);
    this.info("acp initialized");

    // authenticate
    await this.send("authenticate", { methodId: "cursor_login" });
    this.info("acp authenticated");

    this._ready = true;
    this.info("acp client ready");
  }

  /** 停止 process */
  async stop(): Promise<void> {
    this.info("stopping");
    this._ready = false;
    if (this.proc && !this.proc.killed) {
      this.proc.stdin?.end();
      this.proc.kill();
      // wait a moment for cleanup
      await new Promise((r) => setTimeout(r, 300));
    }
    this.rejectAllPending(new Error("client stopped"));
  }

  /** 建立新 session */
  async createSession(cwd: string): Promise<string> {
    const result = (await this.send("session/new", {
      cwd,
      mcpServers: [],
    })) as SessionNewResult;
    this.info(`session created: ${result.sessionId}`);
    return result.sessionId;
  }

  /** 發送 prompt，透過 callback 接收 streaming chunks (text / tool_call / thinking) */
  async prompt(
    sessionId: string,
    text: string,
    onChunk: (chunk: PromptChunk) => void,
  ): Promise<PromptResult> {
    // stateful tracking: 區分「首次見到 toolCallId」vs「後續 status 變化」
    // cursor agent 可能發 pending → in_progress → completed，也可能直接 completed
    const seenToolCalls = new Set<string>();
    let thinkingBuffer = "";
    const thinkingFlush = () => {
      if (thinkingBuffer) {
        onChunk({ type: "thinking", text: thinkingBuffer });
        thinkingBuffer = "";
      }
    };

    const handler = (params: unknown) => {
      const notif = params as SessionUpdateNotification;
      const update = notif?.update;
      if (!update) return;
      const su = update.sessionUpdate;

      // 1) agent 最終回應文字
      if (su === "agent_message_chunk" && update.content?.type === "text") {
        thinkingFlush();
        const t = update.content.text;
        if (t) onChunk({ type: "text", text: t });
        return;
      }

      // 2) agent 思考/推理（推測存在，視情況處理）
      if (su === "agent_thought_chunk" && update.content?.type === "text") {
        const t = update.content.text;
        if (t) thinkingBuffer += t;
        return;
      }

      // 3) 工具呼叫
      if (su === "tool_call") {
        thinkingFlush();
        const toolCallId = (update as any).toolCallId as string | undefined;
        if (!toolCallId) return;
        const status = ((update as any).status as ToolCallStatus) ?? "pending";
        const title = ((update as any).title as string) ?? "";
        const kind = ((update as any).kind as string) ?? "tool";
        const rawInput = (update as any).rawInput;

        if (!seenToolCalls.has(toolCallId)) {
          // 第一次見到這個 toolCallId → emit tool_start
          seenToolCalls.add(toolCallId);
          onChunk({ type: "tool_start", toolCallId, title, kind, rawInput });
        } else if (status === "in_progress") {
          onChunk({ type: "tool_progress", toolCallId, status });
        } else if (status === "completed" || status === "failed") {
          onChunk({ type: "tool_done", toolCallId, status });
        }
        return;
      }

      // 4) 工具狀態更新 / 結果內容
      if (su === "tool_call_update") {
        thinkingFlush();
        const toolCallId = (update as any).toolCallId as string | undefined;
        if (!toolCallId) return;
        const status = (update as any).status as ToolCallStatus | undefined;

        // status 更新（可能與 content 同時出現）
        if (status === "in_progress") {
          onChunk({ type: "tool_progress", toolCallId, status });
        } else if (status === "completed" || status === "failed") {
          onChunk({ type: "tool_done", toolCallId, status });
        }

        // 提取 content 中的 stdout 文字
        const content = (update as any).content as Array<any> | undefined;
        if (Array.isArray(content)) {
          for (const item of content) {
            if (
              item?.type === "content" &&
              item.content?.type === "text" &&
              typeof item.content.text === "string"
            ) {
              const t: string = item.content.text;
              if (t) onChunk({ type: "tool_output", toolCallId, text: t });
            }
          }
        }
        return;
      }

      // 其他事件（available_commands_update、session_info_update 等）忽略
    };
    this.on("session/update", handler);

    try {
      const result = (await this.send("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text }],
      })) as SessionPromptResult;
      return { stopReason: result.stopReason };
    } finally {
      try {
        thinkingFlush();
      } finally {
        this.off("session/update", handler);
      }
    }
  }

  /** 註冊 notification handler */
  on(method: string, handler: NotificationHandler): void {
    const list = this.notifHandlers.get(method);
    if (list) list.push(handler);
    else this.notifHandlers.set(method, [handler]);
  }

  /** 移除 notification handler */
  off(method: string, handler: NotificationHandler): void {
    const list = this.notifHandlers.get(method);
    if (list) {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    }
  }

  // ---- internal ----

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: { jsonrpc?: string; id?: unknown; method?: string; result?: unknown; error?: unknown; params?: unknown };
    try {
      msg = JSON.parse(trimmed);
    } catch {
      if (this.debug) this.info(`unparseable line: ${trimmed.slice(0, 100)}`);
      return;
    }

    // response
    if (msg.id !== undefined && msg.id !== null && (msg.result !== undefined || msg.error !== undefined)) {
      const id = Number(msg.id);
      const entry = this.pending.get(id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        if (msg.error) entry.reject(new Error(String((msg.error as any)?.message ?? msg.error)));
        else entry.resolve(msg.result);
      }
      return;
    }

    // notification
    if (msg.method) {
      const handlers = this.notifHandlers.get(msg.method);
      if (handlers) {
        for (const h of handlers) {
          try { h(msg.params); } catch (e) { /* ignore handler errors */ }
        }
      }

      // 內建: 處理 permission request
      if (msg.method === "session/request_permission" && msg.id !== undefined && msg.id !== null) {
        this.autoAllowPermission(Number(msg.id));
      }
      return;
    }
  }

  private autoAllowPermission(id: number): void {
    const reply = JSON.stringify({
      jsonrpc: "2.0",
      id,
      result: { outcome: { outcome: "selected", optionId: "allow-once" } },
    });
    this.proc?.stdin?.write(reply + "\n");
  }

  private send(method: string, params?: unknown): Promise<unknown> {
    if (!this.proc || this.proc.killed) {
      return Promise.reject(new Error("acp process not running"));
    }

    const id = this.nextId++;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    this.proc.stdin!.write(msg + "\n");

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`acp request timeout: ${method}`));
      }, 300_000); // 5 min timeout
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    });
  }

  private rejectAllPending(err: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(err);
    }
    this.pending.clear();
  }

  private registerExitCleanup(): void {
    if (this.exitCleanupRegistered) return;
    this.exitCleanupRegistered = true;

    process.on("exit", () => {
      try {
        if (this.proc && !this.proc.killed) {
          this.proc.kill();
        }
      } catch {
        // 退出过程中忽略清理错误
      }
    });
  }

  private info(msg: string): void {
    if (this.debug) console.error(`${this.logPrefix} ${msg}`);
  }

  private warn(msg: string): void {
    console.error(`${this.logPrefix} WARN ${msg}`);
  }
}
