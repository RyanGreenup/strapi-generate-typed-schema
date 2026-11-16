/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/ui/toast.tsx, MIT licensed). Kept: the ToastOptions
 * shape (title/message/variant/duration), the absolute top-right renderer
 * box with SplitBorder rails and the variant token as border color, the
 * single-toast store with auto-dismiss timeout (default 5000ms) and the
 * show/error helpers, and ToastProvider/useToast. Dropped: the
 * `NodeJS.Timeout` type and the `.unref()` call on the dismiss timer
 * (Bun/Node specific; the handle is typed via ReturnType<typeof setTimeout>
 * and the renderer exit tears it down). Changed: error() takes `unknown`
 * instead of `any`; added useToastOptional() so DialogProvider can show a
 * copy-on-select toast only when a ToastProvider is mounted above it.
 */
import type { ParentProps } from "solid-js";

import { TextAttributes } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createContext, Show, useContext } from "solid-js";
import { createStore } from "solid-js/store";

import { useTheme } from "../context/theme";
import { SplitBorder } from "./border";

export interface ToastOptions {
  readonly title?: string;
  readonly message: string;
  readonly variant: "info" | "success" | "warning" | "error";
  readonly duration: number;
}

type ToastInput = Omit<ToastOptions, "duration"> & {
  readonly duration?: number;
};

/** Shows the provider's current notification in the terminal's upper-right corner. */
export function Toast() {
  const toast = useToast();
  const { theme } = useTheme();
  const dimensions = useTerminalDimensions();

  return (
    <Show when={toast.currentToast}>
      {(current) => (
        <box
          position="absolute"
          justifyContent="center"
          alignItems="flex-start"
          top={2}
          right={2}
          maxWidth={Math.min(60, dimensions().width - 6)}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={theme.backgroundPanel}
          borderColor={theme[current().variant]}
          border={["left", "right"]}
          customBorderChars={SplitBorder.customBorderChars}
        >
          <Show when={current().title}>
            <text attributes={TextAttributes.BOLD} marginBottom={1} fg={theme.text}>
              {current().title}
            </text>
          </Show>
          <text fg={theme.text} wrapMode="word" width="100%">
            {current().message}
          </text>
        </box>
      )}
    </Show>
  );
}

function init() {
  const [store, setStore] = createStore({
    currentToast: null as ToastOptions | null,
  });

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const toast = {
    show(options: ToastInput) {
      const toastOptions = { ...options, duration: options.duration ?? 5000 };
      setStore("currentToast", toastOptions);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      timeoutHandle = setTimeout(() => {
        setStore("currentToast", null);
      }, toastOptions.duration);
    },
    error(err: unknown) {
      if (err instanceof Error) {
        toast.show({
          variant: "error",
          message: err.message,
        });
        return;
      }
      toast.show({
        variant: "error",
        message: "An unknown error has occurred",
      });
    },
    get currentToast(): ToastOptions | null {
      return store.currentToast;
    },
  };
  return toast;
}

export type ToastContext = ReturnType<typeof init>;

const ctx = createContext<ToastContext>();

/** Provides one replaceable toast with a default duration of 5000 ms. Mount `Toast` separately for display. */
export function ToastProvider(props: ParentProps) {
  const value = init();
  return <ctx.Provider value={value}>{props.children}</ctx.Provider>;
}

/** Gets toast controls, or throws outside a `ToastProvider`. */
export function useToast() {
  const value = useContext(ctx);
  if (!value) throw new Error("useToast must be used within a ToastProvider");
  return value;
}

/** Gets toast controls, or gives `undefined` outside a `ToastProvider`. */
export function useToastOptional() {
  return useContext(ctx);
}
