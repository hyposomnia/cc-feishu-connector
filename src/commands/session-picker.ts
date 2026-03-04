/**
 * Session picker: interactive UI for selecting a Claude Code session to resume.
 */
import type { FeishuGateway } from "../gateway/feishu.js";
import type { SessionStore } from "../session/store.js";
import { createCard, md } from "../renderer/card-builder.js";

export class SessionPicker {
  private gateway: FeishuGateway;
  private sessionStore: SessionStore;
  private pendingPicks = new Map<string, (sessionId: string | undefined) => void>();
  private pickerMessages = new Map<string, string>(); // chatId -> messageId

  constructor(gateway: FeishuGateway, sessionStore: SessionStore) {
    this.gateway = gateway;
    this.sessionStore = sessionStore;
  }

  /**
   * Show session picker and wait for user selection.
   * Returns the selected session ID, or undefined if cancelled.
   */
  async pickSession(chatId: string, cwd: string): Promise<string | undefined> {
    const sessions = this.sessionStore.listClaudeSessions(cwd);

    if (sessions.length === 0) {
      await this.gateway.sendText(chatId, "没有找到历史会话。");
      return undefined;
    }

    // Format session list with summaries
    const sessionList = sessions.slice(0, 10).map((s, i) => {
      const date = new Date(s.lastModified);
      const dateStr = date.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const summary = s.summary ? `\n   ${s.summary}` : "";
      return `${i + 1}. ${dateStr}${summary}`;
    }).join("\n\n");

    const message = [
      `找到 ${sessions.length} 个历史会话：`,
      "",
      sessionList,
      "",
      "请回复序号选择要恢复的会话（1-10），或回复 0 取消。",
    ].join("\n");

    // Send as card so we can delete it later
    const card = createCard(
      { title: "📋 选择会话", template: "blue" },
      [md(message)]
    );
    const messageId = await this.gateway.sendCard(chatId, card);
    if (messageId) {
      this.pickerMessages.set(chatId, messageId);
    }

    // Store the sessions for this chat
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingPicks.delete(chatId);

        // Delete the picker card on timeout
        const msgId = this.pickerMessages.get(chatId);
        if (msgId) {
          this.gateway.getClient().im.v1.message.delete({
            path: { message_id: msgId },
          }).catch(() => {});
          this.pickerMessages.delete(chatId);
        }

        // Clean up stored sessions
        delete (this as any)[`_sessions_${chatId}`];

        // Don't send timeout message to avoid triggering new events
        resolve(undefined);
      }, 60000); // 60 second timeout

      this.pendingPicks.set(chatId, (sessionId) => {
        clearTimeout(timeout);
        this.pendingPicks.delete(chatId);

        // Delete the picker card
        const msgId = this.pickerMessages.get(chatId);
        if (msgId) {
          this.gateway.getClient().im.v1.message.delete({
            path: { message_id: msgId },
          }).catch(() => {});
          this.pickerMessages.delete(chatId);
        }

        // Clean up stored sessions
        delete (this as any)[`_sessions_${chatId}`];

        resolve(sessionId);
      });

      // Store sessions for handleResponse
      (this as any)[`_sessions_${chatId}`] = sessions;
    });
  }

  /**
   * Handle a potential session selection response.
   * Returns true if this was a session picker response.
   */
  handleResponse(chatId: string, text: string): boolean {
    const resolver = this.pendingPicks.get(chatId);
    if (!resolver) return false;

    const choice = parseInt(text.trim(), 10);
    if (isNaN(choice)) {
      // Not a number, ignore but don't consume the message
      return false;
    }

    const sessions = (this as any)[`_sessions_${chatId}`];
    if (!sessions) {
      // Sessions data missing, cancel
      resolver(undefined);
      return true;
    }

    delete (this as any)[`_sessions_${chatId}`];

    if (choice === 0) {
      resolver(undefined);
      return true;
    }

    if (choice < 1 || choice > Math.min(10, sessions.length)) {
      this.gateway.sendText(chatId, `无效的选择。请输入 1-${Math.min(10, sessions.length)} 之间的数字，或输入 0 取消。`);
      // Don't resolve, let user try again
      (this as any)[`_sessions_${chatId}`] = sessions;
      return true;
    }

    const selected = sessions[choice - 1];
    resolver(selected.sessionId);
    return true;
  }
}
