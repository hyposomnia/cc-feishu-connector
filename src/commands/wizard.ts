/**
 * Interactive configuration wizard
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import TOML from "@iarna/toml";

interface Config {
  feishu?: {
    app_id?: string;
    app_secret?: string;
  };
  defaults?: {
    model?: string;
  };
}

export async function runConfigWizard(configPath?: string): Promise<void> {
  const path = configPath ?? resolve(process.cwd(), "config.toml");
  const rl = createInterface({ input, output });

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                                                            ║");
  console.log("║          🚀 ccfc 配置向导                             ║");
  console.log("║          Claude Code 飞书桥接服务                          ║");
  console.log("║                                                            ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  console.log("欢迎使用 ccfc！让我们一起完成配置。\n");

  // Load existing config if available
  let config: Config = { feishu: {}, defaults: {} };
  if (existsSync(path)) {
    try {
      const raw = readFileSync(path, "utf-8");
      config = TOML.parse(raw) as Config;
      console.log("✓ 找到现有配置文件，将更新配置\n");
    } catch {
      console.log("⚠ 配置文件格式错误，将创建新配置\n");
    }
  }

  // Step 1: Feishu App ID
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📱 第一步：飞书应用配置");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("请前往飞书开放平台创建企业自建应用：");
  console.log("👉 https://open.feishu.cn/\n");

  const currentAppId = config.feishu?.app_id;
  if (currentAppId) {
    console.log(`当前 App ID: ${currentAppId}`);
  }

  const appId = await rl.question(
    currentAppId
      ? "请输入新的 App ID（直接回车保持不变）: "
      : "请输入飞书应用的 App ID（格式：cli_xxx）: "
  );

  if (appId.trim()) {
    config.feishu!.app_id = appId.trim();
  } else if (!currentAppId) {
    console.log("\n❌ App ID 不能为空");
    rl.close();
    process.exit(1);
  }

  // Step 2: Feishu App Secret
  console.log("");
  const currentSecret = config.feishu?.app_secret;
  if (currentSecret) {
    const masked = currentSecret.slice(0, 8) + "..." + currentSecret.slice(-4);
    console.log(`当前 App Secret: ${masked}`);
  }

  const appSecret = await rl.question(
    currentSecret
      ? "请输入新的 App Secret（直接回车保持不变）: "
      : "请输入飞书应用的 App Secret: "
  );

  if (appSecret.trim()) {
    config.feishu!.app_secret = appSecret.trim();
  } else if (!currentSecret) {
    console.log("\n❌ App Secret 不能为空");
    rl.close();
    process.exit(1);
  }

  // Step 3: Default model (optional)
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🤖 第二步：默认模型配置（可选）");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("可选的模型：");
  console.log("  • claude-opus-4-6      (最强大，适合复杂任务)");
  console.log("  • claude-sonnet-4-6    (平衡性能和成本，推荐)");
  console.log("  • claude-haiku-4       (快速响应，适合简单任务)\n");

  const currentModel = config.defaults?.model;
  if (currentModel) {
    console.log(`当前默认模型: ${currentModel}`);
  }

  const model = await rl.question(
    currentModel
      ? "请输入新的默认模型（直接回车保持不变）: "
      : "请输入默认模型（直接回车跳过）: "
  );

  if (model.trim()) {
    config.defaults!.model = model.trim();
  }

  // Save configuration
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("💾 保存配置");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  try {
    const tomlString = TOML.stringify(config as any);
    writeFileSync(path, tomlString, "utf-8");
    console.log(`✅ 配置已保存到: ${path}\n`);
  } catch (err) {
    console.error(`❌ 保存配置失败: ${err}`);
    rl.close();
    process.exit(1);
  }

  // Summary
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📋 配置摘要");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log(`飞书 App ID:     ${config.feishu?.app_id}`);
  const secretMasked = config.feishu?.app_secret
    ? config.feishu.app_secret.slice(0, 8) + "..." + config.feishu.app_secret.slice(-4)
    : "";
  console.log(`飞书 App Secret: ${secretMasked}`);
  console.log(`默认模型:        ${config.defaults?.model ?? "(未设置)"}\n`);

  // Next steps
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("🎉 配置完成！");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

  console.log("接下来的步骤：\n");
  console.log("1️⃣  在飞书开放平台配置机器人权限：");
  console.log("   • 开启机器人能力");
  console.log("   • 订阅 im.message.receive_v1 事件");
  console.log("   • 添加权限：im:message, im:message:send_as_bot\n");

  console.log("2️⃣  启动服务：");
  console.log("   ccfc start\n");

  console.log("3️⃣  在飞书中与机器人对话：");
  console.log("   /start /path/to/your/project\n");

  console.log("需要帮助？运行：ccfc help\n");

  rl.close();
}
