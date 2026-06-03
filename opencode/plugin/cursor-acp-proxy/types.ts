// ============================================================
// ACP (Agent Client Protocol) 型別定義
// ============================================================

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// ---- ACP method params ----

export interface InitializeParams {
  protocolVersion: number;
  clientCapabilities: {
    fs?: { readTextFile: boolean; writeTextFile: boolean };
    terminal?: boolean;
  };
  clientInfo: { name: string; version: string };
}

export interface AuthenticateParams {
  methodId: string;
}

export interface SessionNewParams {
  cwd: string;
  mcpServers?: Array<unknown>;
}

export interface SessionNewResult {
  sessionId: string;
  modes?: {
    currentModeId: string;
    availableModes: Array<{ id: string; name: string; description: string }>;
  };
}

export interface SessionPromptParams {
  sessionId: string;
  prompt: Array<{ type: "text"; text: string }>;
}

export interface SessionPromptResult {
  stopReason: string;
}

// ---- session/update notification ----

/** session/update 內的 content (text 類型) */
export interface TextContent {
  type: "text";
  text?: string;
}

/** session/update 內的 content (其他類型預留) */
export interface ContentBlock {
  type: string;
  text?: string;
  [key: string]: unknown;
}

/** tool_call 事件 update 結構 */
export interface ToolCallUpdate {
  sessionUpdate: "tool_call";
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: "pending" | "in_progress" | "completed" | "failed";
  rawInput?: unknown;
  content?: ContentBlock[];
  [key: string]: unknown;
}

/** agent_message_chunk / agent_thought_chunk 事件 update 結構 */
export interface ChunkUpdate {
  sessionUpdate: "agent_message_chunk" | "agent_thought_chunk";
  content?: TextContent;
  [key: string]: unknown;
}

export interface SessionUpdateNotification {
  sessionId: string;
  update:
    | ChunkUpdate
    | ToolCallUpdate
    | { sessionUpdate: string; [key: string]: unknown };
}

// ---- session/request_permission notification ----

export interface PermissionRequestNotification {
  sessionId: string;
  toolCallId: string;
  // ... other fields vary
}

// ----

export interface AcpClientState {
  ready: boolean;
  processKilled: boolean;
}
