import type { CliRenderer } from "@opentui/core";
import type { Accessor } from "solid-js";

// Keymap wiring adapted from opencode (.agents/opencode/packages/tui/src/keymap.tsx).
// Dropped: useTuiConfig/ResolvedKeymapConfig config plumbing (replaced by
// plain AppKeymapOptions) and TuiKeybind.LeaderDefault (inlined literal).
// The command-palette slash plumbing (COMMAND_PALETTE_COMMAND,
// isVisiblePaletteCommand, useCommandSlashes) is ported below for the
// Phase 3 command palette. Renamed the opencode-prefixed symbols.
import { InputRenderable, TextareaRenderable } from "@opentui/core";
import {
  registerBackspacePopsPendingSequence,
  registerBaseLayoutFallback,
  registerCommaBindings,
  registerEscapeClearsPendingSequence,
  registerManagedTextareaLayer,
  registerTimedLeader,
} from "@opentui/keymap/addons/opentui";
import {
  formatCommandBindings as formatCommandBindingsExtra,
  formatKeySequence as formatKeySequenceExtra,
} from "@opentui/keymap/extras";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { KeymapProvider, useBindings, useKeymap, useKeymapSelector } from "@opentui/keymap/solid";
import { createMemo } from "solid-js";

export const LEADER_TOKEN = "leader";
export const BASE_MODE = "base";
export const LEADER_DEFAULT = "ctrl+x";
export const COMMAND_PALETTE_COMMAND = "command.palette.show";

const MODE_KEY = "app.mode";
const LEADER_TIMEOUT_DEFAULT = 1000;

export { createDefaultOpenTuiKeymap, KeymapProvider, useBindings, useKeymap, useKeymapSelector };

export type OpenTuiKeymap = ReturnType<typeof useKeymap>;
type ModeStack = ReturnType<typeof createModeStack>;
type LeaderTrigger = NonNullable<Parameters<typeof registerTimedLeader>[1]["trigger"]>;
type TextareaBindings = NonNullable<Parameters<typeof registerManagedTextareaLayer>[2]["bindings"]>;
type CommandEntry = ReturnType<OpenTuiKeymap["getCommandEntries"]>[number];

export interface CommandSlashEntry {
  readonly display: string;
  readonly description?: string;
  readonly aliases?: readonly string[];
  readonly onSelect: () => void;
}

/** Excludes hidden commands and the palette's own command from palette entries. */
export function isVisiblePaletteCommand(command: CommandEntry["command"]): boolean {
  return command.hidden !== true && command.name !== COMMAND_PALETTE_COMMAND;
}

const modeStacks = new WeakMap<OpenTuiKeymap, ModeStack>();

/** Registers mode requirements and a stack whose push callbacks remove their own entries. */
export function createModeStack(keymap: OpenTuiKeymap) {
  keymap.setData(MODE_KEY, BASE_MODE);

  const offFields = keymap.registerLayerFields({
    mode(value, ctx) {
      ctx.require(MODE_KEY, value);
    },
  });

  const stack: { id: symbol; mode: string }[] = [];
  let disposed = false;

  const update = () => {
    keymap.setData(MODE_KEY, stack.at(-1)?.mode ?? BASE_MODE);
  };

  const stackApi = {
    current() {
      return stack.at(-1)?.mode ?? BASE_MODE;
    },
    push(mode: string) {
      if (disposed) return () => {};
      const id = Symbol(mode);
      let active = true;
      stack.push({ id, mode });
      update();

      return () => {
        if (!active) return;
        active = false;
        const index = stack.findIndex((item) => item.id === id);
        if (index !== -1) stack.splice(index, 1);
        update();
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      stack.length = 0;
      offFields();
      keymap.setData(MODE_KEY, undefined);
      modeStacks.delete(keymap);
    },
  };

  modeStacks.set(keymap, stackApi);
  return stackApi;
}

/** Gets the provider keymap's mode stack, or throws if none is registered. */
export function useModeStack() {
  return getModeStack(useKeymap());
}

/** Gets a registered mode stack, or throws if setup has not registered one. */
export function getModeStack(keymap: OpenTuiKeymap) {
  const value = modeStacks.get(keymap);
  if (!value) throw new Error("Mode stack is not registered for this keymap");
  return value;
}

const KEY_ALIASES = {
  enter: "return",
  esc: "escape",
  pgdown: "pagedown",
  pgup: "pageup",
} as const;

function expandKeyAliases(input: string) {
  const result = Object.entries(KEY_ALIASES).reduce(
    (acc, [alias, key]) =>
      acc.replace(new RegExp(`(^|[+,\\s>])${alias}(?=$|[+,\\s<])`, "gi"), `$1${key}`),
    input,
  );
  if (result === input) return;
  return result;
}

function registerKeyAliases(keymap: OpenTuiKeymap) {
  return keymap.appendBindingExpander((ctx) => {
    const key = expandKeyAliases(ctx.input);
    if (key === undefined) return undefined;
    return [{ key, displays: ctx.displays }];
  });
}

export const inputCommands = [
  "input.move.left",
  "input.move.right",
  "input.move.up",
  "input.move.down",
  "input.select.left",
  "input.select.right",
  "input.select.up",
  "input.select.down",
  "input.line.home",
  "input.line.end",
  "input.select.line.home",
  "input.select.line.end",
  "input.visual.line.home",
  "input.visual.line.end",
  "input.select.visual.line.home",
  "input.select.visual.line.end",
  "input.buffer.home",
  "input.buffer.end",
  "input.select.buffer.home",
  "input.select.buffer.end",
  "input.delete.line",
  "input.delete.to.line.end",
  "input.delete.to.line.start",
  "input.backspace",
  "input.delete",
  "input.newline",
  "input.undo",
  "input.redo",
  "input.word.forward",
  "input.word.backward",
  "input.select.word.forward",
  "input.select.word.backward",
  "input.delete.word.forward",
  "input.delete.word.backward",
  "input.select.all",
  "input.submit",
] as const;

function hasManagedTextareaFocus(renderer: CliRenderer) {
  const editor = renderer.currentFocusedEditor;
  return editor instanceof TextareaRenderable && !(editor instanceof InputRenderable);
}

export interface FormatDisplayOptions {
  leaderDisplay?: string;
}

function formatOptions(options?: FormatDisplayOptions) {
  return {
    tokenDisplay: {
      [LEADER_TOKEN]: options?.leaderDisplay ?? LEADER_DEFAULT,
    },
    keyNameAliases: {
      pageup: "pgup",
      pagedown: "pgdn",
      delete: "del",
    },
    modifierAliases: {
      meta: "alt",
    },
  } as const;
}

/** Formats a sequence with app key aliases and the configured leader display. */
export function formatKeySequence(
  parts: Parameters<typeof formatKeySequenceExtra>[0],
  options?: FormatDisplayOptions,
) {
  return formatKeySequenceExtra(parts, formatOptions(options));
}

/** Formats command bindings with app key aliases and the configured leader display. */
export function formatKeyBindings(
  bindings: Parameters<typeof formatCommandBindingsExtra>[0],
  options?: FormatDisplayOptions,
) {
  return formatCommandBindingsExtra(bindings, formatOptions(options));
}

export interface AppKeymapOptions {
  leader?: LeaderTrigger;
  leaderTimeoutMs?: number;
  textareaBindings?: TextareaBindings;
}

/** Installs app keymap layers and returns a callback that removes them and the mode stack. */
export function registerAppKeymap(
  keymap: OpenTuiKeymap,
  renderer: CliRenderer,
  options?: AppKeymapOptions,
) {
  const modeStack = createModeStack(keymap);
  const offCommaBindings = registerCommaBindings(keymap);
  const offAliasExpander = registerKeyAliases(keymap);
  const offBaseLayout = registerBaseLayoutFallback(keymap);
  const offLeader = registerTimedLeader(keymap, {
    trigger: options?.leader ?? LEADER_DEFAULT,
    name: LEADER_TOKEN,
    timeoutMs: options?.leaderTimeoutMs ?? LEADER_TIMEOUT_DEFAULT,
  });
  const offEscape = registerEscapeClearsPendingSequence(keymap);
  const offBackspace = registerBackspacePopsPendingSequence(keymap);
  const offInputBindings = options?.textareaBindings
    ? registerManagedTextareaLayer(keymap, renderer, {
        enabled: () => hasManagedTextareaFocus(renderer),
        bindings: options.textareaBindings,
      })
    : () => {};

  return () => {
    offInputBindings();
    offBackspace();
    offEscape();
    offLeader();
    offAliasExpander();
    offBaseLayout();
    offCommaBindings();
    modeStack.dispose();
  };
}

/** Tracks whether the pending sequence starts with the leader token. */
export function useLeaderActive(): Accessor<boolean> {
  return useKeymapSelector(
    (keymap: OpenTuiKeymap) => keymap.getPendingSequence()[0]?.tokenName === LEADER_TOKEN,
  );
}

/** Tracks the first registered shortcut for a command, formatted for display. */
export function useCommandShortcut(
  command: string,
  options?: FormatDisplayOptions,
): Accessor<string> {
  return useKeymapSelector((keymap: OpenTuiKeymap) =>
    formatKeySequence(
      keymap.getCommandBindings({ visibility: "registered", commands: [command] }).get(command)?.[0]
        ?.sequence,
      options,
    ),
  );
}

/**
 * Tracks reachable palette commands with slash names and dispatch callbacks.
 * Commands opt in through `slashName` and optional `slashAliases`, `desc`, or `title` metadata.
 */
export function useCommandSlashes(): Accessor<readonly CommandSlashEntry[]> {
  const keymap = useKeymap();
  const entries = useKeymapSelector((selectorKeymap: OpenTuiKeymap) =>
    selectorKeymap.getCommandEntries({
      visibility: "reachable",
      namespace: "palette",
      filter: isVisiblePaletteCommand,
    }),
  );

  const slashes = createMemo<CommandSlashEntry[]>(() =>
    entries().flatMap((entry): CommandSlashEntry[] => {
      const slashName: unknown = entry.command.slashName;
      if (typeof slashName !== "string" || slashName.length === 0) return [];
      const slashAliases: unknown = entry.command.slashAliases;
      let description: string | undefined;
      if (typeof entry.command.desc === "string") description = entry.command.desc;
      else if (typeof entry.command.title === "string") description = entry.command.title;
      return [
        {
          display: `/${slashName}`,
          description,
          aliases: Array.isArray(slashAliases)
            ? slashAliases
                .filter((alias): alias is string => typeof alias === "string")
                .map((alias) => `/${alias}`)
            : undefined,
          onSelect: () => keymap.dispatchCommand(entry.command.name),
        },
      ];
    }),
  );
  return slashes;
}
