import type { DialogContext } from "./dialog";

/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/ui/dialog-alert.tsx, MIT licensed). Kept: everything --
 * the return binding, the esc label that clears the dialog on click, the
 * right-aligned "ok" button, and the static DialogAlert.show helper that
 * resolves on both confirm and close. Dropped: nothing. The selected-state
 * button box (primary background, selectedListItemText foreground) seeds the
 * Phase 5 Button exemplar.
 */
import { TextAttributes } from "@opentui/core";

import { useTheme } from "../context/theme";
import { useBindings } from "../keymap";
import { useDialog } from "./dialog";

export interface DialogAlertProps {
  readonly title: string;
  readonly message: string;
  readonly onConfirm?: () => void;
}

/** Shows alert content that confirms on Enter or click, then clears the dialog stack. */
export function DialogAlert(props: DialogAlertProps) {
  const dialog = useDialog();
  const { theme } = useTheme();

  useBindings(() => ({
    bindings: [
      {
        key: "return",
        desc: "Confirm alert",
        group: "Dialog",
        cmd: () => {
          props.onConfirm?.();
          dialog.clear();
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
        <box
          paddingLeft={3}
          paddingRight={3}
          backgroundColor={theme.primary}
          onMouseUp={() => {
            props.onConfirm?.();
            dialog.clear();
          }}
        >
          <text fg={theme.selectedListItemText}>ok</text>
        </box>
      </box>
    </box>
  );
}

/** Replaces the active dialog with an alert and resolves on confirmation or dismissal. */
DialogAlert.show = async (dialog: DialogContext, title: string, message: string) => {
  return new Promise<void>((resolve) => {
    dialog.replace(
      () => <DialogAlert title={title} message={message} onConfirm={() => resolve()} />,
      () => resolve(),
    );
  });
};
