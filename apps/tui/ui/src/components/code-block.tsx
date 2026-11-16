// Code block exemplar, adapted from opencode's <code> intrinsic usages:
// the Reasoning body (.agents/opencode/packages/tui/src/routes/session/
// index.tsx#L1619-L1627) and the Write tool view (#L2110-L2116). The
// intrinsic is CodeRenderable from @opentui/core, already registered by
// @opentui/solid.
// Kept: filetype-driven tree-sitter highlighting, syntaxStyle from the
// theme context, conceal/streaming/drawUnstyledText passthroughs.
// Dropped: ReasoningPart SDK type and thinking-mode plumbing, the session
// context conceal() signal, and ToolProps input state; content and filetype
// are plain props (pair with src/util/filetype.ts to derive the filetype
// from a path).
import type { RGBA } from "@opentui/core";

import { useTheme } from "../context/theme";

export interface CodeBlockProps {
  readonly content: string;
  // Parser filetype, e.g. "typescript" or "markdown". The bundled parsers
  // cover markdown/typescript/zig; register more via
  // src/util/parsers.ts#registerExtraParsers.
  readonly filetype?: string;
  readonly conceal?: boolean;
  readonly streaming?: boolean;
  // When false, nothing is drawn until highlights arrive (avoids an
  // unstyled flash); opencode uses that for reasoning summaries.
  readonly drawUnstyledText?: boolean;
  readonly fg?: RGBA;
}

/** Highlights source with the active theme and the Markdown parser by default. */
export function CodeBlock(props: CodeBlockProps) {
  const { theme, syntax } = useTheme();
  return (
    <code
      content={props.content}
      filetype={props.filetype ?? "markdown"}
      syntaxStyle={syntax()}
      conceal={props.conceal ?? false}
      streaming={props.streaming ?? false}
      drawUnstyledText={props.drawUnstyledText ?? true}
      fg={props.fg ?? theme.text}
    />
  );
}
