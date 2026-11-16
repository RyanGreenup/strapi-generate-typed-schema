import { createSignal, Show } from "solid-js";

import { useTheme } from "../context/theme";
import { Input } from "./input";

/*
 * Net-new behavior on top of the Input exemplar (src/components/input.tsx,
 * itself adapted from @opencode-ai/tui packages/tui/src/ui/dialog-select.tsx
 * L570-L596, MIT licensed). opencode has no concealed input anywhere
 * (CHECKLIST.md Phase 4 note; InputRenderable exposes no mask option), so
 * masking is added with the checklist's suggested color trick: the input's
 * text colors are set to the field background (backgroundPanel) so real
 * glyphs are invisible while the cursor stays visible, and an absolutely
 * positioned <text> overlay draws maskChar repeated to the value length.
 * The `reveal` prop restores normal colors and hides the overlay. Closest
 * upstream precedent for the color-swap: ui/dialog-prompt.tsx L96-L98 busy
 * dimming.
 */

export interface PasswordInputProps {
  readonly placeholder?: string;
  readonly reveal?: boolean;
  readonly maskChar?: string;
  readonly autofocus?: boolean;
  readonly disabled?: boolean;
  readonly onInput?: (value: string) => void;
  readonly onSubmit?: (value: string) => void;
}

/** Conceals input with mask glyphs unless revealed, while callbacks receive the original text. */
export function PasswordInput(props: PasswordInputProps) {
  const { theme } = useTheme();
  const [length, setLength] = createSignal(0);
  const mask = () => (props.maskChar ?? "*").repeat(length());
  const conceal = () => !props.reveal;

  return (
    <box>
      <Input
        placeholder={props.placeholder ?? "Enter password"}
        autofocus={props.autofocus}
        disabled={props.disabled}
        textColor={conceal() ? theme.backgroundPanel : undefined}
        focusedTextColor={conceal() ? theme.backgroundPanel : theme.text}
        onInput={(value) => {
          setLength(value.length);
          props.onInput?.(value);
        }}
        onSubmit={props.onSubmit}
      />
      <Show when={conceal() && length() > 0}>
        <text position="absolute" left={0} top={0} zIndex={1} fg={theme.textMuted}>
          {mask()}
        </text>
      </Show>
    </box>
  );
}
