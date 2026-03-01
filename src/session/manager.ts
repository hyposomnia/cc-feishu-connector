/**
 * Session manager: terminal-launcher model.
 * Users explicitly /start and /stop Claude Code sessions.
 * Each session = one Claude Code subprocess in a given working directory.
 */
import { ClaudeAgent } from "../agent/claude.js";
import type { ClaudeEvent, PermissionRequestEvent, ResultEvent } from "../agent/types.js";
import type { FeishuGateway } from "../gateway/feishu.js";
import type { CallbackRouter } from "../gateway/callback.js";
import type { AppConfig } from "../config.js";
import { StreamingCard } from "../renderer/streaming.js";
import { PermissionHandler } from "../permission/handler.js";
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
  private permissionHandler: PermissionHandler;
  private currentCard?: StreamingCard;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private _chatId: string;
  private sessionStore: SessionStore;

  constructor(
    id: string,
    userId: string,
    chatId: string,
    startOpts: StartOptions,
    gateway: FeishuGateway,
    permissionHandler: PermissionHandler,
    sessionStore: SessionStore,
  ) {
    this.id = id;
    this.userId = userId;
    this._chatId = chatId;
    this.startOpts = startOpts;
    this.gateway = gateway;
    this.permissionHandler = permissionHandler;
    this.sessionStore = sessionStore;

    this.agent = new ClaudeAgent({
      cwd: startOpts.cwd,
      extraArgs: startOpts.extraArgs,
    });

    this.queue = new MessageQueue();
    this.queue.onProcess(async (item) => {
      await this.processMessage(item.text, item.chatId);
    });

    this.setupAgent();
  }

  /** Enqueue a user message. */
  enqueue(text: string, chatId: string, messageId: string): void {
    this._chatId = chatId;
    this.resetIdleTimer();
    this.queue.enqueue(text, chatId, messageId);
  }

  /** Start the underlying Claude Code process. */
  start(): void {
    this.agent.start();
    this.resetIdleTimer();
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

  private async processMessage(text: string, chatId: string): Promise<void> {
    if (!this.agent.alive) {
      this.agent.start();
    }

    // Create a new streaming card for this turn
    this.currentCard = new StreamingCard(this.gateway, chatId);

    // Send message to Claude Code
    this.agent.sendMessage(text);

    // Wait for the turn to complete
    await new Promise<void>((resolve) => {
      const onIdle = () => {
        this.agent.removeListener("idle", onIdle);
        resolve();
      };
      this.agent.on("idle", onIdle);
    });

    this.currentCard = undefined;
  }

  private setupAgent(): void {
    // Collect stderr for better error reporting
    let stderrBuffer = "";

    this.agent.on("event", async (event: ClaudeEvent) => {
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

      if (this.currentCard) {
        await this.currentCard.processEvent(event);
      }
    });

    this.agent.on("exit", (code: number | null, signal: string | null) => {
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
  private permissionHandler: PermissionHandler;
  private sessionStore: SessionStore;

  constructor(_config: AppConfig, gateway: FeishuGateway, callbackRouter: CallbackRouter) {
    this.gateway = gateway;
    this.permissionHandler = new PermissionHandler(gateway, callbackRouter);
    this.sessionStore = new SessionStore();
  }

  /** Get the session store (for CommandRouter). */
  getSessionStore(): SessionStore {
    return this.sessionStore;
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
      this.permissionHandler,
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
