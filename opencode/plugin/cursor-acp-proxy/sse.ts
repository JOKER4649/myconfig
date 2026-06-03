// ============================================================
// SSE Adapter — ACP text chunk → OpenAI-compatible SSE event
// ============================================================

export interface SseChunkOptions {
  id: string;
  created: number;
  model: string;
}

/** 建立一個 SSE text delta chunk */
export function textChunk(
  opts: SseChunkOptions,
  text: string,
): string {
  const payload = {
    id: opts.id,
    object: "chat.completion.chunk",
    created: opts.created,
    model: opts.model,
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: text },
        finish_reason: null,
      },
    ],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** 建立一個 SSE finish chunk */
export function finishChunk(opts: SseChunkOptions): string {
  const payload = {
    id: opts.id,
    object: "chat.completion.chunk",
    created: opts.created,
    model: opts.model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
      },
    ],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** 結束 SSE stream */
export function doneEvent(): string {
  return "data: [DONE]\n\n";
}

/** 建立 error chunk */
export function errorChunk(
  opts: SseChunkOptions,
  message: string,
): string {
  const payload = {
    id: opts.id,
    object: "chat.completion.chunk",
    created: opts.created,
    model: opts.model,
    choices: [
      {
        index: 0,
        delta: { role: "assistant", content: `\n[Error] ${message}\n` },
        finish_reason: "stop",
      },
    ],
  };
  return `data: ${JSON.stringify(payload)}\n\n`;
}
