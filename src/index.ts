import { loadConfig } from "./config.js";
import { FeishuGateway } from "./gateway/feishu.js";
import { CallbackRouter } from "./gateway/callback.js";
import { SessionManager } from "./session/manager.js";
import { CommandRouter } from "./commands/router.js";
import { WorkspaceStore } from "./workspace/store.js";
import { execFileSync } from "node:child_process";

/**
 * Expand PATH using the user's login shell so that tools like `claude`
 * installed via npm/homebrew/etc. are discoverable even when started
 * from launchd (which provides a minimal PATH).
 */
function expandPathFromLoginShell(): void {
  try {
    const shell = process.env.SHELL ?? "/bin/zsh";
    const loginPath = execFileSync(shell, ["-lc", "echo $PATH"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (loginPath) {
      process.env.PATH = loginPath;
    }
  } catch {
    // Non-fatal: fall back to existing PATH
  }
}

async function main() {
  expandPathFromLoginShell();

  const configPath = process.argv[2];
  const config = loadConfig(configPath);

  const callbackRouter = new CallbackRouter();
  const gateway = new FeishuGateway(config.feishu, callbackRouter);
  const sessionManager = new SessionManager(config, gateway, callbackRouter);
  const workspaceStore = new WorkspaceStore();
  const commandRouter = new CommandRouter(
    sessionManager,
    gateway,
    config,
    sessionManager.getSessionStore(),
    configPath,
    workspaceStore,
  );

  gateway.onMessage(async (msg) => {
    // Check if it's a slash command or session picker response
    const handled = await commandRouter.route(msg);
    if (handled) return;

    // Check if it's a question response
    if (sessionManager.handleQuestionResponse(msg.chatId, msg.text)) {
      return;
    }

    // Forward to active session
    const session = sessionManager.getSession(msg.chatId);
    if (!session) {
      const aliases = workspaceStore.list();
      const aliasHint = aliases.length > 0
        ? `\n\nWorkspace aliases:\n${aliases.map(a => `\`/run ${a.alias}\` → \`${a.path}\``).join("\n")}`
        : "\n\nTip: Use `/ws add <alias> <path>` to save workspace aliases.";
      await gateway.sendText(
        msg.chatId,
        `No active session. Use \`/start <path>\` to start Claude Code.\n\nExample:\n\`/start /Users/dy/my-project\`\n\`/start /Users/dy/my-project --resume\`\n\`/start /Users/dy/my-project --dangerously-skip-permissions\`${aliasHint}`,
      );
      return;
    }

    session.enqueue(msg.text, msg.chatId, msg.messageId);
  });

  // Graceful shutdown
  const shutdown = () => {
    sessionManager.destroyAll();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await gateway.start();
  console.log("[ccfc] Service started, waiting for messages...");
}

export { main };

// Only run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[ccfc] Fatal:", err);
    process.exit(1);
  });
}
