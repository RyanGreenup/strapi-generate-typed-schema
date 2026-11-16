import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/solid";
import { useTheme } from "@ryangreenup/tui-components";
import { defaultItems, ListState } from "@ryangreenup/tui-example-lib";
import { createMemo, createSignal } from "solid-js";

import { Footer } from "./Footer.tsx";
import { ItemList } from "./ItemList.tsx";

// Rust owns the model; Solid only tracks notifications after native mutations.
export function Main(props: { items?: readonly string[] }) {
  const list = new ListState(props.items ? [...props.items] : defaultItems());
  const entries = list.entries;
  const [revision, setRevision] = createSignal(0);
  const cursor = createMemo(() => {
    revision();
    return list.cursor;
  });
  const chosen = createMemo(() => {
    revision();
    return list.chosen;
  });
  const renderer = useRenderer();
  const dims = useTerminalDimensions();
  const themes = useTheme();
  const { theme } = themes;
  // Rows available for the list: total minus header, footer and borders.
  const listHeight = () => Math.max(1, dims().height - 4);
  const cycleTheme = () => {
    const names = Object.keys(themes.all()).sort();
    const next = names[(names.indexOf(themes.selected) + 1) % names.length];
    if (next) themes.set(next);
  };
  useKeyboard((key) => {
    const action = list.handleKey(
      key.name,
      key.sequence,
      key.shift,
      listHeight(),
    );
    if (action === "theme") cycleTheme();
    else if (action === "quit") renderer.destroy();
    else if (action === "handled") setRevision((value) => value + 1);
  });

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={theme.background}
    >
      <box height={1} paddingLeft={1}>
        <text fg={theme.primary}>Rust Example</text>
      </box>
      <box
        flexDirection="row"
        flexGrow={1}
        border
        borderStyle="rounded"
        borderColor={theme.border}
      >
        <ItemList entries={entries} cursor={cursor()} height={listHeight()} />
        <box flexGrow={1} flexBasis={0} paddingLeft={1}>
          <text fg={chosen() ? theme.success : theme.textMuted}>
            {chosen() ? `chose: ${chosen()}` : "nothing chosen yet"}
          </text>
        </box>
      </box>
      <Footer
        count={entries.length}
        cursor={cursor()}
        themeName={themes.selected}
      />
    </box>
  );
}
