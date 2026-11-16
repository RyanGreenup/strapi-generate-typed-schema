import { For } from "solid-js";

import { useTheme } from "../context/theme";
import { useBindings } from "../keymap";

/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/ui/dialog-confirm.tsx L19-L55 single-active-selection
 * model plus the row styling of ui/dialog-export-options.tsx L121-L169, MIT
 * licensed). Kept: one active value, arrow keys move the selection with
 * wraparound, return commits, mouse selects a row. Changed: laid out as a
 * vertical "(x)" / "( )" list over generic options with up/down bindings
 * (upstream was the two-slot horizontal cancel/confirm pair on left/right);
 * selection is controlled via value/onChange. Dropped:
 * useDialog/dialog.clear, the DialogConfirm.show promise helper, and
 * Locale.titlecase (labels are caller-supplied).
 */

export interface RadioGroupOption<T> {
  readonly label: string;
  readonly value: T;
}

export interface RadioGroupProps<T> {
  readonly options: readonly RadioGroupOption<T>[];
  readonly value: T;
  readonly enabled?: boolean;
  readonly onChange: (value: T) => void;
  readonly onCommit?: (value: T) => void;
}

/** Shows controlled radio choices with wrapped arrow navigation and optional Enter commit. */
export function RadioGroup<T>(props: RadioGroupProps<T>) {
  const { theme } = useTheme();
  const index = () => props.options.findIndex((option) => option.value === props.value);

  function move(delta: number) {
    if (props.options.length === 0) return;
    const next = (index() + delta + props.options.length) % props.options.length;
    const option = props.options[next];
    if (option) props.onChange(option.value);
  }

  useBindings(() => ({
    enabled: props.enabled !== false,
    bindings: [
      {
        key: "up",
        desc: "Previous radio option",
        group: "Radio group",
        cmd: () => move(-1),
      },
      {
        key: "down",
        desc: "Next radio option",
        group: "Radio group",
        cmd: () => move(1),
      },
      {
        key: "return",
        desc: "Commit radio selection",
        group: "Radio group",
        cmd: () => props.onCommit?.(props.value),
      },
    ],
  }));

  return (
    <box flexDirection="column">
      <For each={props.options}>
        {(option) => (
          <box
            flexDirection="row"
            gap={2}
            paddingLeft={1}
            backgroundColor={option.value === props.value ? theme.backgroundElement : undefined}
            onMouseUp={() => props.onChange(option.value)}
          >
            <text fg={option.value === props.value ? theme.primary : theme.textMuted}>
              {option.value === props.value ? "(x)" : "( )"}
            </text>
            <text fg={option.value === props.value ? theme.primary : theme.text}>
              {option.label}
            </text>
          </box>
        )}
      </For>
    </box>
  );
}
