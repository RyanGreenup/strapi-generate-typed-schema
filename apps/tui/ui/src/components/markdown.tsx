// Markdown renderer exemplar, adapted from opencode's TextPart
// (.agents/opencode/packages/tui/src/routes/session/index.tsx#L1679, the
// <markdown> intrinsic at #L1685-L1694). The intrinsic is MarkdownRenderable
// from @opentui/core, already registered by @opentui/solid.
// Kept: syntaxStyle from the theme context, streaming support,
// internalBlockMode="top-level", tableOptions, conceal, markdownText and
// background tokens.
// Dropped: the TextPart/AssistantMessage SDK types (content is a plain
// string prop), the session context conceal() signal (a prop now), and the
// alwaysSeparate WeakSet + setPreLayoutSiblingMargin sibling-spacing hook
// (message-feed layout polish, out of scope for a standalone exemplar).
import type { RGBA } from "@opentui/core";

import { useTheme } from "../context/theme";

export interface MarkdownProps {
  readonly content: string;
  // Incremental re-parse while content is still growing (defaults false;
  // opencode streams assistant messages so it passes true).
  readonly streaming?: boolean;
  // Hide markup characters (bold stars, link targets) like a rendered view.
  readonly conceal?: boolean;
  readonly tableStyle?: "grid" | "columns";
  readonly fg?: RGBA;
  readonly bg?: RGBA;
}

/** Renders Markdown with theme syntax colors and visible markup unless `conceal` is true. */
export function Markdown(props: MarkdownProps) {
  const { theme, syntax } = useTheme();
  return (
    <markdown
      syntaxStyle={syntax()}
      streaming={props.streaming ?? false}
      internalBlockMode="top-level"
      content={props.content}
      tableOptions={{ style: props.tableStyle ?? "grid" }}
      conceal={props.conceal ?? false}
      fg={props.fg ?? theme.markdownText}
      bg={props.bg ?? theme.background}
    />
  );
}
