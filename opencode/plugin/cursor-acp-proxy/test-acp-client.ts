// ============================================================
// 纯函数式单元测试: 验证 AcpClient.prompt 对 thinking chunks 的缓冲行为
// 不启动 cursor-agent acp，只替换 send/on/off 来模拟 session/update。
// 用法: bun test-acp-client.ts
// ============================================================
import { AcpClient, type PromptChunk } from "./acp-client";

type SimulatedUpdate = Record<string, unknown>;

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function sameChunks(actual: PromptChunk[], expected: PromptChunk[]): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

async function runPrompt(updates: SimulatedUpdate[]): Promise<PromptChunk[]> {
  const acp = new AcpClient();
  const chunks: PromptChunk[] = [];
  let sessionUpdateHandler: ((params: unknown) => void) | undefined;

  (acp as any).on = (method: string, handler: (params: unknown) => void) => {
    if (method === "session/update") sessionUpdateHandler = handler;
  };
  (acp as any).off = (method: string, handler: (params: unknown) => void) => {
    if (method === "session/update" && sessionUpdateHandler === handler) {
      sessionUpdateHandler = undefined;
    }
  };
  (acp as any).send = async (method: string) => {
    if (method !== "session/prompt") throw new Error(`unexpected method: ${method}`);
    for (const update of updates) {
      sessionUpdateHandler?.({ sessionId: "s1", update });
    }
    return { stopReason: "end_turn" };
  };

  await acp.prompt("s1", "prompt", (chunk) => chunks.push(chunk));
  return chunks;
}

console.log("\n[1] 连续 thinking chunks 会合并到文字前一次 emit");
{
  const chunks = await runPrompt([
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "part1" } },
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "part2" } },
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "part3" } },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "response" } },
  ]);
  assert("thinking 只 emit 一次，且先于 text", sameChunks(chunks, [
    { type: "thinking", text: "part1part2part3" },
    { type: "text", text: "response" },
  ]), JSON.stringify(chunks));
}

console.log("\n[2] 混合 thinking/text/tool_call 时按逻辑区块 flush");
{
  const chunks = await runPrompt([
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "a" } },
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "b" } },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "response1" } },
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "c" } },
    { sessionUpdate: "tool_call", toolCallId: "tool-1", title: "run", kind: "execute", rawInput: {} },
    { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "response2" } },
  ]);
  assert("thinking 会在 text 与 tool_start 前 flush", sameChunks(chunks, [
    { type: "thinking", text: "ab" },
    { type: "text", text: "response1" },
    { type: "thinking", text: "c" },
    { type: "tool_start", toolCallId: "tool-1", title: "run", kind: "execute", rawInput: {} },
    { type: "text", text: "response2" },
  ]), JSON.stringify(chunks));
}

console.log("\n[3] 没有 thinking chunks 时不会额外 emit");
{
  const chunks = await runPrompt([]);
  assert("空事件序列不 emit chunk", chunks.length === 0, JSON.stringify(chunks));
}

console.log("\n[4] 只有 thinking chunk 时会在 prompt resolve 后 flush");
{
  const chunks = await runPrompt([
    { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "lonely" } },
  ]);
  assert("resolve 时 emit 单一 thinking chunk", sameChunks(chunks, [
    { type: "thinking", text: "lonely" },
  ]), JSON.stringify(chunks));
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
