/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/routes/session/footer.tsx L9-L89, MIT licensed). Kept:
 * the space-between row (gap 1, flexShrink 0), muted left text, and the
 * right-hand gap-2 group of colored-icon status items rendered as
 * <text><span fg>{icon} </span>{label}</text>. Changed: content becomes
 * props: left string plus items { icon, color?, label }[] (icon color
 * defaults to theme.textMuted). Dropped: useSync mcp/lsp/permission memos,
 * useDirectory, useConnected, useRoute, and the welcome-cycling timer.
 * Needs only ThemeProvider.
 */
import type { RGBA } from "@opentui/core";

import { For } from "solid-js";

import { useTheme } from "../context/theme";

export interface StatusBarItem {
  readonly icon: string;
  readonly color?: RGBA;
  readonly label: string;
}

export interface StatusBarProps {
  readonly left: string;
  readonly items: readonly StatusBarItem[];
}

/** Places muted status text on the left and icon-label items on the right. */
export function StatusBar(props: StatusBarProps) {
  const { theme } = useTheme();

  return (
    <box flexDirection="row" justifyContent="space-between" gap={1} flexShrink={0}>
      <text fg={theme.textMuted}>{props.left}</text>
      <box gap={2} flexDirection="row" flexShrink={0}>
        <For each={props.items}>
          {(item) => (
            <text fg={theme.text}>
              {/* eslint-disable-next-line solid/style-prop -- opentui's style prop takes renderable options (fg/bg), not CSS */}
              <span style={{ fg: item.color ?? theme.textMuted }}>{item.icon} </span>
              {item.label}
            </text>
          )}
        </For>
      </box>
    </box>
  );
}
