# cc-feishu-connector

Use Claude Code in Feishu (Lark) chat — with interactive cards, permission approvals, and session management.

> **Origin**: Forked from [jawkjiang/cc-feishu](https://github.com/jawkjiang/cc-feishu), with added workspace aliases, message reactions, full thinking display, and various bug fixes.

[中文文档](./README.md)

---

## Features

- 🎨 **Rich interactive cards** — Real-time streaming of thinking, tool calls, code diffs, and results
- 🔐 **Permission approvals** — Feishu card popup for sensitive operations with Allow / Deny / Allow All buttons
- ⏹ **Interrupt execution** — `/esc` to interrupt at any time; session stays alive
- 🔄 **Session resume** — `--resume` to pick from history, `--continue` to resume latest
- 📁 **Workspace aliases** — Save paths with `/ws add <alias> <path>`, launch with `/run <alias>`
- 📝 **Message queuing** — Messages in the same session are processed in order

---

## Prerequisites

- Node.js 22+
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code): `npm install -g @anthropic-ai/claude-code`
- A Feishu self-built enterprise app (setup steps below)

---

## Step 1 — Configure the Feishu Bot

### 1. Create an app

1. Log in to the [Feishu Open Platform](https://open.feishu.cn/app) and click **Create Self-Built App**
2. Enter a name (e.g., "Claude Code") and complete creation

### 2. Get credentials

On the **Credentials & Basic Info** page, copy the **App ID** and **App Secret**.

### 3. Enable the bot feature

Go to **App Features → Bot** and enable it.

### 4. Configure permissions

Go to **Permission Management** and enable the following:

| Permission | Description |
|-----------|-------------|
| `im:message` | Read and send messages |
| `im:message:send_as_bot` | Send messages as the bot |
| `im:message.react.emoji:write` | Add/remove message emoji reactions |

### 5. Subscribe to events

Go to **Event Subscriptions**:

1. Set **Subscription Method** to **Use persistent connection to receive events/callbacks** (no public server needed)
2. Under **Add Events**, subscribe to `im.message.receive_v1` (receive messages)
3. Under **Card Callback**, enable **card.action.trigger** (receive button clicks)

> ⚠️ In persistent connection mode, the bot connects to Feishu via WebSocket — no callback URL required.

### 6. Publish the app

Go to **Version Management & Release**, create a version, and publish. Internal enterprise apps typically don't require review — an admin can publish directly.

---

## Step 2 — Install

### Option A: npm global install (recommended)

```bash
npm install -g @hyposomnia/cc-feishu-connector
```

The `ccfc` command is then available globally.

### Option B: Build from source

```bash
git clone https://github.com/hyposomnia/cc-feishu-connector.git
cd cc-feishu-connector
npm install
npm run build
npm link   # link ccfc to the global PATH
```

---

## Step 3 — Configure credentials

```bash
# Set your Feishu App ID and App Secret
ccfc config set feishu.app_id cli_xxxxxxxxxxxxxxxx
ccfc config set feishu.app_secret xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Optional: set a default model
ccfc config set defaults.model claude-opus-4-6

# Verify config
ccfc config show
```

Config is saved to `~/.cc-feishu-connector/config.toml`. You can also edit it directly:

```toml
# ~/.cc-feishu-connector/config.toml

[feishu]
# Required: Feishu app credentials (from "Credentials & Basic Info" on the Open Platform)
app_id = "cli_xxxxxxxxxxxxxxxx"
app_secret = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

[defaults]
# Optional: default Claude model; leave blank to use the claude CLI default
# Examples: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5
model = "claude-sonnet-4-6"
```

All config options:

| Key | Required | Description |
|-----|----------|-------------|
| `feishu.app_id` | ✅ | Feishu App ID (starts with `cli_`) |
| `feishu.app_secret` | ✅ | Feishu App Secret |
| `defaults.model` | ❌ | Default Claude model; overridable per-session with `/start --model` |

---

## Step 4 — Start the service

```bash
# Run in foreground (with live logs)
ccfc start

# Install as a macOS system service (auto-start on login)
ccfc service install
ccfc service status
ccfc service restart
ccfc service uninstall
```

When the log shows `ws client ready`, the service is connected to Feishu.

---

## Step 5 — Using in Feishu

### Start a Claude Code session

DM the bot, or add it to a group and @mention it, then send:

```
/start /path/to/your/project
```

Or use a workspace alias (see below):

```
/run my-project
```

**Supported flags:**

```
/start /path/to/project                          # basic start
/start /path/to/project --continue               # resume the latest session
/start /path/to/project --resume                 # pick a session from history
/start /path/to/project --model claude-opus-4-6  # specify a model
/start /path/to/project --dangerously-skip-permissions  # skip all permission prompts
```

### Chat with Claude

Once a session is running, just send messages:

```
Read package.json and add a lint script
```

Responses are displayed as interactive cards:
- 💭 **Thinking** (collapsible)
- 🔧 **Tool calls** (Read, Edit, Bash, etc.)
- 📝 **Code diffs** (with +/- markers)
- ✅ **Final result**
- 📊 **Stats** (tokens, cost, duration)

### Permission approvals

When Claude needs to perform a sensitive action, a card appears:

```
🔐 Permission Required
Tool: Bash
Action: Run a shell command
$ rm -rf dist/

[ ✅ Allow ]  [ ❌ Deny ]  [ ✅ Allow All ]
```

Click a button to respond. **Allow All** skips all further permission prompts for the current session.

### Workspace aliases

Save frequently used project paths for quick access:

```
/ws add my-project /Users/me/projects/my-project
/ws add backend /Users/me/work/backend

/run my-project           # same as /start /Users/me/projects/my-project
/run backend --continue   # continue backend's latest session

/ws list                  # show all aliases
/ws delete my-project     # remove an alias
```

### Full command reference

| Command | Description |
|---------|-------------|
| `/start <path\|alias> [flags]` | Start a Claude Code session |
| `/run <path\|alias> [flags]` | Same as `/start` |
| `/stop` | Stop the current session |
| `/esc` or `/interrupt` | Interrupt current execution (like Ctrl+C) |
| `/status` | Show current session status |
| `/config [set <key> <value>]` | View or update config |
| `/ws add <alias> <path>` | Add a workspace alias |
| `/ws list` | List all aliases |
| `/ws delete <alias>` | Remove an alias |
| `/help` | Show help |

---

## Architecture

```
Feishu User ←─WebSocket─→ FeishuGateway ←──────────────────── SessionManager
                               │                                      │
                          CallbackRouter                         ClaudeAgent
                         (card button events)             (subprocess stdin/stdout)
                                                                      │
                                                           Local project filesystem
```

- **FeishuGateway** — WebSocket persistent connection for messages and cards
- **SessionManager** — One session per chat (DM or group); auto-stops after 30 min idle
- **ClaudeAgent** — Spawns `claude --print --input-format stream-json --output-format stream-json`
- **StreamingCard** — Throttled card updates (thinking: 500ms, text: 300ms)
- **PermissionHandler** — Intercepts permission requests, shows approval card, waits for response

---

## Notes

- Each Feishu chat (DM or group) gets its own independent Claude Code subprocess
- Sessions auto-stop after 30 minutes of inactivity
- The service runs **locally** — Claude Code operates on the local filesystem
- In group chats, @mention the bot to trigger a response

---

## License

MIT
