/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/routes/session/subagent-footer.tsx, MIT licensed).
 * Kept: the SplitBorder left-rule panel on backgroundPanel, the
 * space-between row, bold label plus "(N of M)" counter, the muted detail
 * text, and the Parent/Prev/Next hover buttons (backgroundElement hover
 * bg, muted shortcut suffix). Changed: props supply label, index, total,
 * detail, onPrev/onNext/onParent callbacks (a button renders only when
 * its callback is given), and plain shortcut strings replacing
 * useCommandShortcut; key wiring is left to callers (the example binds
 * keys via useBindings). Dropped: useRouteData/useSync sibling
 * derivation, the token/cost usage memo (now the detail prop), and
 * keymap.dispatchCommand.
 * Needs only ThemeProvider.
 */
import { createSignal, Show } from "solid-js";

import { useTheme } from "../context/theme";
import { SplitBorder } from "./border";

export interface PaginationShortcuts {
  readonly parent?: string;
  readonly prev?: string;
  readonly next?: string;
}

export interface PaginationProps {
  readonly label?: string;
  readonly index: number;
  readonly total: number;
  readonly detail?: string;
  readonly onPrev?: () => void;
  readonly onNext?: () => void;
  readonly onParent?: () => void;
  readonly shortcuts?: PaginationShortcuts;
}

type HoverTarget = "parent" | "prev" | "next" | null;

/** Shows the supplied page index and mouse navigation actions. Shortcut labels do not register keys. */
export function Pagination(props: PaginationProps) {
  const { theme } = useTheme();
  const [hover, setHover] = createSignal<HoverTarget>(null);

  function button(
    target: Exclude<HoverTarget, null>,
    label: string,
    action: () => void,
    shortcut?: string,
  ) {
    return (
      <box
        onMouseOver={() => setHover(target)}
        onMouseOut={() => setHover(null)}
        onMouseUp={action}
        backgroundColor={hover() === target ? theme.backgroundElement : theme.backgroundPanel}
      >
        <text fg={theme.text}>
          {label}
          <Show when={shortcut}>
            {" "}
            {/* eslint-disable-next-line solid/style-prop -- opentui's style prop takes renderable options (fg/bg), not CSS */}
            <span style={{ fg: theme.textMuted }}>{shortcut}</span>
          </Show>
        </text>
      </box>
    );
  }

  return (
    <box flexShrink={0}>
      <box
        paddingTop={1}
        paddingBottom={1}
        paddingLeft={2}
        paddingRight={1}
        {...SplitBorder}
        border={["left"]}
        borderColor={theme.border}
        flexShrink={0}
        backgroundColor={theme.backgroundPanel}
      >
        <box flexDirection="row" justifyContent="space-between" gap={1}>
          <box flexDirection="row" gap={1}>
            <text fg={theme.text}>
              <b>{props.label ?? "Page"}</b>
            </text>
            <Show when={props.total > 0}>
              {/* eslint-disable-next-line solid/style-prop -- opentui's style prop takes renderable options (fg/bg), not CSS */}
              <text style={{ fg: theme.textMuted }}>
                ({props.index}
                {" of "}
                {props.total})
              </text>
            </Show>
            <Show when={props.detail}>
              <text fg={theme.textMuted} wrapMode="none">
                {props.detail}
              </text>
            </Show>
          </box>
          <box flexDirection="row" gap={2}>
            <Show when={props.onParent}>
              {(action) => button("parent", "Parent", action(), props.shortcuts?.parent)}
            </Show>
            <Show when={props.onPrev}>
              {(action) => button("prev", "Prev", action(), props.shortcuts?.prev)}
            </Show>
            <Show when={props.onNext}>
              {(action) => button("next", "Next", action(), props.shortcuts?.next)}
            </Show>
          </box>
        </box>
      </box>
    </box>
  );
}
