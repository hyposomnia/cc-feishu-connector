/**
 * Render code diffs for Edit tool results.
 */

export interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
}

/** Create a simple unified diff display from old/new strings. */
export function renderDiff(filePath: string, oldStr: string, newStr: string): string {
  const lines: string[] = [];
  lines.push(`**${filePath}**`);
  lines.push("```diff");

  if (oldStr) {
    for (const line of oldStr.split("\n")) {
      lines.push(`- ${line}`);
    }
  }
  if (newStr) {
    for (const line of newStr.split("\n")) {
      lines.push(`+ ${line}`);
    }
  }

  lines.push("```");
  return lines.join("\n");
}

/** Render an Edit tool_use event as diff markdown. */
export function renderEditDiff(input: Record<string, unknown>): string {
  const filePath = String(input.file_path ?? "unknown");
  const oldStr = String(input.old_string ?? "");
  const newStr = String(input.new_string ?? "");

  if (!oldStr && !newStr) {
    return `**${filePath}** — no changes`;
  }

  return renderDiff(filePath, oldStr, newStr);
}

/** Render a Write tool_use as a file creation block. */
export function renderWriteFile(input: Record<string, unknown>): string {
  const filePath = String(input.file_path ?? "unknown");
  const content = String(input.content ?? "");
  const preview = content.length > 500 ? content.slice(0, 500) + "\n..." : content;

  const lines: string[] = [];
  lines.push(`**${filePath}** (new file)`);
  lines.push("```");
  lines.push(preview);
  lines.push("```");
  return lines.join("\n");
}
