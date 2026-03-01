/**
 * Permission request handler.
 * Intercepts permission_request events from Claude Code,
 * renders approval cards in Feishu, and sends responses back.
 */
import type { PermissionRequestEvent } from "../agent/types.js";
import type { FeishuGateway } from "../gateway/feishu.js";
import type { CallbackRouter, CardAction } from "../gateway/callback.js";
import type { ClaudeAgent } from "../agent/claude.js";
import { createCard, md, hr, actions, button, type Card, type CardElement } from "../renderer/card-builder.js";

export class PermissionHandler {
  private gateway: FeishuGateway;
  private callbackRouter: CallbackRouter;

  constructor(gateway: FeishuGateway, callbackRouter: CallbackRouter) {
    this.gateway = gateway;
    this.callbackRouter = callbackRouter;

    // Register callback handlers for permission buttons
    this.callbackRouter.on("permission_allow", (action) => this.handleResponse(action));
    this.callbackRouter.on("permission_deny", (action) => this.handleResponse(action));
    this.callbackRouter.on("permission_allow_all", (action) => this.handleResponse(action));
  }

  /** Map of pending permission requests: requestId → resolver. */
  private pending = new Map<string, {
    agent: ClaudeAgent;
    messageId?: string;
    resolve: () => void;
  }>();

  /**
   * Handle a permission_request event.
   * Sends an approval card to Feishu and waits for user response.
   */
  async requestPermission(
    event: PermissionRequestEvent,
    agent: ClaudeAgent,
    chatId: string,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const card = this.buildPermissionCard(event);

      this.gateway.sendCard(chatId, card).then((messageId) => {
        this.pending.set(event.permission_request_id, {
          agent,
          messageId,
          resolve,
        });
      });
    });
  }

  private async handleResponse(action: CardAction): Promise<void> {
    const requestId = action.actionValue.request_id as string;
    const response = action.actionValue.permission_allow
      ? "allow"
      : action.actionValue.permission_deny
        ? "deny"
        : action.actionValue.permission_allow_all
          ? "allow_all"
          : null;

    if (!requestId || !response) return;

    const pending = this.pending.get(requestId);
    if (!pending) return;

    // Send the permission response to Claude Code
    pending.agent.sendPermissionResponse(response as "allow" | "deny" | "allow_all");

    // Update the card to show the decision
    if (pending.messageId) {
      const resultCard = this.buildResolvedCard(response);
      try {
        await this.gateway.updateCard(pending.messageId, resultCard);
      } catch {
        // Ignore update failures
      }
    }

    this.pending.delete(requestId);
    pending.resolve();
  }

  private buildPermissionCard(event: PermissionRequestEvent): Card {
    const elements: CardElement[] = [
      md(`**Tool:** \`${event.tool_name}\``),
      md(`**Action:** ${event.message}`),
    ];

    // Show input details for common tools
    if (event.tool_name === "Bash" && event.input.command) {
      elements.push(md(`\`\`\`bash\n${String(event.input.command)}\n\`\`\``));
    } else if (event.input.file_path) {
      elements.push(md(`**File:** \`${event.input.file_path}\``));
    }

    elements.push(hr());
    elements.push(
      actions(
        [
          button("✅ Allow", {
            permission_allow: true,
            request_id: event.permission_request_id,
          }, "primary"),
          button("❌ Deny", {
            permission_deny: true,
            request_id: event.permission_request_id,
          }, "danger"),
          button("✅ Allow All", {
            permission_allow_all: true,
            request_id: event.permission_request_id,
          }, "default"),
        ],
        "flow",
      ),
    );

    return createCard(
      { title: "🔐 Permission Required", template: "orange" },
      elements,
    );
  }

  private buildResolvedCard(response: string): Card {
    const label = {
      allow: "✅ Allowed",
      deny: "❌ Denied",
      allow_all: "✅ Allowed All",
    }[response] ?? response;

    const template = response === "deny" ? "red" : "green";

    return createCard(
      { title: `🔐 ${label}`, template },
      [md(`Permission response: **${label}**`)],
    );
  }
}
