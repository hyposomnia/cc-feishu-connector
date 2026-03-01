/**
 * Interactive config command.
 * Allows users to view and modify config via Feishu cards.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import TOML from "@iarna/toml";
import type { FeishuGateway } from "../gateway/feishu.js";
import type { AppConfig } from "../config.js";

export class ConfigCommand {
  private gateway: FeishuGateway;
  private config: AppConfig;
  private configPath: string;

  constructor(gateway: FeishuGateway, config: AppConfig, configPath?: string) {
    this.gateway = gateway;
    this.config = config;
    this.configPath = configPath ?? resolve(process.cwd(), "config.toml");
  }

  /** Show current config as a card. */
  async show(chatId: string): Promise<void> {
    const card = this.buildConfigCard();
    await this.gateway.sendCard(chatId, card);
  }

  /** Update a config value. */
  async update(key: string, value: string, chatId: string): Promise<void> {
    const parts = key.split(".");

    if (parts[0] === "feishu") {
      if (parts[1] === "app_id") {
        this.config.feishu.app_id = value;
      } else if (parts[1] === "app_secret") {
        this.config.feishu.app_secret = value;
      } else {
        await this.gateway.sendText(chatId, `Unknown config key: ${key}`);
        return;
      }
    } else if (parts[0] === "defaults") {
      if (parts[1] === "model") {
        this.config.defaults.model = value;
      } else {
        await this.gateway.sendText(chatId, `Unknown config key: ${key}`);
        return;
      }
    } else {
      await this.gateway.sendText(chatId, `Unknown config key: ${key}`);
      return;
    }

    // Save to file
    this.saveConfig();
    await this.gateway.sendText(chatId, `✅ Updated ${key} = ${value}\\n\\nConfig saved to ${this.configPath}`);
  }

  private buildConfigCard(): object {
    const maskedSecret = this.config.feishu.app_secret
      ? this.config.feishu.app_secret.slice(0, 8) + "..." + this.config.feishu.app_secret.slice(-4)
      : "(not set)";

    return {
      config: {
        wide_screen_mode: true,
      },
      header: {
        title: {
          tag: "plain_text",
          content: "⚙️ Configuration",
        },
        template: "blue",
      },
      elements: [
        {
          tag: "markdown",
          content: `**Feishu App**\\n\\nApp ID: \`${this.config.feishu.app_id}\`\\nApp Secret: \`${maskedSecret}\``,
        },
        {
          tag: "hr",
        },
        {
          tag: "markdown",
          content: `**Defaults**\\n\\nModel: \`${this.config.defaults.model ?? "(not set)"}\``,
        },
        {
          tag: "hr",
        },
        {
          tag: "note",
          elements: [
            {
              tag: "plain_text",
              content: `Config file: ${this.configPath}`,
            },
          ],
        },
        {
          tag: "markdown",
          content: `\\n**To update:**\\n\`/config set <key> <value>\`\\n\\nExamples:\\n\`/config set feishu.app_id cli_xxx\`\\n\`/config set feishu.app_secret your_secret\`\\n\`/config set defaults.model claude-opus-4-6\``,
        },
      ],
    };
  }

  private saveConfig(): void {
    const tomlString = TOML.stringify(this.config as any);
    writeFileSync(this.configPath, tomlString, "utf-8");
  }
}
