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
    await this.wsClient.start({
      eventDispatcher: this.dispatcher,
    });
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

    // Try multiple possible card action event names
    const cardEventNames = [
      "card.action.trigger",
      "application.bot.menu_v6",
      "card_action_trigger",
      "interactive",
    ];

    for (const eventName of cardEventNames) {
      this.dispatcher.register({
        [eventName]: async (data) => {
          console.log(`[feishu] Card event '${eventName}' received:`, JSON.stringify(data, null, 2));
          if (!this.callbackRouter) return;

          const { open_id, action } = data;
          if (!action) return;

          await this.callbackRouter.dispatch({
            openId: open_id ?? "",
            messageId: action.message_id ?? "",
            actionValue: action.value ?? {},
            actionTag: action.tag ?? "",
          });
        },
      });
    }
  }
}
