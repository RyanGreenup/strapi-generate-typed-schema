import type { RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid";

import { splitProps } from "solid-js";

import { useTheme } from "../context/theme";

/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode, MIT licensed).
 * Upstream styles the raw intrinsics per call site: <text fg={theme.text}>
 * (packages/tui/src/ui/dialog-alert.tsx#L30), <span style={{ fg }}>
 * (component/workspace-label.tsx#L5), and inline <b> inside text
 * (component/dialog-status.tsx#L113). Text applies the theme.text /
 * theme.textMuted defaults so call sites stop repeating them; Span keeps the
 * upstream idiom of inheriting color from its parent <text> unless given one.
 * Emphasis, Underline, and LineBreak are new wrappers following the same
 * inline-modifier pattern (upstream never uses <u> or <br>; it stacks
 * separate <text> elements for line breaks).
 */

export type TextProps = Omit<JSX.IntrinsicElements["text"], "fg"> & {
  readonly color?: RGBA;
  readonly muted?: boolean;
};

/** Applies normal or muted theme text color unless an explicit color overrides it. */
export function Text(props: TextProps) {
  const { theme } = useTheme();
  const [local, rest] = splitProps(props, ["color", "muted", "children"]);
  const fg = () => local.color ?? (local.muted ? theme.textMuted : theme.text);

  return (
    <text {...rest} fg={fg()}>
      {local.children}
    </text>
  );
}

export interface SpanProps {
  readonly children?: JSX.Element;
  readonly color?: RGBA;
  readonly background?: RGBA;
}

/** Applies optional inline colors within a parent text element. */
export function Span(props: SpanProps) {
  return (
    // eslint-disable-next-line solid/style-prop -- opentui's style prop takes renderable options (fg/bg), not CSS
    <span style={{ fg: props.color, bg: props.background }}>{props.children}</span>
  );
}

export interface InlineProps {
  readonly children?: JSX.Element;
}

/** Marks inline content as bold within a parent text element. */
export function Strong(props: InlineProps) {
  return <b>{props.children}</b>;
}

/** Marks inline content as italic within a parent text element. */
export function Emphasis(props: InlineProps) {
  return <i>{props.children}</i>;
}

/** Underlines inline content within a parent text element. */
export function Underline(props: InlineProps) {
  return <u>{props.children}</u>;
}

/** Inserts a line break within a parent text element. */
export function LineBreak() {
  return <br />;
}
