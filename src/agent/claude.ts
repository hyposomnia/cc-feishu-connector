import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { ClaudeEventParser } from "./events.js";
import type { ClaudeEvent, ClaudeInput, PermissionResponse, UserMessage } from "./types.js";

export interface ClaudeAgentOptions {
  /** Working directory for the subprocess. */
  cwd: string;
  /** Extra CLI flags to pass through (e.g. ["--resume", "--model", "opus"]). */
  extraArgs?: string[];
  /** Path to claude binary. Default: "claude". */
  claudeBin?: string;
}

export class ClaudeAgent extends EventEmitter {
  private proc: ChildProcess | null = null;
  private parser = new ClaudeEventParser();
  private cwd: string;
  private extraArgs: string[];
  private claudeBin: string;
  private _busy = false;

  constructor(opts: ClaudeAgentOptions) {
    super();
    this.cwd = opts.cwd;
    this.extraArgs = opts.extraArgs ?? [];
    this.claudeBin = opts.claudeBin ?? "claude";
  }

  get busy(): boolean {
    return this._busy;
  }

  get alive(): boolean {
    return this.proc !== null && this.proc.exitCode === null;
  }

  /** Start the Claude Code subprocess. */
  start(): void {
    if (this.alive) return;

    // Base flags required for bridge communication
    const args = [
      "--print",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
    ];

    // Only add --permission-prompt-tool if user hasn't passed --dangerously-skip-permissions
    const hasSkipPerms = this.extraArgs.some(
      (a) => a === "--dangerously-skip-permissions" || a === "--allow-dangerously-skip-permissions",
    );
    if (!hasSkipPerms) {
      args.push("--permission-prompt-tool", "stdio");
    }

    // Append user-supplied extra flags
    args.push(...this.extraArgs);

    // Create clean environment without CLAUDECODE to avoid nested session detection
    const env = { ...process.env };
    delete env.CLAUDECODE;

    this.proc = spawn(this.claudeBin, args, {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: this.cwd,
      env,
    });

    this.parser = new ClaudeEventParser();
    this.parser.on("event", (event: ClaudeEvent) => {
      this.emit("event", event);
      if (event.type === "result" || event.type === "error") {
        this._busy = false;
        this.emit("idle");
      }
    });
    this.parser.on("parse_error", (raw: string) => {
      this.emit("parse_error", raw);
    });

    this.proc.stdout!.setEncoding("utf-8");
    this.proc.stdout!.on("data", (chunk: string) => {
      this.parser.feed(chunk);
    });

    this.proc.stderr!.setEncoding("utf-8");
    this.proc.stderr!.on("data", (chunk: string) => {
      this.emit("stderr", chunk);
    });

    this.proc.on("exit", (code, signal) => {
      this.parser.flush();
      this._busy = false;
      this.emit("exit", code, signal);
    });

    this.proc.on("error", (err) => {
      this.emit("proc_error", err);
    });
  }

  /** Send a user message. */
  sendMessage(content: string): void {
    const msg: UserMessage = {
      type: "user",
      message: { role: "user", content },
    };
    this.write(msg);
    this._busy = true;
  }

  /** Send a permission response. */
  sendPermissionResponse(response: "allow" | "deny" | "allow_all"): void {
    const msg: PermissionResponse = {
      type: "permission_response",
      response,
    };
    this.write(msg);
  }

  /** Kill the subprocess. */
  stop(): void {
    if (this.proc && this.proc.exitCode === null) {
      this.proc.kill("SIGTERM");
    }
    this.proc = null;
    this._busy = false;
  }

  private write(msg: ClaudeInput): void {
    if (!this.proc?.stdin?.writable) {
      throw new Error("Claude Code process is not running");
    }
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  }
}
