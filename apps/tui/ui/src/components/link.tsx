import type { RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid";

import { useTheme } from "../context/theme";

/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/ui/link.tsx, MIT licensed). Upstream renders a plain
 * <text onMouseUp> and launches the URL with the `open` npm package. This
 * port drops that Node-only dependency and wraps the native <a href>
 * intrinsic (LinkRenderable) instead, which emits OSC 8 terminal hyperlinks;
 * clicking is then handled by the terminal emulator. Kept: display text
 * falls back to the href. Added: the color defaults to theme.primary
 * (upstream left fg to the caller).
 */

export interface LinkProps {
  readonly href: string;
  readonly children?: JSX.Element;
  readonly color?: RGBA;
}

/** Emits a terminal hyperlink whose label defaults to its URL. The terminal handles navigation. */
export function Link(props: LinkProps) {
  const { theme } = useTheme();

  return (
    <text fg={props.color ?? theme.primary}>
      <a href={props.href}>{props.children ?? props.href}</a>
    </text>
  );
}
