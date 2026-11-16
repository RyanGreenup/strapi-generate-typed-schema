/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/component/startup-loading.tsx, MIT licensed).
 * LoadingIndicator keeps upstream's loading conventions: the 500ms appear
 * delay (no flash for fast operations), the 3000ms minimum display hold
 * once shown, the absolute bottom-center overlay at zIndex 5000 with a
 * backgroundPanel pill, and the Spinner + phase text. Changed: the
 * `ready: () => boolean` prop becomes `done?: boolean`; the delay and hold
 * are `appearDelay`/`minVisible` props with the upstream defaults; the
 * label is a `label` prop instead of the hardcoded startup copy; timers
 * drop the Bun/Node `.unref()` and NodeJS.Timeout type. Progress is
 * net-new (upstream has no determinate bar, CHECKLIST.md Phase 5 note): a
 * filled box over a backgroundElement track using theme colors, keeping to
 * box widths only.
 */
import type { RGBA } from "@opentui/core";

import { createEffect, createSignal, onCleanup, Show } from "solid-js";

import { useTheme } from "../context/theme";
import { Spinner } from "./spinner";

export interface LoadingIndicatorProps {
  readonly done?: boolean;
  readonly label?: string;
  readonly appearDelay?: number;
  readonly minVisible?: number;
  readonly animations?: boolean;
}

/** Delays appearance by 500 ms and stays visible for at least 3000 ms by default. */
export function LoadingIndicator(props: LoadingIndicatorProps) {
  const { theme } = useTheme();
  const [show, setShow] = createSignal(false);
  const appearDelay = () => props.appearDelay ?? 500;
  const minVisible = () => props.minVisible ?? 3000;
  let wait: ReturnType<typeof setTimeout> | undefined;
  let hold: ReturnType<typeof setTimeout> | undefined;
  let stamp = 0;

  createEffect(() => {
    if (props.done === true) {
      if (wait) {
        clearTimeout(wait);
        wait = undefined;
      }
      if (!show()) return;
      if (hold) return;

      const left = minVisible() - (Date.now() - stamp);
      if (left <= 0) {
        setShow(false);
        return;
      }

      hold = setTimeout(() => {
        hold = undefined;
        setShow(false);
      }, left);
      return;
    }

    if (hold) {
      clearTimeout(hold);
      hold = undefined;
    }
    if (show()) return;
    if (wait) return;

    wait = setTimeout(() => {
      wait = undefined;
      stamp = Date.now();
      setShow(true);
    }, appearDelay());
  });

  onCleanup(() => {
    if (wait) clearTimeout(wait);
    if (hold) clearTimeout(hold);
  });

  return (
    <Show when={show()}>
      <box
        position="absolute"
        zIndex={5000}
        left={0}
        right={0}
        bottom={1}
        justifyContent="center"
        alignItems="center"
      >
        <box backgroundColor={theme.backgroundPanel} paddingLeft={1} paddingRight={1}>
          <Spinner color={theme.textMuted} enabled={props.animations}>
            {props.label ?? "Loading..."}
          </Spinner>
        </box>
      </box>
    </Show>
  );
}

export interface ProgressProps {
  readonly value: number;
  readonly max?: number;
  readonly width?: number;
  readonly color?: RGBA;
  readonly trackColor?: RGBA;
}

/** Draws a one-row progress bar with a clamped ratio and an empty state for nonpositive maxima. */
export function Progress(props: ProgressProps) {
  const { theme } = useTheme();
  const width = () => props.width ?? 40;
  const max = () => props.max ?? 100;
  const ratio = () => {
    if (max() <= 0) return 0;
    return Math.min(1, Math.max(0, props.value / max()));
  };
  const filled = () => Math.round(ratio() * width());

  return (
    <box
      flexDirection="row"
      width={width()}
      height={1}
      backgroundColor={props.trackColor ?? theme.backgroundElement}
    >
      <box width={filled()} height={1} backgroundColor={props.color ?? theme.primary} />
    </box>
  );
}
