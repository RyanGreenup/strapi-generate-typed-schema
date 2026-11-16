/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/routes/session/index.tsx L1635-L1677 ReasoningHeader
 * plus its caller's clickable header + conditional body L1594-L1629, MIT
 * licensed). Kept: the '+ '/'- ' disclosure marker, the Spinner header
 * while pending, the header color dimming to theme.thinkingOpacity while
 * open (RGBA.fromValues on the base color), onMouseUp toggle on the header
 * box, Show-gated body. Changed: base header color is a prop defaulting to
 * theme.warning; open is controlled (open/onToggle) or falls back to an
 * internal signal; body is plain children. Dropped: the ReasoningPart SDK
 * type and time.end done detection (now the pending prop), the thinking
 * mode gate, and Locale.duration timing.
 * Needs only ThemeProvider.
 */
import type { JSX } from "solid-js";

import { RGBA } from "@opentui/core";
import { createSignal, Show } from "solid-js";

import { useTheme } from "../context/theme";
import { Spinner } from "./spinner";

export interface AccordionProps {
  readonly title: string;
  readonly open?: boolean;
  readonly onToggle?: (open: boolean) => void;
  readonly pending?: boolean;
  readonly color?: RGBA;
  readonly children?: JSX.Element;
}

/** Toggles its body on header clicks, with internal state when `open` is absent. */
export function Accordion(props: AccordionProps) {
  const { theme } = useTheme();
  const [internal, setInternal] = createSignal(false);
  const open = () => props.open ?? internal();

  function toggle() {
    const next = !open();
    if (props.open === undefined) setInternal(next);
    props.onToggle?.(next);
  }

  const base = () => props.color ?? theme.warning;
  const fg = () =>
    open() ? RGBA.fromValues(base().r, base().g, base().b, theme.thinkingOpacity) : base();

  return (
    <box flexDirection="column">
      <box onMouseUp={toggle}>
        <Show
          when={!props.pending}
          fallback={
            <box flexDirection="row">
              <Spinner color={fg()}>{props.title}</Spinner>
            </box>
          }
        >
          <text fg={fg()} wrapMode="none">
            <span>{open() ? "- " : "+ "}</span>
            <span>{props.title}</span>
          </text>
        </Show>
      </box>
      <Show when={open()}>
        <box paddingLeft={2} marginTop={1}>
          {props.children}
        </box>
      </Show>
    </box>
  );
}
