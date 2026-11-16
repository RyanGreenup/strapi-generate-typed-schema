/* Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/feature-plugins/system/diff-viewer-ui.tsx, MIT
 * licensed): a near-verbatim port of the PanelGroup/Panel/Separator
 * layout primitives the diff viewer composes at diff-viewer.tsx#L754+.
 * Kept: the PanelGroupContext axis design, cross-axis Panel border sides
 * (theme.border), and the Separator edge glyph joins (SeparatorEdge).
 * Changed: box glyphs are written as unicode escapes.
 * Added: a convenience SplitPane (left rail + Separator + right content,
 * showLeft/leftWidth) matching the diff viewer's file-tree usage shape.
 * Needs only ThemeProvider; no keymap or dialog wiring.
 */
import type { BorderSides, ColorInput } from "@opentui/core";
import type { JSX } from "@opentui/solid";

import { createContext, Show, splitProps, useContext } from "solid-js";

import { useTheme } from "../context/theme";

export type Axis = "x" | "y";
export type SeparatorEdge = "edge" | "edge-in" | "edge-out";
export type PanelBorder = "start" | "end" | "both" | "none";

const PanelGroupContext = createContext<{ axis: Axis }>();

function crossAxis(axis: Axis) {
  return axis === "x" ? "y" : "x";
}

function usePanelGroup() {
  return useContext(PanelGroupContext);
}

export type PanelGroupProps = JSX.IntrinsicElements["box"] & {
  readonly axis: Axis;
};

/** Arranges panels on an axis and supplies that axis to nested panels and separators. */
export function PanelGroup(props: PanelGroupProps) {
  const [local, boxProps] = splitProps(props, ["axis", "children"]);
  return (
    <PanelGroupContext.Provider
      value={{
        get axis() {
          return local.axis;
        },
      }}
    >
      <box
        minWidth={0}
        minHeight={0}
        padding={0}
        flexDirection={local.axis === "x" ? "row" : "column"}
        {...boxProps}
      >
        {local.children}
      </box>
    </PanelGroupContext.Provider>
  );
}

export type PanelProps = Omit<JSX.IntrinsicElements["box"], "border"> & {
  readonly border?: PanelBorder;
};

/** Applies theme borders across the group axis, with vertical borders outside a group. */
export function Panel(props: PanelProps) {
  const group = usePanelGroup();
  const { theme } = useTheme();
  const [local, boxProps] = splitProps(props, ["border"]);
  const borderProps = () => {
    const border = local.border ?? "start";
    if (border === "none") return {};
    return {
      border: panelBorderSides(group?.axis ?? "y", border),
      borderColor: theme.border,
    };
  };

  return (
    <box
      minWidth={0}
      minHeight={0}
      flexDirection={crossAxis(group?.axis || "y") === "x" ? "row" : "column"}
      {...borderProps()}
      {...boxProps}
    />
  );
}

function panelBorderSides(axis: Axis, border: Exclude<PanelBorder, "none">): BorderSides[] {
  if (axis === "x")
    return border === "both" ? ["top", "bottom"] : [border === "start" ? "top" : "bottom"];
  return border === "both" ? ["left", "right"] : [border === "start" ? "left" : "right"];
}

export interface SeparatorProps {
  readonly axis?: Axis;
  readonly color?: ColorInput;
  readonly start?: SeparatorEdge;
  readonly end?: SeparatorEdge;
}

/** Draws a rule across the group axis, with optional junction glyphs at its ends. */
export function Separator(props: SeparatorProps) {
  const group = usePanelGroup();
  const { theme } = useTheme();
  const color = () => props.color ?? theme.border;
  const axis = () => props.axis ?? crossAxis(group?.axis ?? "y");
  return (
    <Show
      when={axis() === "y"}
      fallback={
        <Show
          when={props.start || props.end}
          fallback={<box height={1} flexShrink={0} border={["top"]} borderColor={color()} />}
        >
          <box height={1} flexShrink={0} flexDirection="row">
            <Show when={props.start}>
              {(edge) => <text fg={color()}>{horizontalEdge(edge(), "start")}</text>}
            </Show>
            <box flexGrow={1} border={["top"]} borderColor={color()} />
            <Show when={props.end}>
              {(edge) => <text fg={color()}>{horizontalEdge(edge(), "end")}</text>}
            </Show>
          </box>
        </Show>
      }
    >
      <Show
        when={props.start || props.end}
        fallback={<box width={1} flexShrink={0} border={["left"]} borderColor={color()} />}
      >
        <box width={1} flexShrink={0} flexDirection="column">
          <Show when={props.start}>
            {(edge) => <text fg={color()}>{verticalEdge(edge(), "start")}</text>}
          </Show>
          <box flexGrow={1} border={["left"]} borderColor={color()} />
          <Show when={props.end}>
            {(edge) => <text fg={color()}>{verticalEdge(edge(), "end")}</text>}
          </Show>
        </box>
      </Show>
    </Show>
  );
}

function horizontalEdge(edge: SeparatorEdge, side: "start" | "end") {
  if (edge === "edge") return side === "start" ? "\u251C" : "\u2524";
  if (edge === "edge-in") return "\u2534";
  return "\u252C";
}

function verticalEdge(edge: SeparatorEdge, side: "start" | "end") {
  if (edge === "edge") return side === "start" ? "\u252C" : "\u2534";
  if (edge === "edge-in") return "\u2524";
  return "\u251C";
}

export interface SplitPaneProps {
  readonly left: JSX.Element;
  readonly right: JSX.Element;
  readonly showLeft?: boolean;
  readonly leftWidth?: number;
}

/** Places a fixed-width optional left pane beside a flexible right pane and separator. */
export function SplitPane(props: SplitPaneProps) {
  return (
    <PanelGroup axis="x" width="100%" height="100%">
      <Show when={props.showLeft !== false}>
        <Panel border="none" width={props.leftWidth ?? 32} flexShrink={0}>
          {props.left}
        </Panel>
        <Separator />
      </Show>
      <Panel border="none" flexGrow={1}>
        {props.right}
      </Panel>
    </PanelGroup>
  );
}
