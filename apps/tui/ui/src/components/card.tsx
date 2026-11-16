/*
 * Original component -- opencode has no standalone card or panel; the
 * source-of-truth styling is the dialog's inner panel
 * (.agents/opencode/packages/tui/src/ui/dialog.tsx#L60: backgroundPanel
 * surface plus padding) and the toast's SplitBorder accent rails
 * (ui/toast.tsx, ported at src/components/border.ts). One component covers
 * the checklist's "Card / Panel". Needs only ThemeProvider; no keymap or
 * dialog wiring.
 */
import type { RGBA } from "@opentui/core";
import type { JSX } from "solid-js";

import { TextAttributes } from "@opentui/core";
import { Show } from "solid-js";

import { useTheme } from "../context/theme";
import { SplitBorder } from "./border";

export interface CardProps {
  readonly title?: string;
  readonly split?: boolean;
  readonly borderColor?: RGBA;
  readonly background?: RGBA;
  readonly padding?: number;
  readonly children?: JSX.Element;
}

/** Groups content on a panel surface with an optional title and vertical split borders. */
export function Card(props: CardProps) {
  const { theme } = useTheme();

  return (
    <box
      backgroundColor={props.background ?? theme.backgroundPanel}
      padding={props.padding ?? 1}
      border={props.split ? SplitBorder.border : undefined}
      customBorderChars={props.split ? SplitBorder.customBorderChars : undefined}
      borderColor={props.borderColor ?? theme.border}
      flexDirection="column"
      gap={1}
    >
      <Show when={props.title}>
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
      </Show>
      {props.children}
    </box>
  );
}
