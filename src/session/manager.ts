/**
 * Session manager: terminal-launcher model.
 * Users explicitly /start and /stop Claude Code sessions.
 * Each session = one Claude Code subprocess in a given working directory.
 */
import { ClaudeAgent } from "../agent/claude.js";
import type { ClaudeEvent, PermissionRequestEvent, QuestionEvent, ResultEvent } from "../agent/types.js";
import type { FeishuGateway } from "../gateway/feishu.js";
import type { CallbackRouter } from "../gateway/callback.js";
import type { AppConfig } from "../config.js";
import { StreamingCard } from "../renderer/streaming.js";
import { PermissionHandler } from "../permission/handler.js";
import { QuestionHandler } from "../question/handler.js";
import { MessageQueue } from "./queue.js";
import { SessionStore } from "./store.js";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export interface StartOptions {
  /** Working directory for claude. */
  cwd: string;
  /** Extra CLI flags passed through to claude. */
  extraArgs: string[];
}

export class Session {
  readonly id: string;
  readonly userId: string;
  readonly startOpts: StartOptions;

  private agent: ClaudeAgent;
  private queue: MessageQueue;
  private gateway: FeishuGateway;
  private callbackRouter: CallbackRouter;
  private permissionHandler: PermissionHandler;
  private questionHandler: QuestionHandler;
  private currentCard?: StreamingCard;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private _chatId: string;
  private sessionStore: SessionStore;
  private userInterrupted = false; // Track if user manually interrupted

  constructor(
    id: string,
    userId: string,
    chatId: string,
    startOpts: StartOptions,
    gateway: FeishuGateway,
    callbackRouter: CallbackRouter,
    permissionHandler: PermissionHandler,
    questionHandler: QuestionHandler,
    sessionStore: SessionStore,
  ) {
    this.id = id;
    this.userId = userId;
    this._chatId = chatId;
    this.startOpts = startOpts;
    this.gateway = gateway;
    this.callbackRouter = callbackRouter;
    this.permissionHandler = permissionHandler;
    this.questionHandler = questionHandler;
    this.sessionStore = sessionStore;

    this.agent = new ClaudeAgent({
      cwd: startOpts.cwd,
      extraArgs: startOpts.extraArgs,
    });

    this.queue = new MessageQueue();
    this.queue.onProcess(async (item) => {
      await this.processMessage(item.text, item.chatId, item.messageId);
    });

    this.setupAgent();
  }

  /** Enqueue a user message. */
  enqueue(text: string, chatId: string, messageId: string): void {
    this._chatId = chatId;
    this.resetIdleTimer();
    this.queue.enqueue(text, chatId, messageId);
  }

  /** Interrupt the current execution. */
  async interrupt(): Promise<void> {
    if (this.agent.alive && this.agent.busy) {
      this.userInterrupted = true;

      // Mark current card as interrupted
      if (this.currentCard) {
        const renderer = this.currentCard.getRenderer();
        renderer.processEvent({ type: "error", error: "Interrupted by user" });
        // Force immediate update to show interrupted state
        await this.currentCard.processEvent({ type: "error", error: "Interrupted by user" }).catch(() => {});
      }

      // Send SIGINT to Claude Code process (this will cause it to exit)
      this.agent.interrupt();

      // Wait a bit for process to exit
      await new Promise(resolve => setTimeout(resolve, 500));

      // Restart the process so session remains active
      if (!this.agent.alive) {
        this.agent.start();
      }
    }
  }

  /** Start the underlying Claude Code process. */
  start(): void {
    this.agent.start();
    this.resetIdleTimer();

    // Show last card if resuming
    this.showLastCardIfExists();
  }

  /** Show the last card if it exists in the store. */
  private async showLastCardIfExists(): Promise<void> {
    const lastCard = this.sessionStore.getLastCard(this.startOpts.cwd);
    if (lastCard && lastCard.chatId === this._chatId) {
      // Check if the card is recent (within last 24 hours)
      const age = Date.now() - lastCard.timestamp;
      if (age < 24 * 60 * 60 * 1000) {
        try {
          await this.gateway.sendText(
            this._chatId,
            `📋 Session resumed. Last interaction was ${Math.floor(age / 60000)} minutes ago.`
          );
        } catch (err) {
          console.error("[session] Failed to show resume message:", err);
        }
      }
    }
  }

  /** Stop and clean up. */
  stop(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.agent.stop();
  }

  get alive(): boolean {
    return this.agent.alive;
  }

  /** Human-readable description of this session. */
  describe(): string {
    const flags = this.startOpts.extraArgs.length
      ? ` ${this.startOpts.extraArgs.join(" ")}`
      : "";
    return `cwd: \`${this.startOpts.cwd}\`${flags}`;
  }

  private async processMessage(text: string, chatId: string, messageId?: string): Promise<void> {
    if (!this.agent.alive) {
      this.agent.start();
    }

    // 立即添加处理中表情
    let reactionId: string | undefined;
    if (messageId) {
      reactionId = await this.gateway.addReaction(messageId, "OneSecond");
    }

    // Create a new streaming card for this turn
    this.currentCard = new StreamingCard(this.gateway, chatId);

    // Send message to Claude Code
    this.agent.sendMessage(text);

    // Wait for the turn to complete
    await new Promise<void>((resolve) => {
      const onIdle = () => {
        cleanup();
        resolve();
      };
      const onExit = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        this.agent.removeListener("idle", onIdle);
        this.agent.removeListener("exit", onExit);
      };
      this.agent.on("idle", onIdle);
      this.agent.on("exit", onExit);
    });

    // Save the last card state
    const cardMessageId = this.currentCard.getMessageId();
    if (cardMessageId) {
      this.sessionStore.saveLastCard(this.startOpts.cwd, cardMessageId, chatId);
    }

    // 处理完毕后移除表情
    if (messageId && reactionId) {
      await this.gateway.removeReaction(messageId, reactionId);
    }

    this.currentCard = undefined;
  }

  private setupAgent(): void {
    // Collect stderr for better error reporting
    let stderrBuffer = "";

    this.agent.on("event", async (event: ClaudeEvent) => {
      console.log("[session] Received event:", event.type, event.type === "tool_use" ? `(${(event as any).name})` : "");

      // Capture session ID from result events
      if (event.type === "result") {
        const resultEvent = event as ResultEvent;
        if (resultEvent.session_id) {
          this.sessionStore.saveSessionId(this.startOpts.cwd, resultEvent.session_id);
        }
      }

      if (event.type === "permission_request") {
        await this.permissionHandler.requestPermission(
          event as PermissionRequestEvent,
          this.agent,
          this._chatId,
        );
        return;
      }

      // Generic interception: any tool with "questions" field in input
      if (event.type === "tool_use") {
        console.log("[session] tool_use detected:", event.name);
        console.log("[session] tool input keys:", Object.keys(event.input || {}));

        if (event.input && "questions" in event.input) {
          console.log("[session] Intercepting interactive tool:", event.name);
          await this.questionHandler.askQuestion(
            event.input as any,
            this.agent,
            this._chatId,
            event.tool_use_id,
          );
          return;
        }
      }

      if (this.currentCard) {
        await this.currentCard.processEvent(event);
      }
    });

    this.agent.on("exit", (code: number | null, signal: string | null) => {
      // Don't show error message if user manually interrupted
      if (this.userInterrupted) {
        this.userInterrupted = false;
        return;
      }

      // Show stderr if process failed
      let message = `Claude Code process exited (code=${code}).`;
      if (code !== 0 && stderrBuffer.trim()) {
        message += `\n\nError output:\n${stderrBuffer.trim()}`;
      }

      this.gateway.sendText(this._chatId, message).catch(() => {});
      stderrBuffer = "";
    });

    this.agent.on("proc_error", (err: Error) => {
      console.error(`[session:${this.id}] Process error:`, err);
    });

    this.agent.on("stderr", (chunk: string) => {
      if (chunk.trim()) {
        stderrBuffer += chunk;
      }
    });
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.gateway.sendText(this._chatId, "Session idle for 30 min, stopped. Use /start to restart.").catch(() => {});
      this.stop();
    }, IDLE_TIMEOUT_MS);
  }
}

export class SessionManager {
  /** One session per chat (chatId → Session). */
  private sessions = new Map<string, Session>();
  private gateway: FeishuGateway;
  private callbackRouter: CallbackRouter;
  private permissionHandler: PermissionHandler;
  private questionHandler: QuestionHandler;
  private sessionStore: SessionStore;

  constructor(_config: AppConfig, gateway: FeishuGateway, callbackRouter: CallbackRouter) {
    this.gateway = gateway;
    this.callbackRouter = callbackRouter;
    this.permissionHandler = new PermissionHandler(gateway, callbackRouter);
    this.questionHandler = new QuestionHandler(gateway);
    this.sessionStore = new SessionStore();
  }

  /** Get the session store (for CommandRouter). */
  getSessionStore(): SessionStore {
    return this.sessionStore;
  }

  /** Handle a potential question response. Returns true if handled. */
  handleQuestionResponse(chatId: string, text: string): boolean {
    return this.questionHandler.handleResponse(chatId, text);
  }

  /** Start a new session in the given chat. Stops any existing one first. */
  startSession(userId: string, chatId: string, opts: StartOptions): Session {
    // Stop existing session in this chat
    this.stopSession(chatId);

    const sessionId = `${chatId}:${Date.now()}`;
    const session = new Session(
      sessionId,
      userId,
      chatId,
      opts,
      this.gateway,
      this.callbackRouter,
      this.permissionHandler,
      this.questionHandler,
      this.sessionStore,
    );
    session.start();
    this.sessions.set(chatId, session);
    return session;
  }

  /** Get the active session for a chat, if any. */
  getSession(chatId: string): Session | undefined {
    const session = this.sessions.get(chatId);
    if (session && !session.alive) {
      this.sessions.delete(chatId);
      return undefined;
    }
    return session;
  }

  /** Stop the session in a chat. */
  stopSession(chatId: string): boolean {
    const session = this.sessions.get(chatId);
    if (session) {
      session.stop();
      this.sessions.delete(chatId);
      return true;
    }
    return false;
  }

  /** List all active sessions. */
  list(): Session[] {
    return Array.from(this.sessions.values());
  }

  /** Stop all sessions. */
  destroyAll(): void {
    for (const session of this.sessions.values()) {
      session.stop();
    }
    this.sessions.clear();
  }
}
