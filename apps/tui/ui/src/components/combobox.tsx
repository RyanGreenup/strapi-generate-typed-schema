/* Combobox / autocomplete adapted from @opencode-ai/tui (MIT licensed,
 * github.com/anomalyco/opencode),
 * packages/tui/src/component/prompt/autocomplete.tsx: controller ref
 * (#L59-L62), option type (#L64-L73), anchored-popup position polling
 * (#L107-L144), fuzzysort ranking (#L476-L525), scroll windowing
 * (#L532-L551), and the popup render tree (#L712-L778).
 * Kept: the ref-driven controller (the parent forwards its input's text on
 * every keystroke), the 50ms anchor position polling, the SplitBorder
 * absolute popup above the anchor, the height cap, fuzzysort with the
 * prefix-doubling scoreFn, mouse handlers, and keyboard/mouse input-mode
 * tracking.
 * Dropped: every opencode app coupling (SDK file search, MCP resources,
 * agents, frecency weighting, extmarks, mode-stack push, useTuiConfig) and
 * the dual "@"/"/" trigger semantics; options come from a plain prop and a
 * single configurable trigger character.
 * Added: onDismiss, maxVisible, and the (option, query) onSelect signature
 * so the parent can rewrite its own input text.
 */
import type { BoxRenderable, ScrollBoxRenderable } from "@opentui/core";

import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import fuzzysort from "fuzzysort";
import { createEffect, createMemo, createSignal, Index, onCleanup, Show } from "solid-js";
import { createStore } from "solid-js/store";

import { useTheme } from "../context/theme";
import { selectedForeground } from "../theme";
import { SplitBorder } from "./border";

export interface ComboboxOption {
  readonly display: string;
  readonly value?: string;
  readonly description?: string;
  readonly aliases?: readonly string[];
  readonly disabled?: boolean;
  readonly onSelect?: () => void;
}

export interface ComboboxRef {
  readonly onInput: (value: string, cursor?: number) => void;
  readonly visible: boolean;
  readonly hide: () => void;
}

export interface ComboboxProps {
  readonly anchor: () => BoxRenderable;
  readonly options: readonly ComboboxOption[];
  readonly trigger?: string;
  readonly maxVisible?: number;
  readonly onSelect: (option: ComboboxOption, query: string) => void;
  readonly onDismiss?: () => void;
  readonly ref: (ref: ComboboxRef) => void;
}

/** Shows trigger-based completions above an anchor when the ref receives input updates. */
export function Combobox(props: ComboboxProps) {
  const { theme } = useTheme();
  const dimensions = useTerminalDimensions();

  const [store, setStore] = createStore({
    selected: 0,
    visible: false,
    input: "keyboard",
  });
  const [search, setSearch] = createSignal("");
  const [positionTick, setPositionTick] = createSignal(0);

  const trigger = () => props.trigger ?? "/";
  const maxVisible = () => props.maxVisible ?? 10;

  // Find the trigger character at a token start before the cursor with no
  // whitespace between it and the cursor (simplified from the upstream
  // slashTriggerIndex/mentionTriggerIndex pair).
  function triggerIndex(value: string, cursor: number): number | undefined {
    for (let index = cursor - 1; index >= 0; index--) {
      const char = value[index];
      if (char === undefined) return undefined;
      if (/\s/.test(char)) return undefined;
      if (char === trigger() && (index === 0 || /\s/.test(value[index - 1] ?? ""))) return index;
    }
    return undefined;
  }

  function hide() {
    setStore("visible", false);
    setStore("selected", 0);
    setSearch("");
  }

  const ref: ComboboxRef = {
    onInput(value, cursor) {
      const offset = cursor ?? value.length;
      const index = triggerIndex(value, offset);
      if (index === undefined) {
        if (store.visible) hide();
        return;
      }
      setStore("visible", true);
      setSearch(value.slice(index + 1, offset));
    },
    get visible() {
      return store.visible;
    },
    hide,
  };
  createEffect(() => props.ref(ref));

  // Poll the anchor position while visible; renderable coordinates are not
  // reactive, so a moved layout is only noticed by comparing x/y/width.
  createEffect(() => {
    if (!store.visible) return;
    let lastPos = { x: 0, y: 0, width: 0 };
    const interval = setInterval(() => {
      const anchor = props.anchor();
      if (anchor.x !== lastPos.x || anchor.y !== lastPos.y || anchor.width !== lastPos.width) {
        lastPos = { x: anchor.x, y: anchor.y, width: anchor.width };
        setPositionTick((tick) => tick + 1);
      }
    }, 50);
    onCleanup(() => clearInterval(interval));
  });

  const position = createMemo(() => {
    if (!store.visible) return { x: 0, y: 0, width: 0 };
    dimensions();
    positionTick();
    const anchor = props.anchor();
    const parent = anchor.parent;
    const parentX = parent?.x ?? 0;
    const parentY = parent?.y ?? 0;

    return {
      x: anchor.x - parentX,
      y: anchor.y - parentY,
      width: anchor.width,
    };
  });

  const options = createMemo(() => {
    const enabled = props.options.filter((option) => option.disabled !== true);
    const needle = search();
    if (needle === "") return enabled;

    return fuzzysort
      .go(needle, enabled, {
        keys: [
          (option) => (option.value ?? option.display).trimEnd(),
          "description",
          (option) => option.aliases?.join(" ") ?? "",
        ],
        limit: 10,
        scoreFn: (results) => {
          const displayResult = results[0];
          let score = results.score;
          if (displayResult && displayResult.target.startsWith(trigger() + needle)) score *= 2;
          return score;
        },
      })
      .map((result) => result.obj);
  });

  // Reset the selection and force keyboard mode when the query changes so
  // synthetic mousemove events from layout shifts do not steal it.
  createEffect(() => {
    search();
    setStore("selected", 0);
    setStore("input", "keyboard");
  });

  const height = createMemo(() => {
    const count = options().length || 1;
    if (!store.visible) return Math.min(maxVisible(), count);
    positionTick();
    return Math.min(maxVisible(), count, Math.max(1, props.anchor().y));
  });

  let scroll: ScrollBoxRenderable | undefined;

  function move(direction: -1 | 1) {
    if (!store.visible) return;
    if (options().length === 0) return;
    let next = store.selected + direction;
    if (next < 0) next = options().length - 1;
    if (next >= options().length) next = 0;
    moveTo(next);
  }

  function moveTo(next: number) {
    setStore("selected", next);
    if (!scroll) return;
    const viewportHeight = Math.min(height(), options().length);
    const scrollBottom = scroll.scrollTop + viewportHeight;
    if (next < scroll.scrollTop) {
      scroll.scrollBy(next - scroll.scrollTop);
    } else if (next + 1 > scrollBottom) {
      scroll.scrollBy(next + 1 - scrollBottom);
    }
  }

  function select() {
    const selected = options()[store.selected];
    if (!selected) return;
    const query = search();
    hide();
    selected.onSelect?.();
    props.onSelect(selected, query);
  }

  useKeyboard((key) => {
    if (!store.visible) return;
    switch (key.name) {
      case "down":
        move(1);
        break;
      case "up":
        move(-1);
        break;
      case "return":
      case "tab":
        select();
        break;
      case "escape":
        hide();
        props.onDismiss?.();
        break;
    }
  });

  return (
    <box
      visible={store.visible}
      position="absolute"
      top={position().y - height()}
      left={position().x}
      width={position().width}
      zIndex={100}
      {...SplitBorder}
      borderColor={theme.border}
    >
      <scrollbox
        ref={(r: ScrollBoxRenderable) => (scroll = r)}
        backgroundColor={theme.backgroundMenu}
        height={height()}
        scrollbarOptions={{ visible: false }}
      >
        <Index
          each={options()}
          fallback={
            <box paddingLeft={1} paddingRight={1}>
              <text fg={theme.textMuted}>No matching items</text>
            </box>
          }
        >
          {(option, index) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={index === store.selected ? theme.primary : undefined}
              flexDirection="row"
              onMouseMove={() => {
                setStore("input", "mouse");
              }}
              onMouseOver={() => {
                if (store.input !== "mouse") return;
                moveTo(index);
              }}
              onMouseDown={() => {
                setStore("input", "mouse");
                moveTo(index);
              }}
              onMouseUp={() => select()}
            >
              <text
                fg={index === store.selected ? selectedForeground(theme) : theme.text}
                flexShrink={0}
              >
                {option().display}
              </text>
              <Show when={option().description !== undefined}>
                <text
                  fg={index === store.selected ? selectedForeground(theme) : theme.textMuted}
                  wrapMode="none"
                >
                  {` ${option().description?.trimStart() ?? ""}`}
                </text>
              </Show>
            </box>
          )}
        </Index>
      </scrollbox>
    </box>
  );
}
