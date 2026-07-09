// ============================================================
// Auto Compact Plugin — 上下文达阀值时自动压缩并继续
// 参考 oh-my-openagent preemptive-compaction 实现
// ============================================================
import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import type { AssistantMessage, Provider } from "@opencode-ai/sdk"
import { appendFileSync, mkdirSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { BlankTransport, LogLayer, type LogLayerMetadata } from "loglayer"

// 监听 message.updated 事件，当 (input + cache.read) / model.contextWindow
// 跨过设定的阀值时，自动调用 session.summarize() 避免 context overflow。
// 与 opencode 内建 compaction.auto 不同：本 plugin 相对每个模型自己的
// context window 计算 ratio，所以同一套阀值对 200K Claude / 1M Gemini /
// 128K GPT-5 都适用。

const DEFAULT_THRESHOLD = 0.8
const DEFAULT_COOLDOWN_MS = 60_000
const DEFAULT_MIN_TOKENS = 50_000
const DEFAULT_LARGE_CONTEXT_BOUNDARY = 400_000
const DEFAULT_LARGE_CONTEXT_THRESHOLD = 0.6
const DEFAULT_SMALL_CONTEXT_THRESHOLD = 0.8
const PROVIDER_CACHE_REFRESH_MS = 5 * 60_000
const THRESHOLD_MIN = 0.1
const THRESHOLD_MAX = 0.95

export type PreemptiveCompactConfig = {
  enabled?: boolean
  threshold?: number
  cooldownMs?: number
  minTokens?: number
  showToast?: boolean
  // 若为 true，触发 preemptive compaction 前会用 PATCH /config 把
  // opencode 内建 compaction.auto 设为 false，避免内建 compaction 与
  // 本 plugin 同时触发造成 race。默认 false（不主动改动使用者设定）。
  disableBuiltinCompaction?: boolean
  // 大于等于此值的 context 视为「大型 context」（如 1M Gemini），
  // 用 largeContextThreshold；小于则视为「小型 context」，用
  // smallContextThreshold。
  largeContextBoundary?: number
  largeContextThreshold?: number
  smallContextThreshold?: number
}

export type ResolvedConfig = {
  enabled: boolean
  // undefined = 使用者未设定，依 context size 自动选择
  threshold: number | undefined
  cooldownMs: number
  minTokens: number
  showToast: boolean
  disableBuiltinCompaction: boolean
  largeContextBoundary: number
  largeContextThreshold: number
  smallContextThreshold: number
}

export type ShouldTriggerInput = {
  totalTokens: number
  contextLimit: number | undefined
  config: ResolvedConfig
  inCooldown: boolean
  inProgress: boolean
}

export type ShouldTriggerResult =
  | { trigger: true; threshold: number; ratio: number }
  | { trigger: false; reason: "disabled" | "in_progress" | "in_cooldown" | "below_min_tokens" | "unknown_model" | "below_threshold"; ratio?: number; threshold?: number }

// ============================================================
// 纯函数（export 供测试）
// ============================================================

/**
 * 把任意 metadata value 压成单行可读字符串。
 * - null → "null"
 * - undefined → "undefined"
 * - string → 原样（不引号）
 * - number / boolean → String(v)
 * - object / array → JSON.stringify
 */
export function formatMetaValue(v: unknown): string {
  if (v === null) return "null"
  if (v === undefined) return "undefined"
  if (typeof v === "string") return v
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  // 物件 / 陣列：fallback 用 JSON.stringify 才能看出內容
  return JSON.stringify(v)
}

/**
 * 把 metadata 摊平成 ` key=value key=value` 形式。
 * undefined / null / 非对象 / 空对象 → ""。
 */
export function formatMeta(meta: LogLayerMetadata | undefined): string {
  if (!meta || typeof meta !== "object") return ""
  const entries = Object.entries(meta as Record<string, unknown>)
  if (entries.length === 0) return ""
  return " " + entries.map(([k, v]) => `${k}=${formatMetaValue(v)}`).join(" ")
}

/**
 * 把 n 限制在 [min, max]。min > max 时行为未定义（调用方负责）。
 */
export function clampNumber(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

/**
 * 核心：根据 context size 决定实际使用的阀值。
 *
 * - 使用者显式设定 config.threshold 时一律优先使用（向後相容）
 * - 否则依 contextLimit vs config.largeContextBoundary 选
 *   largeContextThreshold / smallContextThreshold
 */
export function resolveThreshold(contextLimit: number, config: ResolvedConfig): number {
  if (config.threshold !== undefined) return config.threshold
  if (contextLimit >= config.largeContextBoundary) {
    return config.largeContextThreshold
  }
  return config.smallContextThreshold
}

/**
 * 安全读取 raw config，null / undefined / 非对象 → 空 config。
 * 数组也算非对象（避免后续 `.threshold` 等访问返回 undefined 链导致误判）。
 */
export function readPreemptiveCompactConfig(raw: unknown): PreemptiveCompactConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  return raw as PreemptiveCompactConfig
}

/**
 * 套用预设值并 clamp threshold。
 * 注意：threshold 若使用者未设定则保留 undefined，由 resolveThreshold 决定。
 */
export function resolveConfig(raw: PreemptiveCompactConfig): ResolvedConfig {
  const threshold =
    typeof raw.threshold === "number"
      ? clampNumber(raw.threshold, THRESHOLD_MIN, THRESHOLD_MAX)
      : undefined
  return {
    enabled: raw.enabled !== false,
    threshold,
    cooldownMs:
      typeof raw.cooldownMs === "number" ? raw.cooldownMs : DEFAULT_COOLDOWN_MS,
    minTokens:
      typeof raw.minTokens === "number" ? raw.minTokens : DEFAULT_MIN_TOKENS,
    showToast: raw.showToast !== false,
    // 默认关闭：只有使用者明确启用时才主动修改内建 compaction 设定
    disableBuiltinCompaction: raw.disableBuiltinCompaction === true,
    largeContextBoundary:
      typeof raw.largeContextBoundary === "number"
        ? raw.largeContextBoundary
        : DEFAULT_LARGE_CONTEXT_BOUNDARY,
    largeContextThreshold:
      typeof raw.largeContextThreshold === "number"
        ? raw.largeContextThreshold
        : DEFAULT_LARGE_CONTEXT_THRESHOLD,
    smallContextThreshold:
      typeof raw.smallContextThreshold === "number"
        ? raw.smallContextThreshold
        : DEFAULT_SMALL_CONTEXT_THRESHOLD,
  }
}

/**
 * 把 provider 列表转成 `${providerID}/${modelID}` → contextLimit 的 Map。
 * model 缺 limit.context 或 limit.context <= 0 会跳过。
 */
export function buildContextLimitMap(providers: Provider[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const provider of providers) {
    for (const [modelID, model] of Object.entries(provider.models ?? {})) {
      const limit = model?.limit?.context
      if (typeof limit === "number" && limit > 0) {
        map.set(extractModelKey(provider.id, modelID), limit)
      }
    }
  }
  return map
}

/** 把 provider 与 model ID 包成查找用的 key。 */
export function extractModelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`
}

/**
 * 计算 (input + cache.read)。其他 token 计数（output、reasoning、
 * cache.write）不参与 context 占用估算。
 */
export function computeUsageRatio(tokens: AssistantMessage["tokens"]): number {
  const input = tokens.input ?? 0
  const cacheRead = tokens.cache?.read ?? 0
  return input + cacheRead
}

/** 类型守卫：info 是不是 AssistantMessage。 */
export function isAssistantMessage(info: unknown): info is AssistantMessage {
  return (
    typeof info === "object" &&
    info !== null &&
    (info as { role?: unknown }).role === "assistant"
  )
}

/**
 * 整合所有 trigger 条件，输出结构化决策。**纯函数**：
 * 状态（inCooldown / inProgress）已由 caller 算好传入；本函数只决定
 * 触发与否与原因，不做副作用。
 */
export function shouldTrigger(input: ShouldTriggerInput): ShouldTriggerResult {
  const { totalTokens, contextLimit, config, inCooldown, inProgress } = input

  if (!config.enabled) {
    return { trigger: false, reason: "disabled" }
  }
  if (inProgress) {
    return { trigger: false, reason: "in_progress" }
  }
  if (inCooldown) {
    return { trigger: false, reason: "in_cooldown" }
  }
  // 先用总 token 量做闸门：刚启动 / 短对话不必进入 ratio 计算
  if (totalTokens < config.minTokens) {
    return { trigger: false, reason: "below_min_tokens" }
  }
  if (contextLimit === undefined) {
    return { trigger: false, reason: "unknown_model" }
  }

  const threshold = resolveThreshold(contextLimit, config)
  const ratio = totalTokens / contextLimit
  if (ratio < threshold) {
    return { trigger: false, reason: "below_threshold", ratio, threshold }
  }
  return { trigger: true, threshold, ratio }
}

// ============================================================
// Tracker 类（export 供测试）
// ============================================================

/**
 * 包裝 lastCompactionTime Map + 可注入時鐘。
 * 用 dep injection 的時鐘讓測試可控時間。
 */
export class CooldownTracker {
  private readonly lastMarked = new Map<string, number>()
  private readonly now: () => number

  constructor(now: () => number = () => Date.now()) {
    this.now = now
  }

  /** `now - lastMarked < cooldownMs` 才算冷卻中。從未 mark 過不算。 */
  isInCooldown(sessionID: string, cooldownMs: number): boolean {
    const last = this.lastMarked.get(sessionID)
    if (last === undefined) return false
    return this.now() - last < cooldownMs
  }

  /** 記錄 sessionID 當下時間作為冷卻起點。 */
  markTriggered(sessionID: string): void {
    this.lastMarked.set(sessionID, this.now())
  }

  /** 清掉 sessionID 的冷卻記錄（強制解除冷卻）。 */
  clear(sessionID: string): void {
    this.lastMarked.delete(sessionID)
  }
}

/**
 * 包裝 compactionInProgress Set，提供 atomic tryEnter / release。
 * 設計目的：race-safe gate 確保兩個並發 message.updated 不會同時通過
 * 檢查、各自啟動一次 summarize。
 */
export class InProgressTracker {
  private readonly inProgress = new Set<string>()

  /**
   * 嘗試進入 sessionID 的「進行中」狀態。
   * 回 true 表示成功（之前不在 progress 內），後續應在 finally 中 release。
   * 回 false 表示已有別的流程在跑。
   */
  tryEnter(sessionID: string): boolean {
    if (this.inProgress.has(sessionID)) return false
    this.inProgress.add(sessionID)
    return true
  }

  /** 釋放 sessionID 的「進行中」狀態。 */
  release(sessionID: string): void {
    this.inProgress.delete(sessionID)
  }

  /** 查詢是否仍在進行中（給 shouldTrigger 用）。 */
  isInProgress(sessionID: string): boolean {
    return this.inProgress.has(sessionID)
  }
}

// ============================================================
// Logger 設定（保留 loglayer + BlankTransport，延用原本格式）
// ============================================================
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

// Module-level singleton logger
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

// ============================================================
// OpenCode client 包裝（內部用、不 export）
// ============================================================

type PluginState = {
  cooldown: CooldownTracker
  inProgress: InProgressTracker
  contextLimits: Map<string, number>
  providersFetchedAt: number
  resolvedConfig: ResolvedConfig
}

async function fetchContextLimits(
  client: PluginInput["client"],
  state: PluginState,
  directory: string,
): Promise<void> {
  const now = Date.now()
  if (
    state.contextLimits.size > 0 &&
    now - state.providersFetchedAt < PROVIDER_CACHE_REFRESH_MS
  ) {
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
    // 保留旧 cache；第一次失败时 contextLimits 仍为空，shouldTrigger 会回 unknown_model
  }
}

async function loadConfig(
  client: PluginInput["client"],
  state: PluginState,
  directory: string,
): Promise<ResolvedConfig> {
  try {
    const response = await client.config.get({
      query: { directory },
      throwOnError: true,
    })
    const experimental = (
      response.data as
        | { experimental?: { preemptive_compact?: unknown } }
        | undefined
    )?.experimental
    const raw = readPreemptiveCompactConfig(experimental?.preemptive_compact)
    state.resolvedConfig = resolveConfig(raw)
  } catch {
    // 暂时性失败时保留先前已解析的 config
  }
  logger
    .withMetadata({
      enabled: state.resolvedConfig.enabled,
      threshold: state.resolvedConfig.threshold,
      minTokens: state.resolvedConfig.minTokens,
      cooldownMs: state.resolvedConfig.cooldownMs,
      disableBuiltinCompaction: state.resolvedConfig.disableBuiltinCompaction,
    })
    .debug("config loaded")
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

// ============================================================
// Plugin factory
// ============================================================

export const PreemptiveCompactPlugin: Plugin = async ({ client, directory, project }) => {
  const state: PluginState = {
    cooldown: new CooldownTracker(),
    inProgress: new InProgressTracker(),
    contextLimits: new Map(),
    providersFetchedAt: 0,
    resolvedConfig: resolveConfig({}),
  }

  logger
    .withMetadata({
      directory,
      projectID: project?.id ?? null,
      hasClient: typeof client === "object" && client !== null,
    })
    .info("plugin initialized")

  // 后台预载，不要 await — plugin 初始化时 opencode 还在 bootstrap，
  // 等 client API 调用会 deadlock startup
  void loadConfig(client, state, directory)
  void fetchContextLimits(client, state, directory)

  return {
    event: async ({ event }) => {
      logger.withMetadata({ eventType: event.type }).debug("event received")

      if (event.type !== "message.updated") return
      const info = event.properties.info
      if (!isAssistantMessage(info)) return
      // 跳過訊息本身就出錯的情況（不需要 compact）
      if (info.error) return
      // 跳過 opencode 內建 compaction 自己產生的 message，避免 compaction 結束後
      // 又被本 plugin 看到而再次觸發，形成週期性 compact
      if (info.summary === true) return
      if (info.mode === "compaction") return

      logger
        .withMetadata({
          sessionID: info.sessionID,
          role: info.role,
          providerID: info.providerID,
          modelID: info.modelID,
          mode: info.mode,
          summary: info.summary ?? false,
          tokensInput: info.tokens.input,
          tokensCacheRead: info.tokens.cache.read,
          tokensSum: computeUsageRatio(info.tokens),
        })
        .debug("checking message")

      const sessionID = info.sessionID

      // Race-safe atomic gate（無 await 介入，不會被插隊）
      if (!state.inProgress.tryEnter(sessionID)) {
        logger.withMetadata({ sessionID }).debug("skip: compaction in progress")
        return
      }

      try {
        const config = await loadConfig(client, state, directory)
        const inCooldown = state.cooldown.isInCooldown(sessionID, config.cooldownMs)

        await fetchContextLimits(client, state, directory)
        const contextLimit = state.contextLimits.get(
          extractModelKey(info.providerID, info.modelID),
        )
        const totalTokens = computeUsageRatio(info.tokens)

        const decision = shouldTrigger({
          totalTokens,
          contextLimit,
          config,
          inCooldown,
          inProgress: false, // 已被 tryEnter 接住
        })

        if (!decision.trigger) {
          logger
            .withMetadata({
              sessionID,
              ratio: decision.ratio,
              threshold: decision.threshold,
            })
            .debug(`skip: ${decision.reason}`)
          return
        }

        const { ratio, threshold } = decision
        const percent = Math.round(ratio * 100)
        logger
          .withMetadata({
            sessionID,
            providerID: info.providerID,
            modelID: info.modelID,
            totalTokens,
            contextLimit,
            ratio: Number(ratio.toFixed(3)),
            threshold,
          })
          .info("triggering preemptive compaction")

        // 與內建 compaction 的互動
        if (config.disableBuiltinCompaction) {
          try {
            await client.config.update({
              query: { directory },
              body: { compaction: { auto: false } } as never,
            })
            logger.withMetadata({ sessionID }).info("disabled built-in compaction via config.update")
          } catch (error) {
            logger
              .withMetadata({
                sessionID,
                error: error instanceof Error ? error.message : String(error),
              })
              .warn("failed to disable built-in compaction")
          }
        } else {
          logger
            .withMetadata({ sessionID })
            .warn(
              "built-in compaction may also trigger; set compaction.auto=false in opencode.jsonc or enable disableBuiltinCompaction",
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
          logger
            .withMetadata({
              sessionID,
              error: error instanceof Error ? error.message : String(error),
            })
            .warn("preemptive compaction failed")
        } finally {
          // Cooldown 從 summarize 結束後才開始算，避免 summarize 跑超過
          // cooldownMs 時新進的 message.updated 又啟動第二次
          state.cooldown.markTriggered(sessionID)
        }
      } finally {
        state.inProgress.release(sessionID)
      }
    },
  }
}

export default PreemptiveCompactPlugin
