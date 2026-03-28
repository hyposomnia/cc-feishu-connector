/**
 * Slash command router.
 * Built-in commands: /start, /stop, /status
 * Claude Code commands: forwarded to active session.
 */
import { existsSync } from "node:fs";
import type { IncomingMessage } from "../gateway/feishu.js";
import type { FeishuGateway } from "../gateway/feishu.js";
import type { SessionManager } from "../session/manager.js";
import { ConfigCommand } from "./config.js";
import type { AppConfig } from "../config.js";
import { SessionPicker } from "./session-picker.js";
import type { SessionStore } from "../session/store.js";
import type { CallbackRouter } from "../gateway/callback.js";
import type { WorkspaceStore } from "../workspace/store.js";

export class CommandRouter {
  private sessionManager: SessionManager;
  private gateway: FeishuGateway;
  private configCommand: ConfigCommand;
  private sessionPicker: SessionPicker;
  private workspaceStore?: WorkspaceStore;

  constructor(
    sessionManager: SessionManager,
    gateway: FeishuGateway,
    config: AppConfig,
    sessionStore: SessionStore,
    configPath?: string,
    workspaceStore?: WorkspaceStore,
  ) {
    this.sessionManager = sessionManager;
    this.gateway = gateway;
    this.configCommand = new ConfigCommand(gateway, config, configPath);
    this.sessionPicker = new SessionPicker(gateway, sessionStore);
    this.workspaceStore = workspaceStore;
  }

  /**
   * Route a slash command message.
   * Returns true if handled, false to pass through to session.
   */
  async route(msg: IncomingMessage): Promise<boolean> {
    const text = msg.text.trim();

    // Check if this is a session picker response
    if (this.sessionPicker.handleResponse(msg.chatId, text)) {
      return true;
    }

    if (!text.startsWith("/")) return false;

    // Parse command and args
    const tokens = parseCommandLine(text);
    const cmd = tokens[0].slice(1).toLowerCase(); // remove leading /
    const args = tokens.slice(1);

    switch (cmd) {
      case "start":
        return this.handleStart(msg, args);
      case "stop":
        return this.handleStop(msg);
      case "esc":
      case "interrupt":
        return this.handleInterrupt(msg);
      case "status":
        return this.handleStatus(msg);
      case "config":
        return this.handleConfig(msg, args);
      case "run":
        return this.handleStart(msg, args);
      case "workspace":
      case "ws":
        return this.handleWorkspace(msg, args);
      case "help":
        return this.handleHelp(msg);
      default:
        // Forward to active session if one exists
        return this.forwardToSession(msg, text);
    }
  }

  private async handleStart(msg: IncomingMessage, args: string[]): Promise<boolean> {
    if (args.length === 0) {
      await this.gateway.sendText(
        msg.chatId,
        "Usage: `/start <path> [flags...]`\n\nExamples:\n`/start /Users/dy/my-project`\n`/start /Users/dy/my-project --resume`\n`/start /Users/dy/my-project --model opus`\n`/start /Users/dy/my-project --dangerously-skip-permissions`\n`/start /Users/dy/my-project --continue`",
      );
      return true;
    }

    // First non-flag arg is the path
    const cwd = this.workspaceStore ? this.workspaceStore.resolve(args[0]) : args[0];
    let extraArgs = args.slice(1);

    // Validate path exists
    if (!existsSync(cwd)) {
      await this.gateway.sendText(msg.chatId, `Path not found: \`${cwd}\``);
      return true;
    }

    // If --resume flag is present, show session picker
    const resumeIndex = extraArgs.indexOf("--resume");
    if (resumeIndex !== -1) {
      const sessionId = await this.sessionPicker.pickSession(msg.chatId, cwd);
      if (!sessionId) {
        return true; // User cancelled or no sessions found
      }
      // Replace --resume with --resume <session-id>
      extraArgs.splice(resumeIndex, 1, "--resume", sessionId);
    }

    try {
      const session = this.sessionManager.startSession(msg.senderId, msg.chatId, {
        cwd,
        extraArgs,
      });
      const flagsDesc = extraArgs.length ? `\nFlags: \`${extraArgs.join(" ")}\`` : "";
      await this.gateway.sendText(
        msg.chatId,
        `Claude Code started.\nWorking directory: \`${cwd}\`${flagsDesc}\n\nSend messages to interact. Use /stop to end.`,
      );
      return true;
    } catch (err) {
      await this.gateway.sendText(
        msg.chatId,
        `Failed to start: ${err instanceof Error ? err.message : String(err)}`,
      );
      return true;
    }
  }

  private async handleStop(msg: IncomingMessage): Promise<boolean> {
    const stopped = this.sessionManager.stopSession(msg.chatId);
    if (stopped) {
      await this.gateway.sendText(msg.chatId, "Claude Code session stopped.");
    } else {
      await this.gateway.sendText(msg.chatId, "No active session.");
    }
    return true;
  }

  private async handleInterrupt(msg: IncomingMessage): Promise<boolean> {
    const session = this.sessionManager.getSession(msg.chatId);
    if (session) {
      await session.interrupt();
      await this.gateway.sendText(msg.chatId, "⏹ Execution interrupted. Session is still active.");
    } else {
      await this.gateway.sendText(msg.chatId, "No active session.");
    }
    return true;
  }

  private async handleStatus(msg: IncomingMessage): Promise<boolean> {
    const session = this.sessionManager.getSession(msg.chatId);
    if (session) {
      await this.gateway.sendText(
        msg.chatId,
        `Active session: ${session.describe()}\nAlive: ${session.alive}`,
      );
    } else {
      await this.gateway.sendText(msg.chatId, "No active session.");
    }
    return true;
  }

  private async handleConfig(msg: IncomingMessage, args: string[]): Promise<boolean> {
    if (args.length === 0) {
      // Show current config
      await this.configCommand.show(msg.chatId);
      return true;
    }

    const subCmd = args[0].toLowerCase();
    if (subCmd === "set" && args.length >= 3) {
      const key = args[1];
      const value = args.slice(2).join(" ");
      await this.configCommand.update(key, value, msg.chatId);
      return true;
    }

    await this.gateway.sendText(
      msg.chatId,
      "Usage:\n`/config` — Show current config\n`/config set <key> <value>` — Update a config value",
    );
    return true;
  }

  private async handleWorkspace(msg: IncomingMessage, args: string[]): Promise<boolean> {
    if (!this.workspaceStore) {
      await this.gateway.sendText(msg.chatId, "Workspace store not initialized.");
      return true;
    }

    const subCmd = args[0]?.toLowerCase();

    if (subCmd === "add" && args.length >= 3) {
      const alias = args[1];
      const path = args[2];
      if (!existsSync(path)) {
        await this.gateway.sendText(msg.chatId, `Path not found: \`${path}\``);
        return true;
      }
      this.workspaceStore.add(alias, path);
      await this.gateway.sendText(msg.chatId, `Workspace alias added: \`${alias}\` → \`${path}\``);
      return true;
    }

    if (subCmd === "delete" && args.length >= 2) {
      const alias = args[1];
      const deleted = this.workspaceStore.delete(alias);
      await this.gateway.sendText(
        msg.chatId,
        deleted ? `Workspace alias deleted: \`${alias}\`` : `Alias not found: \`${alias}\``,
      );
      return true;
    }

    if (subCmd === "list") {
      const list = this.workspaceStore.list();
      if (list.length === 0) {
        await this.gateway.sendText(msg.chatId, "No workspace aliases configured.");
      } else {
        const lines = list.map(({ alias, path }) => `\`${alias}\` → \`${path}\``);
        await this.gateway.sendText(msg.chatId, `**Workspace aliases:**\n${lines.join("\n")}`);
      }
      return true;
    }

    await this.gateway.sendText(
      msg.chatId,
      "Usage:\n`/workspace add <alias> <path>` — Add alias\n`/workspace delete <alias>` — Remove alias\n`/workspace list` — List all aliases\n\nShortcut: `/ws` works the same as `/workspace`",
    );
    return true;
  }

  private async handleHelp(msg: IncomingMessage): Promise<boolean> {
    await this.gateway.sendText(
      msg.chatId,
      [
        "**cc-feishu Commands**",
        "",
        "`/start <path> [flags...]` — Start Claude Code in a directory",
        "`/stop` — Stop current session",
        "`/esc` or `/interrupt` — Interrupt current execution (like Ctrl+C)",
        "`/status` — Show session info",
        "`/config` — View/edit configuration",
        "`/run <alias>` — Start Claude Code using workspace alias",
        "`/workspace add <alias> <path>` — Add workspace alias",
        "`/workspace list` — List workspace aliases",
        "`/ws` — Shortcut for /workspace",
        "`/help` — Show this message",
        "",
        "**Supported flags** (passed to `claude` CLI):",
        "`--resume` / `-r` — Resume last conversation",
        "`--continue` / `-c` — Continue most recent conversation",
        "`--model <name>` — Use a specific model",
        "`--dangerously-skip-permissions` — Skip all permission prompts",
        "`--allowedTools <tools>` — Restrict available tools",
        "",
        "Any other `/command` is forwarded to the active Claude Code session.",
      ].join("\n"),
    );
    return true;
  }

  /** Forward a slash command to the active session. */
  private async forwardToSession(msg: IncomingMessage, text: string): Promise<boolean> {
    const session = this.sessionManager.getSession(msg.chatId);
    if (!session) {
      // Don't handle — let index.ts show the "no active session" message
      return false;
    }
    session.enqueue(text, msg.chatId, msg.messageId);
    return true;
  }
}

/**
 * Simple command line tokenizer: splits on spaces but respects quotes.
 */
function parseCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (const ch of input) {
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === " ") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}
