/**
 * Summarize tool_use events for card display.
 */
import type { ToolUseEvent } from "../agent/types.js";

interface ToolSummary {
  icon: string;
  title: string;
  detail: string;
}

/** Generate a human-readable summary for a tool call. */
export function summarizeToolCall(event: ToolUseEvent): ToolSummary {
  const { name, input } = event;

  switch (name) {
    case "Read":
      return {
        icon: "📄",
        title: "Read",
        detail: String(input.file_path ?? input.path ?? "file"),
      };

    case "Write":
      return {
        icon: "✏️",
        title: "Write",
        detail: String(input.file_path ?? "file"),
      };

    case "Edit":
      return {
        icon: "🔧",
        title: "Edit",
        detail: String(input.file_path ?? "file"),
      };

    case "Bash":
      return {
        icon: "💻",
        title: "Bash",
        detail: truncate(String(input.command ?? ""), 80),
      };

    case "Grep":
      return {
        icon: "🔍",
        title: "Grep",
        detail: `pattern="${truncate(String(input.pattern ?? ""), 40)}"`,
      };

    case "Glob":
      return {
        icon: "📁",
        title: "Glob",
        detail: `pattern="${truncate(String(input.pattern ?? ""), 40)}"`,
      };

    case "WebSearch":
      return {
        icon: "🌐",
        title: "WebSearch",
        detail: truncate(String(input.query ?? ""), 60),
      };

    case "WebFetch":
      return {
        icon: "🌐",
        title: "WebFetch",
        detail: truncate(String(input.url ?? ""), 60),
      };

    case "Task":
      return {
        icon: "🤖",
        title: "Task",
        detail: truncate(String(input.description ?? ""), 60),
      };

    default:
      return {
        icon: "⚙️",
        title: name,
        detail: truncate(JSON.stringify(input), 60),
      };
  }
}

/** Format a tool summary as a markdown line. */
export function toolCallToMarkdown(event: ToolUseEvent): string {
  const s = summarizeToolCall(event);
  return `${s.icon} **${s.title}** \`${s.detail}\``;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}
