// ============================================================
// auto-compact.spec.ts — bun:test
//
// 覆盖所有可可靠测试的部分（纯函数 + CooldownTracker / InProgressTracker）。
// 不测试依赖文件系统 / opencode client / event loop 的部分
// （writeLogLine / currentLogFile / loadConfig / fetchContextLimits / showToast / event hook 端到端）
// ============================================================
import { describe, test, expect, beforeEach } from "bun:test"
import type { Provider } from "@opencode-ai/sdk"
import type { AssistantMessage } from "@opencode-ai/sdk"
import {
  formatMetaValue,
  formatMeta,
  clampNumber,
  resolveThreshold,
  readPreemptiveCompactConfig,
  resolveConfig,
  buildContextLimitMap,
  extractModelKey,
  computeUsageRatio,
  isAssistantMessage,
  shouldTrigger,
  CooldownTracker,
  InProgressTracker,
  type PreemptiveCompactConfig,
  type ResolvedConfig,
} from "./auto-compact.ts"

// ============================================================
// formatMetaValue
// ============================================================

describe("formatMetaValue", () => {
  test("null → \"null\"", () => {
    expect(formatMetaValue(null)).toBe("null")
  })

  test("undefined → \"undefined\"", () => {
    expect(formatMetaValue(undefined)).toBe("undefined")
  })

  test("string 原样输出（不加引号）", () => {
    expect(formatMetaValue("hello world")).toBe("hello world")
    expect(formatMetaValue("")).toBe("")
  })

  test("number 走 String()", () => {
    expect(formatMetaValue(0)).toBe("0")
    expect(formatMetaValue(42)).toBe("42")
    expect(formatMetaValue(-1.5)).toBe("-1.5")
  })

  test("boolean 走 String()", () => {
    expect(formatMetaValue(true)).toBe("true")
    expect(formatMetaValue(false)).toBe("false")
  })

  test("object → JSON.stringify", () => {
    expect(formatMetaValue({ a: 1 })).toBe('{"a":1}')
    expect(formatMetaValue({ nested: { x: 2 } })).toBe('{"nested":{"x":2}}')
  })

  test("array → JSON.stringify", () => {
    expect(formatMetaValue([1, 2, 3])).toBe("[1,2,3]")
  })

  test("object 含 undefined 值 → JSON.stringify 保留 key", () => {
    // JSON.stringify 会把 undefined 当作 skipped，但含其他值时应正常输出
    expect(formatMetaValue({ a: undefined, b: 1 })).toBe("{\"b\":1}")
  })
})

// ============================================================
// formatMeta
// ============================================================

describe("formatMeta", () => {
  test("undefined → \"\"", () => {
    expect(formatMeta(undefined)).toBe("")
  })

  test("null → \"\"", () => {
    expect(formatMeta(null as never)).toBe("")
  })

  test("非物件（字串）→ \"\"", () => {
    expect(formatMeta("not-an-object" as never)).toBe("")
  })

  test("空物件 → \"\"", () => {
    expect(formatMeta({})).toBe("")
  })

  test("多 key 串成 \" a=1 b=2\" 形式", () => {
    expect(formatMeta({ a: 1, b: 2 })).toBe(" a=1 b=2")
  })

  test("混合类型 key", () => {
    expect(formatMeta({ sessionID: "abc", totalTokens: 100, enabled: true })).toBe(
      " sessionID=abc totalTokens=100 enabled=true",
    )
  })

  test("null / undefined 值也走 formatMetaValue", () => {
    expect(formatMeta({ x: null, y: undefined })).toBe(" x=null y=undefined")
  })

  test("物件值走 JSON.stringify", () => {
    expect(formatMeta({ err: new Error("bad") })).toMatch(/^ err=/)
    // 部分内容不好预测，但至少前缀要正确
  })
})

// ============================================================
// clampNumber
// ============================================================

describe("clampNumber", () => {
  test("范围内原值", () => {
    expect(clampNumber(0.5, 0.1, 0.95)).toBe(0.5)
    expect(clampNumber(0.1, 0.1, 0.95)).toBe(0.1) // min boundary
    expect(clampNumber(0.95, 0.1, 0.95)).toBe(0.95) // max boundary
  })

  test("小于 min → min", () => {
    expect(clampNumber(-1, 0.1, 0.95)).toBe(0.1)
    expect(clampNumber(0, 0.1, 0.95)).toBe(0.1)
  })

  test("大于 max → max", () => {
    expect(clampNumber(1, 0.1, 0.95)).toBe(0.95)
    expect(clampNumber(2.5, 0.1, 0.95)).toBe(0.95)
  })

  test("min === max → 全部回该值", () => {
    expect(clampNumber(0.5, 0.5, 0.5)).toBe(0.5)
  })

  test("整数 / 负数边界", () => {
    expect(clampNumber(50, 0, 100)).toBe(50)
    expect(clampNumber(-50, 0, 100)).toBe(0)
    expect(clampNumber(150, 0, 100)).toBe(100)
  })
})

// ============================================================
// resolveThreshold（核心测试）
// ============================================================

describe("resolveThreshold", () => {
  const baseConfig = (overrides: Partial<ResolvedConfig> = {}): ResolvedConfig => ({
    enabled: true,
    threshold: undefined,
    cooldownMs: 60_000,
    minTokens: 50_000,
    showToast: true,
    disableBuiltinCompaction: false,
    largeContextBoundary: 400_000,
    largeContextThreshold: 0.6,
    smallContextThreshold: 0.8,
    ...overrides,
  })

  test("contextLimit = 400_000（边界）→ largeContextThreshold (0.6)", () => {
    expect(resolveThreshold(400_000, baseConfig())).toBe(0.6)
  })

  test("contextLimit = 400_001 → largeContextThreshold (0.6)", () => {
    expect(resolveThreshold(400_001, baseConfig())).toBe(0.6)
  })

  test("contextLimit = 399_999（边界下）→ smallContextThreshold (0.8)", () => {
    expect(resolveThreshold(399_999, baseConfig())).toBe(0.8)
  })

  test("contextLimit = 1_000_000 → largeContextThreshold (0.6)", () => {
    expect(resolveThreshold(1_000_000, baseConfig())).toBe(0.6)
  })

  test("contextLimit = 128_000 → smallContextThreshold (0.8)", () => {
    expect(resolveThreshold(128_000, baseConfig())).toBe(0.8)
  })

  test("使用者自定义 largeContextBoundary 影响判断", () => {
    const cfg = baseConfig({ largeContextBoundary: 200_000 })
    // 200_000 >= 200_000 → largeContextThreshold
    expect(resolveThreshold(200_000, cfg)).toBe(0.6)
    // 199_999 < 200_000 → smallContextThreshold
    expect(resolveThreshold(199_999, cfg)).toBe(0.8)
  })

  test("使用者自定义 largeContextThreshold / smallContextThreshold 生效", () => {
    const cfg = baseConfig({
      largeContextThreshold: 0.5,
      smallContextThreshold: 0.7,
    })
    expect(resolveThreshold(500_000, cfg)).toBe(0.5)
    expect(resolveThreshold(100_000, cfg)).toBe(0.7)
  })

  test("使用者显式设定 threshold 时优先使用，不看 contextLimit", () => {
    const cfg = baseConfig({ threshold: 0.42 })
    // 不论 contextLimit 多大，threshold 一律优先
    expect(resolveThreshold(1_000_000, cfg)).toBe(0.42)
    expect(resolveThreshold(128_000, cfg)).toBe(0.42)
    expect(resolveThreshold(50_000, cfg)).toBe(0.42)
  })

  test("threshold = 0 (无效但使用者显式) → 仍优先使用", () => {
    const cfg = baseConfig({ threshold: 0 })
    expect(resolveThreshold(400_000, cfg)).toBe(0)
  })

  test("使用者自定义 boundary + 自定义 threshold 同时设定，threshold 仍优先", () => {
    const cfg = baseConfig({
      threshold: 0.55,
      largeContextBoundary: 300_000,
      largeContextThreshold: 0.45,
      smallContextThreshold: 0.7,
    })
    expect(resolveThreshold(500_000, cfg)).toBe(0.55)
    expect(resolveThreshold(100_000, cfg)).toBe(0.55)
  })
})

// ============================================================
// readPreemptiveCompactConfig
// ============================================================

describe("readPreemptiveCompactConfig", () => {
  test("null → {}", () => {
    expect(readPreemptiveCompactConfig(null)).toEqual({})
  })

  test("undefined → {}", () => {
    expect(readPreemptiveCompactConfig(undefined)).toEqual({})
  })

  test("非物件（数字）→ {}", () => {
    expect(readPreemptiveCompactConfig(42)).toEqual({})
  })

  test("非物件（字串）→ {}", () => {
    expect(readPreemptiveCompactConfig("hello")).toEqual({})
  })

  test("非物件（boolean）→ {}", () => {
    expect(readPreemptiveCompactConfig(true)).toEqual({})
  })

  test("物件原样回传", () => {
    const input: PreemptiveCompactConfig = { enabled: false, threshold: 0.5 }
    expect(readPreemptiveCompactConfig(input)).toBe(input)
  })

  test("空物件原样回传", () => {
    const input = {}
    expect(readPreemptiveCompactConfig(input)).toEqual({})
    expect(readPreemptiveCompactConfig(input)).toBe(input)
  })

  test("数组视为非物件 → {}", () => {
    expect(readPreemptiveCompactConfig([])).toEqual({})
    expect(readPreemptiveCompactConfig([1, 2, 3])).toEqual({})
  })
})

// ============================================================
// resolveConfig
// ============================================================

describe("resolveConfig", () => {
  test("空 config → 全预设值", () => {
    const got = resolveConfig({})
    expect(got).toEqual({
      enabled: true,
      threshold: undefined,
      cooldownMs: 60_000,
      minTokens: 50_000,
      showToast: true,
      disableBuiltinCompaction: false,
      largeContextBoundary: 400_000,
      largeContextThreshold: 0.6,
      smallContextThreshold: 0.8,
    })
  })

  test("各栏位个别设定都生效", () => {
    const got = resolveConfig({
      cooldownMs: 30_000,
      minTokens: 80_000,
      showToast: false,
      largeContextBoundary: 500_000,
      largeContextThreshold: 0.5,
      smallContextThreshold: 0.75,
    })
    expect(got.cooldownMs).toBe(30_000)
    expect(got.minTokens).toBe(80_000)
    expect(got.showToast).toBe(false)
    expect(got.largeContextBoundary).toBe(500_000)
    expect(got.largeContextThreshold).toBe(0.5)
    expect(got.smallContextThreshold).toBe(0.75)
  })

  test("threshold = 0.5（范围内）→ 保留 0.5", () => {
    const got = resolveConfig({ threshold: 0.5 })
    expect(got.threshold).toBe(0.5)
  })

  test("threshold = 0.05（低于 0.1）→ clamp 到 0.1", () => {
    const got = resolveConfig({ threshold: 0.05 })
    expect(got.threshold).toBe(0.1)
  })

  test("threshold = 0.99（高于 0.95）→ clamp 到 0.95", () => {
    const got = resolveConfig({ threshold: 0.99 })
    expect(got.threshold).toBe(0.95)
  })

  test("threshold = 0.1（下边界）→ 保留 0.1", () => {
    const got = resolveConfig({ threshold: 0.1 })
    expect(got.threshold).toBe(0.1)
  })

  test("threshold = 0.95（上边界）→ 保留 0.95", () => {
    const got = resolveConfig({ threshold: 0.95 })
    expect(got.threshold).toBe(0.95)
  })

  test("threshold 非数字 → 保留 undefined（待 resolveThreshold 接手）", () => {
    const got = resolveConfig({ threshold: "x" as unknown as number })
    expect(got.threshold).toBeUndefined()
  })

  test("enabled: false → enabled = false", () => {
    expect(resolveConfig({ enabled: false }).enabled).toBe(false)
  })

  test("enabled: true → enabled = true", () => {
    expect(resolveConfig({ enabled: true }).enabled).toBe(true)
  })

  test("disableBuiltinCompaction: true → 启用", () => {
    expect(resolveConfig({ disableBuiltinCompaction: true }).disableBuiltinCompaction).toBe(true)
  })

  test("disableBuiltinCompaction 未设定 → false", () => {
    expect(resolveConfig({}).disableBuiltinCompaction).toBe(false)
  })

  test("disableBuiltinCompaction: false → 仍 false", () => {
    expect(resolveConfig({ disableBuiltinCompaction: false }).disableBuiltinCompaction).toBe(false)
  })

  test("cooldownMs / minTokens 非数字 → 用预设", () => {
    const got = resolveConfig({
      cooldownMs: "x" as unknown as number,
      minTokens: "y" as unknown as number,
    })
    expect(got.cooldownMs).toBe(60_000)
    expect(got.minTokens).toBe(50_000)
  })
})

// ============================================================
// extractModelKey
// ============================================================

describe("extractModelKey", () => {
  test("标准 providerID / modelID", () => {
    expect(extractModelKey("openai", "gpt-4")).toBe("openai/gpt-4")
  })

  test("含斜杠的 modelID 也单纯拼接", () => {
    expect(extractModelKey("foo", "bar/baz")).toBe("foo/bar/baz")
  })

  test("空字串也容忍", () => {
    expect(extractModelKey("", "")).toBe("/")
  })
})

// ============================================================
// buildContextLimitMap
// ============================================================

describe("buildContextLimitMap", () => {
  function makeProvider(id: string, models: Record<string, { limit?: { context?: number } }>): Provider {
    return {
      id,
      name: id,
      source: "config",
      env: [],
      options: {},
      models: models as Provider["models"],
    }
  }

  test("空 providers → 空 map", () => {
    expect(buildContextLimitMap([]).size).toBe(0)
  })

  test("有 provider 但没 models → 空 map", () => {
    const p = makeProvider("foo", {})
    expect(buildContextLimitMap([p]).size).toBe(0)
  })

  test("model 缺 limit.context → 跳过", () => {
    const p = makeProvider("foo", { m1: {} })
    expect(buildContextLimitMap([p]).size).toBe(0)
  })

  test("model limit.context = 0 → 跳过", () => {
    const p = makeProvider("foo", { m1: { limit: { context: 0 } } })
    expect(buildContextLimitMap([p]).size).toBe(0)
  })

  test("model limit.context = 200_000 → 写入 map", () => {
    const p = makeProvider("openai", { "gpt-4": { limit: { context: 200_000 } } })
    const map = buildContextLimitMap([p])
    expect(map.size).toBe(1)
    expect(map.get("openai/gpt-4")).toBe(200_000)
  })

  test("model limit.context = undefined → 跳过", () => {
    const p = makeProvider("openai", { "gpt-4": { limit: { context: undefined } } })
    expect(buildContextLimitMap([p]).size).toBe(0)
  })

  test("多 provider × 多 model → 正确建立所有 key", () => {
    const p1 = makeProvider("openai", {
      "gpt-4": { limit: { context: 200_000 } },
      "gpt-3.5": { limit: { context: 16_000 } },
    })
    const p2 = makeProvider("anthropic", {
      "claude-3": { limit: { context: 1_000_000 } },
    })
    const map = buildContextLimitMap([p1, p2])
    expect(map.size).toBe(3)
    expect(map.get("openai/gpt-4")).toBe(200_000)
    expect(map.get("openai/gpt-3.5")).toBe(16_000)
    expect(map.get("anthropic/claude-3")).toBe(1_000_000)
  })

  test("混合有/无 limit 的 models → 只保留有限 context 的", () => {
    const p = makeProvider("foo", {
      m1: { limit: { context: 100 } },
      m2: { limit: { context: 0 } },
      m3: {},
      m4: { limit: { context: 50_000 } },
    })
    const map = buildContextLimitMap([p])
    expect(map.size).toBe(2)
    expect(map.get("foo/m1")).toBe(100)
    expect(map.get("foo/m4")).toBe(50_000)
  })
})

// ============================================================
// computeUsageRatio
// ============================================================

describe("computeUsageRatio", () => {
  test("input + cache.read 都有值时正确加总", () => {
    const r = computeUsageRatio({
      input: 1000,
      output: 0,
      reasoning: 0,
      cache: { read: 500, write: 0 },
    })
    expect(r).toBe(1500)
  })

  test("cache.read = 0 → 只算 input", () => {
    const r = computeUsageRatio({
      input: 200,
      output: 999,
      reasoning: 999,
      cache: { read: 0, write: 999 },
    })
    expect(r).toBe(200)
  })

  test("input = 0 → 只算 cache.read", () => {
    const r = computeUsageRatio({
      input: 0,
      output: 999,
      reasoning: 999,
      cache: { read: 700, write: 999 },
    })
    expect(r).toBe(700)
  })

  test("都缺 → 0", () => {
    const r = computeUsageRatio({
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    })
    expect(r).toBe(0)
  })

  test("cache 物件缺 → cache.read 当 0 处理", () => {
    const r = computeUsageRatio({
      input: 100,
      output: 0,
      reasoning: 0,
      cache: undefined as unknown as { read: number; write: number },
    })
    expect(r).toBe(100)
  })

  test("不计入 output / reasoning / cache.write", () => {
    const r = computeUsageRatio({
      input: 10,
      output: 999_999,
      reasoning: 999_999,
      cache: { read: 20, write: 999_999 },
    })
    // 只算 input(10) + cache.read(20) = 30
    expect(r).toBe(30)
  })
})

// ============================================================
// isAssistantMessage
// ============================================================

describe("isAssistantMessage", () => {
  function asst(): AssistantMessage {
    return {
      id: "x",
      sessionID: "s",
      role: "assistant",
      time: { created: 0 },
      parentID: "p",
      modelID: "m",
      providerID: "p",
      mode: "normal",
      path: { cwd: "/", root: "/" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    }
  }

  test("role: \"assistant\" → true", () => {
    expect(isAssistantMessage(asst())).toBe(true)
  })

  test("role: \"user\" → false", () => {
    expect(isAssistantMessage({ role: "user" })).toBe(false)
  })

  test("null → false", () => {
    expect(isAssistantMessage(null)).toBe(false)
  })

  test("undefined → false", () => {
    expect(isAssistantMessage(undefined)).toBe(false)
  })

  test("非物件（字串）→ false", () => {
    expect(isAssistantMessage("assistant")).toBe(false)
  })

  test("非物件（数字）→ false", () => {
    expect(isAssistantMessage(42)).toBe(false)
  })

  test("缺 role → false", () => {
    expect(isAssistantMessage({})).toBe(false)
  })

  test("role 是其他字串 → false", () => {
    expect(isAssistantMessage({ role: "system" })).toBe(false)
  })

  test("role 是大小写不同的 \"Assistant\" → false", () => {
    expect(isAssistantMessage({ role: "Assistant" })).toBe(false)
  })
})

// ============================================================
// shouldTrigger
// ============================================================

describe("shouldTrigger", () => {
  // 走预设 + threshold 用 0.8（避免看 context size）
  const baseCfg = (overrides: Partial<ResolvedConfig> = {}): ResolvedConfig =>
    resolveConfig({
      ...overrides,
    })
  const defaultCfg = baseCfg()
  // 為了簡化：固定一個 contextLimit 與 totalTokens，讓特例只翻單一旗標
  const baseInput = (overrides: Partial<Parameters<typeof shouldTrigger>[0]> = {}) => ({
    totalTokens: 100_000,
    contextLimit: 200_000,
    config: defaultCfg,
    inCooldown: false,
    inProgress: false,
    ...overrides,
  })

  test("enabled: false → trigger: false, reason: \"disabled\"", () => {
    const r = shouldTrigger(baseInput({ config: baseCfg({ enabled: false }) }))
    expect(r).toEqual({ trigger: false, reason: "disabled" })
  })

  test("inProgress: true → trigger: false, reason: \"in_progress\"", () => {
    const r = shouldTrigger(baseInput({ inProgress: true }))
    expect(r).toEqual({ trigger: false, reason: "in_progress" })
  })

  test("inCooldown: true → trigger: false, reason: \"in_cooldown\"", () => {
    const r = shouldTrigger(baseInput({ inCooldown: true }))
    expect(r).toEqual({ trigger: false, reason: "in_cooldown" })
  })

  test("totalTokens < minTokens → trigger: false, reason: \"below_min_tokens\"", () => {
    // minTokens 预设 50_000；totalTokens = 10_000 远低于
    const r = shouldTrigger(baseInput({ totalTokens: 10_000 }))
    expect(r).toEqual({ trigger: false, reason: "below_min_tokens" })
  })

  test("contextLimit undefined → trigger: false, reason: \"unknown_model\"", () => {
    const r = shouldTrigger(baseInput({ contextLimit: undefined }))
    expect(r).toEqual({ trigger: false, reason: "unknown_model" })
  })

  test("ratio < threshold → trigger: false, reason: \"below_threshold\"（附 ratio / threshold）", () => {
    // threshold 预设 0.8（threshold 未设 → undefined → 改走 small 0.8）
    // contextLimit = 200_000, totalTokens = 100_000 → ratio = 0.5 < 0.8
    const r = shouldTrigger(baseInput({ totalTokens: 100_000, contextLimit: 200_000 }))
    expect(r.trigger).toBe(false)
    if (!r.trigger) {
      expect(r.reason).toBe("below_threshold")
      expect(r.ratio).toBeCloseTo(0.5, 5)
      expect(r.threshold).toBe(0.8)
    }
  })

  test("ratio >= threshold → trigger: true（附 ratio / threshold）", () => {
    // contextLimit = 200_000, totalTokens = 170_000 → ratio = 0.85 >= 0.8
    const r = shouldTrigger(baseInput({ totalTokens: 170_000, contextLimit: 200_000 }))
    expect(r.trigger).toBe(true)
    if (r.trigger) {
      expect(r.ratio).toBeCloseTo(0.85, 5)
      expect(r.threshold).toBe(0.8)
    }
  })

  test("不同 contextLimit 走不同 threshold（与 resolveThreshold 整合正确）", () => {
    // 同一 ratio 0.65，对 1M 上下文（largeContextThreshold=0.6）→ trigger
    // 对 200K 上下文（smallContextThreshold=0.8）→ below_threshold
    const r1 = shouldTrigger(
      baseInput({ totalTokens: 650_000, contextLimit: 1_000_000 }),
    )
    expect(r1.trigger).toBe(true)
    if (r1.trigger) expect(r1.threshold).toBe(0.6)

    const r2 = shouldTrigger(
      baseInput({ totalTokens: 130_000, contextLimit: 200_000 }),
    )
    // ratio = 130_000 / 200_000 = 0.65 < 0.8
    expect(r2.trigger).toBe(false)
    if (!r2.trigger) {
      expect(r2.reason).toBe("below_threshold")
      expect(r2.threshold).toBe(0.8)
    }
  })

  test("使用者显式 threshold 时优先使用，不分大小 context", () => {
    const cfg = baseCfg({ threshold: 0.5 })
    // 200K context, threshold = 0.5, totalTokens = 120_000 → ratio=0.6 >= 0.5 → trigger
    const r = shouldTrigger({ ...baseInput({ totalTokens: 120_000, contextLimit: 200_000 }), config: cfg })
    expect(r.trigger).toBe(true)
  })

  test("boundary：ratio = threshold 视为 trigger（>= 比较）", () => {
    // contextLimit = 100_000, totalTokens = 80_000 → ratio = 0.8 == 0.8 → trigger
    const r = shouldTrigger(baseInput({ totalTokens: 80_000, contextLimit: 100_000 }))
    expect(r.trigger).toBe(true)
  })

  test("优先级：disabled > inProgress > inCooldown > below_min_tokens > unknown_model > below_threshold", () => {
    // 所有旗標同時觸發時，回傳 "disabled"（第一個檢查）
    const r1 = shouldTrigger(
      baseInput({
        inProgress: true,
        inCooldown: true,
        totalTokens: 0,
        contextLimit: undefined,
        config: baseCfg({ enabled: false }),
      }),
    )
    expect(r1).toEqual({ trigger: false, reason: "disabled" })

    // 移除 enabled=false，剩下三個旗標都觸發 → 應該 "in_progress"
    const cfg = baseCfg()
    const r2 = shouldTrigger(
      baseInput({ inProgress: true, inCooldown: true, totalTokens: 0, contextLimit: undefined }),
    )
    expect(r2).toEqual({ trigger: false, reason: "in_progress" })

    // 移除 inProgress → "in_cooldown"
    const r3 = shouldTrigger(
      baseInput({ inProgress: false, inCooldown: true, totalTokens: 0, contextLimit: undefined }),
    )
    expect(r3).toEqual({ trigger: false, reason: "in_cooldown" })

    // 移除 inCooldown → "below_min_tokens"
    const r4 = shouldTrigger(
      baseInput({ inProgress: false, inCooldown: false, totalTokens: 0, contextLimit: undefined }),
    )
    expect(r4).toEqual({ trigger: false, reason: "below_min_tokens" })

    // 給足 minTokens，仍 contextLimit undefined → "unknown_model"
    const r5 = shouldTrigger(
      baseInput({ inProgress: false, inCooldown: false, totalTokens: 100_000, contextLimit: undefined }),
    )
    expect(r5).toEqual({ trigger: false, reason: "unknown_model" })
    // 別忘了 config 是 default 的；threshold undefined → resolveThreshold 不被呼叫（short-circuit）
  })
})

// ============================================================
// CooldownTracker
// ============================================================

describe("CooldownTracker", () => {
  test("未 mark 過 → 永遠不在 cooldown", () => {
    const t = new CooldownTracker(() => 1000)
    expect(t.isInCooldown("s1", 60_000)).toBe(false)
  })

  test("刚 markTriggered → 在 cooldown 内", () => {
    let now = 0
    const t = new CooldownTracker(() => now)
    t.markTriggered("s1")
    expect(t.isInCooldown("s1", 60_000)).toBe(true)
  })

  test("经过 cooldownMs 之后 → 不再 cooldown（严格 < 比较）", () => {
    let now = 0
    const t = new CooldownTracker(() => now)
    t.markTriggered("s1")
    now = 60_000 // 刚好等于 cooldownMs
    expect(t.isInCooldown("s1", 60_000)).toBe(false) // == 不算 cooldown
    now = 30_000 // 半途
    expect(t.isInCooldown("s1", 60_000)).toBe(true)
  })

  test("注入时钟可控时间", () => {
    let now = 100
    const t = new CooldownTracker(() => now)
    t.markTriggered("s1") // @ now=100
    now = 200
    expect(t.isInCooldown("s1", 60_000)).toBe(true) // delta=100<60_000
    now = 200 + 60_000 + 1
    expect(t.isInCooldown("s1", 60_000)).toBe(false)
  })

  test("不同 sessionID 互不影响", () => {
    const t = new CooldownTracker(() => 1000)
    t.markTriggered("s1")
    expect(t.isInCooldown("s1", 60_000)).toBe(true)
    expect(t.isInCooldown("s2", 60_000)).toBe(false)
  })

  test("clear 后回 false", () => {
    const t = new CooldownTracker(() => 1000)
    t.markTriggered("s1")
    expect(t.isInCooldown("s1", 60_000)).toBe(true)
    t.clear("s1")
    expect(t.isInCooldown("s1", 60_000)).toBe(false)
  })

  test("clear 不存在的 sessionID 不报错", () => {
    const t = new CooldownTracker()
    expect(() => t.clear("never-marked")).not.toThrow()
  })

  test("markTriggered 后再 mark 可重置时间", () => {
    let now = 0
    const t = new CooldownTracker(() => now)
    t.markTriggered("s1")
    now = 30_000 // 仍在 cooldown
    expect(t.isInCooldown("s1", 60_000)).toBe(true)
    t.markTriggered("s1") // 重置
    now = 40_000 // 距上次 mark 仅 10_000，仍 cooldown
    expect(t.isInCooldown("s1", 60_000)).toBe(true)
  })

  test("默认时钟走 Date.now()（不抛错即可）", () => {
    const t = new CooldownTracker()
    t.markTriggered("s1")
    // 不能跨太大秒数避免 flakiness，但既然 mark 刚发生，应在冷卻内
    expect(t.isInCooldown("s1", 60_000)).toBe(true)
  })
})

// ============================================================
// InProgressTracker
// ============================================================

describe("InProgressTracker", () => {
  test("tryEnter 第一次 true，之后 false", () => {
    const t = new InProgressTracker()
    expect(t.tryEnter("s1")).toBe(true)
    expect(t.tryEnter("s1")).toBe(false)
    expect(t.tryEnter("s1")).toBe(false)
  })

  test("release 后可再次 tryEnter 为 true", () => {
    const t = new InProgressTracker()
    expect(t.tryEnter("s1")).toBe(true)
    t.release("s1")
    expect(t.tryEnter("s1")).toBe(true)
  })

  test("不同 sessionID 互不影响", () => {
    const t = new InProgressTracker()
    expect(t.tryEnter("s1")).toBe(true)
    expect(t.tryEnter("s2")).toBe(true)
    expect(t.tryEnter("s1")).toBe(false)
    expect(t.tryEnter("s2")).toBe(false)
  })

  test("isInProgress 反映当前状态", () => {
    const t = new InProgressTracker()
    expect(t.isInProgress("s1")).toBe(false)
    t.tryEnter("s1")
    expect(t.isInProgress("s1")).toBe(true)
    t.release("s1")
    expect(t.isInProgress("s1")).toBe(false)
  })

  test("release 不存在的 sessionID 不报错", () => {
    const t = new InProgressTracker()
    expect(() => t.release("never-entered")).not.toThrow()
  })
})

// ============================================================
// 总结（快速 sanity：以上 export 都存在）
// ============================================================

describe("exports sanity", () => {
  test("所有 spec 文件里 import 的符号都能被 import", () => {
    //  透过 import 已经验过；这里再加一个小型 smoke 確保物件型别正常
    const t = new CooldownTracker(() => 0)
    expect(typeof t.isInCooldown).toBe("function")
    expect(typeof t.markTriggered).toBe("function")
    expect(typeof t.clear).toBe("function")

    const ip = new InProgressTracker()
    expect(typeof ip.tryEnter).toBe("function")
    expect(typeof ip.release).toBe("function")
    expect(typeof ip.isInProgress).toBe("function")
  })
})
