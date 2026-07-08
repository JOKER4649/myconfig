// ============================================================
// Auto Compact Plugin — 上下文達閾值時自動壓縮並繼續
// 參考 oh-my-openagent preemptive-compaction 實作
// ============================================================
import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import type { AssistantMessage, Provider, Model } from "@opencode-ai/sdk"
import { appendFileSync, mkdirSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { BlankTransport, LogLayer, type LogLayerMetadata } from "loglayer"

// Preemptive compaction plugin for opencode.
//
// Watches every completed assistant message, computes the current
// (input + cache.read) / model.contextWindow ratio, and calls
// session.summarize() once usage crosses a configured threshold.
//
// Unlike opencode's built-in `compaction.auto`, this triggers relative
// to each model's actual context window, so the same threshold works
// for 200K Claude, 1M Gemini, 128K GPT-5, etc.

const DEFAULT_THRESHOLD = 0.8
const DEFAULT_COOLDOWN_MS = 60_000
const DEFAULT_MIN_TOKENS = 50_000
const PROVIDER_CACHE_REFRESH_MS = 5 * 60_000

type PreemptiveCompactConfig = {
  enabled?: boolean
  threshold?: number
  cooldownMs?: number
  minTokens?: number
  showToast?: boolean
  // 若為 true，觸發 preemptive compaction 前會嘗試用 PATCH /config 把
  // opencode 內建的 compaction.auto 設為 false，避免內建 compaction 與本
  // plugin 同時觸發造成 race。預設 false（不主動修改使用者的設定）。
  disableBuiltinCompaction?: boolean
}

type CompactionState = {
  compactionInProgress: Set<string>
  lastCompactionTime: Map<string, number>
  contextLimits: Map<string, number>
  providersFetchedAt: number
  resolvedConfig: ResolvedConfig
}

type ResolvedConfig = {
  enabled: boolean
  threshold: number
  cooldownMs: number
  minTokens: number
  showToast: boolean
  disableBuiltinCompaction: boolean
}

// ===== Log 設定 =====
//
// 寫入策略：用 loglayer + BlankTransport 自訂 shipToLogger，
// 把每筆 log 用 appendFileSync 同步寫入 daily rotation 檔案。
//
// 優點：
// - human-readable（不強制 JSON line），可 grep / tail 直接看
// - 同步寫入 → 不需要 await，不會卡 event hook
// - 跨日自動切檔：每天一個 `preemptive-compact-YYYY-MM-DD.log`
//
// 失敗一律吞掉：log 寫入失敗絕不能干擾 plugin 主流程。

const SERVICE = "preemptive-compact"
const LOG_DIR = path.join(
  process.env.HOME ?? os.tmpdir(),
  ".local",
  "share",
  "opencode",
  "log",
)

/** 當天的 log 檔路徑（依 UTC 日期切檔，跨日自動換檔） */
function currentLogFile(): string {
  const date = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  return path.join(LOG_DIR, `${SERVICE}-${date}.log`)
}

/** 把 metadata value 轉成單行字串（不 JSON.stringify，盡量保持人類可讀） */
function formatMetaValue(v: unknown): string {
  if (v === null) return "null"
  if (v === undefined) return "undefined"
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  // 物件 / 陣列：fallback 用 JSON.stringify 才能看出內容；
  // spec 不鼓勵 JSON.stringify，但對純量以外的值這是唯一可讀的選項。
  return JSON.stringify(v)
}

/** 將 metadata object 攤平成 ` key=value` 形式（無 metadata 時回空字串） */
function formatMeta(meta: LogLayerMetadata | undefined): string {
  if (!meta || typeof meta !== "object") return ""
  const entries = Object.entries(meta as Record<string, unknown>)
  if (entries.length === 0) return ""
  return " " + entries.map(([k, v]) => `${k}=${formatMetaValue(v)}`).join(" ")
}

/** 同步寫入一行 log；任何錯誤都吃掉，絕不從 hook 拋出 */
function writeLogLine(
  level: string,
  message: string,
  meta: LogLayerMetadata | undefined,
): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true })
    const ts = new Date().toISOString()
    const line =
      `[${ts}] [${level.toUpperCase()}] [${SERVICE}] ${message}${formatMeta(meta)}\n`
    appendFileSync(currentLogFile(), line)
  } catch {
    // best-effort
  }
}

// Module-level singleton logger。每個 plugin 實例共用同一個 logger
// （避免重複建立 LogLayer instance）。寫入是 sync，所以即使並發呼叫
// 也只是順序 append 到同一個檔案，不會交錯。
const logger = new LogLayer({
  transport: new BlankTransport({
    shipToLogger: ({ logLevel, messages, metadata }) => {
      const message = messages
        .map((m) => (typeof m === "string" ? m : JSON.stringify(m)))
        .join(" ")
      writeLogLine(logLevel, message, metadata)
      return messages
    },
  }),
})

/** 便利 wrapper：呼叫對應 level method 並附帶 metadata */
function logAt(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  meta?: Record<string, unknown>,
): void {
  try {
    logger.withMetadata(meta ?? {})[level](message)
  } catch {
    // best-effort
  }
}

function readPreemptiveCompactConfig(raw: unknown): PreemptiveCompactConfig {
  if (!raw || typeof raw !== "object") return {}
  return raw as PreemptiveCompactConfig
}

function resolveConfig(raw: PreemptiveCompactConfig): ResolvedConfig {
  const threshold = typeof raw.threshold === "number" ? raw.threshold : DEFAULT_THRESHOLD
  return {
    enabled: raw.enabled !== false,
    threshold: Math.min(Math.max(threshold, 0.1), 0.95),
    cooldownMs: typeof raw.cooldownMs === "number" ? raw.cooldownMs : DEFAULT_COOLDOWN_MS,
    minTokens: typeof raw.minTokens === "number" ? raw.minTokens : DEFAULT_MIN_TOKENS,
    showToast: raw.showToast !== false,
    // 預設關閉：只在使用者明確啟用時才會主動修改 opencode 的 compaction 設定。
    disableBuiltinCompaction: raw.disableBuiltinCompaction === true,
  }
}

function buildContextLimitMap(providers: Provider[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const provider of providers) {
    for (const [modelID, model] of Object.entries(provider.models ?? {})) {
      const limit = (model as Model | undefined)?.limit?.context
      if (typeof limit === "number" && limit > 0) {
        map.set(`${provider.id}/${modelID}`, limit)
      }
    }
  }
  return map
}

function isAssistantMessage(info: unknown): info is AssistantMessage {
  return (
    typeof info === "object" &&
    info !== null &&
    (info as { role?: unknown }).role === "assistant"
  )
}

function computeUsageRatio(tokens: AssistantMessage["tokens"]): number {
  const input = tokens.input ?? 0
  const cacheRead = tokens.cache?.read ?? 0
  return input + cacheRead
}

async function fetchContextLimits(
  client: PluginInput["client"],
  state: CompactionState,
  directory: string,
): Promise<void> {
  const now = Date.now()
  if (state.contextLimits.size > 0 && now - state.providersFetchedAt < PROVIDER_CACHE_REFRESH_MS) {
    return
  }

  try {
    const response = await client.config.providers({
      query: { directory },
      throwOnError: true,
    })
    const providers = (response.data?.providers ?? []) as Provider[]
    state.contextLimits = buildContextLimitMap(providers)
    state.providersFetchedAt = now
  } catch {
    // Leave existing cache in place; first call just means we have no map yet.
  }
}

async function loadConfig(
  client: PluginInput["client"],
  state: CompactionState,
  directory: string,
): Promise<ResolvedConfig> {
  try {
    const response = await client.config.get({
      query: { directory },
      throwOnError: true,
    })
    const experimental = (response.data as { experimental?: { preemptive_compact?: unknown } } | undefined)
      ?.experimental
    const raw = readPreemptiveCompactConfig(experimental?.preemptive_compact)
    state.resolvedConfig = resolveConfig(raw)
  } catch {
    // Keep the previously resolved config on transient failures.
  }
  // 診斷 log：每次 resolve 都印一次目前生效的設定值，方便確認
  // experimental.preemptive_compact 是否真的被讀到。
  logAt("debug", "config loaded", {
    enabled: state.resolvedConfig.enabled,
    threshold: state.resolvedConfig.threshold,
    minTokens: state.resolvedConfig.minTokens,
    cooldownMs: state.resolvedConfig.cooldownMs,
    disableBuiltinCompaction: state.resolvedConfig.disableBuiltinCompaction,
  })
  return state.resolvedConfig
}

async function showToast(
  client: PluginInput["client"],
  message: string,
  directory: string,
): Promise<void> {
  try {
    await client.tui.showToast({
      query: { directory },
      body: {
        title: "Preemptive Compaction",
        message,
        variant: "info",
        duration: 3000,
      },
    })
  } catch {
    // Toast failures are non-fatal.
  }
}

export const PreemptiveCompactPlugin: Plugin = async ({ client, directory, project }) => {
  const state: CompactionState = {
    compactionInProgress: new Set(),
    lastCompactionTime: new Map(),
    contextLimits: new Map(),
    providersFetchedAt: 0,
    resolvedConfig: resolveConfig({}),
  }

  // 診斷 log：確認 factory 有被 opencode 走到、有 client / project 可以用。
  // 若完全沒看到這行，代表 plugin 沒被載入；plugin 載入後沒看到 "event received"
  // 則代表 event hook 沒被註冊到。
  logAt("info", "plugin initialized", {
    directory,
    projectID: project?.id ?? null,
    hasClient: typeof client === "object" && client !== null,
  })

  // Prefetch in the background. Do not await here — plugin init runs while
  // opencode is still bootstrapping, and blocking on client API calls deadlocks startup.
  void loadConfig(client, state, directory)
  void fetchContextLimits(client, state, directory)

  return {
    event: async ({ event }) => {
      // 診斷 log：所有 event 都印一筆，方便確認 event hook 真的有被呼叫、
      // 以及是哪一類事件。debug 等級預設會被過濾掉，正式使用時不會太吵。
      logAt("debug", "event received", { eventType: event.type })

      if (event.type !== "message.updated") return
      const info = event.properties.info
      if (!isAssistantMessage(info)) return
      // 跳過訊息本身就出錯的情況（不需要 compact）。
      if (info.error) return
      // 跳過 opencode 內建 compaction 自己產生的 message，避免 compaction 結束後
      // 又被本 plugin 看到而再次觸發，形成週期性 compact：
      //   - summary === true: 該 message 是 compaction 的 summary 結果
      //   - mode === "compaction": 該 message 是 compaction 過程中產生的
      // （SDK v1 型別上沒有 `agent` 欄位，但 runtime 上 `mode === "compaction"`
      // 與 `agent === "compaction"` 是同步設定的，所以用 mode 當過濾條件。）
      if (info.summary === true) return
      if (info.mode === "compaction") return

      // 診斷 log：通過前置檢查後，記下這個 candidate message 的關鍵欄位，
      // 方便日後排查「為什麼 trigger / 沒 trigger」。
      logAt("debug", "checking message", {
        sessionID: info.sessionID,
        role: info.role,
        providerID: info.providerID,
        modelID: info.modelID,
        mode: info.mode,
        summary: info.summary ?? false,
        error: null,
        tokensInput: info.tokens.input,
        tokensCacheRead: info.tokens.cache.read,
        tokensSum: computeUsageRatio(info.tokens),
      })

      const sessionID = info.sessionID

      // Race-safe gate：has() 與 add() 之間不穿插任何 await，
      // 確保兩個並發的 message.updated 不會同時通過檢查、各自啟動一次 summarize。
      // （JS 是單執行緒，只要沒有 await，has 與 add 之間不會被插隊。）
      if (state.compactionInProgress.has(sessionID)) {
        logAt("debug", "skip: compaction in progress", { sessionID })
        return
      }
      state.compactionInProgress.add(sessionID)

      try {
        const config = await loadConfig(client, state, directory)
        if (!config.enabled) return

        const lastTriggered = state.lastCompactionTime.get(sessionID) ?? 0
        const sinceLastMs = Date.now() - lastTriggered
        if (sinceLastMs < config.cooldownMs) {
          logAt("debug", "skip: cooldown active", {
            sessionID,
            sinceLastSec: Math.round(sinceLastMs / 1000),
            cooldownMs: config.cooldownMs,
          })
          return
        }

        const totalTokens = computeUsageRatio(info.tokens)
        if (totalTokens < config.minTokens) {
          logAt("debug", "skip: below minTokens", {
            sessionID,
            totalTokens,
            minTokens: config.minTokens,
          })
          return
        }

        await fetchContextLimits(client, state, directory)
        const contextLimit = state.contextLimits.get(`${info.providerID}/${info.modelID}`)
        if (!contextLimit) {
          logAt("debug", "skip: unknown model context limit", {
            sessionID,
            providerID: info.providerID,
            modelID: info.modelID,
          })
          return
        }

        const ratio = totalTokens / contextLimit
        if (ratio < config.threshold) {
          logAt("debug", "skip: below threshold", {
            sessionID,
            ratio: Number(ratio.toFixed(3)),
            threshold: config.threshold,
          })
          return
        }

        const percent = Math.round(ratio * 100)
        logAt("info", "triggering preemptive compaction", {
          sessionID,
          providerID: info.providerID,
          modelID: info.modelID,
          totalTokens,
          contextLimit,
          ratio: Number(ratio.toFixed(3)),
          threshold: config.threshold,
        })

        // 與內建 compaction 的互動：若使用者啟用 disableBuiltinCompaction，
        // 嘗試 PATCH /config 把 compaction.auto 設為 false，避免 race。
        // 預設關閉，改用 warning log 提醒使用者在 opencode.jsonc 設定。
        // （config.update 的 body 型別來自 SDK v1 的 Config，沒有 `compaction`
        //  欄位；用 `as never` 繞過型別檢查，server 端實際上接受。）
        if (config.disableBuiltinCompaction) {
          try {
            await client.config.update({
              query: { directory },
              body: { compaction: { auto: false } } as never,
            })
            logAt("info", "disabled built-in compaction via config.update", {
              sessionID,
            })
          } catch (error) {
            logAt("warn", "failed to disable built-in compaction", {
              sessionID,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        } else {
          logAt(
            "warn",
            "built-in compaction may also trigger; set compaction.auto=false in opencode.jsonc or enable disableBuiltinCompaction",
            { sessionID },
          )
        }

        if (config.showToast) {
          await showToast(
            client,
            `Context at ${percent}% of ${info.modelID} — compacting to prevent overflow...`,
            directory,
          )
        }

        try {
          await client.session.summarize({
            path: { id: sessionID },
            body: { providerID: info.providerID, modelID: info.modelID },
            query: { directory },
          })
        } catch (error) {
          logAt("warn", "preemptive compaction failed", {
            sessionID,
            error: error instanceof Error ? error.message : String(error),
          })
        } finally {
          // Cooldown 從「summarize 開始前」改到「summarize 結束後」，
          // 避免 summarize 跑超過 cooldownMs（例如 60s）時，新進的 message.updated
          // 再次通過 cooldown 檢查、啟動第二次 summarize。
          state.lastCompactionTime.set(sessionID, Date.now())
        }
      } finally {
        // 無論結果（成功 / 失敗 / 提前 return）都要釋放 slot，
        // 讓下一個 message.updated 可以重新進入檢查流程。
        state.compactionInProgress.delete(sessionID)
      }
    },
  }
}

export default PreemptiveCompactPlugin
