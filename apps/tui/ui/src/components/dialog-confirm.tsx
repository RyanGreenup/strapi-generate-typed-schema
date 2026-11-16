import type { DialogContext } from "./dialog";
/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/ui/dialog-confirm.tsx, MIT licensed). Kept: the
 * active-option store (default "confirm"), the left/right toggle and return
 * dispatch bindings, the cancel/confirm button row with the active-highlight
 * styling, the `label` override for the cancel slot, and the static
 * DialogConfirm.show helper resolving true/false/undefined (undefined on
 * escape). Changed: upstream's Locale.titlecase is inlined as a local helper
 * (util/locale is not ported). The horizontal selection model here seeds the
 * Phase 4 Tab Select and Radio group exemplars.
 */
import { TextAttributes } from "@opentui/core";
import { For } from "solid-js";

import { createStore } from "solid-js/store";

import { useTheme } from "../context/theme";
import { useBindings } from "../keymap";
import { useDialog } from "./dialog";

export interface DialogConfirmProps {
  readonly title: string;
  readonly message: string;
  readonly onConfirm?: () => void;
  readonly onCancel?: () => void;
  readonly label?: string;
}

export type DialogConfirmResult = boolean | undefined;

function titlecase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

/** Shows confirmation choices, with arrow-key selection and callbacks before the dialog stack clears. */
export function DialogConfirm(props: DialogConfirmProps) {
  const dialog = useDialog();
  const { theme } = useTheme();
  const [store, setStore] = createStore({
    active: "confirm",
  });

  useBindings(() => ({
    bindings: [
      {
        key: "return",
        desc: "Confirm dialog selection",
        group: "Dialog",
        cmd: () => {
          if (store.active === "confirm") props.onConfirm?.();
          if (store.active === "cancel") props.onCancel?.();
          dialog.clear();
        },
      },
      {
        key: "left",
        desc: "Previous dialog option",
        group: "Dialog",
        cmd: () => {
          setStore("active", store.active === "confirm" ? "cancel" : "confirm");
        },
      },
      {
        key: "right",
        desc: "Next dialog option",
        group: "Dialog",
        cmd: () => {
          setStore("active", store.active === "confirm" ? "cancel" : "confirm");
        },
      },
    ],
  }));
  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.textMuted}>{props.message}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <For each={["cancel", "confirm"] as const}>
          {(key) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={key === store.active ? theme.primary : undefined}
              onMouseUp={() => {
                if (key === "confirm") props.onConfirm?.();
                if (key === "cancel") props.onCancel?.();
                dialog.clear();
              }}
            >
              <text fg={key === store.active ? theme.selectedListItemText : theme.textMuted}>
                {titlecase(key === "cancel" ? (props.label ?? key) : key)}
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
  );
}

/** Resolves with the chosen boolean, or `undefined` if the dialog closes without a choice. */
DialogConfirm.show = async (
  dialog: DialogContext,
  title: string,
  message: string,
  label?: string,
) => {
  return new Promise<DialogConfirmResult>((resolve) => {
    dialog.replace(
      () => (
        <DialogConfirm
          title={title}
          message={message}
          onConfirm={() => resolve(true)}
          onCancel={() => resolve(false)}
          label={label}
        />
      ),
      () => resolve(undefined),
    );
  });
};
