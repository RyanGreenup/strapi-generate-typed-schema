/* Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/routes/session/sidebar.tsx#L12-L99, MIT licensed).
 * Kept: the backgroundPanel surface with the 1/2 padding frame, the
 * overlay absolute/relative position switch, the flexGrow scrollbox body
 * with borderActive-on-background scrollbar track colors and shared
 * scroll acceleration, and the pinned flexShrink footer box.
 * Dropped: plugin runtime Slots, useProject/useSync session derivation,
 * InstallationVersion branding, and useTuiConfig (scroll speed is the
 * shared util default).
 * Added: title (string gets the upstream bold treatment, JSX passes
 * through), width (default 42), children, and footer props so content is
 * the caller's business.
 * Needs only ThemeProvider; no keymap or dialog wiring.
 */
import type { JSX } from "solid-js";

import { TextAttributes } from "@opentui/core";
import { Show } from "solid-js";

import { useTheme } from "../context/theme";
import { getScrollAcceleration } from "../util/scroll";

export interface SidebarProps {
  readonly title?: JSX.Element | string;
  readonly overlay?: boolean;
  readonly width?: number;
  readonly children?: JSX.Element;
  readonly footer?: JSX.Element;
}

/** Shows a full-height panel with scrollable content and a fixed optional footer. */
export function Sidebar(props: SidebarProps) {
  const { theme } = useTheme();

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      width={props.width ?? 42}
      height="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      position={props.overlay ? "absolute" : "relative"}
    >
      <scrollbox
        flexGrow={1}
        scrollAcceleration={getScrollAcceleration()}
        verticalScrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.background,
            foregroundColor: theme.borderActive,
          },
        }}
      >
        <box flexShrink={0} gap={1} paddingRight={1}>
          <Show when={props.title !== undefined}>
            <box paddingRight={1}>
              <Show when={typeof props.title === "string"} fallback={props.title}>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  {props.title}
                </text>
              </Show>
            </box>
          </Show>
          {props.children}
        </box>
      </scrollbox>

      <Show when={props.footer}>
        <box flexShrink={0} gap={1} paddingTop={1}>
          {props.footer}
        </box>
      </Show>
    </box>
  );
}
