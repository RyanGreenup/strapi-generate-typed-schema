/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/routes/session/index.tsx#L1435, MIT licensed): the
 * " QUEUED " span pattern - a bold span with a colored background, a
 * contrast foreground picked by selectedForeground(theme, bg), and literal
 * space padding around the label. Kept: the span rendering, the
 * space-padded label, bold by default, and the selectedForeground contrast
 * fallback (upstream routes/session/index.tsx#L1375). Dropped: the
 * queued-message id comparison and the agent color registry
 * (local.agent.color) - the background is a plain `color` prop defaulting
 * to theme.secondary, matching the File badge variant at #L1413. Badge is
 * a text chunk: render it inside a <text> element.
 */
import type { RGBA } from "@opentui/core";

import { useTheme } from "../context/theme";
import { selectedForeground } from "../theme";

export interface BadgeProps {
  readonly label: string;
  readonly color?: RGBA;
  readonly fg?: RGBA;
  readonly bold?: boolean;
}

/** Shows an inline padded label with a contrast-aware foreground by default. */
export function Badge(props: BadgeProps) {
  const { theme } = useTheme();
  const bg = () => props.color ?? theme.secondary;
  const fg = () => props.fg ?? selectedForeground(theme, bg());

  return (
    <span
      // eslint-disable-next-line solid/style-prop -- OpenTUI span styles use renderable fg/bg/bold, not CSS properties.
      style={{ bg: bg(), fg: fg(), bold: props.bold ?? true }}
    >{` ${props.label} `}</span>
  );
}
