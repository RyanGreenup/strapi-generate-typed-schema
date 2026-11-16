/* Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/feature-plugins/system/diff-viewer-file-tree.tsx, MIT
 * licensed), on top of the pure helpers ported to src/util/file-tree.ts.
 * Kept: buildFileTree/flattenFileTree memos, the branch/disclosure prefix
 * rendering (glyphs as unicode escapes), the tint(text, background, 0.75)
 * faded branch color, primary-background highlight when focused, row
 * mouse clicks, the Panel border="both" wrapper (./split-pane), and
 * scrollFileTreeRowIntoView with its immediate call plus
 * requestAnimationFrame re-run after layout settles.
 * Dropped: the injected DiffViewerFileTreeTheme bag (useTheme instead),
 * loading/error props, selectedFileIndex, reviewedFileNames, and the
 * M/A/D fileTreeRowStatus column.
 * Added: rowSuffix?: (row) => string generalizing the status column; the
 * name truncation subtracts the actual suffix length per row.
 * Needs only ThemeProvider; keys are the caller's business (see the
 * example wiring the util selection movers).
 */
import type { ScrollBoxRenderable } from "@opentui/core";

import type { FileTreeItem, FileTreeRow } from "../util/file-tree";

import { createEffect, createMemo, For, Show } from "solid-js";

import { useTheme } from "../context/theme";
import { tint } from "../theme";
import { buildFileTree, flattenFileTree } from "../util/file-tree";
import { truncate } from "../util/locale";
import { Panel } from "./split-pane";

export interface TreeViewProps {
  readonly items: readonly FileTreeItem[];
  readonly expanded?: ReadonlySet<number>;
  readonly highlighted?: number;
  readonly focused?: boolean;
  readonly width?: number;
  readonly onRowClick?: (row: FileTreeRow) => void;
  readonly rowSuffix?: (row: FileTreeRow) => string;
}

/** Shows file paths as expandable rows and keeps the highlighted row in view. */
export function TreeView(props: TreeViewProps) {
  const { theme } = useTheme();
  const tree = createMemo(() => buildFileTree(props.items));
  const rows = createMemo(() => flattenFileTree(tree(), props.expanded));
  const selectedIndex = createMemo(() => rows().findIndex((row) => row.id === props.highlighted));
  const width = () => props.width ?? 32;
  let scroll: ScrollBoxRenderable | undefined;

  const scrollSelectedIntoView = () => {
    const index = selectedIndex();
    if (index !== -1) scrollFileTreeRowIntoView(scroll, index);
  };

  createEffect(() => {
    // Row changes can require another layout pass even if the selected index stays the same.
    rows();
    if (selectedIndex() === -1) return;
    scrollSelectedIntoView();
    requestAnimationFrame(scrollSelectedIntoView);
  });

  const fadedColor = () => tint(theme.text, theme.background, 0.75);

  return (
    <Panel border="both" width={width()}>
      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        verticalScrollbarOptions={{ visible: false }}
        horizontalScrollbarOptions={{ visible: false }}
      >
        <Show when={props.items.length > 0} fallback={<text fg={theme.text}>No files</text>}>
          <For each={rows()}>
            {(row, index) => {
              const highlighted = () => props.focused && props.highlighted === row.id;
              const prefix = () => fileTreeRowPrefix(rows(), index(), row, props.expanded);
              const suffix = () => props.rowSuffix?.(row) ?? "";
              const name = () =>
                truncate(row.name, Math.max(1, width() - suffix().length - prefix().length));
              const nameColor = () => {
                if (highlighted()) return theme.background;
                if (row.kind === "directory") return theme.textMuted;
                return theme.text;
              };
              return (
                <box
                  flexDirection="row"
                  width="100%"
                  backgroundColor={highlighted() ? theme.primary : undefined}
                  onMouseUp={() => props.onRowClick?.(row)}
                >
                  <text
                    fg={highlighted() ? theme.background : fadedColor()}
                    wrapMode="none"
                    flexShrink={0}
                  >
                    {prefix()}
                  </text>
                  <box flexGrow={1} minWidth={0}>
                    <text fg={nameColor()} wrapMode="none">
                      {name()}
                    </text>
                  </box>
                  <Show when={suffix() !== ""}>
                    <text
                      fg={highlighted() ? theme.background : theme.textMuted}
                      wrapMode="none"
                      flexShrink={0}
                    >
                      {suffix()}
                    </text>
                  </Show>
                </box>
              );
            }}
          </For>
        </Show>
      </scrollbox>
    </Panel>
  );
}

function scrollFileTreeRowIntoView(scroll: ScrollBoxRenderable | undefined, index: number) {
  if (!scroll) return;
  if (index < scroll.scrollTop) {
    scroll.scrollTo(index);
    return;
  }
  if (index >= scroll.scrollTop + scroll.viewport.height) {
    scroll.scrollTo(index - scroll.viewport.height + 1);
  }
}

function fileTreeRowPrefix(
  rows: readonly FileTreeRow[],
  index: number,
  row: FileTreeRow,
  expanded: ReadonlySet<number> | undefined,
) {
  const indentation = Array.from({ length: row.depth }, (_, depth) => {
    if (depth === 0 && !hasLaterSibling(rows, 0, 0)) return " ";
    return hasLaterSibling(rows, index, depth) ? "\u2502  " : "   ";
  }).join("");
  const topRoot = index === 0 && row.depth === 0;
  const branch = topRoot ? " " : branchGlyph(rows, index, row);
  const marker = row.kind === "directory" ? markerGlyph(row, expanded) : "";

  return `${indentation}${branch}${marker}`;
}

function branchGlyph(rows: readonly FileTreeRow[], index: number, row: FileTreeRow) {
  if (hasLaterSibling(rows, index, row.depth)) return "\u251C\u2500 ";
  return "\u2514\u2500 ";
}

function markerGlyph(row: FileTreeRow, expanded: ReadonlySet<number> | undefined) {
  if (expanded && !expanded.has(row.id)) return "\u25B8 ";
  return "\u25BE ";
}

function hasLaterSibling(rows: readonly FileTreeRow[], index: number, depth: number) {
  return rows.slice(index + 1).find((row) => row.depth <= depth)?.depth === depth;
}
