/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/ui/dialog.tsx, MIT licensed). Kept: the centered shell
 * (widths xlarge 116 / large 88 / medium 60, maxWidth = terminal width - 2),
 * the dimmed backdrop with mouse-dismiss and its text-selection guard, the
 * single-top replace() stack with onClose callbacks, the "modal" keymap-mode
 * push while a dialog is open, focus capture/blur/refocus on close, the
 * escape and ctrl+c close bindings, and DialogProvider/useDialog, plus the
 * provider's copy-on-select handlers (mouse-up and right-click copy the
 * renderer selection, then clear it). Dropped: the Flag environment gate
 * around copy-on-select and the useClipboard context; the provider instead
 * takes an `onCopy` prop (ported with the Phase 5 Toast exemplar); the
 * handlers are no-ops without it, and the "Copied" feedback only shows when
 * a ToastProvider is above. Changed: replace() takes a typed () => JSX.Element
 * thunk where upstream used `any` (every upstream call site already passes a
 * thunk). Requires KeymapProvider plus registerAppKeymap (for the mode
 * stack) above DialogProvider; the ctrl+c binding only fires when the app is
 * rendered without exitOnCtrlC.
 */
import type { Renderable } from "@opentui/core";
import type { JSX, ParentProps } from "solid-js";

import { MouseButton, RGBA } from "@opentui/core";
import { useRenderer, useTerminalDimensions } from "@opentui/solid";
import { batch, createContext, createEffect, onCleanup, Show, useContext } from "solid-js";
import { createStore } from "solid-js/store";

import { useTheme } from "../context/theme";
import { useBindings, useModeStack } from "../keymap";
import { useToastOptional } from "./toast";

export type DialogSize = "medium" | "large" | "xlarge";

export interface DialogProps {
  readonly size?: DialogSize;
  readonly onClose: () => void;
  readonly children?: JSX.Element;
}

/** Shows a centered modal whose backdrop requests close unless a text selection is active. */
export function Dialog(props: DialogProps) {
  const dimensions = useTerminalDimensions();
  const { theme } = useTheme();
  const renderer = useRenderer();

  let dismiss = false;
  const width = () => {
    if (props.size === "xlarge") return 116;
    if (props.size === "large") return 88;
    return 60;
  };

  return (
    <box
      onMouseDown={() => {
        dismiss = !!renderer.getSelection();
      }}
      onMouseUp={() => {
        if (dismiss) {
          dismiss = false;
          return;
        }
        props.onClose();
      }}
      width={dimensions().width}
      height={dimensions().height}
      alignItems="center"
      position="absolute"
      zIndex={3000}
      paddingTop={dimensions().height / 4}
      left={0}
      top={0}
      backgroundColor={RGBA.fromInts(0, 0, 0, 150)}
    >
      <box
        onMouseUp={(e: { stopPropagation: () => void }) => {
          // A selection release must bubble up to the backdrop, whose dismiss
          // flag keeps it from closing the dialog.
          if ((renderer.getSelection()?.getSelectedText() ?? "") !== "") return;
          dismiss = false;
          e.stopPropagation();
        }}
        width={width()}
        maxWidth={dimensions().width - 2}
        backgroundColor={theme.backgroundPanel}
        paddingTop={1}
      >
        {props.children}
      </box>
    </box>
  );
}

interface DialogStackEntry {
  element: () => JSX.Element;
  onClose?: () => void;
}

function init() {
  const [store, setStore] = createStore<{
    stack: DialogStackEntry[];
    size: DialogSize;
  }>({
    stack: [],
    size: "medium",
  });

  const renderer = useRenderer();
  const modeStack = useModeStack();

  createEffect(() => {
    if (store.stack.length === 0) return;
    const popMode = modeStack.push("modal");
    onCleanup(popMode);
  });

  let focus: Renderable | null = null;
  function refocus() {
    setTimeout(() => {
      if (!focus) return;
      if (focus.isDestroyed) return;
      function find(item: Renderable) {
        for (const child of item.getChildren()) {
          if (child === focus) return true;
          if (find(child)) return true;
        }
        return false;
      }
      const found = find(renderer.root);
      if (!found) return;
      focus.focus();
    }, 1);
  }

  function closeTop() {
    if (renderer.getSelection()) renderer.clearSelection();
    const current = store.stack.at(-1);
    current?.onClose?.();
    setStore("stack", store.stack.slice(0, -1));
    refocus();
  }

  useBindings(() => ({
    enabled: store.stack.length > 0 && (renderer.getSelection()?.getSelectedText() ?? "") === "",
    bindings: [
      {
        key: "escape",
        desc: "Close dialog",
        group: "Dialog",
        cmd: closeTop,
      },
      {
        key: "ctrl+c",
        desc: "Close dialog",
        group: "Dialog",
        cmd: closeTop,
      },
    ],
  }));

  return {
    clear() {
      for (const item of store.stack) {
        if (item.onClose) item.onClose();
      }
      batch(() => {
        setStore("size", "medium");
        setStore("stack", []);
      });
      refocus();
    },
    replace(input: () => JSX.Element, onClose?: () => void) {
      if (store.stack.length === 0) {
        focus = renderer.currentFocusedRenderable;
        focus?.blur();
      }
      for (const item of store.stack) {
        if (item.onClose) item.onClose();
      }
      setStore("size", "medium");
      setStore("stack", [
        {
          element: input,
          onClose,
        },
      ]);
    },
    get stack() {
      return store.stack;
    },
    get size() {
      return store.size;
    },
    setSize(size: DialogSize) {
      setStore("size", size);
    },
  };
}

export type DialogContext = ReturnType<typeof init>;

const ctx = createContext<DialogContext>();

export interface DialogProviderProps extends ParentProps {
  readonly onCopy?: (text: string) => void | Promise<void>;
}

/** Provides modal state, focus restoration, and optional selection copy support. Requires an app mode stack. */
export function DialogProvider(props: DialogProviderProps) {
  const value = init();
  const renderer = useRenderer();
  const toast = useToastOptional();

  function copySelection() {
    const text = renderer.getSelection()?.getSelectedText() ?? "";
    const write = props.onCopy;
    if (text === "" || !write) return false;
    void Promise.resolve(write(text)).then(
      () => toast?.show({ message: "Copied to clipboard", variant: "info" }),
      (error: unknown) => toast?.error(error),
    );
    renderer.clearSelection();
    return true;
  }

  return (
    <ctx.Provider value={value}>
      {props.children}
      <box
        position="absolute"
        zIndex={3000}
        onMouseDown={(evt: {
          button: number;
          preventDefault: () => void;
          stopPropagation: () => void;
        }) => {
          if (evt.button !== MouseButton.RIGHT) return;
          if (!copySelection()) return;
          evt.preventDefault();
          evt.stopPropagation();
        }}
        onMouseUp={copySelection}
      >
        <Show when={value.stack.length}>
          <Dialog onClose={() => value.clear()} size={value.size}>
            {value.stack.at(-1)!.element()}
          </Dialog>
        </Show>
      </box>
    </ctx.Provider>
  );
}

/** Gets modal controls, or throws outside a `DialogProvider`. */
export function useDialog() {
  const value = useContext(ctx);
  if (!value) throw new Error("useDialog must be used within a DialogProvider");
  return value;
}
