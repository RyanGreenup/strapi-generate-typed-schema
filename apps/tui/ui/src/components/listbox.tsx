/* Listbox adapted from @opencode-ai/tui (MIT licensed,
 * github.com/anomalyco/opencode), packages/tui/src/ui/dialog-select.tsx:
 * the list half of DialogSelect (selection + scroll #L154-L342, render tree
 * #L617-L728, Option renderer #L731-L790) extracted as a standalone
 * component. The filter input half lives in filtered-select.tsx.
 * Kept: category grouping, wrap-around selection, manual scroll windowing
 * over the scrollbox children, mouse handlers, keyboard/mouse input-mode
 * tracking, gutter/footer/description rendering, title truncation, the
 * current-value marker, and CustomSpeedScroll (util/scroll.ts) inlined.
 * Dropped: the dialog system (escape now calls an onDismiss prop and
 * option.onSelect takes no dialog context), keymap useBindings (plain
 * useKeyboard gated by `enabled`), actions/footer machinery, remeda
 * (hand-rolled groupBy), isDeepEqual (keyOf prop, Object.is default),
 * titleView/categoryView/details/margin/bg/locked props, and the
 * preserveSelection generation counters + requestAnimationFrame guards
 * (mount order is deterministic without dialog animation).
 * Added: keyOf, enabled, keyboard, maxHeight props; j/k navigation; ASCII
 * "*" current marker instead of the round bullet glyph.
 */
import type { ScrollAcceleration, ScrollBoxRenderable } from "@opentui/core";
import type { JSX } from "solid-js";

import { RGBA, TextAttributes } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/solid";
import { createEffect, createMemo, For, on, Show } from "solid-js";
import { createStore } from "solid-js/store";

import { useTheme } from "../context/theme";
import { selectedForeground } from "../theme";
import { truncate, truncateLeft } from "../util/locale";

const PAGE_SIZE = 10;
const TITLE_WIDTH_DEFAULT = 61;

class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private readonly speed: number) {}

  tick(_now?: number): number {
    return this.speed;
  }

  reset(): void {}
}

const SCROLL_ACCELERATION = new CustomSpeedScroll(3);

export interface ListboxOption<T> {
  readonly title: string;
  readonly value: T;
  readonly description?: string;
  readonly footer?: string;
  readonly category?: string;
  readonly disabled?: boolean;
  readonly titleWidth?: number;
  readonly truncateTitle?: boolean | "left";
  readonly gutter?: () => JSX.Element;
  readonly onSelect?: () => void;
}

export interface ListboxRef<T> {
  readonly selected: ListboxOption<T> | undefined;
  readonly move: (delta: number) => void;
  readonly moveTo: (value: T) => void;
  readonly submit: () => void;
}

export interface ListboxProps<T> {
  readonly options: readonly ListboxOption<T>[];
  readonly current?: T;
  readonly keyOf?: (value: T) => string | number;
  readonly flat?: boolean;
  readonly enabled?: boolean;
  readonly keyboard?: boolean;
  readonly maxHeight?: number;
  readonly emptyView?: JSX.Element;
  readonly onMove?: (option: ListboxOption<T>) => void;
  readonly onSelect?: (option: ListboxOption<T>) => void;
  readonly onDismiss?: () => void;
  readonly ref?: (ref: ListboxRef<T>) => void;
}

/** Shows enabled options by category, preserves selection by value, and supports mouse and keyboard navigation. */
export function Listbox<T>(props: ListboxProps<T>) {
  const { theme } = useTheme();

  const [store, setStore] = createStore({
    selected: 0,
    input: "keyboard",
  });

  const same = (a: T, b: T) => {
    if (props.keyOf) return props.keyOf(a) === props.keyOf(b);
    return Object.is(a, b);
  };

  const enabledOptions = createMemo(() =>
    props.options.filter((option) => option.disabled !== true),
  );

  const grouped = createMemo<[string, ListboxOption<T>[]][]>(() => {
    if (props.flat === true) return [["", [...enabledOptions()]]];
    const groups = new Map<string, ListboxOption<T>[]>();
    for (const option of enabledOptions()) {
      const category = option.category ?? "";
      const bucket = groups.get(category);
      if (bucket) bucket.push(option);
      else groups.set(category, [option]);
    }
    return [...groups.entries()];
  });

  const flat = createMemo(() => grouped().flatMap(([, options]) => options));

  const rows = createMemo(() => {
    const headers = grouped().reduce((acc, [category], index) => {
      if (category === "") return acc;
      return acc + (index > 0 ? 2 : 1);
    }, 0);
    return flat().length + headers;
  });

  const dimensions = useTerminalDimensions();
  const height = createMemo(
    () => props.maxHeight ?? Math.min(rows(), Math.floor(dimensions().height / 2) - 6),
  );

  const selected = createMemo(() => flat()[store.selected]);

  // Simplified preserveSelection: re-find the previously selected value when
  // the option list changes, clamp when it is gone.
  createEffect(
    on(flat, (options, previousOptions, previous: ListboxOption<T> | undefined) => {
      const previousSelected = previous;
      if (previousSelected) {
        const index = options.findIndex((option) => same(option.value, previousSelected.value));
        if (index >= 0) {
          setStore("selected", index);
          return options[index];
        }
      }
      const next = Math.max(0, Math.min(store.selected, options.length - 1));
      setStore("selected", next);
      return options[next];
    }),
  );

  createEffect(
    on(
      () => props.current,
      (current) => {
        if (current === undefined) return;
        const index = flat().findIndex((option) => same(option.value, current));
        if (index >= 0) moveTo(index, true);
      },
    ),
  );

  // Synthetic mousemove events can fire as the layout shifts underneath the
  // cursor; force keyboard mode whenever the option list changes so hover
  // does not steal the selection.
  createEffect(() => {
    flat();
    setStore("input", "keyboard");
  });

  let scroll: ScrollBoxRenderable | undefined;

  function move(direction: number) {
    if (flat().length === 0) return;
    let next = store.selected + direction;
    if (next < 0) next = flat().length - 1;
    if (next >= flat().length) next = 0;
    moveTo(next, true);
  }

  function moveTo(next: number, center = false) {
    setStore("selected", next);
    const option = selected();
    if (option) props.onMove?.(option);
    scrollToSelection(center);
  }

  // Locate the row by position because a unique renderable ID cannot
  // currently be ensured; headers are scrollbox children too.
  function selectionChildIndex() {
    let remaining = store.selected;
    let index = 0;
    for (const [category, options] of grouped()) {
      if (category !== "") index++;
      if (remaining < options.length) {
        index += remaining;
        break;
      }
      index += options.length;
      remaining -= options.length;
    }
    return index;
  }

  function scrollToSelection(center: boolean) {
    if (!scroll) return;
    const target = scroll.getChildren()[selectionChildIndex()];
    if (!target) return;
    const y = target.y - scroll.y;
    if (center) {
      const centerOffset = Math.floor(scroll.height / 2);
      scroll.scrollBy(y - centerOffset);
      return;
    }

    if (y >= scroll.height) scroll.scrollBy(y - scroll.height + 1);
    if (y < 0) {
      scroll.scrollBy(y);
      scrollToStartIfFirstSelected();
    }
  }

  function scrollToStartIfFirstSelected() {
    const first = flat()[0];
    const active = selected();
    if (scroll && first && active && same(first.value, active.value)) scroll.scrollTo(0);
  }

  function submit() {
    setStore("input", "keyboard");
    const option = selected();
    if (!option) return;
    option.onSelect?.();
    props.onSelect?.(option);
  }

  useKeyboard((key) => {
    if (props.enabled === false || props.keyboard === false) return;
    switch (key.name) {
      case "down":
      case "j":
        setStore("input", "keyboard");
        move(1);
        break;
      case "up":
      case "k":
        setStore("input", "keyboard");
        move(-1);
        break;
      case "pagedown":
        setStore("input", "keyboard");
        move(PAGE_SIZE);
        break;
      case "pageup":
        setStore("input", "keyboard");
        move(-PAGE_SIZE);
        break;
      case "home":
        setStore("input", "keyboard");
        moveTo(0);
        break;
      case "end":
        setStore("input", "keyboard");
        moveTo(flat().length - 1);
        break;
      case "return":
        submit();
        break;
      case "escape":
        props.onDismiss?.();
        break;
    }
  });

  const indexOfOption = (option: ListboxOption<T>) =>
    flat().findIndex((candidate) => same(candidate.value, option.value));

  const ref: ListboxRef<T> = {
    get selected() {
      return selected();
    },
    move,
    moveTo(value) {
      const index = flat().findIndex((option) => same(option.value, value));
      if (index >= 0) moveTo(index, true);
    },
    submit,
  };
  createEffect(() => props.ref?.(ref));

  const isCurrent = (option: ListboxOption<T>) =>
    props.current !== undefined && same(option.value, props.current);

  return (
    <Show
      when={flat().length > 0}
      fallback={
        props.emptyView ?? (
          <box paddingLeft={4} paddingRight={4} paddingTop={1}>
            <text fg={theme.textMuted}>No results found</text>
          </box>
        )
      }
    >
      <scrollbox
        paddingLeft={1}
        paddingRight={1}
        scrollbarOptions={{ visible: false }}
        scrollAcceleration={SCROLL_ACCELERATION}
        ref={(r: ScrollBoxRenderable) => (scroll = r)}
        maxHeight={height()}
      >
        <For each={grouped()}>
          {([category, options], groupIndex) => (
            <>
              <Show when={category !== ""}>
                <box paddingTop={groupIndex() > 0 ? 1 : 0} paddingLeft={3}>
                  <text fg={theme.accent} attributes={TextAttributes.BOLD}>
                    {category}
                  </text>
                </box>
              </Show>
              <For each={options}>
                {(option) => (
                  <ListboxOptionRow
                    option={option}
                    category={category}
                    flat={props.flat === true}
                    selected={selected}
                    current={isCurrent(option)}
                    same={same}
                    input={() => store.input}
                    setInput={(input) => setStore("input", input)}
                    indexOfOption={indexOfOption}
                    moveTo={moveTo}
                    onSelect={props.onSelect}
                  />
                )}
              </For>
            </>
          )}
        </For>
      </scrollbox>
    </Show>
  );
}

interface ListboxOptionRowProps<T> {
  readonly option: ListboxOption<T>;
  readonly category: string;
  readonly flat: boolean;
  readonly selected: () => ListboxOption<T> | undefined;
  readonly current: boolean;
  readonly same: (a: T, b: T) => boolean;
  readonly input: () => string;
  readonly setInput: (input: string) => void;
  readonly indexOfOption: (option: ListboxOption<T>) => number;
  readonly moveTo: (index: number) => void;
  readonly onSelect?: (option: ListboxOption<T>) => void;
}

function ListboxOptionRow<T>(props: ListboxOptionRowProps<T>) {
  const { theme } = useTheme();
  const active = createMemo(() => {
    const selected = props.selected();
    return selected !== undefined && props.same(props.option.value, selected.value);
  });
  const footer = createMemo(() => {
    if (props.flat) return props.option.category ?? props.option.footer;
    return props.option.footer;
  });
  const selectHoveredOption = () => {
    const index = props.indexOfOption(props.option);
    if (index >= 0) props.moveTo(index);
  };

  return (
    <box
      flexDirection="column"
      position="relative"
      onMouseMove={() => props.setInput("mouse")}
      onMouseUp={() => {
        props.option.onSelect?.();
        props.onSelect?.(props.option);
      }}
      onMouseOver={() => {
        if (props.input() === "mouse") selectHoveredOption();
      }}
      onMouseDown={selectHoveredOption}
    >
      <box
        flexDirection="row"
        paddingLeft={props.current || props.option.gutter !== undefined ? 1 : 3}
        paddingRight={3}
        gap={1}
        backgroundColor={active() ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
      >
        <OptionRow
          title={props.option.title}
          footer={footer()}
          titleWidth={props.option.titleWidth}
          truncateTitle={props.option.truncateTitle}
          description={
            props.option.description !== props.category ? props.option.description : undefined
          }
          active={active()}
          current={props.current}
          gutter={props.option.gutter}
        />
      </box>
    </box>
  );
}

interface OptionRowProps {
  readonly title: string;
  readonly description?: string;
  readonly active?: boolean;
  readonly current?: boolean;
  readonly footer?: string;
  readonly titleWidth?: number;
  readonly truncateTitle?: boolean | "left";
  readonly gutter?: () => JSX.Element;
}

function OptionRow(props: OptionRowProps) {
  const { theme } = useTheme();
  const fg = selectedForeground(theme);
  const text = createMemo(() => {
    if (props.active === true) return fg;
    if (props.current === true) return theme.primary;
    return theme.text;
  });
  const title = createMemo(() => {
    if (props.truncateTitle === false) return props.title;
    if (props.truncateTitle === "left")
      return truncateLeft(props.title, props.titleWidth ?? TITLE_WIDTH_DEFAULT);
    return truncate(props.title, props.titleWidth ?? TITLE_WIDTH_DEFAULT);
  });
  const descriptionStyle = createMemo(() => ({
    fg: props.active === true ? fg : theme.textMuted,
  }));

  return (
    <>
      <Show when={props.current === true && props.gutter === undefined}>
        <text flexShrink={0} fg={text()} marginRight={0}>
          *
        </text>
      </Show>
      <Show when={props.gutter !== undefined}>
        <box flexShrink={0} marginRight={0}>
          {props.gutter?.()}
        </box>
      </Show>
      <text
        flexGrow={1}
        fg={text()}
        attributes={props.active === true ? TextAttributes.BOLD : undefined}
        overflow="hidden"
        wrapMode="none"
        paddingLeft={3}
      >
        {title()}
        <Show when={props.description !== undefined && props.description !== ""}>
          <span style={descriptionStyle()}> {props.description}</span>
        </Show>
      </text>
      <Show when={props.footer !== undefined && props.footer !== ""}>
        <box flexShrink={0}>
          <text fg={props.active === true ? fg : theme.textMuted}>{props.footer}</text>
        </box>
      </Show>
    </>
  );
}
