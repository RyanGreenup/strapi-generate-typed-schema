import { useTheme } from "../context/theme";

/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/ui/dialog-export-options.tsx L121-L169, MIT licensed) -
 * one boolean toggle row from the export-options checkbox group. Kept: the
 * row recipe (flexDirection row, gap 2, paddingLeft 1, backgroundElement bg
 * when focused), the "[x]" / "[ ]" glyphs, and the focused primary /
 * unfocused muted-glyph coloring. Changed: state is controlled via
 * checked/focused props; onMouseUp fires onFocus then onToggle (upstream
 * mouse only focused the row; toggling too is the standalone-friendly
 * behavior). Dropped: useDialog/setSize, the export-specific option
 * semantics, the embedded filename textarea, and the group tab/space
 * bindings, which live with the caller (see the checkbox example).
 */

export interface CheckboxProps {
  readonly label: string;
  readonly checked: boolean;
  readonly focused?: boolean;
  readonly onToggle?: () => void;
  readonly onFocus?: () => void;
}

/** Shows controlled check state and requests focus before a mouse toggle. */
export function Checkbox(props: CheckboxProps) {
  const { theme } = useTheme();

  return (
    <box
      flexDirection="row"
      gap={2}
      paddingLeft={1}
      backgroundColor={props.focused ? theme.backgroundElement : undefined}
      onMouseUp={() => {
        props.onFocus?.();
        props.onToggle?.();
      }}
    >
      <text fg={props.focused ? theme.primary : theme.textMuted}>
        {props.checked ? "[x]" : "[ ]"}
      </text>
      <text fg={props.focused ? theme.primary : theme.text}>{props.label}</text>
    </box>
  );
}
