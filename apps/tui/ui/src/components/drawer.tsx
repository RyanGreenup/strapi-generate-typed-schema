/*
 * Original component -- opencode has no drawer; its only surfaces are the
 * centered dialog and the corner-anchored toast. The design is derived from
 * the dialog shell (.agents/opencode/packages/tui/src/ui/dialog.tsx): same
 * dimmed backdrop (zIndex 3000), mouse-dismiss with the text-selection
 * guard, backgroundPanel surface, "modal" keymap-mode push while open, and
 * escape close binding. Differences from Dialog: the panel is aligned to a
 * terminal edge (spanning it fully) instead of centered, the lifecycle is
 * parent-controlled (render it conditionally and pass onClose) instead of
 * driven by the dialog stack, and there is no focus capture/restore (that
 * machinery stays with the dialog stack). Requires KeymapProvider plus
 * registerAppKeymap above it; DialogProvider is not needed.
 */
import type { JSX } from "solid-js";

import { RGBA, TextAttributes } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { onCleanup, Show } from "solid-js";

import { useTheme } from "../context/theme";
import { useBindings, useModeStack } from "../keymap";

export type DrawerEdge = "left" | "right" | "top" | "bottom";

export interface DrawerProps {
  readonly edge?: DrawerEdge;
  readonly size?: number;
  readonly title?: string;
  readonly onClose: () => void;
  readonly children?: JSX.Element;
}

/** Opens an edge-aligned modal that requests close on Escape or backdrop click. Requires an app mode stack. */
export function Drawer(props: DrawerProps) {
  const dimensions = useTerminalDimensions();
  const { theme } = useTheme();
  const renderer = useRenderer();
  const modeStack = useModeStack();

  onCleanup(modeStack.push("modal"));

  useBindings(() => ({
    enabled: (renderer.getSelection()?.getSelectedText() ?? "") === "",
    bindings: [
      {
        key: "escape",
        desc: "Close drawer",
        group: "Drawer",
        cmd: () => {
          if (renderer.getSelection()) renderer.clearSelection();
          props.onClose();
        },
      },
    ],
  }));

  const edge = () => props.edge ?? "right";
  const horizontal = () => edge() === "left" || edge() === "right";
  const size = () => props.size ?? (horizontal() ? 40 : 12);

  let dismiss = false;
  return (
    <box
      onMouseDown={() => {
        dismiss = !!renderer.getSelection();
      }}
      onMouseUp={() => {
        if (dismiss) {
          dismiss = false;
          return;
        }
        props.onClose();
      }}
      width={dimensions().width}
      height={dimensions().height}
      position="absolute"
      zIndex={3000}
      left={0}
      top={0}
      flexDirection={horizontal() ? "row" : "column"}
      justifyContent={edge() === "left" || edge() === "top" ? "flex-start" : "flex-end"}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    >
      <box
        onMouseUp={(e: { stopPropagation: () => void }) => {
          dismiss = false;
          e.stopPropagation();
        }}
        width={horizontal() ? size() : undefined}
        maxWidth={horizontal() ? dimensions().width - 2 : undefined}
        height={horizontal() ? undefined : size()}
        maxHeight={horizontal() ? undefined : dimensions().height - 2}
        backgroundColor={theme.backgroundPanel}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="column"
        gap={1}
      >
        <Show when={props.title}>
          <box flexDirection="row" justifyContent="space-between">
            <text attributes={TextAttributes.BOLD} fg={theme.text}>
              {props.title}
            </text>
            <text fg={theme.textMuted} onMouseUp={() => props.onClose()}>
              esc
            </text>
          </box>
        </Show>
        {props.children}
      </box>
    </box>
  );
}
