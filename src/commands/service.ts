/**
 * Service management for macOS (launchd)
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";

const PLIST_NAME = "com.cc-feishu.service.plist";
const LAUNCH_AGENTS_DIR = resolve(homedir(), "Library", "LaunchAgents");
const DEST_PLIST = resolve(LAUNCH_AGENTS_DIR, PLIST_NAME);

function assertMacOS() {
  if (process.platform !== "darwin") {
    const hint = process.platform === "win32"
      ? "Windows 上请使用任务计划程序或 NSSM 将 `ccfc start` 注册为服务。"
      : "当前系统不支持此命令，请手动将 `ccfc start` 注册为系统服务。";
    console.error(`错误：系统服务管理仅支持 macOS。\n${hint}`);
    process.exit(1);
  }
}

function getPlistContent(projectDir: string, configPath: string, nodePath: string): string {
  const indexPath = resolve(projectDir, "dist", "index.js");
  const logsDir = resolve(projectDir, "logs");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.cc-feishu.service</string>

    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${indexPath}</string>
        <string>${configPath}</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${projectDir}</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${logsDir}/stdout.log</string>

    <key>StandardErrorPath</key>
    <string>${logsDir}/stderr.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>`;
}

export function installService(projectDir: string, configPath: string): void {
  assertMacOS();
  console.log("🚀 安装 ccfc 服务...");

  // Get Node.js path
  const nodePath = execSync("which node", { encoding: "utf-8" }).trim();
  console.log(`📍 Node.js 路径: ${nodePath}`);

  // Create LaunchAgents directory if not exists
  if (!existsSync(LAUNCH_AGENTS_DIR)) {
    mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
  }

  // Create logs directory
  const logsDir = resolve(projectDir, "logs");
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  // Generate and write plist file
  const plistContent = getPlistContent(projectDir, configPath, nodePath);
  writeFileSync(DEST_PLIST, plistContent, "utf-8");
  console.log(`📋 服务配置已写入: ${DEST_PLIST}`);

  // Unload existing service (if any)
  try {
    execSync(`launchctl unload "${DEST_PLIST}"`, { stdio: "ignore" });
  } catch {
    // Ignore errors if service not loaded
  }

  // Load service
  execSync(`launchctl load "${DEST_PLIST}"`);
  console.log("⚡ 服务已加载并启动");

  console.log("");
  console.log("✅ ccfc 服务安装成功！");
  console.log("");
  console.log("常用命令:");
  console.log(`  查看状态: launchctl list | grep cc-feishu`);
  console.log(`  停止服务: launchctl unload "${DEST_PLIST}"`);
  console.log(`  启动服务: launchctl load "${DEST_PLIST}"`);
  console.log(`  查看日志: tail -f ${logsDir}/stdout.log`);
  console.log(`  卸载服务: cc-feishu service uninstall`);
}

export function uninstallService(): void {
  assertMacOS();
  console.log("🛑 卸载 ccfc 服务...");

  if (!existsSync(DEST_PLIST)) {
    console.log("⚠️  服务未安装");
    return;
  }

  // Unload service
  try {
    execSync(`launchctl unload "${DEST_PLIST}"`, { stdio: "ignore" });
    console.log("⚡ 服务已停止");
  } catch (err) {
    console.log("⚠️  服务未运行");
  }

  // Remove plist file
  execSync(`rm "${DEST_PLIST}"`);
  console.log("📋 服务配置已删除");

  console.log("");
  console.log("✅ ccfc 服务已卸载");
}

export function getServiceStatus(): void {
  assertMacOS();
  try {
    const output = execSync("launchctl list | grep cc-feishu", { encoding: "utf-8" });
    console.log("服务状态:");
    console.log(output.trim());

    if (existsSync(DEST_PLIST)) {
      console.log("");
      console.log(`配置文件: ${DEST_PLIST}`);
    }
  } catch {
    console.log("⚠️  服务未运行");
    if (existsSync(DEST_PLIST)) {
      console.log(`配置文件存在: ${DEST_PLIST}`);
      console.log(`启动服务: launchctl load "${DEST_PLIST}"`);
    } else {
      console.log("服务未安装");
      console.log("安装服务: ccfc service install");
    }
  }
}

export function restartService(): void {
  assertMacOS();
  console.log("🔄 重启 ccfc 服务...");

  if (!existsSync(DEST_PLIST)) {
    console.log("⚠️  服务未安装");
    return;
  }

  // Unload
  try {
    execSync(`launchctl unload "${DEST_PLIST}"`, { stdio: "ignore" });
    console.log("⚡ 服务已停止");
  } catch {
    console.log("⚠️  服务未运行");
  }

  // Load
  execSync(`launchctl load "${DEST_PLIST}"`);
  console.log("⚡ 服务已启动");

  console.log("");
  console.log("✅ ccfc 服务已重启");
}
