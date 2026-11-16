import { TextAttributes } from "@opentui/core";
import { For } from "solid-js";

import { useTheme } from "../context/theme";
import { useBindings } from "../keymap";

/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/ui/dialog-confirm.tsx L69-L88 segmented render plus the
 * bold labeled variant of ui/dialog-select.tsx L540-L554 action-bar
 * segments, MIT licensed). Kept: adjacent padded boxes in a row, active
 * segment gets theme.primary bg + selectedListItemText fg (+ BOLD from the
 * action-bar variant), inactive segments muted, left/right move with
 * wraparound, return commits, mouse-up selects. Changed: generic
 * options/value/onChange API instead of the fixed cancel/confirm pair.
 * Dropped: useDialog/dialog.clear, DialogConfirm.show, Locale.titlecase.
 * This exemplar seeds the Phase 7 Tabs capstone.
 */

export interface TabSelectOption<T> {
  readonly label: string;
  readonly value: T;
}

export interface TabSelectProps<T> {
  readonly options: readonly TabSelectOption<T>[];
  readonly value: T;
  readonly enabled?: boolean;
  readonly onChange: (value: T) => void;
  readonly onCommit?: (value: T) => void;
}

/** Shows controlled horizontal choices with wrapped arrow navigation and optional Enter commit. */
export function TabSelect<T>(props: TabSelectProps<T>) {
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
        key: "left",
        desc: "Previous tab",
        group: "Tab select",
        cmd: () => move(-1),
      },
      {
        key: "right",
        desc: "Next tab",
        group: "Tab select",
        cmd: () => move(1),
      },
      {
        key: "return",
        desc: "Commit tab selection",
        group: "Tab select",
        cmd: () => props.onCommit?.(props.value),
      },
    ],
  }));

  return (
    <box flexDirection="row">
      <For each={props.options}>
        {(option) => (
          <box
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={option.value === props.value ? theme.primary : undefined}
            onMouseUp={() => props.onChange(option.value)}
          >
            <text
              fg={option.value === props.value ? theme.selectedListItemText : theme.textMuted}
              attributes={option.value === props.value ? TextAttributes.BOLD : undefined}
            >
              {option.label}
            </text>
          </box>
        )}
      </For>
    </box>
  );
}
