/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/ui/dialog-confirm.tsx L19-L88 segmented header plus
 * conditional content panels, MIT licensed). The segmented header is not
 * re-ported: it composes the TabSelect exemplar (src/components/
 * tab-select.tsx), which was built to seed this capstone. Kept: active
 * segment styling, left/right cycling, mouse select (all via TabSelect),
 * panel swap below the header. Changed: tabs become a
 * { label, panel }[] prop; active index is controlled (active/onChange)
 * or falls back to an internal signal. Dropped: useDialog/dialog.clear
 * and the DialogConfirm.show helper.
 * Requires KeymapProvider plus registerAppKeymap (via TabSelect's
 * left/right bindings) and ThemeProvider.
 */
import type { JSX } from "solid-js";

import { createSignal, Show } from "solid-js";

import { TabSelect } from "./tab-select";

export interface TabsTab {
  readonly label: string;
  readonly panel: () => JSX.Element;
}

export interface TabsProps {
  readonly tabs: readonly TabsTab[];
  readonly active?: number;
  readonly onChange?: (index: number) => void;
  readonly enabled?: boolean;
}

/** Mounts only the active panel and uses internal selection when `active` is absent. */
export function Tabs(props: TabsProps) {
  const [internal, setInternal] = createSignal(0);
  const active = () => props.active ?? internal();

  function select(index: number) {
    if (props.active === undefined) setInternal(index);
    props.onChange?.(index);
  }

  return (
    <box flexDirection="column" gap={1}>
      <TabSelect
        options={props.tabs.map((tab, index) => ({
          label: tab.label,
          value: index,
        }))}
        value={active()}
        enabled={props.enabled}
        onChange={select}
      />
      <Show when={props.tabs[active()]} keyed>
        {(tab) => tab.panel()}
      </Show>
    </box>
  );
}
