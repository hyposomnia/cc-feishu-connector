/**
 * Streaming card updater with throttling.
 * Manages the lifecycle of a single turn card: create → update → freeze.
 */
import type { FeishuGateway } from "../gateway/feishu.js";
import { TurnCardRenderer } from "./turn-card.js";
import type { ClaudeEvent } from "../agent/types.js";

export interface StreamingCardOptions {
  /** Throttle interval for thinking events (ms). */
  thinkingThrottleMs?: number;
  /** Throttle interval for text events (ms). */
  textThrottleMs?: number;
}

const DEFAULT_OPTIONS: Required<StreamingCardOptions> = {
  thinkingThrottleMs: 500,
  textThrottleMs: 300,
};

export class StreamingCard {
  private renderer = new TurnCardRenderer();
  private gateway: FeishuGateway;
  private chatId: string;
  private messageId?: string;
  private opts: Required<StreamingCardOptions>;

  private lastUpdateTime = 0;
  private pendingUpdate = false;
  private updateTimer?: ReturnType<typeof setTimeout>;

  constructor(gateway: FeishuGateway, chatId: string, opts?: StreamingCardOptions) {
    this.gateway = gateway;
    this.chatId = chatId;
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
  }

  /** Process an event and update the card. */
  async processEvent(event: ClaudeEvent): Promise<void> {
    this.renderer.processEvent(event);

    // Determine update strategy based on event type
    switch (event.type) {
      case "thinking":
        await this.throttledUpdate(this.opts.thinkingThrottleMs);
        break;

      case "text":
        await this.throttledUpdate(this.opts.textThrottleMs);
        break;

      case "assistant":
        // Assistant response text - throttled update
        await this.throttledUpdate(this.opts.textThrottleMs);
        break;

      case "system":
        // System messages - immediate update to show status
        await this.immediateUpdate();
        break;

      case "tool_use":
      case "permission_request":
        // Immediate update for tool calls
        await this.immediateUpdate();
        break;

      case "result":
      case "error":
        // Final update: immediate + freeze
        await this.immediateUpdate();
        break;

      case "tool_result":
        // Update to show result status
        await this.throttledUpdate(200);
        break;
    }
  }

  /** Get the underlying renderer for direct access. */
  getRenderer(): TurnCardRenderer {
    return this.renderer;
  }

  /** Get the Feishu message ID of this card. */
  getMessageId(): string | undefined {
    return this.messageId;
  }

  private async immediateUpdate(): Promise<void> {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = undefined;
    }
    this.pendingUpdate = false;
    await this.sendUpdate();
  }

  private async throttledUpdate(intervalMs: number): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastUpdateTime;

    if (elapsed >= intervalMs) {
      await this.sendUpdate();
    } else if (!this.pendingUpdate) {
      this.pendingUpdate = true;
      this.updateTimer = setTimeout(async () => {
        this.pendingUpdate = false;
        this.updateTimer = undefined;
        await this.sendUpdate();
      }, intervalMs - elapsed);
    }
  }

  private async sendUpdate(): Promise<void> {
    this.lastUpdateTime = Date.now();
    const card = this.renderer.buildCard();

    try {
      if (!this.messageId) {
        // First update: create the card
        this.messageId = await this.gateway.sendCard(this.chatId, card);
      } else {
        // Subsequent updates: PATCH the card
        await this.gateway.updateCard(this.messageId, card);
      }
    } catch (err) {
      console.error("[streaming] Card update failed:", err);
    }
  }
}
