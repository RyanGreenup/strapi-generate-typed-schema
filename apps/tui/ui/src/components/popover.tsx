/* Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/component/prompt/autocomplete.tsx, MIT licensed): the
 * anchored-popup machinery only - position polling (#L107-L144), the
 * height clamp (#L712-L717), and the absolute popup box (#L722-L739).
 * Kept: the positionTick signal bumped by a 50ms setInterval while
 * visible (renderable coordinates are not reactive), the position memo
 * that also tracks useTerminalDimensions, the anchor.y height clamp so
 * the popup never overflows the top edge, and the zIndex 100 SplitBorder
 * box over a theme.backgroundMenu scrollbox.
 * Dropped: the entire completion machinery (options, fuzzysort, frecency,
 * extmarks, mode stack, keymap gather) - children are arbitrary JSX.
 * Changed: content height is measured from the scrollbox scrollHeight
 * inside the same poll (upstream knew its option count up front), and the
 * anchor accessor may return undefined before its ref is set.
 * Added: maxHeight prop (default 10) and the Tooltip convenience wrapper
 * rendering a single muted text line.
 * Needs only ThemeProvider; no keymap or dialog wiring.
 */
import type { Renderable, ScrollBoxRenderable } from "@opentui/core";
import type { JSX } from "solid-js";

import { useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";

import { useTheme } from "../context/theme";
import { SplitBorder } from "./border";

export interface PopoverProps {
  readonly anchor: () => Renderable | undefined;
  readonly visible: boolean;
  readonly children?: JSX.Element;
  readonly maxHeight?: number;
}

/** Shows scrollable content above an anchor and follows its layout while visible. */
export function Popover(props: PopoverProps) {
  const { theme } = useTheme();
  const dimensions = useTerminalDimensions();
  const [positionTick, setPositionTick] = createSignal(0);

  let scroll: ScrollBoxRenderable | undefined;

  // Poll the anchor position and the rendered content height while
  // visible; renderable coordinates are not reactive, so a moved layout
  // is only noticed by comparing x/y/width between ticks.
  createEffect(() => {
    if (!props.visible) return;
    let last = { x: 0, y: 0, width: 0, content: 0 };
    const interval = setInterval(() => {
      const anchor = props.anchor();
      if (!anchor) return;
      const content = scroll?.scrollHeight ?? 0;
      if (
        anchor.x !== last.x ||
        anchor.y !== last.y ||
        anchor.width !== last.width ||
        content !== last.content
      ) {
        last = { x: anchor.x, y: anchor.y, width: anchor.width, content };
        setPositionTick((tick) => tick + 1);
      }
    }, 50);
    onCleanup(() => clearInterval(interval));
  });

  const position = createMemo(() => {
    if (!props.visible) return { x: 0, y: 0, width: 0 };
    dimensions();
    positionTick();
    const anchor = props.anchor();
    if (!anchor) return { x: 0, y: 0, width: 0 };
    const parent = anchor.parent;
    const parentX = parent?.x ?? 0;
    const parentY = parent?.y ?? 0;

    return {
      x: anchor.x - parentX,
      y: anchor.y - parentY,
      width: anchor.width,
    };
  });

  const height = createMemo(() => {
    const max = props.maxHeight ?? 10;
    if (!props.visible) return 1;
    positionTick();
    const content = Math.max(1, scroll?.scrollHeight ?? 1);
    return Math.min(max, content, Math.max(1, props.anchor()?.y ?? 1));
  });

  return (
    <box
      visible={props.visible && props.anchor() !== undefined}
      position="absolute"
      top={position().y - height()}
      left={position().x}
      width={position().width}
      zIndex={100}
      {...SplitBorder}
      borderColor={theme.border}
    >
      <scrollbox
        ref={(r: ScrollBoxRenderable) => (scroll = r)}
        backgroundColor={theme.backgroundMenu}
        height={height()}
        scrollbarOptions={{ visible: false }}
      >
        {props.children}
      </scrollbox>
    </box>
  );
}

export interface TooltipProps {
  readonly anchor: () => Renderable | undefined;
  readonly visible: boolean;
  readonly text: string;
  readonly maxHeight?: number;
}

/** Shows muted text above an anchor, with a one-row height limit by default. */
export function Tooltip(props: TooltipProps) {
  const { theme } = useTheme();
  return (
    <Popover anchor={props.anchor} visible={props.visible} maxHeight={props.maxHeight ?? 1}>
      <box paddingLeft={1} paddingRight={1}>
        <text fg={theme.textMuted}>{props.text}</text>
      </box>
    </Popover>
  );
}
