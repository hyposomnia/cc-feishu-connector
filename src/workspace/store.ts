import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const STORE_DIR = join(homedir(), ".cc-feishu");
const STORE_PATH = join(STORE_DIR, "workspaces.json");

export class WorkspaceStore {
  private aliases: Record<string, string> = {};

  constructor() { this.load(); }

  add(alias: string, absolutePath: string): void {
    this.aliases[alias] = absolutePath;
    this.persist();
  }

  delete(alias: string): boolean {
    if (!(alias in this.aliases)) return false;
    delete this.aliases[alias];
    this.persist();
    return true;
  }

  list(): Array<{ alias: string; path: string }> {
    return Object.entries(this.aliases).map(([alias, path]) => ({ alias, path }));
  }

  resolve(aliasOrPath: string): string {
    return this.aliases[aliasOrPath] ?? aliasOrPath;
  }

  private load(): void {
    if (!existsSync(STORE_PATH)) return;
    try {
      const data = JSON.parse(readFileSync(STORE_PATH, "utf-8"));
      this.aliases = data.aliases ?? {};
    } catch { this.aliases = {}; }
  }

  private persist(): void {
    mkdirSync(STORE_DIR, { recursive: true });
    writeFileSync(STORE_PATH, JSON.stringify({ aliases: this.aliases }, null, 2));
  }
}
