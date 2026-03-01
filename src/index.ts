import { loadConfig } from "./config.js";
import { FeishuGateway } from "./gateway/feishu.js";
import { CallbackRouter } from "./gateway/callback.js";
import { SessionManager } from "./session/manager.js";
import { CommandRouter } from "./commands/router.js";

async function main() {
  const configPath = process.argv[2];
  const config = loadConfig(configPath);

  const gateway = new FeishuGateway(config.feishu);
  const callbackRouter = new CallbackRouter();
  const sessionManager = new SessionManager(config, gateway, callbackRouter);
  const commandRouter = new CommandRouter(
    sessionManager,
    gateway,
    config,
    sessionManager.getSessionStore(),
    configPath,
  );

  gateway.onMessage(async (msg) => {
    // Check if it's a slash command or session picker response
    const handled = await commandRouter.route(msg);
    if (handled) return;

    // Forward to active session
    const session = sessionManager.getSession(msg.chatId);
    if (!session) {
      await gateway.sendText(
        msg.chatId,
        "No active session. Use `/start <path>` to start Claude Code.\n\nExample:\n`/start /Users/dy/my-project`\n`/start /Users/dy/my-project --resume`\n`/start /Users/dy/my-project --dangerously-skip-permissions`",
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
  console.log("[cc-feishu] Service started, waiting for messages...");
}

export { main };

// Only run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error("[cc-feishu] Fatal:", err);
    process.exit(1);
  });
}
