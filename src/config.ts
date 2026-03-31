import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import TOML from "@iarna/toml";

export interface FeishuConfig {
  app_id: string;
  app_secret: string;
}

export interface DefaultsConfig {
  model?: string;
}

export interface ProxyConfig {
  url?: string;
}

export interface AppConfig {
  feishu: FeishuConfig;
  defaults: DefaultsConfig;
  proxy?: ProxyConfig;
}

export function loadConfig(configPath?: string): AppConfig {
  const filePath = configPath ?? resolve(process.cwd(), "config.toml");
  const raw = readFileSync(filePath, "utf-8");
  const parsed = TOML.parse(raw) as unknown as AppConfig;

  if (!parsed.feishu?.app_id || !parsed.feishu?.app_secret) {
    throw new Error("Missing feishu.app_id or feishu.app_secret in config");
  }

  parsed.defaults ??= {};

  return parsed;
}
