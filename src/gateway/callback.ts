/**
 * Card action callback handler.
 * In WebSocket mode, card callbacks are delivered as events via the EventDispatcher.
 * This module provides a registry for action handlers keyed by action value.
 */

export type CardAction = {
  openId: string;
  messageId: string;
  actionValue: Record<string, unknown>;
  actionTag: string;
};

export type CardActionCallback = (action: CardAction) => void | Promise<void>;

export class CallbackRouter {
  private handlers = new Map<string, CardActionCallback>();

  /** Register a handler for a specific action key. */
  on(actionKey: string, handler: CardActionCallback): void {
    this.handlers.set(actionKey, handler);
  }

  /** Remove a handler. */
  off(actionKey: string): void {
    this.handlers.delete(actionKey);
  }

  /** Dispatch a card action event. Called by the Feishu gateway. */
  async dispatch(action: CardAction): Promise<void> {
    console.log("[callback] Dispatching action:", JSON.stringify(action.actionValue));
    console.log("[callback] Registered handlers:", Array.from(this.handlers.keys()));

    // Look for a matching handler by checking action value keys
    for (const [key, handler] of this.handlers) {
      if (key in action.actionValue) {
        console.log("[callback] Matched handler:", key);
        try {
          await handler(action);
        } catch (err) {
          console.error("[callback] Handler error:", err);
          throw err;
        }
        return;
      }
    }
    console.warn("[callback] No handler for action:", action.actionValue);
  }
}
