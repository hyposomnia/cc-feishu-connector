/**
 * Feishu interactive card JSON builder utilities.
 */

export interface CardConfig {
  update_multi?: boolean;
  enable_forward?: boolean;
  wide_screen_mode?: boolean;
}

export interface CardHeader {
  title: string;
  template?: string;
}

export type CardElement =
  | MarkdownElement
  | DivElement
  | HrElement
  | NoteElement
  | ActionElement
  | ColumnSetElement;

export interface MarkdownElement {
  tag: "markdown";
  content: string;
  text_align?: "left" | "center" | "right";
}

export interface DivElement {
  tag: "div";
  text: { tag: "plain_text" | "lark_md"; content: string };
  fields?: Array<{ is_short: boolean; text: { tag: string; content: string } }>;
}

export interface HrElement {
  tag: "hr";
}

export interface NoteElement {
  tag: "note";
  elements: Array<{ tag: "plain_text" | "lark_md"; content: string }>;
}

export interface ActionElement {
  tag: "action";
  actions: ActionItem[];
  layout?: "bisected" | "trisection" | "flow";
}

export interface ActionItem {
  tag: "button";
  text: { tag: "plain_text"; content: string };
  type: "primary" | "danger" | "default";
  size?: "tiny" | "small" | "medium" | "large";
  value: Record<string, unknown>;
}

export interface ColumnSetElement {
  tag: "column_set";
  flex_mode: "none" | "stretch" | "flow" | "bisect";
  background_style?: "default" | "grey";
  columns: Array<{
    tag: "column";
    width: "weighted" | "auto";
    weight?: number;
    elements: CardElement[];
  }>;
}

export interface Card {
  config?: CardConfig;
  header?: {
    title: { tag: "plain_text"; content: string };
    template?: string;
  };
  elements: CardElement[];
}

/** Create a card with default config for streaming updates. */
export function createCard(header: CardHeader, elements: CardElement[]): Card {
  return {
    config: {
      update_multi: true,
      wide_screen_mode: true,
    },
    header: {
      title: { tag: "plain_text", content: header.title },
      template: header.template ?? "blue",
    },
    elements,
  };
}

/** Markdown element shorthand. */
export function md(content: string): MarkdownElement {
  return { tag: "markdown", content };
}

/** Horizontal rule. */
export function hr(): HrElement {
  return { tag: "hr" };
}

/** Note (footer) element. */
export function note(text: string): NoteElement {
  return {
    tag: "note",
    elements: [{ tag: "plain_text", content: text }],
  };
}

/** Action buttons. */
export function actions(buttons: ActionItem[], layout?: ActionElement["layout"]): ActionElement {
  return { tag: "action", actions: buttons, layout };
}

/** Single button. */
export function button(
  text: string,
  value: Record<string, unknown>,
  type: ActionItem["type"] = "default"
): ActionItem {
  return {
    tag: "button",
    text: { tag: "plain_text", content: text },
    type,
    value,
  };
}
