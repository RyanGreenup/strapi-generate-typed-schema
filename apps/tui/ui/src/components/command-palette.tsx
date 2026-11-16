import type { OpenTuiKeymap } from "../keymap";
import type { FilteredSelectRef } from "./filtered-select";

/* Command palette adapted from @opencode-ai/tui (MIT licensed,
 * github.com/anomalyco/opencode),
 * packages/tui/src/component/command-palette.tsx (all 79 lines).
 * The one Phase 3 component that touches the keymap: it must render inside
 * both a KeymapProvider and a ThemeProvider.
 * Kept: the reachable palette-namespace command query with registered
 * bindings merged in (#L29-L47), the command-to-option mapping with
 * formatted key-binding footers (#L48-L61), and the Suggested category
 * prepended while the filter is empty (#L63-L76).
 * Dropped: the dialog system (dialog.replace/clear become open/onDismiss
 * props and the palette draws its own absolute overlay box) and the
 * useTuiConfig binding-format config.
 * Added: open/onDismiss/title props and the overlay shell.
 */
import { useTerminalDimensions } from "@opentui/solid";
import { createMemo, Show } from "solid-js";

import { useTheme } from "../context/theme";
import {
  formatKeyBindings,
  isVisiblePaletteCommand,
  useKeymap,
  useKeymapSelector,
} from "../keymap";
import { FilteredSelect } from "./filtered-select";

export interface CommandPaletteProps {
  readonly open: boolean;
  readonly onDismiss: () => void;
  readonly title?: string;
}

type PaletteEntry = ReturnType<OpenTuiKeymap["getCommandEntries"]>[number];

function isSuggestedPaletteCommand(entry: PaletteEntry): boolean {
  const suggested: unknown = entry.command.suggested;
  if (typeof suggested === "boolean") return suggested;
  if (typeof suggested === "function") return (suggested as () => unknown)() === true;
  return false;
}

/** Searches reachable palette commands and dismisses before dispatch of the selected command. */
export function CommandPalette(props: CommandPaletteProps) {
  const { theme } = useTheme();
  const keymap = useKeymap();
  const dimensions = useTerminalDimensions();

  const entries = useKeymapSelector((selectorKeymap: OpenTuiKeymap) => {
    const reachable = selectorKeymap.getCommandEntries({
      namespace: "palette",
      visibility: "reachable",
      filter: isVisiblePaletteCommand,
    });
    const registeredBindings = selectorKeymap.getCommandBindings({
      visibility: "registered",
      commands: reachable.map((entry) => entry.command.name),
    });

    return reachable.map((entry) => ({
      ...entry,
      bindings: registeredBindings.get(entry.command.name) ?? entry.bindings,
    }));
  });

  const options = createMemo(() =>
    entries().map((entry) => ({
      title: typeof entry.command.title === "string" ? entry.command.title : entry.command.name,
      description: typeof entry.command.desc === "string" ? entry.command.desc : undefined,
      category: typeof entry.command.category === "string" ? entry.command.category : undefined,
      footer: formatKeyBindings(entry.bindings),
      value: entry.command.name,
      suggested: isSuggestedPaletteCommand(entry),
      onSelect: () => {
        props.onDismiss();
        keymap.dispatchCommand(entry.command.name);
      },
    })),
  );

  let ref: FilteredSelectRef<string> | undefined;
  const list = () => {
    if (ref !== undefined && ref.filter.length > 0) return options();
    return [
      ...options()
        .filter((option) => option.suggested)
        .map((option) => ({
          ...option,
          value: `suggested:${option.value}`,
          category: "Suggested",
        })),
      ...options(),
    ];
  };

  const width = createMemo(() => Math.min(64, Math.max(24, dimensions().width - 8)));
  const left = createMemo(() => Math.max(0, Math.floor((dimensions().width - width()) / 2)));

  return (
    <Show when={props.open}>
      <box
        position="absolute"
        top={2}
        left={left()}
        width={width()}
        zIndex={100}
        border
        borderColor={theme.borderActive}
        backgroundColor={theme.backgroundPanel}
        flexDirection="column"
        paddingTop={1}
      >
        <FilteredSelect
          title={props.title ?? "Commands"}
          placeholder="Search commands"
          options={list()}
          onDismiss={props.onDismiss}
          ref={(value) => {
            ref = value;
          }}
        />
      </box>
    </Show>
  );
}
