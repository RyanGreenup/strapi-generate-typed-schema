import type { TextareaOptions, TextareaRenderable } from "@opentui/core";

import { createEffect, Show } from "solid-js";

import { useTheme } from "../context/theme";
import { Spinner } from "./spinner";

/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/ui/dialog-prompt.tsx L20-L115, MIT licensed) - the
 * textarea half of DialogPrompt as a standalone multi-line input. Kept: the
 * deferred 1ms autofocus + gotoLineEnd on mount, the busy effect (traits
 * suspend/BUSY, blur while busy, muted text and hidden cursor colors), and
 * the Spinner busy indicator (via the `animations` prop seam from our
 * spinner port). Changed: submit uses the intrinsic onSubmit prop
 * (precedent: ui/dialog-export-options.tsx L99) instead of the
 * useBindings/useCommandShortcut/keybinds.gather command plumbing (with the
 * core default bindings plain enter inserts a newline and alt+enter fires
 * submit; pass `keyBindings` to change that). Dropped:
 * useDialog/dialog.setSize, useTuiConfig, and the DialogPrompt field chrome
 * (title row, hints) which moves to the FormField exemplar.
 */

export interface TextareaProps {
  readonly value?: string;
  readonly placeholder?: string;
  readonly height?: number;
  readonly busy?: boolean;
  readonly busyText?: string;
  readonly animations?: boolean;
  readonly autofocus?: boolean;
  readonly keyBindings?: NonNullable<TextareaOptions["keyBindings"]>;
  readonly onSubmit?: (value: string) => void;
  readonly ref?: (renderable: TextareaRenderable) => void;
}

/** Shows a multiline buffer initialized from `value`, with focus and submission suspended while busy. */
export function Textarea(props: TextareaProps) {
  const { theme } = useTheme();
  let textarea: TextareaRenderable | undefined;

  createEffect(() => {
    if (!textarea || textarea.isDestroyed) return;
    textarea.traits = props.busy ? { suspend: true, status: "BUSY" } : {};
    if (props.busy) {
      textarea.blur();
      return;
    }
    if (props.autofocus !== false) textarea.focus();
  });

  return (
    <box gap={1}>
      <textarea
        height={props.height ?? 3}
        keyBindings={props.keyBindings}
        ref={(renderable: TextareaRenderable) => {
          textarea = renderable;
          props.ref?.(renderable);
          setTimeout(() => {
            if (!textarea || textarea.isDestroyed) return;
            if (props.busy || props.autofocus === false) return;
            textarea.focus();
          }, 1);
          renderable.gotoLineEnd();
        }}
        onSubmit={() => {
          if (props.busy || !textarea) return;
          props.onSubmit?.(textarea.plainText);
        }}
        initialValue={props.value}
        placeholder={props.placeholder ?? "Enter text"}
        placeholderColor={theme.textMuted}
        textColor={props.busy ? theme.textMuted : theme.text}
        focusedTextColor={props.busy ? theme.textMuted : theme.text}
        cursorColor={props.busy ? theme.backgroundElement : theme.text}
      />
      <Show when={props.busy}>
        <Spinner color={theme.textMuted} enabled={props.animations}>
          {props.busyText ?? "Working..."}
        </Spinner>
      </Show>
    </box>
  );
}
