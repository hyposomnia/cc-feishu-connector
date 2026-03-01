// --- Input messages (stdin to Claude Code) ---

export interface UserMessage {
  type: "user";
  message: {
    role: "user";
    content: string;
  };
}

export interface PermissionResponse {
  type: "permission_response";
  response: "allow" | "deny" | "allow_all";
}

export type ClaudeInput = UserMessage | PermissionResponse;

// --- Output events (stdout from Claude Code) ---

export interface ThinkingEvent {
  type: "thinking";
  thinking: string;
}

export interface TextEvent {
  type: "text";
  text: string;
}

export interface ToolUseEvent {
  type: "tool_use";
  tool_use_id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ResultEvent {
  type: "result";
  result: string;
  session_id?: string;
  cost_usd?: number;
  duration_ms?: number;
  tokens?: {
    input: number;
    output: number;
  };
}

export interface PermissionRequestEvent {
  type: "permission_request";
  permission_request_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  message: string;
}

export interface ErrorEvent {
  type: "error";
  error: string;
}

export interface SystemEvent {
  type: "system";
  message: string;
}

export interface AssistantEvent {
  type: "assistant";
  message?: {
    content: Array<
      | { type: "text"; text: string }
      | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
    >;
    id: string;
    model: string;
    role: "assistant";
  };
}

export interface UserEvent {
  type: "user";
  content?: string;
  message?: {
    role: "user";
    content: string;
  };
}

export type ClaudeEvent =
  | ThinkingEvent
  | TextEvent
  | ToolUseEvent
  | ToolResultEvent
  | ResultEvent
  | PermissionRequestEvent
  | ErrorEvent
  | SystemEvent
  | AssistantEvent
  | UserEvent;
