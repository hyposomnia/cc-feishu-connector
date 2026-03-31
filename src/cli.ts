/**
 * cc-feishu CLI tool
 * Usage:
 *   ccfc config show
 *   ccfc config get <key>
 *   ccfc config set <key> <value>
 *   ccfc start [config-path]
 *   ccfc service install
 *   ccfc service uninstall
 *   ccfc service status
 *   ccfc service restart
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import TOML from "@iarna/toml";
import { runConfigWizard } from "./commands/wizard.js";
import { installService, uninstallService, getServiceStatus, restartService } from "./commands/service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_DIR = resolve(__dirname, "..");
const DEFAULT_CONFIG_PATH = resolve(homedir(), ".cc-feishu-connector", "config.toml");

interface Config {
  feishu?: {
    app_id?: string;
    app_secret?: string;
  };
  defaults?: {
    model?: string;
  };
}

function loadConfig(path: string): Config {
  if (!existsSync(path)) {
    return { feishu: {}, defaults: {} };
  }
  const raw = readFileSync(path, "utf-8");
  return TOML.parse(raw) as Config;
}

function saveConfig(path: string, config: Config): void {
  const tomlString = TOML.stringify(config as any);
  writeFileSync(path, tomlString, "utf-8");
}

function getValue(obj: any, path: string): any {
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function setValue(obj: any, path: string, value: string): void {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current)) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function showConfig(configPath: string): void {
  const config = loadConfig(configPath);
  console.log("Current configuration:");
  console.log("");
  console.log("Feishu:");
  console.log(`  app_id: ${config.feishu?.app_id ?? "(not set)"}`);
  const secret = config.feishu?.app_secret;
  const maskedSecret = secret
    ? secret.slice(0, 8) + "..." + secret.slice(-4)
    : "(not set)";
  console.log(`  app_secret: ${maskedSecret}`);
  console.log("");
  console.log("Defaults:");
  console.log(`  model: ${config.defaults?.model ?? "(not set)"}`);
  console.log("");
  console.log(`Config file: ${configPath}`);
}

function getConfigValue(configPath: string, key: string): void {
  const config = loadConfig(configPath);
  const value = getValue(config, key);
  if (value === undefined) {
    console.error(`Key not found: ${key}`);
    process.exit(1);
  }
  console.log(value);
}

function setConfigValue(configPath: string, key: string, value: string): void {
  const config = loadConfig(configPath);
  setValue(config, key, value);
  saveConfig(configPath, config);
  console.log(`✅ Set ${key} = ${value}`);
  console.log(`Config saved to ${configPath}`);
}

function showHelp(): void {
  console.log(`ccfc - Claude Code Feishu bridge service

Usage:
  ccfc setup [config-path]           交互式配置向导（推荐）
  ccfc start [config-path]           Start the service
  ccfc config show [config-path]     Show current configuration
  ccfc config get <key> [config-path] Get a config value
  ccfc config set <key> <value> [config-path] Set a config value
  ccfc service install [config-path] Install as system service (auto-start)
  ccfc service uninstall             Uninstall system service
  ccfc service status                Show service status
  ccfc service restart               Restart system service

Config keys:
  feishu.app_id         Feishu app ID
  feishu.app_secret     Feishu app secret
  defaults.model        Default Claude model

Examples:
  ccfc setup                         # 交互式配置（推荐新手使用）
  ccfc config show
  ccfc config set feishu.app_id cli_xxx
  ccfc config set feishu.app_secret your_secret
  ccfc config set defaults.model claude-opus-4-6
  ccfc config get feishu.app_id
  ccfc start
  ccfc start /path/to/config.toml
  ccfc service install               # 安装为系统服务
  ccfc service status                # 查看服务状态
`);
}

async function startService(configPath?: string): Promise<void> {
  const { main } = await import("./index.js");
  // Clear argv and set config path if provided
  process.argv.splice(2);
  if (configPath) {
    process.argv[2] = configPath;
  }
  await main();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === "help" || args[0] === "--help" || args[0] === "-h") {
    showHelp();
    return;
  }

  const command = args[0];

  if (command === "start") {
    const configPath = args[1];
    await startService(configPath);
    return;
  }

  if (command === "setup") {
    const configPath = args[1] ?? DEFAULT_CONFIG_PATH;
    await runConfigWizard(configPath);
    return;
  }

  if (command === "config") {
    const subCommand = args[1];
    if (!subCommand) {
      console.error("Missing config subcommand. Use: show, get, or set");
      process.exit(1);
    }

    if (subCommand === "show") {
      const configPath = args[2] ?? DEFAULT_CONFIG_PATH;
      showConfig(configPath);
      return;
    }

    if (subCommand === "get") {
      const key = args[2];
      if (!key) {
        console.error("Missing key. Usage: ccfc config get <key>");
        process.exit(1);
      }
      const configPath = args[3] ?? DEFAULT_CONFIG_PATH;
      getConfigValue(configPath, key);
      return;
    }

    if (subCommand === "set") {
      const key = args[2];
      const value = args[3];
      if (!key || !value) {
        console.error("Missing key or value. Usage: ccfc config set <key> <value>");
        process.exit(1);
      }
      const configPath = args[4] ?? DEFAULT_CONFIG_PATH;
      setConfigValue(configPath, key, value);
      return;
    }

    console.error(`Unknown config subcommand: ${subCommand}`);
    process.exit(1);
  }

  if (command === "service") {
    const subCommand = args[1];
    if (!subCommand) {
      console.error("Missing service subcommand. Use: install, uninstall, status, or restart");
      process.exit(1);
    }

    if (subCommand === "install") {
      const configPath = args[2] ?? DEFAULT_CONFIG_PATH;
      installService(PROJECT_DIR, resolve(configPath));
      return;
    }

    if (subCommand === "uninstall") {
      uninstallService();
      return;
    }

    if (subCommand === "status") {
      getServiceStatus();
      return;
    }

    if (subCommand === "restart") {
      restartService();
      return;
    }

    console.error(`Unknown service subcommand: ${subCommand}`);
    process.exit(1);
  }

  console.error(`Unknown command: ${command}`);
  console.error("Run 'ccfc help' for usage information");
  process.exit(1);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
