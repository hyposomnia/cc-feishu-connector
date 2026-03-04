/**
 * Question handler: handles AskUserQuestion tool calls from Claude Code.
 * Shows questions in Feishu and collects user responses.
 */
import type { FeishuGateway } from "../gateway/feishu.js";
import type { ClaudeAgent } from "../agent/claude.js";
import { createCard, md } from "../renderer/card-builder.js";

interface QuestionData {
  questions: Array<{
    question: string;
    header: string;
    options: Array<{
      label: string;
      description: string;
    }>;
    multiSelect: boolean;
  }>;
  metadata?: {
    source?: string;
  };
}

export class QuestionHandler {
  private gateway: FeishuGateway;
  private pendingQuestions = new Map<string, {
    agent: ClaudeAgent;
    questions: QuestionData;
    toolUseId?: string;
    resolve: () => void;
  }>();

  constructor(gateway: FeishuGateway) {
    this.gateway = gateway;
  }

  /**
   * Handle a question (from tool call or event).
   * Shows questions in Feishu and waits for user response.
   */
  async askQuestion(
    questionData: QuestionData,
    agent: ClaudeAgent,
    chatId: string,
    toolUseId?: string,
  ): Promise<void> {
    return new Promise<void>((resolve) => {
      // Format questions
      const questionTexts = questionData.questions.map((q, i) => {
        const optionsText = q.options.map((opt, j) =>
          `${j + 1}. **${opt.label}**\n   ${opt.description}`
        ).join("\n\n");

        const multiSelectHint = q.multiSelect
          ? "\n   *(可多选，用逗号分隔，如: 1,3)*"
          : "";

        return `**问题 ${i + 1}: ${q.question}**${multiSelectHint}\n\n${optionsText}`;
      }).join("\n\n---\n\n");

      const message = [
        questionTexts,
        "",
        `请回复选项序号（1-${questionData.questions[0].options.length}）。`,
      ].join("\n");

      const card = createCard(
        { title: "❓ 需要您的选择", template: "orange" },
        [md(message)]
      );

      const requestId = `question:${chatId}:${Date.now()}`;
      this.gateway.sendCard(chatId, card).then(() => {
        this.pendingQuestions.set(requestId, {
          agent,
          questions: questionData,
          toolUseId,
          resolve,
        });
      });
    });
  }

  /**
   * Handle a potential question response.
   * Returns true if this was a question response.
   */
  handleResponse(chatId: string, text: string): boolean {
    // Find pending question for this chat
    let requestId: string | undefined;
    for (const [id, _] of this.pendingQuestions) {
      if (id.includes(chatId)) {
        requestId = id;
        break;
      }
    }

    if (!requestId) return false;

    const pending = this.pendingQuestions.get(requestId);
    if (!pending) return false;

    // Parse user response
    const choices = text.trim().split(/[,，]/).map(s => parseInt(s.trim(), 10));
    if (choices.some(isNaN)) {
      this.gateway.sendText(chatId, "无效的选择。请输入数字，多个选项用逗号分隔。");
      return true;
    }

    // Build answers object
    const answers: Record<string, string> = {};
    pending.questions.questions.forEach((q, i) => {
      const selectedOptions = choices
        .filter(c => c >= 1 && c <= q.options.length)
        .map(c => q.options[c - 1].label);

      if (selectedOptions.length > 0) {
        answers[q.header] = selectedOptions.join(",");
      }
    });

    // Send response to Claude Code
    if (pending.toolUseId) {
      // This was a tool call, send tool_result
      pending.agent.sendToolResult(pending.toolUseId, JSON.stringify({ answers }), false);
    } else {
      // This was a question event, send question_response
      pending.agent.sendQuestionResponse(answers);
    }

    this.pendingQuestions.delete(requestId);
    pending.resolve();
    return true;
  }
}
