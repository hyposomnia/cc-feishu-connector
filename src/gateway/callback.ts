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

export type CardActionCallback = (action: CardAction) => object | undefined | void | Promise<object | undefined | void>;

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

  /** Dispatch a card action event. Returns the updated card if the handler provides one. */
  async dispatch(action: CardAction): Promise<object | undefined> {
    for (const [key, handler] of this.handlers) {
      if (key in action.actionValue) {
        try {
          const result = await handler(action);
          return result as object | undefined;
        } catch (err) {
          console.error("[callback] Handler error:", err);
          throw err;
        }
      }
    }
    return undefined;
  }
}
