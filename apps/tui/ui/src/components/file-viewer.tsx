/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/routes/session/index.tsx, MIT licensed): the BlockTool
 * panel chrome (L1987-L2026) wrapping either the Write tool's numbered code
 * view (L2098-L2119) or the Edit tool's diff view (L2388-L2430).
 * Kept: the chrome verbatim (left rule via SplitBorder.customBorderChars
 * with borderColor theme.background, hover backgroundMenu over
 * backgroundPanel, padded muted title, and the renderer text-selection
 * guard on mouse up so click actions never fire while text is selected),
 * the line-number gutter around highlighted code, and the full diff token
 * prop set with the width > 120 split/unified switch.
 * Dropped: ToolProps/part state and the error footer, Diagnostics,
 * usePathFormatter, the spinner title variant, the alwaysSeparate renderer
 * registry, and marginTop (message-list spacing).
 * Changed: composes the Phase 6 NumberedCode and DiffViewer exemplars
 * instead of raw <line_number>/<code>/<diff> intrinsics; the title defaults
 * from path + mode instead of the tool call.
 * Added: optional onClick (hover feedback only shows when it is set, as
 * upstream) and a view override for the diff auto split.
 * Needs only ThemeProvider; no keymap or dialog wiring.
 */
import { useRenderer } from "@opentui/solid";
import { createMemo, createSignal, Match, Switch } from "solid-js";

import { useTheme } from "../context/theme";
import { filetype } from "../util/filetype";
import { SplitBorder } from "./border";
import { DiffViewer } from "./diff-viewer";
import { NumberedCode } from "./line-number";

export interface FileViewerProps {
  readonly path: string;
  readonly mode: "code" | "diff";
  // Source text for mode "code".
  readonly content?: string;
  // Unified diff text (---/+++/@@ hunks) for mode "diff".
  readonly diff?: string;
  readonly wrapMode?: "word" | "char" | "none";
  readonly title?: string;
  // Diff layout; "auto" splits when the terminal is wider than 120 cells.
  readonly view?: "unified" | "split" | "auto";
  readonly onClick?: () => void;
}

/** Shows supplied source or diff text with path-derived syntax, without filesystem access. */
export function FileViewer(props: FileViewerProps) {
  const { theme } = useTheme();
  const renderer = useRenderer();
  const [hover, setHover] = createSignal(false);
  const title = createMemo(() => {
    if (props.title !== undefined) return props.title;
    return props.mode === "diff" ? `# Diff ${props.path}` : `# ${props.path}`;
  });

  return (
    <box
      border={["left"]}
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      gap={1}
      backgroundColor={hover() ? theme.backgroundMenu : theme.backgroundPanel}
      customBorderChars={SplitBorder.customBorderChars}
      borderColor={theme.background}
      onMouseOver={() => props.onClick && setHover(true)}
      onMouseOut={() => setHover(false)}
      onMouseUp={() => {
        // Guard: a click that ends a text selection must not trigger the
        // action, so copying from the panel stays safe.
        const selected = renderer.getSelection()?.getSelectedText();
        if (selected !== undefined && selected !== "") return;
        props.onClick?.();
      }}
    >
      <text paddingLeft={3} fg={theme.textMuted}>
        {title()}
      </text>
      <Switch>
        <Match when={props.mode === "diff"}>
          <box paddingLeft={1}>
            <DiffViewer
              diff={props.diff ?? ""}
              filetype={filetype(props.path)}
              view={props.view}
              wrapMode={props.wrapMode}
            />
          </box>
        </Match>
        <Match when={true}>
          <NumberedCode content={props.content ?? ""} filetype={filetype(props.path)} />
        </Match>
      </Switch>
    </box>
  );
}
