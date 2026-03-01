# cc-feishu

Claude Code 飞书桥接服务 — 在飞书聊天窗口中使用 Claude Code。

## 功能特性

- ✅ **完整的 Claude Code 体验** — 在飞书中获得接近 CLI 的完整功能
- 🎨 **富交互卡片** — 实时显示 thinking、tool calls、代码 diff、执行结果
- 🔐 **权限审批** — Claude 执行敏感操作时在飞书弹出审批按钮
- 📝 **消息排队** — 支持连续发送多条消息，按序处理
- 🔄 **流式更新** — 卡片实时更新，节流优化避免频繁刷新
- 💬 **斜杠指令** — `/start`, `/stop`, `/status`, `/help` 等管理指令

## 快速开始

### 1. 安装依赖

```bash
cd ~/cc-feishu
npm install
```

### 2. 配置飞书应用

1. 前往 [飞书开放平台](https://open.feishu.cn/) 创建企业自建应用
2. 获取 `App ID` 和 `App Secret`
3. 开启机器人能力，订阅 `im.message.receive_v1` 事件
4. 配置权限：
   - `im:message` (读取与发送消息)
   - `im:message:send_as_bot` (以应用身份发消息)

### 3. 配置应用凭证

使用 CLI 工具配置：

```bash
# 查看当前配置
./dist/cli.js config show

# 设置飞书凭证
./dist/cli.js config set feishu.app_id cli_your_app_id
./dist/cli.js config set feishu.app_secret your_app_secret

# 设置默认模型（可选）
./dist/cli.js config set defaults.model claude-opus-4-6

# 查看单个配置项
./dist/cli.js config get feishu.app_id
```

配置会自动保存到 `config.toml` 文件。

或者手动编辑配置文件：

```bash
cp config.example.toml config.toml
```

编辑 `config.toml`:

```toml
[feishu]
app_id = "cli_your_app_id"
app_secret = "your_app_secret"

[defaults]
# model = "claude-sonnet-4-6"
```

### 4. 启动服务

使用 CLI 工具启动：

```bash
# 使用默认配置文件 (config.toml)
./dist/cli.js start

# 或指定配置文件路径
./dist/cli.js start /path/to/config.toml
```

或者直接运行：

```bash
npm run build
npm start
```

开发模式（自动重启）:

```bash
npm run dev
```

## CLI 工具

`cc-feishu` 提供了一个命令行工具来管理配置和启动服务。

### 安装为全局命令（可选）

```bash
npm link
# 或
sudo npm link
```

安装后可以直接使用 `cc-feishu` 命令：

```bash
cc-feishu config show
cc-feishu config set feishu.app_id cli_xxx
cc-feishu start
```

### CLI 命令

```bash
# 配置管理
cc-feishu config show [config-path]              # 显示当前配置
cc-feishu config get <key> [config-path]         # 获取配置项
cc-feishu config set <key> <value> [config-path] # 设置配置项

# 启动服务
cc-feishu start [config-path]                    # 启动服务

# 帮助
cc-feishu help                                   # 显示帮助信息
```

### 配置项

- `feishu.app_id` — 飞书应用 ID
- `feishu.app_secret` — 飞书应用密钥
- `defaults.model` — 默认 Claude 模型

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

### 权限审批

当 Claude 需要执行敏感操作（如运行 bash 命令）时，会弹出审批卡片：

```
⚠️ Permission Request
Claude wants to run:
  $ npm test

[✅ Allow]  [❌ Deny]  [🔓 Allow All]
```

点击按钮即可批准或拒绝。

### 管理指令

- `/config` — 查看和修改配置
  - `/config` — 显示当前配置
  - `/config set <key> <value>` — 更新配置项
- `/stop` — 停止当前会话
- `/status` — 查看会话状态
- `/help` — 显示帮助信息

### 转发 Claude Code 指令

其他斜杠指令会自动转发给 Claude Code：

```
/model
/cost
/compact
/clear
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
