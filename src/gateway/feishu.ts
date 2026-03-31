import {
  Client,
  WSClient,
  EventDispatcher,
} from "@larksuiteoapi/node-sdk";
import type { FeishuConfig } from "../config.js";
import type { CallbackRouter } from "./callback.js";

export interface IncomingMessage {
  messageId: string;
  chatId: string;
  chatType: string;
  senderId: string;
  text: string;
  mentions?: Array<{ key: string; id: string; name: string }>;
}

export type MessageHandler = (msg: IncomingMessage) => void | Promise<void>;

export class FeishuGateway {
  private client: Client;
  private wsClient: WSClient;
  private dispatcher: EventDispatcher;
  private messageHandler?: MessageHandler;
  private callbackRouter?: CallbackRouter;
  private processedMessages = new Set<string>();
  private readonly MESSAGE_CACHE_SIZE = 1000;

  constructor(config: FeishuConfig, callbackRouter?: CallbackRouter) {
    this.client = new Client({
      appId: config.app_id,
      appSecret: config.app_secret,
    });

    this.dispatcher = new EventDispatcher({});

    this.wsClient = new WSClient({
      appId: config.app_id,
      appSecret: config.app_secret,
    });

    this.callbackRouter = callbackRouter;
    this.setupEventHandlers();
  }

  /** Register the handler for incoming user messages. */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /** Start the WebSocket connection. */
  async start(): Promise<void> {
    this.patchWSClientCardHandler();
    await this.wsClient.start({
      eventDispatcher: this.dispatcher,
    });
  }

  /**
   * Monkey-patch WSClient to handle `type: "card"` messages.
   *
   * The SDK's handleEventData() silently drops card messages (type !== "event"),
   * so card action callbacks are never dispatched. We intercept them here,
   * parse the payload, dispatch to callbackRouter, and send an ACK.
   */
  private patchWSClientCardHandler(): void {
    const ws = this.wsClient as unknown as Record<string, unknown>;
    const original = (ws.handleEventData as Function).bind(this.wsClient);

    ws.handleEventData = async (data: {
      headers: Array<{ key: string; value: string }>;
      payload: Uint8Array;
      [k: string]: unknown;
    }) => {
      const typeHeader = data.headers.find((h) => h.key === "type");
      if (typeHeader?.value !== "card") {
        return original(data);
      }

      // Card action callback (type:"card" frame).
      // The SDK silently drops these frames, so we handle them here.
      const startTime = Date.now();

      try {
        const rawPayload = new TextDecoder("utf-8").decode(data.payload);
        const cardData = JSON.parse(rawPayload);
        console.log("[feishu] type:card payload:", JSON.stringify(cardData));

        if (this.callbackRouter && cardData.action) {
          const openId = cardData.operator?.open_id ?? cardData.open_id ?? "";
          const messageId = cardData.open_message_id ?? "";

          const updatedCard = await this.callbackRouter.dispatch({
            openId,
            messageId,
            actionValue: cardData.action.value ?? {},
            actionTag: cardData.action.tag ?? "",
          });

          if (updatedCard && messageId) {
            this.updateCard(messageId, updatedCard).catch((err) => {
              console.error("[feishu] updateCard failed (card frame):", err?.message);
            });
          }
        }
      } catch (err) {
        console.error("[feishu] card frame handler error:", err);
      }

      // Send ACK back to Feishu
      const endTime = Date.now();
      const payloadStr = JSON.stringify({ code: 0 });
      const sendMessage = (ws.sendMessage as Function).bind(this.wsClient);
      sendMessage({
        ...data,
        headers: [...data.headers, { key: "biz_rt", value: String(endTime - startTime) }],
        payload: new TextEncoder().encode(payloadStr),
      });
    };
  }

  /** Send a plain text message. */
  async sendText(chatId: string, text: string): Promise<string | undefined> {
    const resp = await this.client.im.v1.message.create({
      data: {
        receive_id: chatId,
        msg_type: "text",
        content: JSON.stringify({ text }),
      },
      params: { receive_id_type: "chat_id" },
    });
    return resp.data?.message_id;
  }

  /** Send an interactive card message. Returns the message_id for later PATCH. */
  async sendCard(chatId: string, card: object): Promise<string | undefined> {
    const resp = await this.client.im.v1.message.create({
      data: {
        receive_id: chatId,
        msg_type: "interactive",
        content: JSON.stringify(card),
      },
      params: { receive_id_type: "chat_id" },
    });
    return resp.data?.message_id;
  }

  /** Update (PATCH) an existing card message. */
  async updateCard(messageId: string, card: object): Promise<void> {
    await this.client.im.v1.message.patch({
      data: { content: JSON.stringify(card) },
      path: { message_id: messageId },
    });
  }

  /** Reply to a specific message with a card. */
  async replyCard(messageId: string, card: object): Promise<string | undefined> {
    const resp = await this.client.im.v1.message.reply({
      data: {
        msg_type: "interactive",
        content: JSON.stringify(card),
      },
      path: { message_id: messageId },
    });
    return resp.data?.message_id;
  }

  /** 给消息添加表情反应，返回 reactionId */
  async addReaction(messageId: string, emojiType: string): Promise<string | undefined> {
    const res = await this.client.im.v1.messageReaction.create({
      path: { message_id: messageId },
      data: { reaction_type: { emoji_type: emojiType } },
    }).catch((err: any) => { console.error("[gateway] addReaction failed:", err?.message); return null; });
    return res?.data?.reaction_id;
  }

  /** 移除表情反应 */
  async removeReaction(messageId: string, reactionId: string): Promise<void> {
    await this.client.im.v1.messageReaction.delete({
      path: { message_id: messageId, reaction_id: reactionId },
    }).catch((err: any) => { console.error("[gateway] removeReaction failed:", err?.message); });
  }

  /** Get the raw SDK client for advanced operations. */
  getClient(): Client {
    return this.client;
  }

  private setupEventHandlers(): void {
    this.dispatcher.register({
      "im.message.receive_v1": async (data) => {
        if (!this.messageHandler) return;

        const { message, sender } = data;
        if (!message || !sender) return;

        // Deduplicate messages by message_id
        if (this.processedMessages.has(message.message_id)) {
          return;
        }

        // Add to processed set and maintain cache size
        this.processedMessages.add(message.message_id);
        if (this.processedMessages.size > this.MESSAGE_CACHE_SIZE) {
          // Remove oldest entries (first 100)
          const toRemove = Array.from(this.processedMessages).slice(0, 100);
          toRemove.forEach(id => this.processedMessages.delete(id));
        }

        // Only handle text messages
        if (message.message_type !== "text") return;

        let text = "";
        try {
          const parsed = JSON.parse(message.content);
          text = parsed.text ?? "";
        } catch {
          text = message.content;
        }

        // Strip bot mentions from text
        if (message.mentions?.length) {
          for (const m of message.mentions) {
            text = text.replace(m.key, "").trim();
          }
        }

        if (!text) return;

        const incoming: IncomingMessage = {
          messageId: message.message_id,
          chatId: message.chat_id,
          chatType: message.chat_type,
          senderId: sender.sender_id?.open_id ?? "",
          text,
          mentions: message.mentions?.map((m) => ({
            key: m.key,
            id: m.id?.open_id ?? "",
            name: m.name,
          })),
        };

        await this.messageHandler(incoming);
      },
    });

    // Register a no-op handler for card.action.trigger events.
    // Feishu may send both a type:"card" frame (handled by patchWSClientCardHandler)
    // and a type:"event" frame with card.action.trigger for the same button click.
    // Without a registered handler, EventDispatcher returns the string
    // "no card.action.trigger event handle" which gets base64-encoded into the ACK —
    // registering a handler that returns undefined keeps the ACK clean.
    this.dispatcher.register({
      // card.action.trigger is the primary delivery path for button clicks in WebSocket mode.
      // The SDK wraps any non-undefined return value as base64 in the ACK, which Feishu
      // rejects with 200672. So we MUST return undefined to keep the ACK as { code: 200 }.
      // Card update is done via REST API separately.
      "card.action.trigger": async (data) => {
        console.log("[feishu] card.action.trigger event:", JSON.stringify(data));
        if (!this.callbackRouter) return undefined;
        const action = (data as any).action;
        // message ID is in context.open_message_id (NOT open_message_id at top level)
        const messageId = (data as any).context?.open_message_id ?? "";
        const openId = (data as any).operator?.open_id ?? (data as any).open_id ?? "";
        if (!action) return undefined;
        try {
          const updatedCard = await this.callbackRouter.dispatch({
            openId,
            messageId,
            actionValue: action.value ?? {},
            actionTag: action.tag ?? "",
          });
          // Update card via REST API (ACK must return undefined to avoid 200672)
          if (updatedCard && messageId) {
            this.updateCard(messageId, updatedCard).catch((err) => {
              console.error("[feishu] updateCard failed (event):", err?.message);
            });
          }
        } catch (err) {
          console.error("[feishu] card.action.trigger error:", err);
        }
        return undefined; // Must be undefined — any object causes 200672
      },
    });
  }
}
