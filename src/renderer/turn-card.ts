/**
 * Turn card: renders a full AI turn as a single Feishu card.
 * Accumulates events and produces the card JSON at any point.
 */
import type { ClaudeEvent, ToolUseEvent, ToolResultEvent } from "../agent/types.js";
import { createCard, md, hr, note, type Card, type CardElement } from "./card-builder.js";
import { toolCallToMarkdown } from "./tool-call.js";

export type TurnStatus = "thinking" | "working" | "done" | "error";

interface ToolCallRecord {
  event: ToolUseEvent;
  result?: ToolResultEvent;
}

// Event items in chronological order
type EventItem =
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool"; tool: ToolCallRecord };

export class TurnCardRenderer {
  private thinkingChunks: string[] = [];
  private eventItems: EventItem[] = []; // Chronological order of events
  private toolCallsMap = new Map<string, ToolCallRecord>(); // tool_use_id -> record
  private status: TurnStatus = "thinking";
  private costUsd?: number;
  private durationMs?: number;
  private tokens?: { input: number; output: number };
  private errorMsg?: string;

  /** Process a Claude event and update internal state. */
  processEvent(event: ClaudeEvent): void {
    switch (event.type) {
      case "thinking":
        this.status = "thinking";
        this.thinkingChunks.push(event.thinking);
        break;

      case "tool_use": {
        // Only set status to working if not already done/error
        if (this.status !== "done" && this.status !== "error") {
          this.status = "working";
        }
        const record: ToolCallRecord = { event };
        this.toolCallsMap.set(event.tool_use_id, record);
        this.eventItems.push({ type: "tool", tool: record });
        break;
      }

      case "tool_result": {
        const tc = this.toolCallsMap.get(event.tool_use_id);
        if (tc) tc.result = event;
        break;
      }

      case "text":
        // Only set status to working if not already done/error
        if (this.status !== "done" && this.status !== "error") {
          this.status = "working";
        }
        this.eventItems.push({ type: "text", text: event.text });
        break;

      case "assistant":
        // Assistant message event (contains response text and/or tool calls)
        if (event.message?.content && Array.isArray(event.message.content)) {
          for (const block of event.message.content) {
            if (block.type === "text" && "text" in block) {
              // Text content - add to event items
              this.eventItems.push({ type: "text", text: block.text });
            } else if (block.type === "tool_use" && "name" in block) {
              // Tool use - convert to ToolUseEvent and add to event items
              // Only set status to working if not already done/error
              if (this.status !== "done" && this.status !== "error") {
                this.status = "working";
              }
              const toolEvent: ToolUseEvent = {
                type: "tool_use",
                tool_use_id: block.id,
                name: block.name,
                input: block.input,
              };
              const record: ToolCallRecord = { event: toolEvent };
              this.toolCallsMap.set(block.id, record);
              this.eventItems.push({ type: "tool", tool: record });
            }
          }
        }
        break;

      case "system":
        // System messages (like session resumed, etc.)
        if (event.message) {
          this.eventItems.push({ type: "text", text: `ℹ️ ${event.message}` });
        }
        break;

      case "result":
        this.status = "done";
        if (event.result) {
          this.eventItems.push({ type: "text", text: event.result });
        }
        this.costUsd = event.cost_usd;
        this.durationMs = event.duration_ms;
        this.tokens = event.tokens;
        break;

      case "error":
        this.status = "error";
        this.errorMsg = event.error;
        break;

      case "user":
        // User message echo - ignore (already shown in Feishu)
        break;
    }
  }

  /** Build the current card JSON for Feishu. */
  buildCard(): Card {
    const elements: CardElement[] = [];

    // Thinking section
    const thinkingText = this.thinkingChunks.join("");
    if (thinkingText) {
      if (this.status === "done" || this.status === "error") {
        // Done: italic header to indicate completed thinking
        elements.push(md(`💭 *Thinking*\n${lastBlock(thinkingText, 500)}`));
      } else {
        // In progress: bold header
        elements.push(md(`💭 **Thinking**\n${lastBlock(thinkingText, 500)}`));
      }
    }

    // Event items in chronological order
    if (this.eventItems.length > 0) {
      elements.push(hr());

      for (const item of this.eventItems) {
        if (item.type === "text") {
          // Text content
          elements.push(md(truncateBlock(item.text, 2000)));
        } else if (item.type === "tool") {
          // Tool call - show as collapsed summary
          const tc = item.tool;
          const summaryLine = toolCallToMarkdown(tc.event);

          // Add result indicator
          if (tc.result) {
            if (tc.result.is_error) {
              elements.push(md(`${summaryLine} ❌`));
              elements.push(md(`  Error: \`${truncateBlock(tc.result.content, 200)}\``));
            } else {
              elements.push(md(`${summaryLine} ✅`));
            }
          } else {
            // Still executing
            elements.push(md(`${summaryLine} ⏳`));
          }
        }
      }
    }

    // Error message
    if (this.errorMsg) {
      elements.push(hr());
      elements.push(md(`❌ **Error:** ${this.errorMsg}`));
    }

    // Footer with stats
    if (this.status === "done") {
      const parts: string[] = [];
      if (this.tokens) {
        parts.push(`tokens: ${this.tokens.input}→${this.tokens.output}`);
      }
      if (this.costUsd !== undefined) {
        parts.push(`cost: $${this.costUsd.toFixed(4)}`);
      }
      if (this.durationMs !== undefined) {
        parts.push(`time: ${(this.durationMs / 1000).toFixed(1)}s`);
      }
      if (parts.length > 0) {
        elements.push(note(parts.join(" | ")));
      }
    }

    // Status indicator in header
    const headerTemplate = {
      thinking: "blue",
      working: "wathet",
      done: "green",
      error: "red",
    }[this.status];

    const headerTitle = {
      thinking: "🧠 Thinking...",
      working: "⚡ Working...",
      done: "✅ Done",
      error: "❌ Error",
    }[this.status];

    return createCard({ title: headerTitle, template: headerTemplate }, elements);
  }

  getStatus(): TurnStatus {
    return this.status;
  }
}

function truncateBlock(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\n\n*... (truncated)*";
}

function lastBlock(text: string, max: number): string {
  if (text.length <= max) return text;
  return "*...*\n\n" + text.slice(text.length - max);
}
