// ============================================================
// Plugin Entry — 註冊 cursor-acp 真 ACP provider
// ============================================================
import type { Plugin } from "@opencode-ai/plugin";
import { AcpClient } from "./acp-client";
import { AcpHttpServer, type FormatStyle } from "./server";

const DEBUG = process.env.CURSOR_ACP_DEBUG === "true";
const SHOW_TOOLS = process.env.CURSOR_ACP_SHOW_TOOLS !== "false"; // default true
const SHOW_THINKING = process.env.CURSOR_ACP_SHOW_THINKING !== "false"; // default true
const FORMAT_STYLE: FormatStyle =
  process.env.CURSOR_ACP_FORMAT === "detailed" ? "detailed" : "concise";

type CleanupTarget = {
  acp: AcpClient;
  server: AcpHttpServer;
};

const cleanupTargets = new Set<CleanupTarget>();
let cleanupHooksRegistered = false;

function log(msg: string): void {
  if (DEBUG) console.error(`[cursor-acp-proxy] ${msg}`);
}

function stopTarget(target: CleanupTarget): void {
  try {
    void target.acp.stop().catch((err) => {
      log(`acp cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  } catch (err) {
    log(`acp cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    void target.server.stop().catch((err) => {
      log(`server cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  } catch (err) {
    log(`server cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function registerCleanupHooks(): void {
  if (cleanupHooksRegistered) return;
  cleanupHooksRegistered = true;

  const shutdown = () => {
    for (const target of cleanupTargets) {
      stopTarget(target);
    }
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const plugin: Plugin = async (_input) => {
  log("starting...");

  // ---- 1. 啟動 ACP client ----
  const acp = new AcpClient({ debug: DEBUG });
  try {
    await acp.start();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cursor-acp-proxy] FAILED to start acp client: ${msg}`);
    return {}; // 不阻擋 opencode 啟動
  }

  // ---- 2. 啟動 HTTP server ----
  const server = new AcpHttpServer(acp, {
    debug: DEBUG,
    showTools: SHOW_TOOLS,
    showThinking: SHOW_THINKING,
    format: FORMAT_STYLE,
  });
  let port: number;
  try {
    port = await server.start(32125);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[cursor-acp-proxy] FAILED to start http server: ${msg}`);
    await acp.stop();
    return {};
  }

  const baseURL = `http://127.0.0.1:${port}/v1`;
  log(`proxy ready at ${baseURL}`);

  cleanupTargets.add({ acp, server });
  registerCleanupHooks();

  // ---- 3. 註冊 hooks ----
  return {
    // 注入 provider config
    config(input) {
      // 確保 provider section 存在
      input.provider = input.provider ?? {};

      // 如果尚未設定 cursor-acp provider，則注入
      if (!input.provider["cursor-acp"]) {
        input.provider["cursor-acp"] = {
          name: "Cursor ACP (Real)",
          npm: "@ai-sdk/openai-compatible",
          options: {
            apiKey: "cursor-acp",
            baseURL,
          },
          models: {
            "cursor-acp/auto": { name: "Auto" },
            "cursor-acp/composer-2.5-fast": { name: "Composer 2.5 Fast" },
            "cursor-acp/composer-2.5": { name: "Composer 2.5" },
            "cursor-acp/claude-opus-4-8-high": { name: "Claude 4.8 Opus" },
            "cursor-acp/claude-opus-4-8-thinking-high": { name: "Claude 4.8 Opus Thinking" },
            "cursor-acp/gpt-5.5-high": { name: "GPT-5.5" },
            "cursor-acp/gpt-5.5-medium": { name: "GPT-5.5 Medium" },
          },
        };
        log("injected provider config");
      }
    },

    // 確保 chat.params 使用我們的 baseURL
    async "chat.params"(input, output) {
      const modelProvider =
        (input.model as any)?.providerID ??
        (input.model as any)?.provider ??
        "";

      if (modelProvider !== "cursor-acp") return;

      // 覆蓋 baseURL 指向我們自己的 proxy
      output.options = output.options ?? {};
      output.options.baseURL = baseURL;
      output.options.apiKey = output.options.apiKey ?? "cursor-acp";

      log(`chat.params: model=${(input.model as any)?.modelID}, baseURL=${baseURL}`);
    },
  };
};

export default plugin;
