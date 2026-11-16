/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode, MIT
 * licensed). EmptyState ports component/plugin-route-missing.tsx#L3: a
 * full-size centered column with a theme.warning message and a ghost
 * action button (backgroundElement surface, padding 1); the route id and
 * onHome coupling become `message` and a generic optional `action`.
 * ErrorState ports component/error-component.tsx#L10-L200: the crash
 * template keeps upstream's hardcoded per-mode fallback palette (mirroring
 * theme/assets/opencode.json) instead of useTheme, because the theme
 * context may be the thing that crashed - so its buttons are inlined with
 * that palette rather than reusing the themed Button component. Kept: the
 * responsive gating (subtext >= 18 rows, footer >= 20 rows, content width
 * min(84, max(24, width - 4))), bold headline, rounded " Error " panel,
 * roving action buttons (left/right/tab move, return activates, letter
 * keys fire directly, mouse-down focuses + mouse-up activates), and the
 * bordered scrollable detail pane (up/down/pageup/pagedown/home/end).
 * Dropped: useExit/useClipboard/InstallationVersion/describeOS/
 * describeTerminal and the GitHub buildIssueURL report machinery - actions
 * and copy are the caller's business via the `actions` prop; ctrl+c is
 * left to the renderer's exitOnCtrlC. The fixed-speed scroll acceleration
 * mirrors util/scroll.ts's default (speed 3) like the Listbox port.
 */
import type { ScrollAcceleration, ScrollBoxRenderable } from "@opentui/core";

import { TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createSignal, For, Show } from "solid-js";

import { useTheme } from "../context/theme";

export interface EmptyStateProps {
  readonly message: string;
  readonly action?: {
    readonly label: string;
    readonly onUse: () => void;
  };
}

/** Centers an empty-state message and an optional mouse action in the available space. */
export function EmptyState(props: EmptyStateProps) {
  const { theme } = useTheme();

  return (
    <box
      width="100%"
      height="100%"
      alignItems="center"
      justifyContent="center"
      flexDirection="column"
      gap={1}
    >
      <text fg={theme.warning}>{props.message}</text>
      <Show when={props.action}>
        {(action) => (
          <box
            onMouseUp={() => action().onUse()}
            backgroundColor={theme.backgroundElement}
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={theme.text}>{action().label}</text>
          </box>
        )}
      </Show>
    </box>
  );
}

class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private readonly speed: number) {}

  tick(_now?: number): number {
    return this.speed;
  }

  reset(): void {}
}

const SCROLL_ACCELERATION = new CustomSpeedScroll(3);

export interface ErrorStateAction {
  readonly key: string;
  readonly label: string;
  readonly onUse: () => void;
}

export interface ErrorStateProps {
  readonly title: string;
  readonly message: string;
  readonly subtext?: string;
  readonly detail?: string;
  readonly actions: readonly ErrorStateAction[];
  readonly mode?: "dark" | "light";
}

/** Shows keyboard-accessible recovery actions and optional scrollable details without a theme provider. */
export function ErrorState(props: ErrorStateProps) {
  const term = useTerminalDimensions();
  const [selected, setSelected] = createSignal(0);
  let scroll: ScrollBoxRenderable | undefined;

  // Safe fallback palette per mode (mirrors theme/assets/opencode.json)
  // since the theme context may be the thing that crashed.
  const colors = () =>
    props.mode === "light"
      ? {
          bg: "#ffffff",
          element: "#f5f5f5",
          borderSubtle: "#d4d4d4",
          text: "#1a1a1a",
          muted: "#8a8a8a",
          primary: "#3b7dd8",
          onPrimary: "#ffffff",
          error: "#d1383d",
        }
      : {
          bg: "#0a0a0a",
          element: "#1e1e1e",
          borderSubtle: "#3c3c3c",
          text: "#eeeeee",
          muted: "#808080",
          primary: "#fab283",
          onPrimary: "#0a0a0a",
          error: "#e06c75",
        };

  const move = (delta: number) =>
    setSelected((prev) => (prev + delta + props.actions.length) % props.actions.length);

  // Vertical keys scroll the detail pane; buttons navigate horizontally.
  function scrollDetail(name: string) {
    if (!scroll) return;
    switch (name) {
      case "up":
        scroll.scrollBy(-1);
        break;
      case "down":
        scroll.scrollBy(1);
        break;
      case "pageup":
        scroll.scrollBy(-scroll.height);
        break;
      case "pagedown":
        scroll.scrollBy(scroll.height);
        break;
      case "home":
        scroll.scrollTo(0);
        break;
      case "end":
        scroll.scrollTo(scroll.scrollHeight);
        break;
    }
  }

  useKeyboard((evt) => {
    const horizontal =
      evt.name === "return" || evt.name === "left" || evt.name === "right" || evt.name === "tab";
    if (horizontal) {
      evt.preventDefault();
      evt.stopPropagation();
    }
    if (evt.name === "return") {
      props.actions[selected()]?.onUse();
      return;
    }
    if (evt.name === "left") {
      move(-1);
      return;
    }
    if (evt.name === "right") {
      move(1);
      return;
    }
    if (evt.name === "tab") {
      move(evt.shift ? -1 : 1);
      return;
    }
    scrollDetail(evt.name);
    const direct = props.actions.find((action) => action.key === evt.name);
    if (direct) direct.onUse();
  });

  // Responsive thresholds.
  const contentWidth = () => Math.min(84, Math.max(24, term().width - 4));
  const showSubtext = () => term().height >= 18;
  const showFooter = () => term().height >= 20;

  return (
    <box
      width={term().width}
      height={term().height}
      backgroundColor={colors().bg}
      flexDirection="column"
      alignItems="center"
    >
      <box
        width={contentWidth()}
        flexGrow={1}
        flexDirection="column"
        paddingTop={1}
        paddingBottom={1}
        gap={1}
      >
        <box flexDirection="column" alignItems="center" flexShrink={0}>
          <text attributes={TextAttributes.BOLD} fg={colors().text}>
            {props.title}
          </text>
          <Show when={showSubtext() && props.subtext}>
            <text fg={colors().muted}>{props.subtext}</text>
          </Show>
        </box>

        <box
          flexShrink={0}
          border
          borderStyle="rounded"
          borderColor={colors().error}
          title=" Error "
          titleColor={colors().error}
          paddingLeft={2}
          paddingRight={2}
        >
          <text fg={colors().text}>{props.message}</text>
        </box>

        <box
          flexDirection="row"
          flexWrap="wrap"
          justifyContent="center"
          gap={2}
          rowGap={1}
          flexShrink={0}
        >
          <For each={props.actions}>
            {(action, index) => {
              const isSelected = () => selected() === index();
              return (
                <box flexDirection="column" alignItems="center" flexShrink={0}>
                  <box
                    onMouseDown={() => setSelected(index())}
                    onMouseUp={() => action.onUse()}
                    backgroundColor={isSelected() ? colors().primary : colors().element}
                    minWidth={15}
                    alignItems="center"
                    paddingLeft={2}
                    paddingRight={2}
                  >
                    <text
                      attributes={TextAttributes.BOLD}
                      fg={isSelected() ? colors().onPrimary : colors().text}
                    >
                      {action.label}
                    </text>
                  </box>
                  <text fg={isSelected() ? colors().primary : colors().muted}>{action.key}</text>
                </box>
              );
            }}
          </For>
        </box>

        <Show when={props.detail}>
          <box
            flexGrow={1}
            flexBasis={0}
            minHeight={3}
            border
            borderStyle="rounded"
            borderColor={colors().borderSubtle}
            title=" Detail "
            titleColor={colors().muted}
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
              scrollAcceleration={SCROLL_ACCELERATION}
            >
              <text fg={colors().muted}>{props.detail}</text>
            </scrollbox>
          </box>
        </Show>

        <Show when={showFooter()}>
          <box flexDirection="column" alignItems="center" flexShrink={0}>
            <text fg={colors().muted}>
              left/right or tab select, return activates, letter keys fire directly
            </text>
          </box>
        </Show>
      </box>
    </box>
  );
}
