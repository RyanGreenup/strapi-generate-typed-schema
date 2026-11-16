import { useTheme } from "../context/theme";

/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/ui/dialog-export-options.tsx L121-L169, MIT licensed).
 * opencode has no distinct switch rendering (CHECKLIST.md Phase 4 note);
 * this reuses the export-options boolean-toggle row state machine with
 * track glyphs "( o)" / "(o )" in place of "[x]" / "[ ]". Same controlled
 * API and drops as the Checkbox exemplar; group tab/space bindings live
 * with the caller (see the switch example).
 */

export interface SwitchProps {
  readonly label: string;
  readonly checked: boolean;
  readonly focused?: boolean;
  readonly onToggle?: () => void;
  readonly onFocus?: () => void;
}

/** Shows a controlled switch and requests focus before a mouse toggle. */
export function Switch(props: SwitchProps) {
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
      <text fg={props.checked ? theme.primary : theme.textMuted}>
        {props.checked ? "( o)" : "(o )"}
      </text>
      <text fg={props.focused ? theme.primary : theme.text}>{props.label}</text>
    </box>
  );
}
