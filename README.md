# cc-feishu-connector

Claude Code 飞书桥接服务 — 在飞书聊天窗口中使用 Claude Code。

> **来源说明**：本项目 fork 自 [jawkjiang/cc-feishu](https://github.com/jawkjiang/cc-feishu)，在原项目基础上做了以下改动：
> - 消息表情反应：收到消息立即添加 ⏳ 表情，回复后自动移除
> - 工作目录别名系统：`/ws add/list/delete` 持久化别名，`/run <alias>` 快速启动
> - 完整 thinking 显示：显示最后 500 字符而非截断摘要
> - 修复重复内容 bug：result 事件文本不再与流式 text 事件重复
> - 无会话提示增强：显示已配置的 workspace alias 列表

## 功能特性

- ✅ **完整的 Claude Code 体验** — 在飞书中获得接近 CLI 的完整功能
- 🎨 **富交互卡片** — 实时显示 thinking、tool calls、代码 diff、执行结果
- 🔐 **权限审批** — Claude 执行敏感操作时在飞书弹出审批按钮
- ⏹ **中断执行** — 使用 `/esc` 命令随时中断当前执行
- 🔄 **会话恢复** — 支持 `--resume` 恢复历史会话
- 📝 **消息排队** — 支持连续发送多条消息，按序处理
- 💬 **斜杠指令** — `/start`, `/stop`, `/esc`, `/status`, `/help` 等管理指令

## 快速开始

### 安装

**推荐使用 npm 全局安装：**

```bash
npm install -g @hyposomnia/cc-feishu-connector
```

安装后可以直接使用 `cc-feishu` 命令。

### 配置飞书应用

1. 前往 [飞书开放平台](https://open.feishu.cn/) 创建企业自建应用
2. 获取 `App ID` 和 `App Secret`
3. 开启机器人能力，订阅 `im.message.receive_v1` 事件
4. 配置权限：
   - `im:message` (读取与发送消息)
   - `im:message:send_as_bot` (以应用身份发消息)
5. 在"事件与回调"中选择"使用长连接接收事件/回调"

### 配置应用凭证

```bash
# 设置飞书凭证
cc-feishu config set feishu.app_id cli_your_app_id
cc-feishu config set feishu.app_secret your_app_secret

# 查看当前配置
cc-feishu config show
```

配置会自动保存到 `~/.cc-feishu/config.toml` 文件。

### 启动服务

```bash
# 前台运行（查看日志）
cc-feishu start

# 或安装为系统服务（macOS）
cc-feishu service install
cc-feishu service status
cc-feishu service restart
```

## 使用方法

### 启动 Claude Code 会话

在飞书私聊或群聊中发送：

```
/start /path/to/your/project
```

支持的启动参数：

```
/start /Users/dy/my-project
/start /Users/dy/my-project --resume
/start /Users/dy/my-project --model opus
/start /Users/dy/my-project --dangerously-skip-permissions
/start /Users/dy/my-project --continue
```

### 与 Claude 对话

启动会话后，直接发送消息即可：

```
帮我读一下 package.json 然后加个 lint script
```

Claude 的响应会以交互式卡片形式展示，包括：
- 💭 思考过程（可折叠）
- 🔧 工具调用（Read、Edit、Bash 等）
- 📝 代码 diff（+/- 标记）
- ✅ 最终结果
- 📊 统计信息（tokens、费用、耗时）

### 中断执行

如果 Claude 正在执行，可以随时中断：

```
/esc
```

执行会被中断，但会话保持活跃，可以继续发送新消息。

### 管理指令

- `/start <path> [flags]` — 启动 Claude Code 会话
- `/stop` — 停止当前会话
- `/esc` 或 `/interrupt` — 中断当前执行（类似 Ctrl+C）
- `/status` — 查看会话状态
- `/config` — 查看和修改配置
- `/help` — 显示帮助信息

### 权限审批

当 Claude 需要执行敏感操作（如运行 bash 命令）时，会弹出审批卡片：

```
⚠️ Permission Request
Claude wants to run:
  $ npm test

[✅ Allow]  [❌ Deny]  [🔓 Allow All]
```

点击按钮即可批准或拒绝。

## CLI 命令

```bash
# 配置管理
cc-feishu config show                    # 显示当前配置
cc-feishu config get <key>               # 获取配置项
cc-feishu config set <key> <value>       # 设置配置项

# 服务管理
cc-feishu start                          # 启动服务（前台）
cc-feishu service install                # 安装为系统服务（macOS）
cc-feishu service uninstall              # 卸载系统服务
cc-feishu service status                 # 查看服务状态
cc-feishu service restart                # 重启服务

# 帮助
cc-feishu help                           # 显示帮助信息
```

## 从源码安装（开发者）

如果你想从源码安装或参与开发：

```bash
# 克隆仓库
git clone https://github.com/hyposomnia/cc-feishu-connector.git
cd cc-feishu-connector

# 安装依赖
npm install

# 构建
npm run build

# 链接到全局命令
npm link

# 启动服务
cc-feishu start
```

## 架构

```
飞书用户 ←─WebSocket─→ cc-feishu 服务 ←─stdin/stdout JSON─→ Claude Code 子进程
                              │
                         本地项目文件系统
```

- **飞书 Gateway** — WebSocket 连接，接收/发送消息和卡片
- **Session Manager** — 管理 Claude Code 子进程生命周期
- **Event Parser** — 解析 stream-json 事件流
- **Card Renderer** — 渲染飞书交互式卡片
- **Permission Handler** — 处理权限请求和审批

## 开发

### 项目结构

```
src/
├── index.ts              # 入口
├── config.ts             # TOML 配置加载
├── gateway/
│   ├── feishu.ts         # 飞书 WebSocket 连接
│   └── callback.ts       # 卡片回调处理
├── agent/
│   ├── claude.ts         # Claude Code 子进程管理
│   ├── events.ts         # stream-json 事件解析
│   └── types.ts          # 类型定义
├── renderer/
│   ├── card-builder.ts   # 飞书卡片构建器
│   ├── turn-card.ts      # 对话轮次卡片
│   ├── diff.ts           # 代码 diff 渲染
│   ├── tool-call.ts      # 工具调用摘要
│   └── streaming.ts      # 流式卡片更新
├── session/
│   ├── manager.ts        # 会话管理
│   └── queue.ts          # 消息队列
├── permission/
│   └── handler.ts        # 权限请求处理
└── commands/
    └── router.ts         # 斜杠指令路由
```

### 添加新功能

1. **自定义斜杠指令** — 在 `commands/router.ts` 的 `route()` 方法中添加新 case
2. **自定义卡片样式** — 修改 `renderer/turn-card.ts` 的 `buildCard()` 方法
3. **新的事件类型** — 在 `agent/types.ts` 添加类型，在 `renderer/turn-card.ts` 处理

## 注意事项

- 每个飞书聊天窗口（私聊/群聊）对应一个独立的 Claude Code 会话
- 会话空闲 30 分钟后自动停止
- 卡片更新有节流机制，避免触发飞书 API 频率限制
- 需要本地安装 Claude Code CLI（`npm install -g @anthropic-ai/claude-code`）

## License

MIT
