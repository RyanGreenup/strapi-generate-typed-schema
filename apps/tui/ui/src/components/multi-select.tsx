/* Multi-select built on the local FilteredSelect. Pattern from
 * @opencode-ai/tui (MIT licensed, github.com/anomalyco/opencode): the
 * toggle-in-place list of packages/tui/src/component/dialog-mcp.tsx (an
 * action toggles the current row and the dialog stays open) crossed with
 * the checkbox rows of packages/tui/src/ui/dialog-export-options.tsx#L121-L170.
 * Kept: toggle-without-closing semantics and per-row checkbox affordances.
 * Dropped: the dialog system, the keymap-bound action machinery, and the
 * async status footers (state is a plain controlled prop).
 * Added: controlled values/onChange, ASCII "[x]"/"[ ]" gutters, and
 * enter-to-toggle (space would type into the filter input).
 */
import type { JSX } from "solid-js";

import type { ListboxOption } from "./listbox";

import { createMemo } from "solid-js";

import { useTheme } from "../context/theme";
import { FilteredSelect } from "./filtered-select";

export interface MultiSelectProps<T> {
  readonly title: string;
  readonly options: readonly ListboxOption<T>[];
  readonly values: readonly T[];
  readonly onChange: (values: readonly T[]) => void;
  readonly keyOf?: (value: T) => string | number;
  readonly placeholder?: string;
  readonly enabled?: boolean;
  readonly emptyView?: JSX.Element;
  readonly onDismiss?: () => void;
}

/** Filters options and requests controlled value changes when an option toggles, without automatic dismissal. */
export function MultiSelect<T>(props: MultiSelectProps<T>) {
  const { theme } = useTheme();

  const keyOf = (value: T) => (props.keyOf ? props.keyOf(value) : value);

  const checked = createMemo(() => new Set(props.values.map(keyOf)));

  const toggle = (value: T) => {
    if (checked().has(keyOf(value))) {
      props.onChange(props.values.filter((existing) => keyOf(existing) !== keyOf(value)));
      return;
    }
    props.onChange([...props.values, value]);
  };

  const decorated = createMemo(() =>
    props.options.map(
      (option): ListboxOption<T> => ({
        ...option,
        gutter: () => {
          const isChecked = checked().has(keyOf(option.value));
          return (
            <text fg={isChecked ? theme.success : theme.textMuted}>
              {isChecked ? "[x]" : "[ ]"}
            </text>
          );
        },
      }),
    ),
  );

  return (
    <FilteredSelect
      title={props.title}
      placeholder={props.placeholder}
      options={decorated()}
      keyOf={props.keyOf}
      enabled={props.enabled}
      emptyView={props.emptyView}
      footerHints={[
        { title: "enter", label: "toggle" },
        { title: "esc", label: "done", side: "right" },
      ]}
      onSelect={(option) => toggle(option.value)}
      onDismiss={props.onDismiss}
    />
  );
}
