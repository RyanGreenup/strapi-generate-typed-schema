import type { RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid";

import { getComponentCatalogue } from "@opentui/solid/components";
import { registerSpinner } from "opentui-spinner/solid";
import { Show } from "solid-js";

import { useTheme } from "../context/theme";

/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/component/spinner.tsx, MIT licensed). The upstream
 * `useKV().get("animations_enabled", true)` read is adapted as the
 * `enabled` prop (same default) per the porting rule: components take
 * settings via props, no dependency on a settings store for a styled component.
 */

if (!getComponentCatalogue().spinner) registerSpinner();

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface SpinnerProps {
  readonly children?: JSX.Element;
  readonly color?: RGBA;
  readonly enabled?: boolean;
}

/** Shows an 80 ms Braille spinner, or a static ellipsis if animation is disabled. */
export function Spinner(props: SpinnerProps) {
  const { theme } = useTheme();
  const color = () => props.color ?? theme.textMuted;
  const enabled = () => props.enabled ?? true;

  return (
    <Show when={enabled()} fallback={<text fg={color()}>⋯{props.children}</text>}>
      <box flexDirection="row" gap={1}>
        <spinner frames={SPINNER_FRAMES} interval={80} color={color()} />
        <Show when={props.children}>
          <text fg={color()}>{props.children}</text>
        </Show>
      </box>
    </Show>
  );
}
