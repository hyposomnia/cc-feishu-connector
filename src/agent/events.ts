import { EventEmitter } from "node:events";
import type { ClaudeEvent } from "./types.js";

/**
 * Parses newline-delimited JSON from Claude Code stdout into typed events.
 */
export class ClaudeEventParser extends EventEmitter {
  private buffer = "";

  /** Feed raw stdout data. */
  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split("\n");
    // Keep incomplete last line in buffer
    this.buffer = lines.pop()!;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as ClaudeEvent;
        this.emit("event", event);
      } catch {
        this.emit("parse_error", trimmed);
      }
    }
  }

  /** Flush any remaining buffer content. */
  flush(): void {
    const trimmed = this.buffer.trim();
    if (trimmed) {
      try {
        const event = JSON.parse(trimmed) as ClaudeEvent;
        this.emit("event", event);
      } catch {
        this.emit("parse_error", trimmed);
      }
    }
    this.buffer = "";
  }
}
