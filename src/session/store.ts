/**
 * Session store: persists Claude Code session IDs for resume functionality.
 * Reads existing sessions from Claude Code's storage.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";

const STORE_DIR = resolve(homedir(), ".cc-feishu");
const STORE_FILE = resolve(STORE_DIR, "sessions.json");
const CLAUDE_PROJECTS_DIR = resolve(homedir(), ".claude", "projects");

interface SessionData {
  sessionId: string;
  cwd: string;
  lastUsed: number;
  lastCard?: CardState;
}

export interface CardState {
  messageId: string;
  chatId: string;
  timestamp: number;
}

interface StoreData {
  sessions: Record<string, SessionData>;
}

interface ClaudeSession {
  sessionId: string;
  lastModified: number;
  size: number;
  summary?: string; // First user message as summary
}

export class SessionStore {
  private data: StoreData;

  constructor() {
    this.data = this.load();
  }

  /** Get the most recent session ID for a project directory from Claude Code's storage. */
  getSessionId(cwd: string): string | undefined {
    // First check our own store
    const normalized = resolve(cwd);
    const stored = this.data.sessions[normalized]?.sessionId;
    if (stored) {
      return stored;
    }

    // Fall back to reading Claude Code's session directory
    const claudeSessions = this.listClaudeSessions(cwd);
    if (claudeSessions.length > 0) {
      // Return the most recently modified session
      const latest = claudeSessions[0];
      return latest.sessionId;
    }

    return undefined;
  }

  /** List all Claude Code sessions for a project directory, sorted by last modified (newest first). */
  listClaudeSessions(cwd: string): ClaudeSession[] {
    const normalized = resolve(cwd);
    const projectKey = this.normalizePathForClaude(normalized);
    const projectDir = join(CLAUDE_PROJECTS_DIR, projectKey);

    if (!existsSync(projectDir)) {
      return [];
    }

    try {
      const files = readdirSync(projectDir);
      const sessions: ClaudeSession[] = [];

      for (const file of files) {
        // Session files are UUIDs with .jsonl extension
        if (file.endsWith(".jsonl")) {
          const sessionId = file.replace(".jsonl", "");
          const filePath = join(projectDir, file);
          const stats = statSync(filePath);

          // Extract summary from first user message
          const summary = this.extractSummary(filePath);

          sessions.push({
            sessionId,
            lastModified: stats.mtimeMs,
            size: stats.size,
            summary,
          });
        }
      }

      // Sort by last modified, newest first
      sessions.sort((a, b) => b.lastModified - a.lastModified);
      return sessions;
    } catch (err) {
      console.error(`[store] Error reading Claude sessions:`, err);
      return [];
    }
  }

  /** Save a session ID for a project directory. */
  saveSessionId(cwd: string, sessionId: string): void {
    const normalized = resolve(cwd);
    this.data.sessions[normalized] = {
      sessionId,
      cwd: normalized,
      lastUsed: Date.now(),
    };
    this.persist();
  }

  /** Clear session ID for a project directory. */
  clearSessionId(cwd: string): void {
    const normalized = resolve(cwd);
    delete this.data.sessions[normalized];
    this.persist();
  }

  /** Save the last card state for a session. */
  saveLastCard(cwd: string, messageId: string, chatId: string): void {
    const normalized = resolve(cwd);
    const session = this.data.sessions[normalized];
    if (session) {
      session.lastCard = {
        messageId,
        chatId,
        timestamp: Date.now(),
      };
      this.persist();
    }
  }

  /** Get the last card state for a session. */
  getLastCard(cwd: string): CardState | undefined {
    const normalized = resolve(cwd);
    return this.data.sessions[normalized]?.lastCard;
  }

  /** Normalize path the same way Claude Code does: replace / with -. */
  private normalizePathForClaude(path: string): string {
    return path.replace(/\//g, "-");
  }

  /** Extract summary (first user message) from a session file. */
  private extractSummary(filePath: string): string | undefined {
    try {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n").slice(0, 100); // Only read first 100 lines

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const record = JSON.parse(line);
          if (record.type === "user" && record.message?.content) {
            // Truncate to 60 characters
            const text = record.message.content.trim();
            return text.length > 60 ? text.slice(0, 60) + "..." : text;
          }
        } catch {
          continue;
        }
      }
    } catch {
      // Ignore errors
    }
    return undefined;
  }

  private load(): StoreData {
    if (!existsSync(STORE_FILE)) {
      return { sessions: {} };
    }
    try {
      const raw = readFileSync(STORE_FILE, "utf-8");
      return JSON.parse(raw);
    } catch {
      return { sessions: {} };
    }
  }

  private persist(): void {
    if (!existsSync(STORE_DIR)) {
      mkdirSync(STORE_DIR, { recursive: true });
    }
    writeFileSync(STORE_FILE, JSON.stringify(this.data, null, 2), "utf-8");
  }
}
