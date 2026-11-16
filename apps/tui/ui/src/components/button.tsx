/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode, MIT
 * licensed). Button merges the two upstream button patterns: the canonical
 * solid action from ui/dialog-alert.tsx#L42-L54 (paddingLeft/Right 3,
 * theme.primary background, theme.selectedListItemText label, onMouseUp
 * fires) and the roving-selection button row from
 * component/error-component.tsx#L139-L157 (bg cycles element -> primary
 * with an `active` prop, bold label, minWidth, key-hint caption below,
 * onMouseDown focuses before onMouseUp activates). When `active` is
 * undefined the button is a standalone solid action; when boolean, the
 * parent owns the roving selection (see ErrorState in empty-state.tsx).
 * IconButton is the ghost glyph button from
 * component/plugin-route-missing.tsx#L9-L11 (backgroundElement surface,
 * padding 1). LinkButton puts the button surface around the OSC 8 <a>
 * intrinsic like src/components/link.tsx, with an optional onOpen callback
 * in place of upstream's `open` package (not installed here). Dropped:
 * dialog-alert's useDialog/useBindings (onPress prop plus example-level
 * key handling instead) and its DialogContext-coupled .show helper.
 */
import type { RGBA } from "@opentui/core";

import { TextAttributes } from "@opentui/core";
import { Show } from "solid-js";

import { useTheme } from "../context/theme";

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly active?: boolean;
  readonly onFocus?: () => void;
  readonly minWidth?: number;
  readonly hint?: string;
  readonly color?: RGBA;
}

/** Fires on mouse release, with parent-controlled selection when `active` is present. */
export function Button(props: ButtonProps) {
  const { theme } = useTheme();
  const roving = () => props.active !== undefined;
  const solid = () => props.active !== false;
  const bg = () => (solid() ? (props.color ?? theme.primary) : theme.backgroundElement);
  const fg = () => (solid() ? theme.selectedListItemText : theme.text);

  return (
    <box flexDirection="column" alignItems="center" flexShrink={0}>
      <box
        onMouseDown={() => props.onFocus?.()}
        onMouseUp={() => props.onPress()}
        backgroundColor={bg()}
        minWidth={props.minWidth}
        alignItems="center"
        paddingLeft={roving() ? 2 : 3}
        paddingRight={roving() ? 2 : 3}
      >
        <text attributes={roving() ? TextAttributes.BOLD : undefined} fg={fg()}>
          {props.label}
        </text>
      </box>
      <Show when={props.hint}>
        <text fg={props.active === true ? theme.primary : theme.textMuted}>{props.hint}</text>
      </Show>
    </box>
  );
}

export interface IconButtonProps {
  readonly glyph: string;
  readonly onPress: () => void;
  readonly color?: RGBA;
}

/** Shows a padded glyph action that fires on mouse release. */
export function IconButton(props: IconButtonProps) {
  const { theme } = useTheme();

  return (
    <box
      onMouseUp={() => props.onPress()}
      backgroundColor={theme.backgroundElement}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={props.color ?? theme.text}>{props.glyph}</text>
    </box>
  );
}

export interface LinkButtonProps {
  readonly href: string;
  readonly label?: string;
  readonly onOpen?: (href: string) => void;
}

/** Shows a terminal hyperlink on a button surface and calls `onOpen` on mouse release. */
export function LinkButton(props: LinkButtonProps) {
  const { theme } = useTheme();

  return (
    <box
      onMouseUp={() => props.onOpen?.(props.href)}
      backgroundColor={theme.backgroundElement}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={theme.primary}>
        <a href={props.href}>{props.label ?? props.href}</a>
      </text>
    </box>
  );
}
