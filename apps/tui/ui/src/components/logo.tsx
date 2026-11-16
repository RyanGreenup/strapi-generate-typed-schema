import type { RGBA } from "@opentui/core";
import type { JSX } from "@opentui/solid";

import { TextAttributes } from "@opentui/core";
import { For } from "solid-js";

import { useTheme } from "../context/theme";
import { tint } from "../theme";

/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/component/logo.tsx and packages/tui/src/logo.ts, MIT
 * licensed). Logo ports the hand-rendered block-art banner verbatim: each
 * character becomes a <text> cell, and the marker chars `_ ^ ~ ,` encode a
 * faux 3D shadow mixed from theme.background via tint(). The hardcoded
 * upstream art is kept as the default but exposed through the `art` prop.
 * AsciiFont is new: upstream draws its banner by hand, while this wrapper
 * uses the built-in <ascii_font> renderable with a theme.text default color.
 */

export type AsciiFontName = NonNullable<JSX.IntrinsicElements["ascii_font"]["font"]>;

export interface AsciiFontProps {
  readonly text: string;
  readonly font?: AsciiFontName;
  readonly color?: RGBA;
}

/** Draws text with a terminal ASCII font, with `tiny` as the default font. */
export function AsciiFont(props: AsciiFontProps) {
  const { theme } = useTheme();

  return (
    <ascii_font font={props.font ?? "tiny"} text={props.text} color={props.color ?? theme.text} />
  );
}

export interface LogoArt {
  readonly left: readonly string[];
  readonly right: readonly string[];
}

// Ported verbatim from packages/tui/src/logo.ts. The marker chars `_ ^ ~ ,`
// are replaced with shaded half-block cells at render time.
export const LOGO: LogoArt = {
  left: [
    "                   ",
    "█▀▀█ █▀▀█ █▀▀█ █▀▀▄",
    "█__█ █__█ █^^^ █__█",
    "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀",
  ],
  right: [
    "             ▄     ",
    "█▀▀▀ █▀▀█ █▀▀█ █▀▀█",
    "█___ █__█ █__█ █^^^",
    "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀",
  ],
};

export interface LogoProps {
  readonly art?: LogoArt;
}

/** Draws paired logo rows and expands marker characters into theme-colored block shadows. */
export function Logo(props: LogoProps) {
  const { theme } = useTheme();
  const art = () => props.art ?? LOGO;

  const renderLine = (line: string, fg: RGBA, bold: boolean): JSX.Element[] => {
    const shadow = tint(theme.background, fg, 0.25);
    const attrs = bold ? TextAttributes.BOLD : undefined;
    return Array.from(line).map((char) => {
      if (char === "_") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            {" "}
          </text>
        );
      }
      if (char === "^") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        );
      }
      if (char === "~") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        );
      }
      if (char === ",") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▄
          </text>
        );
      }
      return (
        <text fg={fg} attributes={attrs} selectable={false}>
          {char}
        </text>
      );
    });
  };

  return (
    <box>
      <For each={art().left}>
        {(line, index) => (
          <box flexDirection="row" gap={1}>
            <box flexDirection="row">{renderLine(line, theme.textMuted, false)}</box>
            <box flexDirection="row">
              {renderLine(art().right[index()] ?? "", theme.text, true)}
            </box>
          </box>
        )}
      </For>
    </box>
  );
}
