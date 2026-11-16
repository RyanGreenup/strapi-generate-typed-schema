import type { JSX } from "@opentui/solid";

import { TextAttributes } from "@opentui/core";
import { Show } from "solid-js";

import { useTheme } from "../context/theme";

/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/ui/dialog-prompt.tsx L75-L112 layout plus the explicit
 * label variant of ui/dialog-export-options.tsx L94-L98, MIT licensed).
 * Kept: the header row (bold label, space-between, clickable muted "esc"),
 * the gap box grouping description + control, and the muted footer hint
 * row. Changed: the esc affordance renders only when `onDismiss` is
 * provided; an `error` row (net-new, theme.error) is added below the
 * control. Dropped: useDialog/dialog.clear, the DialogPrompt.show promise
 * wrapper, and all key bindings - FormField is pure layout around any
 * control passed as children.
 */

export interface FormFieldProps {
  readonly label: string;
  readonly description?: string | (() => JSX.Element);
  readonly error?: string;
  readonly hint?: JSX.Element | string;
  readonly onDismiss?: () => void;
  readonly children?: JSX.Element;
}

/** Wraps a control with label, description, error, and hint content without keyboard handlers. */
export function FormField(props: FormFieldProps) {
  const { theme } = useTheme();

  return (
    <box gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.label}
        </text>
        <Show when={props.onDismiss}>
          <text fg={theme.textMuted} onMouseUp={() => props.onDismiss?.()}>
            esc
          </text>
        </Show>
      </box>
      <box gap={1}>
        <Show when={props.description}>
          {typeof props.description === "function" ? (
            props.description()
          ) : (
            <text fg={theme.textMuted}>{props.description}</text>
          )}
        </Show>
        {props.children}
      </box>
      <Show when={props.error}>
        <text fg={theme.error}>{props.error}</text>
      </Show>
      <Show when={props.hint}>
        <box flexDirection="row" gap={1}>
          {typeof props.hint === "string" ? (
            <text fg={theme.textMuted}>{props.hint}</text>
          ) : (
            props.hint
          )}
        </box>
      </Show>
    </box>
  );
}
