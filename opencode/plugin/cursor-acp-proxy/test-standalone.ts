// ============================================================
// 獨立測試: 啟動 AcpClient + HTTP server，用 curl 測試
// 用法: npx tsx test-standalone.ts
// ============================================================
import { AcpClient } from "./acp-client";
import { AcpHttpServer } from "./server";

async function main() {
  console.error("=== Starting standalone test ===\n");

  // 1. 啟動 ACP client
  const acp = new AcpClient({ debug: true });
  console.error("[test] starting acp client...");
  await acp.start();
  console.error("[test] acp client ready\n");

  // 2. 啟動 HTTP server
  const server = new AcpHttpServer(acp, { debug: true });
  const port = await server.start(32126);
  console.error(`[test] server on port ${port}\n`);

  // 3. 測試 /health
  console.error("--- GET /health ---");
  const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
  console.error("health:", await healthRes.json());

  // 4. 測試 /v1/chat/completions (stream)
  console.error("\n--- POST /v1/chat/completions (stream) ---");
  const t0 = Date.now();
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "auto",
      messages: [{ role: "user", content: "Say hello in one sentence." }],
      stream: true,
    }),
  });

  if (!res.ok) {
    console.error("HTTP error:", res.status, await res.text());
    process.exit(1);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    text += chunk;
    // print raw SSE lines to stderr for debugging
    for (const line of chunk.split("\n")) {
      if (line.trim()) console.error("SSE:", line.trim().slice(0, 120));
    }
  }
  const t1 = Date.now();

  // extract text from SSE
  const textMatch = text.match(/delta":{"content":"([^"]+)"/g);
  const extractedText = textMatch
    ? textMatch.map((m) => m.match(/"([^"]+)"/)?.[1] ?? "").join("")
    : "(no text)";

  console.error(`\n--- Result [${t1 - t0}ms] ---`);
  console.error("Text:", extractedText);

  // 5. cleanup
  await server.stop();
  await acp.stop();
  console.error("\n=== Test complete ===");
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
