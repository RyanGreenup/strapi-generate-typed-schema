// Text table exemplar: a fresh wrapper over @opentui/core's
// TextTableRenderable. opencode never instantiates it directly; its only
// table touchpoint is <markdown tableOptions={{ style: "grid" }}>
// (.agents/opencode/packages/tui/src/routes/session/index.tsx#L1690), which
// builds tables through this renderable internally. Unlike code/diff/
// markdown, the Solid catalogue does not register a table intrinsic, so
// this file uses the pulse-box registration recipe
// (src/components/pulse-box.tsx): module augmentation + extend().
// Kept: nothing to port; props mirror MarkdownTableOptions' style switch
// ("grid" draws borders, "columns" is borderless full-width columns).
// Dropped: n/a (net-new wrapper per the checklist).
import type { TextChunk } from "@opentui/core";

import { bold, fg, TextTableRenderable } from "@opentui/core";
import { extend } from "@opentui/solid";
import { createEffect, createMemo } from "solid-js";

import { useTheme } from "../context/theme";

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    text_table: typeof TextTableRenderable;
  }
}

extend({ text_table: TextTableRenderable });

export interface TextTableProps {
  // Plain string cells; the first row is the header (rendered bold).
  readonly rows: readonly (readonly string[])[];
  readonly style?: "grid" | "columns";
  readonly cellPaddingX?: number;
  readonly wrapMode?: "none" | "char" | "word";
}

/** Shows string cells with a bold first row and theme-aware grid or full-width columns. */
export function TextTable(props: TextTableProps) {
  const { theme } = useTheme();
  const content = createMemo<TextChunk[][][]>(() => {
    // theme.* reads are reactive, so chunk colors refresh with the palette.
    return props.rows.map((row, rowIndex) =>
      row.map((cell) => {
        const colored = fg(rowIndex === 0 ? theme.text : theme.textMuted)(cell);
        return [rowIndex === 0 ? bold(colored) : colored];
      }),
    );
  });
  // The Solid reconciler coerces a JSX `content` prop to a string (it is
  // the text-node prop), which would corrupt TextTableContent, so the cell
  // chunks are assigned imperatively through the ref instead.
  let table: TextTableRenderable | undefined;
  createEffect(() => {
    if (table) table.content = content();
  });
  return (
    <text_table
      ref={(el: TextTableRenderable) => {
        table = el;
        el.content = content();
      }}
      showBorders={(props.style ?? "grid") === "grid"}
      columnWidthMode={(props.style ?? "grid") === "grid" ? "content" : "full"}
      cellPaddingX={props.cellPaddingX ?? 1}
      wrapMode={props.wrapMode ?? "word"}
      borderColor={theme.border}
      fg={theme.text}
    />
  );
}
