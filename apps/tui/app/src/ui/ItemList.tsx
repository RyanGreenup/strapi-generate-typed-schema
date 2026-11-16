import { useTheme } from "@ryangreenup/tui-components";
import { scrollOffset } from "@ryangreenup/tui-example-lib";
import { createMemo, For, Show } from "solid-js";

// A scrolling list that keeps the cursor row visible.
export function ItemList(props: {
  entries: readonly string[];
  cursor: number;
  height: number;
}) {
  const { theme } = useTheme();
  const offset = createMemo(() =>
    scrollOffset(props.cursor, props.height, props.entries.length),
  );
  const visible = createMemo(() =>
    props.entries
      .slice(offset(), offset() + props.height)
      .map((entry, i) => ({ entry, index: offset() + i })),
  );

  return (
    <box
      flexGrow={1}
      flexBasis={0}
      flexDirection="column"
      overflow="hidden"
      paddingRight={1}
    >
      <Show
        when={props.entries.length > 0}
        fallback={<text fg={theme.textMuted}>empty</text>}
      >
        <For each={visible()}>
          {(row) => (
            <text
              wrapMode="none"
              fg={theme.text}
              bg={
                row.index === props.cursor ? theme.backgroundElement : undefined
              }
            >
              {row.entry}
            </text>
          )}
        </For>
      </Show>
    </box>
  );
}
