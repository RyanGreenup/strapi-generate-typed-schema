/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/component/prompt/index.tsx L1321-L1440, MIT licensed):
 * the managed prompt textarea. The Phase 6 src/components/textarea.tsx
 * wraps the same intrinsic for dialog prompts but does not expose
 * onContentChange, onPaste, or maxHeight and adds busy/Spinner chrome, so
 * this exemplar uses the raw <textarea> intrinsic directly.
 * Kept: the left rule wrapper (SplitBorder.customBorderChars with a
 * U+2579 bottomLeft cap), the backgroundElement editing surface, the
 * maxHeight memo defaulting to Math.max(6, floor(height / 3)), the
 * double-setTimeout IME flush before reading plainText on submit, CRLF/CR
 * paste normalization at the boundary, syntaxStyle from the theme, the
 * disabled key/paste guards, mouse-down focus, and .focus() from ref.
 * Dropped: extmarks and prompt-part placeholders, autocomplete wiring,
 * history/stash/frecency, the dispatchCommand("prompt.paste") empty-paste
 * fallback, the getClipboardText override, and the agent footer row.
 * Changed: the border highlight tracks the renderable's focused/blurred
 * events instead of the leader-key store; syntax highlighting is gated by a
 * plain `syntax` prop instead of the prompt mode.
 * Needs only ThemeProvider; no keymap or dialog wiring.
 */
import type { KeyEvent, MouseEvent, PasteEvent, TextareaRenderable } from "@opentui/core";

import { decodePasteBytes, RenderableEvents } from "@opentui/core";
import { useTerminalDimensions } from "@opentui/solid";
import { createMemo, createSignal } from "solid-js";

import { useTheme } from "../context/theme";
import { SplitBorder } from "./border";

export interface CodeEditorProps {
  // Initial buffer content; the buffer is uncontrolled after mount.
  readonly value?: string;
  readonly onChange?: (value: string) => void;
  readonly onSubmit?: (value: string) => void;
  readonly placeholder?: string;
  readonly maxHeight?: number;
  readonly disabled?: boolean;
  // Apply the theme's tree-sitter syntax style to the buffer.
  readonly syntax?: boolean;
  readonly ref?: (renderable: TextareaRenderable) => void;
}

/** Shows an uncontrolled multiline editor that focuses after mount unless disabled. */
export function CodeEditor(props: CodeEditorProps) {
  const { theme, syntax } = useTheme();
  const dimensions = useTerminalDimensions();
  const [focused, setFocused] = createSignal(false);
  let input: TextareaRenderable | undefined;

  const maxHeight = createMemo(
    () => props.maxHeight ?? Math.max(6, Math.floor(dimensions().height / 3)),
  );

  return (
    <box
      width="100%"
      border={["left"]}
      borderColor={focused() ? theme.borderActive : theme.border}
      customBorderChars={{
        ...SplitBorder.customBorderChars,
        bottomLeft: "\u2579",
      }}
    >
      <box
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        paddingBottom={1}
        flexShrink={0}
        backgroundColor={theme.backgroundElement}
        flexGrow={1}
        width="100%"
      >
        <textarea
          width="100%"
          placeholder={props.placeholder}
          placeholderColor={theme.textMuted}
          textColor={theme.text}
          focusedTextColor={theme.text}
          minHeight={1}
          maxHeight={maxHeight()}
          initialValue={props.value}
          syntaxStyle={props.syntax ? syntax() : undefined}
          onContentChange={() => {
            if (input) props.onChange?.(input.plainText);
          }}
          onKeyDown={(key: KeyEvent) => {
            if (props.disabled) key.preventDefault();
          }}
          onSubmit={() => {
            // IME: double-defer so the last composed character (e.g. Korean
            // hangul) is flushed to plainText before we read it.
            setTimeout(
              () =>
                setTimeout(() => {
                  if (!input || input.isDestroyed) return;
                  props.onSubmit?.(input.plainText);
                }, 0),
              0,
            );
          }}
          onPaste={(event: PasteEvent) => {
            event.preventDefault();
            if (props.disabled) return;
            // Normalize line endings at the boundary; Windows ConPTY often
            // sends CR-only newlines in bracketed paste. CRLF first, then
            // any remaining CR.
            const normalized = decodePasteBytes(event.bytes)
              .replace(/\r\n/g, "\n")
              .replace(/\r/g, "\n");
            if (normalized) input?.insertText(normalized);
          }}
          onMouseDown={(event: MouseEvent) => event.target?.focus()}
          focusedBackgroundColor={theme.backgroundElement}
          cursorColor={props.disabled ? theme.backgroundElement : theme.text}
          ref={(renderable: TextareaRenderable) => {
            input = renderable;
            props.ref?.(renderable);
            renderable.on(RenderableEvents.FOCUSED, () => setFocused(true));
            renderable.on(RenderableEvents.BLURRED, () => setFocused(false));
            setTimeout(() => {
              if (renderable.isDestroyed || props.disabled) return;
              renderable.focus();
            }, 0);
          }}
        />
      </box>
    </box>
  );
}
