/* Menu preset over the local Listbox. opencode has no menu component; its
 * menus are thin DialogSelect wrappers such as
 * packages/tui/src/component/dialog-agent.tsx#L20-L30 in @opencode-ai/tui
 * (MIT licensed, github.com/anomalyco/opencode): map items to options, mark
 * the current value, select and close.
 * Kept: that wrapper pattern (title + current marker + onSelect).
 * Dropped: the dialog system and the filter input (menus are short lists;
 * use FilteredSelect when filtering matters).
 * Added: a compact bordered panel shell with an optional title line.
 */
import { TextAttributes } from "@opentui/core";
import { Show } from "solid-js";

import { useTheme } from "../context/theme";
import { Listbox } from "./listbox";

export interface MenuItem<T> {
  readonly title: string;
  readonly value: T;
  readonly description?: string;
  readonly disabled?: boolean;
  readonly onSelect?: () => void;
}

export interface MenuProps<T> {
  readonly items: readonly MenuItem<T>[];
  readonly title?: string;
  readonly current?: T;
  readonly keyOf?: (value: T) => string | number;
  readonly enabled?: boolean;
  readonly width?: number;
  readonly onSelect?: (item: MenuItem<T>) => void;
  readonly onDismiss?: () => void;
}

/** Shows a bordered list menu that excludes disabled items and invokes item callbacks before `onSelect`. */
export function Menu<T>(props: MenuProps<T>) {
  const { theme } = useTheme();

  return (
    <box
      border
      borderColor={theme.border}
      backgroundColor={theme.backgroundPanel}
      flexDirection="column"
      width={props.width ?? 40}
      paddingTop={1}
      paddingBottom={1}
    >
      <Show when={props.title !== undefined}>
        <box paddingLeft={4} paddingBottom={1}>
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.title}
          </text>
        </box>
      </Show>
      <Listbox
        options={props.items.map((item) => ({
          title: item.title,
          value: item.value,
          description: item.description,
          disabled: item.disabled,
          onSelect: item.onSelect,
        }))}
        current={props.current}
        keyOf={props.keyOf}
        enabled={props.enabled}
        onSelect={(option) => {
          const item = props.items.find(
            (candidate) =>
              Object.is(candidate.value, option.value) ||
              (props.keyOf !== undefined &&
                props.keyOf(candidate.value) === props.keyOf(option.value)),
          );
          if (item) props.onSelect?.(item);
        }}
        onDismiss={props.onDismiss}
      />
    </box>
  );
}
