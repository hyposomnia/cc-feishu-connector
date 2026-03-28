# cc-feishu

Claude Code 飞书桥接服务。将飞书聊天消息转发给本地 Claude Code 子进程，并将结果以交互式卡片形式回送。

## 命令

```bash
# 开发（不构建，直接运行源码）
npm run dev

# 构建（输出到 dist/）
npm run build

# 运行构建产物
npm start

# 发布前自动构建
npm publish
```

## 架构

```
飞书用户 <--WebSocket--> FeishuGateway <--> SessionManager <--> ClaudeAgent (子进程)
                              |                                        |
                         CallbackRouter                     stdin/stdout stream-json
                         (卡片按钮回调)
```

- **入口**: `src/index.ts` — 组装所有模块，监听消息
- **CLI 入口**: `src/cli.ts` — `cc-feishu` 命令行工具（config/service 子命令）
- **配置**: `src/config.ts` — 读取 TOML，必须包含 `feishu.app_id` 和 `feishu.app_secret`
- **飞书网关**: `src/gateway/feishu.ts` — WebSocket 长连接收发消息和卡片
- **卡片回调**: `src/gateway/callback.ts` — 处理飞书卡片按钮点击事件
- **Claude 子进程**: `src/agent/claude.ts` — spawn `claude --print --input-format stream-json --output-format stream-json`
- **事件解析**: `src/agent/events.ts` — 解析 stream-json 行流
- **会话管理**: `src/session/manager.ts` — 每个 chatId 对应一个 Session + ClaudeAgent
- **消息队列**: `src/session/queue.ts` — 串行处理同一会话的消息
- **流式卡片**: `src/renderer/streaming.ts` — 节流更新飞书卡片（thinking 500ms，text 300ms）
- **卡片渲染**: `src/renderer/turn-card.ts` — 构建飞书交互卡片 JSON
- **权限处理**: `src/permission/handler.ts` — 拦截 permission_request 事件，发送审批卡片
- **问题处理**: `src/question/handler.ts` — 拦截带 `questions` 字段的 tool_use，转发给用户

## 关键模式

**子进程通信**: Claude Code 以 `--permission-prompt-tool stdio` 启动（除非用户传了 `--dangerously-skip-permissions`）。消息通过 stdin 写入 JSON，stdout 逐行读取 JSON 事件。

**防嵌套检测**: 启动子进程时删除 `CLAUDECODE` 环境变量，避免 Claude Code 认为自己在嵌套环境中被拒绝启动。

**中断后重启**: `/esc` 发送 SIGINT，进程退出后立即 `agent.start()` 重启，保持会话活跃。

**会话恢复**: `--resume` 标志会触发 `SessionPicker`，从 `SessionStore` 列出历史 session ID 供用户选择，再拼接 `--resume <session-id>` 传给 claude CLI。

**配置文件位置**:
- CLI 方式（`cc-feishu start`）: `~/.cc-feishu/config.toml`
- 直接运行（`npm run dev`）: 当前目录的 `config.toml`，或通过 `process.argv[2]` 指定路径

## 构建产物

tsup 构建两个入口：
- `dist/cli.js` — 带 shebang，对应 `bin.cc-feishu`
- `dist/index.js` — 无 shebang，供 service 方式启动

## 依赖注意事项

- `@larksuiteoapi/node-sdk` — 飞书官方 SDK，WebSocket 长连接
- `@iarna/toml` — TOML 解析（config）
- TypeScript strict 模式，ESM，target node22
- 运行时要求本地已安装 `claude` CLI（`npm install -g @anthropic-ai/claude-code`）

## 会话生命周期

- 空闲超时 30 分钟自动停止
- 每个 chatId（私聊/群聊）独立一个会话
- 同一会话消息串行排队处理，不并发
