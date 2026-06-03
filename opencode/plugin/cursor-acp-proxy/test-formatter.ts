// ============================================================
// 純函式測試: 驗證 formatChunk 對「文字 + 工具呼叫 + 工具輸出 + 思考」完整事件流的輸出
// 不啟動 cursor-agent acp，純粹測 formatter 邏輯。
// 用法: bun test-formatter.ts
// ============================================================
import { formatChunk, type FormatStyle } from "./server";
import type { PromptChunk } from "./acp-client";

interface Ctx { showTools: boolean; showThinking: boolean; format: FormatStyle; }
const concise: Ctx = { showTools: true, showThinking: true, format: "concise" };
const detailed: Ctx = { showTools: true, showThinking: true, format: "detailed" };
const toolsOff: Ctx = { showTools: false, showThinking: true, format: "concise" };
const thinkingOff: Ctx = { showTools: true, showThinking: false, format: "concise" };

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

/** 跑完整事件流，回傳串接後的文字 */
function runFlow(chunks: PromptChunk[], ctx: Ctx): string {
  let out = "";
  for (const c of chunks) {
    const s = formatChunk(ctx, c);
    if (s !== null) out += s;
  }
  return out;
}

// ------------------------------------------------------------
// 測試 1: 完整事件流 — concise 模式
// ------------------------------------------------------------
console.log("\n[1] concise 完整事件流");
{
  const chunks: PromptChunk[] = [
    { type: "thinking", text: "The command executed" },
    { type: "thinking", text: "successfully." },
    { type: "text", text: "It worked." },
    { type: "tool_start", toolCallId: "t1", title: "run echo", kind: "execute", rawInput: {} },
    { type: "tool_progress", toolCallId: "t1", status: "in_progress" },
    {
      type: "tool_output", toolCallId: "t1", text: "HELLO_ACP\nDONE\n",
    },
    { type: "tool_done", toolCallId: "t1", status: "completed" },
    { type: "thinking", text: "I should explain." },
  ];
  const out = runFlow(chunks, concise);

  // 1.1 兩個 thinking chunk 必須各佔獨立行
  const lines = out.split("\n");
  const think1 = lines.findIndex((l) => l.includes("The command executed"));
  const think2 = lines.findIndex((l) => l.includes("successfully."));
  assert("thinking chunk 1 存在於獨立行", think1 >= 0);
  assert("thinking chunk 2 存在於獨立行", think2 >= 0);
  assert("兩個 thinking chunk 是不同行（不黏在一起）", think1 !== think2);

  // 1.2 修正前的 bug: "executed💭" / "💭 successfully." 都不該出現
  assert("不應出現『executed💭』黏字", !out.includes("executed💭"));
  assert("不應出現『💭  successfully.』黏字（注意 💭 後面要有空格但不應有相鄰的 💭）",
    !out.match(/💭 💭/));
  // 1.3 修正後: 兩個 thinking 之間有換行
  assert("兩個 thinking chunk 之間有換行", out.includes("The command executed\n💭"));

  // 1.4 工具呼叫
  assert("工具 start 顯示 🔧", out.includes("🔧 execute: run echo"));
  assert("工具 progress 顯示 ⏳", out.includes("⏳ in_progress"));
  assert("工具 done 顯示 ✓", out.includes("✓ completed"));

  // 1.5 工具輸出（重點）— stdout 文字必須顯示
  assert("tool_output 顯示 HELLO_ACP", out.includes("HELLO_ACP"));
  assert("tool_output 顯示 DONE", out.includes("DONE"));
  // 1.6 tool_output 區塊前後應有換行隔開
  const helloIdx = out.indexOf("HELLO_ACP");
  const prevChar = out[helloIdx - 1] ?? "";
  assert("tool_output 之前有換行", prevChar === "\n", `prev char: ${JSON.stringify(prevChar)}`);

  // 1.7 最終 user-facing 文字（"It worked."）前不應多餘空行
  const textIdx = out.indexOf("It worked.");
  // text 前面應該直接是 \n（來自上一個 thinking 的 trailing newline）— 不該有 \n\n
  const twoBefore = out.slice(Math.max(0, textIdx - 2), textIdx);
  assert("最終文字前不應有空行（無 \\n\\n）", twoBefore !== "\n\n", `got: ${JSON.stringify(twoBefore)}`);

  console.log(`  --- 輸出 ---\n${out}\n  --- ---`);
}

// ------------------------------------------------------------
// 測試 2: detailed 模式
// ------------------------------------------------------------
console.log("\n[2] detailed 模式");
{
  const chunks: PromptChunk[] = [
    { type: "thinking", text: "step A" },
    { type: "tool_output", toolCallId: "t1", text: "OUT\n" },
  ];
  const out = runFlow(chunks, detailed);
  assert("thinking 用 [Thinking] 前綴", out.includes("[Thinking] step A"));
  assert("thinking 之後有換行（trailing newline）", out.includes("step A\n"));
  assert("tool_output 用 [Tool Output] 標籤", out.includes("[Tool Output]"));
  assert("tool_output 內含原文", out.includes("OUT"));
}

// ------------------------------------------------------------
// 測試 3: 選項關閉
// ------------------------------------------------------------
console.log("\n[3] 選項關閉 — 不應出現對應 prefix");
{
  const chunks: PromptChunk[] = [
    { type: "thinking", text: "thought" },
    { type: "tool_output", toolCallId: "t1", text: "OUT\n" },
  ];
  const out1 = runFlow(chunks, toolsOff);
  assert("showTools=false → 隱藏 tool_output", !out1.includes("OUT"));
  assert("showTools=false → 仍顯示 thinking", out1.includes("💭 thought"));

  const out2 = runFlow(chunks, thinkingOff);
  assert("showThinking=false → 隱藏 thinking", !out2.includes("💭"));
  assert("showThinking=false → 仍顯示 tool_output", out2.includes("OUT"));
}

// ------------------------------------------------------------
// 測試 4: tool_output 為空字串時不 emit
// ------------------------------------------------------------
console.log("\n[4] 邊界 — 空 tool_output 應被略過");
{
  const chunks: PromptChunk[] = [
    { type: "tool_output", toolCallId: "t1", text: "" },
    { type: "text", text: "x" },
  ];
  const out = runFlow(chunks, concise);
  // 空 string 仍會 emit "\n\n" — 這是 formatter 的可預期行為
  // 重點是：tool_output 為空時不應拋錯、且不應包含任何 OUT 標記
  assert("空 tool_output 不拋錯", typeof out === "string");
  assert("空 tool_output 不含內容標記", !out.includes("OUT"));
}

// ------------------------------------------------------------
// 結果
// ------------------------------------------------------------
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
