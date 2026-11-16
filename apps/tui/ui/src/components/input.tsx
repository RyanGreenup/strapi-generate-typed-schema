import type { InputRenderable, RGBA } from "@opentui/core";

import { useTheme } from "../context/theme";

/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/ui/dialog-select.tsx L570-L596, MIT licensed) - the
 * filter <input> block extracted as a standalone single-line input. Kept:
 * theme colors (focusedBackgroundColor, cursorColor, focusedTextColor,
 * placeholderColor), the deferred 1ms autofocus guarded by isDestroyed, and
 * the managed-input trait tagging (upstream `traits = { status: "FILTER" }`,
 * here the optional `status` prop). Changed: the store/batch/onFilter
 * plumbing becomes plain onInput/onSubmit callbacks and the `locked` gate
 * becomes `disabled`; optional textColor/focusedTextColor overrides are
 * added so PasswordInput can conceal glyphs. Dropped: everything else in
 * DialogSelect (fuzzysort, remeda, keymap command registry).
 */

export interface InputProps {
  readonly value?: string;
  readonly placeholder?: string;
  readonly autofocus?: boolean;
  readonly disabled?: boolean;
  readonly status?: string;
  readonly textColor?: RGBA;
  readonly focusedTextColor?: RGBA;
  readonly onInput?: (value: string) => void;
  readonly onSubmit?: (value: string) => void;
  readonly ref?: (renderable: InputRenderable) => void;
}

/** Shows a themed single-line input that focuses after mount unless `autofocus` is false. */
export function Input(props: InputProps) {
  const { theme } = useTheme();
  let input: InputRenderable | undefined;

  return (
    <input
      value={props.value}
      onInput={(value: string) => {
        if (props.disabled) return;
        props.onInput?.(value);
      }}
      onSubmit={(value) => {
        if (typeof value !== "string") return;
        if (props.disabled) return;
        props.onSubmit?.(value);
      }}
      focusedBackgroundColor={theme.backgroundPanel}
      cursorColor={theme.primary}
      textColor={props.textColor}
      focusedTextColor={props.focusedTextColor ?? theme.textMuted}
      placeholder={props.placeholder ?? "Enter text"}
      placeholderColor={theme.textMuted}
      ref={(renderable: InputRenderable) => {
        input = renderable;
        if (props.status !== undefined && props.status !== "")
          renderable.traits = { status: props.status };
        props.ref?.(renderable);
        if (props.autofocus === false) return;
        setTimeout(() => {
          if (!input || input.isDestroyed) return;
          input.focus();
        }, 1);
      }}
    />
  );
}
