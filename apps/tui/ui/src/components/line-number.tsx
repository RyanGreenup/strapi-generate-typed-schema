// Line number gutter exemplar, adapted from opencode's Write tool view
// (.agents/opencode/packages/tui/src/routes/session/index.tsx#L2109-L2117):
// a <line_number> intrinsic (LineNumberRenderable from @opentui/core)
// wrapping a <code> child whose lines it numbers.
// Kept: the gutter defaults (textMuted fg, minWidth 3, paddingRight 1) and
// the nested code renderer, reused from src/components/code-block.tsx.
// Dropped: ToolProps input plumbing (props.input.filePath/content),
// Diagnostics, the BlockTool panel chrome, and usePathFormatter titles;
// content and filetype are plain props.
import type { RGBA } from "@opentui/core";

import { useTheme } from "../context/theme";
import { CodeBlock } from "./code-block";

export interface NumberedCodeProps {
  readonly content: string;
  readonly filetype?: string;
  // Gutter passthroughs.
  readonly minWidth?: number;
  readonly paddingRight?: number;
  readonly fg?: RGBA;
  // 1-based number shown for the first line (useful for excerpts).
  readonly startLine?: number;
}

/** Adds a themed gutter to highlighted source, with one-based excerpt line numbers. */
export function NumberedCode(props: NumberedCodeProps) {
  const { theme } = useTheme();
  return (
    <line_number
      fg={props.fg ?? theme.textMuted}
      minWidth={props.minWidth ?? 3}
      paddingRight={props.paddingRight ?? 1}
      lineNumberOffset={(props.startLine ?? 1) - 1}
    >
      <CodeBlock content={props.content} filetype={props.filetype} />
    </line_number>
  );
}
