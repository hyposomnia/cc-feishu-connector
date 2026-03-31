/**
 * Permission request handler.
 * Intercepts permission_request events from Claude Code,
 * renders approval cards in Feishu, and sends responses back.
 */
import type { PermissionRequestEvent, ControlRequestEvent } from "../agent/types.js";
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
    isControl?: boolean; // true = control_request, false = permission_request
    originalInput?: Record<string, unknown>; // for control_request: original tool input
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
          isControl: false,
        });
      });
    });
  }

  /**
   * Handle a control_request event (newer permission mechanism).
   * Sends an approval card to Feishu and waits for user response.
   */
  async requestControl(
    event: ControlRequestEvent,
    agent: ClaudeAgent,
    chatId: string,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      const card = this.buildControlCard(event);
      this.gateway.sendCard(chatId, card).then((messageId) => {
        this.pending.set(event.request_id, {
          agent,
          messageId,
          resolve,
          isControl: true,
          originalInput: event.request.input,
        });
      });
    });
  }

  private async handleResponse(action: CardAction): Promise<object | undefined> {
    const requestId = action.actionValue.request_id as string;
    const response = action.actionValue.permission_allow === "true"
      ? "allow"
      : action.actionValue.permission_deny === "true"
        ? "deny"
        : action.actionValue.permission_allow_all === "true"
          ? "allow_all"
          : null;

    if (!requestId || !response) return undefined;

    const pending = this.pending.get(requestId);
    if (!pending) return undefined; // stale card click, ignore silently

    // Remove from pending immediately to debounce double-clicks
    this.pending.delete(requestId);

    // Resume Claude
    if (pending.isControl) {
      const behavior = response === "deny" ? "deny" : "allow";
      pending.agent.sendControlResponse(requestId, behavior, pending.originalInput);
    } else {
      pending.agent.sendPermissionResponse(response as "allow" | "deny" | "allow_all");
    }

    pending.resolve();

    // Return resolved card — caller wraps it in the proper callback response format
    return this.buildResolvedCard(response);
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
          button("✅ 允许", {
            permission_allow: "true",
            request_id: event.permission_request_id,
          }, "primary"),
          button("❌ 拒绝", {
            permission_deny: "true",
            request_id: event.permission_request_id,
          }, "danger"),
          button("✅ 全部允许", {
            permission_allow_all: "true",
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

  private buildControlCard(event: ControlRequestEvent): Card {
    const req = event.request;
    const elements: CardElement[] = [
      md(`**Tool:** \`${req.tool_name}\``),
    ];

    if (req.description) {
      elements.push(md(`**Action:** ${req.description}`));
    }

    // Show input details
    if (req.tool_name === "Bash" && req.input.command) {
      elements.push(md(`\`\`\`bash\n${String(req.input.command)}\n\`\`\``));
    } else if (req.input.file_path) {
      elements.push(md(`**File:** \`${req.input.file_path}\``));
    }

    if (req.decision_reason) {
      elements.push(md(`**Reason:** ${req.decision_reason}`));
    }

    elements.push(hr());
    elements.push(
      actions(
        [
          button("✅ 允许", {
            permission_allow: "true",
            request_id: event.request_id,
          }, "primary"),
          button("❌ 拒绝", {
            permission_deny: "true",
            request_id: event.request_id,
          }, "danger"),
          button("✅ 全部允许", {
            permission_allow_all: "true",
            request_id: event.request_id,
          }, "default"),
        ],
        "flow",
      ),
    );

    const title = req.title ?? `🔐 Permission Required`;
    return createCard(
      { title, template: "orange" },
      elements,
    );
  }

  private buildResolvedCard(response: string): Card {
    const template = response === "deny" ? "red" : "green";

    // Show all three options: clicked = bold+emoji, others = strikethrough (greyed)
    const options: Array<{ key: string; label: string }> = [
      { key: "allow", label: "允许" },
      { key: "deny", label: "拒绝" },
      { key: "allow_all", label: "全部允许" },
    ];
    const icons: Record<string, string> = { allow: "✅", deny: "❌", allow_all: "✅" };

    const line = options.map(({ key, label }) => {
      if (key === response) {
        return `**${icons[key]} ${label}**`;
      }
      return `~~${label}~~`;
    }).join("　｜　");

    return createCard(
      { title: "🔐 已响应", template },
      [md(line)],
    );
  }
}
