// ============================================================
// Auto Compact Plugin — 上下文達閾值時自動壓縮並繼續
// 參考 oh-my-openagent preemptive-compaction 實作
// ============================================================
import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { AssistantMessage, Config, Event } from "@opencode-ai/sdk";

const DEBUG = process.env.AUTO_COMPACT_DEBUG === "true";

/** 觸發壓縮的上下文占用比例（預設 60%） */
const THRESHOLD = parseThreshold(process.env.AUTO_COMPACT_THRESHOLD ?? "0.60");
/** 兩次壓縮之間的最小間隔 */
const COOLDOWN_MS = 60_000;
/** summarize 逾時 */
const COMPACT_TIMEOUT_MS = 60_000;
/** 低於此 token 數不觸發（避免剛啟動就壓縮） */
const MIN_TOKENS = 10_000;

const DEFAULT_ANTHROPIC_LIMIT = 200_000;

type TokenInfo = AssistantMessage["tokens"];

interface CachedSessionState {
  providerID: string;
  modelID: string;
  tokens: TokenInfo;
}

function parseThreshold(raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value >= 1) return 0.6;
  return value;
}

function log(msg: string, extra?: Record<string, unknown>): void {
  if (!DEBUG) return;
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  console.error(`[auto-compact] ${msg}${suffix}`);
}

function isCompactionAgent(agent: unknown): boolean {
  return typeof agent === "string" && agent.trim().toLowerCase() === "compaction";
}

function totalInputTokens(tokens: TokenInfo): number {
  return (tokens.input ?? 0) + (tokens.cache?.read ?? 0);
}

function isAnthropicProvider(providerID: string): boolean {
  const normalized = providerID.toLowerCase();
  return (
    normalized === "anthropic" ||
    normalized === "google-vertex-anthropic" ||
    normalized === "aws-bedrock-anthropic"
  );
}

function modelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`;
}

function resolveContextLimit(
  providerID: string,
  modelID: string,
  limits: Map<string, number>,
): number | null {
  const cached = limits.get(modelKey(providerID, modelID));
  if (cached) return cached;
  if (isAnthropicProvider(providerID)) return DEFAULT_ANTHROPIC_LIMIT;
  return null;
}

function collectLimitsFromConfig(config: Config, limits: Map<string, number>): void {
  const providers = config.provider;
  if (!providers) return;

  for (const [providerID, providerConfig] of Object.entries(providers)) {
    const models = providerConfig?.models;
    if (!models) continue;

    for (const [modelID, modelConfig] of Object.entries(models)) {
      const context = modelConfig?.limit?.context;
      if (context) limits.set(modelKey(providerID, modelID), context);
    }
  }
}

async function refreshLimitsFromApi(
  client: PluginInput["client"],
  directory: string,
  limits: Map<string, number>,
): Promise<void> {
  try {
    const result = await withTimeout(
      client.provider.list({ query: { directory } }),
      5_000,
      "provider.list timed out",
    );
    const providers = result.data?.all;
    if (!providers) return;

    for (const provider of providers) {
      for (const [modelID, model] of Object.entries(provider.models ?? {})) {
        const context = model.limit?.context;
        if (context) limits.set(modelKey(provider.id, modelID), context);
      }
    }
  } catch (error) {
    log("failed to refresh provider limits", { error: String(error) });
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
): Promise<T> {
  let timeoutID: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutID = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutID !== undefined) clearTimeout(timeoutID);
  }
}

async function showToast(
  client: PluginInput["client"],
  input: { title: string; message: string; variant: "info" | "warning" | "error" | "success" },
): Promise<void> {
  try {
    await client.tui.showToast({
      body: {
        title: input.title,
        message: input.message,
        variant: input.variant,
        duration: 8000,
      },
    });
  } catch {
    // TUI 可能不可用（headless 模式）
  }
}

const plugin: Plugin = async (ctx) => {
  const contextLimits = new Map<string, number>();
  const tokenCache = new Map<string, CachedSessionState>();
  const compactionInProgress = new Set<string>();
  const compactedSessions = new Set<string>();
  const lastCompactionTime = new Map<string, number>();
  let limitsRefresh: Promise<void> | null = null;

  const ensureContextLimits = async (): Promise<void> => {
    if (contextLimits.size > 0) return;
    if (!limitsRefresh) {
      limitsRefresh = refreshLimitsFromApi(ctx.client, ctx.directory, contextLimits).finally(() => {
        limitsRefresh = null;
      });
    }
    await limitsRefresh;
  };

  log("plugin loaded", { threshold: THRESHOLD });

  const runCompactionIfNeeded = async (sessionID: string): Promise<void> => {
    if (compactedSessions.has(sessionID) || compactionInProgress.has(sessionID)) return;

    const lastTime = lastCompactionTime.get(sessionID);
    if (lastTime && Date.now() - lastTime < COOLDOWN_MS) return;

    const cached = tokenCache.get(sessionID);
    if (!cached?.modelID) return;

    await ensureContextLimits();

    const contextLimit = resolveContextLimit(cached.providerID, cached.modelID, contextLimits);
    if (contextLimit === null) {
      log("skip: unknown context limit", {
        sessionID,
        providerID: cached.providerID,
        modelID: cached.modelID,
      });
      return;
    }

    const used = totalInputTokens(cached.tokens);
    if (used < MIN_TOKENS) return;

    const usageRatio = used / contextLimit;
    if (usageRatio < THRESHOLD) return;

    compactionInProgress.add(sessionID);
    lastCompactionTime.set(sessionID, Date.now());

    const percent = Math.round(usageRatio * 100);
    log("triggering compaction", {
      sessionID,
      used,
      contextLimit,
      usageRatio,
    });

    await showToast(ctx.client, {
      title: "自動壓縮上下文",
      message: `上下文已達 ${percent}%，正在壓縮…`,
      variant: "info",
    });

    try {
      await withTimeout(
        ctx.client.session.summarize({
          path: { id: sessionID },
          body: {
            providerID: cached.providerID,
            modelID: cached.modelID,
            auto: true,
          } as { providerID: string; modelID: string; auto?: boolean },
          query: { directory: ctx.directory },
        }),
        COMPACT_TIMEOUT_MS,
        `Compaction summarize timed out after ${COMPACT_TIMEOUT_MS}ms`,
      );

      compactedSessions.add(sessionID);

      await showToast(ctx.client, {
        title: "上下文已壓縮",
        message: `已從 ${percent}% 壓縮，agent 將繼續執行。`,
        variant: "success",
      });

      log("compaction succeeded", { sessionID });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log("compaction failed", { sessionID, error: message });

      await showToast(ctx.client, {
        title: "自動壓縮失敗",
        message: `上下文已達 ${percent}% 但壓縮失敗：${message}`,
        variant: "warning",
      });
    } finally {
      compactionInProgress.delete(sessionID);
    }
  };

  const handleMessageUpdated = async (event: Event): Promise<void> => {
    if (event.type !== "message.updated") return;

    const info = event.properties.info;
    if (info.role !== "assistant" || !info.finish) return;
    if (isCompactionAgent((info as { agent?: unknown }).agent)) return;

    const sessionID = info.sessionID;
    if (!sessionID || !info.providerID || !info.tokens) return;

    tokenCache.set(sessionID, {
      providerID: info.providerID,
      modelID: info.modelID,
      tokens: info.tokens,
    });
    compactedSessions.delete(sessionID);

    await runCompactionIfNeeded(sessionID);
  };

  const clearSession = (sessionID: string | undefined): void => {
    if (!sessionID) return;
    compactionInProgress.delete(sessionID);
    compactedSessions.delete(sessionID);
    lastCompactionTime.delete(sessionID);
    tokenCache.delete(sessionID);
  };

  return {
    async config(input) {
      collectLimitsFromConfig(input, contextLimits);
      log("config hook: limits updated", { knownLimits: contextLimits.size });
      // 背景刷新 provider API 的 limit，不阻塞啟動
      void refreshLimitsFromApi(ctx.client, ctx.directory, contextLimits);
    },

    async event({ event }) {
      if (event.type === "session.deleted") {
        clearSession(event.properties.info?.id);
        return;
      }

      if (event.type === "session.compacted") {
        const sessionID = event.properties.sessionID;
        if (sessionID) compactedSessions.add(sessionID);
        return;
      }

      await handleMessageUpdated(event);
    },

    async "tool.execute.after"(input) {
      await runCompactionIfNeeded(input.sessionID);
    },
  };
};

export default plugin;
