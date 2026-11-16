// Diff viewer exemplar, adapted from opencode's Edit tool view
// (.agents/opencode/packages/tui/src/routes/session/index.tsx#L2388, the
// <diff> intrinsic at #L2409-L2427) and the permission-dialog variant
// (routes/session/permission.tsx#L22 EditBody). The intrinsic is
// DiffRenderable from @opentui/core, already registered by @opentui/solid.
// Kept: the full diff token prop set (added/removed/context backgrounds,
// sign colors, line number colors), syntax highlighting by filetype, and
// the auto view switch (split when the terminal is wider than 120 cells,
// ported from the memo at index.tsx#L2393-L2398).
// Dropped: props.metadata.diff tool state (diff is a plain string prop),
// the ctx.tui.diff_style config and ctx.diffWrapMode() session signals
// (view/wrapMode props), and the PermissionRequest/SDK/useSync coupling.
import { useTerminalDimensions } from "@opentui/solid";
import { createMemo } from "solid-js";

import { useTheme } from "../context/theme";

export interface DiffViewerProps {
  // Unified diff text (---/+++/@@ hunks).
  readonly diff: string;
  readonly filetype?: string;
  readonly view?: "unified" | "split" | "auto";
  readonly wrapMode?: "word" | "char" | "none";
  readonly showLineNumbers?: boolean;
}

const SPLIT_MIN_WIDTH = 120;

/** Shows a themed diff. Automatic layout splits only when terminal width exceeds 120 cells. */
export function DiffViewer(props: DiffViewerProps) {
  const { theme, syntax } = useTheme();
  const dimensions = useTerminalDimensions();
  const view = createMemo(() => {
    const requested = props.view ?? "auto";
    if (requested !== "auto") return requested;
    return dimensions().width > SPLIT_MIN_WIDTH ? "split" : "unified";
  });
  return (
    <diff
      diff={props.diff}
      view={view()}
      filetype={props.filetype}
      syntaxStyle={syntax()}
      showLineNumbers={props.showLineNumbers ?? true}
      width="100%"
      wrapMode={props.wrapMode ?? "word"}
      fg={theme.text}
      addedBg={theme.diffAddedBg}
      removedBg={theme.diffRemovedBg}
      contextBg={theme.diffContextBg}
      addedSignColor={theme.diffHighlightAdded}
      removedSignColor={theme.diffHighlightRemoved}
      lineNumberFg={theme.diffLineNumber}
      lineNumberBg={theme.diffContextBg}
      addedLineNumberBg={theme.diffAddedLineNumberBg}
      removedLineNumberBg={theme.diffRemovedLineNumberBg}
    />
  );
}
