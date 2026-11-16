import type { JSX } from "@opentui/solid";

import { splitProps } from "solid-js";

import { useTheme } from "../context/theme";

/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode, MIT licensed).
 * Upstream has no Box wrapper; it styles the raw <box> intrinsic per call site
 * (e.g. packages/tui/src/ui/dialog.tsx#L11, ui/dialog-confirm.tsx#L69). This
 * exemplar lifts those recurring styles into a themed wrapper: a `variant`
 * prop picks the background token (background / backgroundPanel /
 * backgroundElement) and the border color follows theme.border, switching to
 * theme.borderActive while `focused`. Explicit backgroundColor/borderColor
 * props still win over the theme defaults.
 */

export type BoxVariant = "default" | "panel" | "element";

export type BoxProps = JSX.IntrinsicElements["box"] & {
  readonly variant?: BoxVariant;
};

/** Applies theme surfaces and focus borders unless explicit colors override them. */
export function Box(props: BoxProps) {
  const { theme } = useTheme();
  const [local, rest] = splitProps(props, [
    "variant",
    "backgroundColor",
    "borderColor",
    "focused",
    "children",
  ]);

  const variantBackground = () => {
    if (local.variant === "panel") return theme.backgroundPanel;
    if (local.variant === "element") return theme.backgroundElement;
    return theme.background;
  };

  const backgroundColor = () => local.backgroundColor ?? variantBackground();

  const borderColor = () =>
    local.borderColor ?? (local.focused ? theme.borderActive : theme.border);

  return (
    <box
      {...rest}
      focused={local.focused}
      backgroundColor={backgroundColor()}
      borderColor={borderColor()}
    >
      {local.children}
    </box>
  );
}
