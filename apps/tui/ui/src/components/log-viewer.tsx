/* Adapted from @opencode-ai/tui (github.com/anomalyco/opencode, MIT
 * licensed): the label/value entry list, copy action, and copied
 * feedback from packages/tui/src/component/dialog-debug.tsx plus the
 * bordered scrollable detail pane and its keyboard paging from
 * component/error-component.tsx#L83-L194.
 * Kept: the padEnd(10) muted label column, the rounded " Details " pane
 * with the scroll hint bottom title, up/down/pageup/pagedown/home/end
 * driving scrollBy/scrollTo (pages use scroll.height, end uses
 * scroll.scrollHeight), and the bold "copied" feedback swap on the copy
 * affordance (mouse or the c key).
 * Dropped: useRoute/useLocal/InstallationVersion/describeOS entry
 * sources (entries are a prop), the dialog chrome (useDialog/setSize/esc
 * header), and useClipboard/useToast - copying is the caller's business
 * via the optional onCopy seam.
 * Changed: keys go through useBindings instead of the dialog-scoped
 * handler, and the check glyph is a unicode escape.
 * Requires KeymapProvider plus registerAppKeymap (and ThemeProvider).
 */
import type { ScrollBoxRenderable } from "@opentui/core";

import { TextAttributes } from "@opentui/core";
import { createSignal, For, Show } from "solid-js";

import { useTheme } from "../context/theme";
import { useBindings } from "../keymap";
import { getScrollAcceleration } from "../util/scroll";

export interface LogEntry {
  readonly label: string;
  readonly value: string;
}

export interface LogViewerProps {
  readonly entries?: readonly LogEntry[];
  readonly text?: string;
  readonly title?: string;
  readonly onCopy?: (all: string) => void;
}

/** Shows labeled entries and scrollable text, with optional copy callbacks for their combined content. */
export function LogViewer(props: LogViewerProps) {
  const { theme } = useTheme();
  const [copied, setCopied] = createSignal(false);

  let scroll: ScrollBoxRenderable | undefined;

  const allText = () => {
    const entryLines = (props.entries ?? []).map((entry) => `${entry.label}: ${entry.value}`);
    return [...entryLines, ...(props.text !== undefined ? [props.text] : [])].join("\n");
  };

  const copy = () => {
    if (!props.onCopy) return;
    props.onCopy(allText());
    setCopied(true);
  };

  useBindings(() => ({
    bindings: [
      {
        key: "up",
        desc: "Scroll up",
        group: "Log viewer",
        cmd: () => scroll?.scrollBy(-1),
      },
      {
        key: "down",
        desc: "Scroll down",
        group: "Log viewer",
        cmd: () => scroll?.scrollBy(1),
      },
      {
        key: "pageup",
        desc: "Page up",
        group: "Log viewer",
        cmd: () => scroll?.scrollBy(-(scroll?.height ?? 0)),
      },
      {
        key: "pagedown",
        desc: "Page down",
        group: "Log viewer",
        cmd: () => scroll?.scrollBy(scroll?.height ?? 0),
      },
      {
        key: "home",
        desc: "Scroll to top",
        group: "Log viewer",
        cmd: () => scroll?.scrollTo(0),
      },
      {
        key: "end",
        desc: "Scroll to bottom",
        group: "Log viewer",
        cmd: () => scroll?.scrollTo(scroll?.scrollHeight ?? 0),
      },
      ...(props.onCopy ? [{ key: "c", desc: "Copy log", group: "Log viewer", cmd: copy }] : []),
    ],
  }));

  return (
    <box flexGrow={1} gap={1}>
      <Show when={props.title !== undefined}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          {props.title}
        </text>
      </Show>

      <Show when={props.entries !== undefined && props.entries.length > 0}>
        <box flexShrink={0}>
          <For each={props.entries}>
            {(entry) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} fg={theme.textMuted}>
                  {entry.label.padEnd(10)}
                </text>
                <text fg={theme.text} wrapMode="word">
                  {entry.value}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>

      <Show when={props.text !== undefined}>
        <box
          flexGrow={1}
          flexBasis={0}
          minHeight={3}
          border
          borderStyle="rounded"
          borderColor={theme.borderSubtle}
          title=" Details "
          titleColor={theme.textMuted}
          bottomTitle=" up/down scroll "
          bottomTitleAlignment="right"
          paddingLeft={1}
          paddingRight={1}
        >
          <scrollbox
            ref={(element: ScrollBoxRenderable) => {
              scroll = element;
            }}
            flexGrow={1}
            scrollAcceleration={getScrollAcceleration()}
          >
            <text fg={theme.textMuted}>{props.text}</text>
          </scrollbox>
        </box>
      </Show>

      <Show when={props.onCopy}>
        <box flexDirection="row" justifyContent="flex-end" flexShrink={0}>
          <text onMouseUp={copy}>
            {/* eslint-disable-next-line solid/style-prop -- opentui's style prop takes renderable options (fg/bg), not CSS */}
            <span style={{ fg: copied() ? theme.success : theme.text }}>
              <b>{copied() ? "\u2713 copied" : "copy"}</b>{" "}
            </span>
            {/* eslint-disable-next-line solid/style-prop -- opentui's style prop takes renderable options (fg/bg), not CSS */}
            <span style={{ fg: theme.textMuted }}>c</span>
          </text>
        </box>
      </Show>
    </box>
  );
}
