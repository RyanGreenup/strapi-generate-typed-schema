/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/component/dialog-status.tsx L10-L130 row conventions,
 * MIT licensed). Kept: the colored status bullet (status-to-token map),
 * bold row name plus muted detail span, and section headers. Changed:
 * data becomes a sections: { title, rows: { status, name, detail? }[] }[]
 * prop; the section header shows the title with a muted row count.
 * Dropped: useSync data sources (mcp/lsp/formatter/plugin parsing), the
 * useDialog esc header, and bun's fileURLToPath. Note: a real column-grid
 * variant is deferred to the Phase 6 text-table wrapper
 * (src/components/text-table.tsx); the example composes it alongside.
 * Needs only ThemeProvider.
 */
import { TextAttributes } from "@opentui/core";
import { For, Show } from "solid-js";

import { useTheme } from "../context/theme";

export type DataTableStatus = "success" | "error" | "warning" | "muted";

export interface DataTableRow {
  readonly status: DataTableStatus;
  readonly name: string;
  readonly detail?: string;
}

export interface DataTableSection {
  readonly title: string;
  readonly rows: readonly DataTableRow[];
}

export interface DataTableProps {
  readonly sections: readonly DataTableSection[];
}

// Round bullet glyph (U+2022), built from its codepoint to keep the
// source ASCII-only.
const BULLET = String.fromCharCode(0x2022);

/** Shows section counts and rows with theme-colored status bullets and optional details. */
export function DataTable(props: DataTableProps) {
  const { theme } = useTheme();
  const statusColor = (status: DataTableStatus) =>
    ({
      success: theme.success,
      error: theme.error,
      warning: theme.warning,
      muted: theme.textMuted,
    })[status];

  return (
    <box flexDirection="column" gap={1}>
      <For each={props.sections}>
        {(section) => (
          <box flexDirection="column">
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {section.title}{" "}
              {/* eslint-disable-next-line solid/style-prop -- opentui's style prop takes renderable options (fg/bg), not CSS */}
              <span style={{ fg: theme.textMuted }}>({section.rows.length})</span>
            </text>
            <For each={section.rows}>
              {(row) => (
                <box flexDirection="row" gap={1}>
                  <text flexShrink={0} fg={statusColor(row.status)}>
                    {BULLET}
                  </text>
                  <text fg={theme.text} wrapMode="word">
                    <b>{row.name}</b>
                    <Show when={row.detail}>
                      {" "}
                      {/* eslint-disable-next-line solid/style-prop -- opentui's style prop takes renderable options (fg/bg), not CSS */}
                      <span style={{ fg: theme.textMuted }}>{row.detail}</span>
                    </Show>
                  </text>
                </box>
              )}
            </For>
          </box>
        )}
      </For>
    </box>
  );
}
