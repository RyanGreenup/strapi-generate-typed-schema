/* Filtered select adapted from @opencode-ai/tui (MIT licensed,
 * github.com/anomalyco/opencode), packages/tui/src/ui/dialog-select.tsx:
 * the filter half of DialogSelect (fuzzysort filtering #L154-L173, header +
 * filter input #L557-L596, footer #L712-L724) layered on top of the local
 * Listbox component.
 * Kept: fuzzysort ranking with the title-over-category weighting, the
 * flatten-while-filtering behavior, the auto-focused filter input with its
 * setTimeout + isDestroyed guard, the header esc affordance, and
 * display-only footer hints.
 * Dropped: the dialog system (header esc calls onDismiss), the actions[] +
 * tab-cycling machinery (keymap-bound; footerHints remain), skipFilter and
 * locked props, keymap useBindings (plain useKeyboard drives the Listbox
 * through its ref), and the input FILTER trait (opencode app styling).
 * Added: enabled prop, keyOf pass-through, string-only footers.
 */
import type { InputRenderable } from "@opentui/core";
import type { JSX } from "solid-js";

import type { ListboxOption, ListboxRef } from "./listbox";
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import fuzzysort from "fuzzysort";

import { batch, createEffect, createMemo, createSignal, For, on, Show } from "solid-js";

import { useTheme } from "../context/theme";
import { Listbox } from "./listbox";

const PAGE_SIZE = 10;

export interface FooterHint {
  readonly title: string;
  readonly label: string;
  readonly side?: "left" | "right";
}

export interface FilteredSelectRef<T> {
  readonly filter: string;
  readonly filtered: readonly ListboxOption<T>[];
  readonly moveTo: (value: T) => void;
}

export interface FilteredSelectProps<T> {
  readonly title: string;
  readonly placeholder?: string;
  readonly options: readonly ListboxOption<T>[];
  readonly current?: T;
  readonly keyOf?: (value: T) => string | number;
  readonly flat?: boolean;
  readonly enabled?: boolean;
  readonly renderFilter?: boolean;
  readonly footerHints?: readonly FooterHint[];
  readonly emptyView?: JSX.Element;
  readonly onFilter?: (query: string) => void;
  readonly onMove?: (option: ListboxOption<T>) => void;
  readonly onSelect?: (option: ListboxOption<T>) => void;
  readonly onDismiss?: () => void;
  readonly ref?: (ref: FilteredSelectRef<T>) => void;
}

/** Filters enabled options by title and category, with automatic filter focus and keyboard navigation. */
export function FilteredSelect<T>(props: FilteredSelectProps<T>) {
  const { theme } = useTheme();
  const [filter, setFilter] = createSignal("");

  const filtered = createMemo(() => {
    const options = props.options.filter((option) => option.disabled !== true);
    if (props.renderFilter === false) return options;
    const needle = filter().toLowerCase();
    if (needle === "") return options;

    // Prioritize title matches (weight: 2) over category matches (weight: 1);
    // users typically search by the item name, not its category.
    return fuzzysort
      .go(needle, options, {
        keys: ["title", "category"],
        scoreFn: (r) => (r[0]?.score ?? 0) * 2 + (r[1]?.score ?? 0),
      })
      .map((result) => result.obj);
  });

  let listbox: ListboxRef<T> | undefined;
  let input: InputRenderable | undefined;

  // Reset the selection to the top of the results whenever the filter
  // changes; deferred so the Listbox has re-rendered the new option list.
  createEffect(
    on(
      filter,
      (value) => {
        setTimeout(() => {
          if (value.length === 0) return;
          const first = filtered()[0];
          if (first) listbox?.moveTo(first.value);
        }, 0);
      },
      { defer: true },
    ),
  );

  useKeyboard((key) => {
    if (props.enabled === false) return;
    switch (key.name) {
      case "down":
        listbox?.move(1);
        break;
      case "up":
        listbox?.move(-1);
        break;
      case "pagedown":
        listbox?.move(PAGE_SIZE);
        break;
      case "pageup":
        listbox?.move(-PAGE_SIZE);
        break;
      case "return":
        listbox?.submit();
        break;
      case "escape":
        props.onDismiss?.();
        break;
    }
  });

  const ref: FilteredSelectRef<T> = {
    get filter() {
      return filter();
    },
    get filtered() {
      return filtered();
    },
    moveTo(value) {
      listbox?.moveTo(value);
    },
  };
  createEffect(() => props.ref?.(ref));

  const hints = createMemo(() => props.footerHints ?? []);
  const left = createMemo(() => hints().filter((hint) => hint.side !== "right"));
  const right = createMemo(() => hints().filter((hint) => hint.side === "right"));

  return (
    <box gap={1} paddingBottom={1} flexGrow={1} flexDirection="column">
      <box paddingLeft={4} paddingRight={4} flexDirection="column">
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.title}
          </text>
          <text fg={theme.textMuted} onMouseUp={() => props.onDismiss?.()}>
            esc
          </text>
        </box>
        <Show when={props.renderFilter !== false}>
          <box paddingTop={1}>
            <input
              onInput={(value) => {
                batch(() => {
                  setFilter(value);
                  props.onFilter?.(value);
                });
              }}
              focusedBackgroundColor={theme.backgroundPanel}
              cursorColor={theme.primary}
              focusedTextColor={theme.textMuted}
              ref={(r: InputRenderable) => {
                input = r;
                setTimeout(() => {
                  if (!input) return;
                  if (input.isDestroyed) return;
                  input.focus();
                }, 1);
              }}
              placeholder={props.placeholder ?? "Search"}
              placeholderColor={theme.textMuted}
            />
          </box>
        </Show>
      </box>
      <box flexGrow={1} flexShrink={1}>
        <Listbox
          options={filtered()}
          current={props.current}
          keyOf={props.keyOf}
          flat={props.flat === true && filter().length > 0}
          keyboard={false}
          emptyView={props.emptyView}
          onMove={props.onMove}
          onSelect={props.onSelect}
          ref={(r) => {
            listbox = r;
          }}
        />
      </box>
      <Show when={hints().length > 0} fallback={<box flexShrink={0} />}>
        <box
          paddingRight={2}
          paddingLeft={4}
          flexDirection="row"
          justifyContent="space-between"
          flexShrink={0}
        >
          <box flexDirection="row" gap={2}>
            <For each={left()}>{(hint) => <FooterHintText hint={hint} />}</For>
          </box>
          <box flexDirection="row" gap={2}>
            <For each={right()}>{(hint) => <FooterHintText hint={hint} />}</For>
          </box>
        </box>
      </Show>
    </box>
  );
}

function FooterHintText(props: { readonly hint: FooterHint }) {
  const { theme } = useTheme();
  return (
    <text>
      {/* eslint-disable-next-line solid/style-prop -- opentui's style prop takes renderable options (fg/bg), not CSS */}
      <span style={{ fg: theme.text }}>
        <b>{props.hint.title}</b>{" "}
      </span>
      {/* eslint-disable-next-line solid/style-prop -- opentui's style prop takes renderable options (fg/bg), not CSS */}
      <span style={{ fg: theme.textMuted }}>{props.hint.label}</span>
    </text>
  );
}
