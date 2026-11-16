/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/ui/link.tsx L18 clickable text plus
 * component/workspace-label.tsx L13-L18 multi-span segment-with-separator
 * pattern, MIT licensed). Kept: the run-of-segments-with-muted-separators
 * layout and the clickable-text idiom. Changed: segments become a generic
 * { label, onClick? }[] prop with a configurable separator (default ' > ');
 * the run is a row of <text> elements instead of spans because spans do
 * not take mouse handlers, so per-segment clicks need text nodes.
 * Clickable and last segments render theme.text, the rest theme.textMuted.
 * Dropped: WorkspaceStatus semantics and the `open` package (callers
 * supply onClick).
 * Needs only ThemeProvider.
 */
import { For, Show } from "solid-js";

import { useTheme } from "../context/theme";

export interface BreadcrumbSegment {
  readonly label: string;
  readonly onClick?: () => void;
}

export interface BreadcrumbsProps {
  readonly segments: readonly BreadcrumbSegment[];
  readonly separator?: string;
}

/** Shows a path whose segments invoke their optional callbacks on mouse release. */
export function Breadcrumbs(props: BreadcrumbsProps) {
  const { theme } = useTheme();

  return (
    <box flexDirection="row">
      <For each={props.segments}>
        {(segment, index) => (
          <>
            <Show when={index() > 0}>
              <text fg={theme.textMuted} wrapMode="none">
                {props.separator ?? " > "}
              </text>
            </Show>
            <text
              fg={
                segment.onClick || index() === props.segments.length - 1
                  ? theme.text
                  : theme.textMuted
              }
              wrapMode="none"
              onMouseUp={() => segment.onClick?.()}
            >
              {segment.label}
            </text>
          </>
        )}
      </For>
    </box>
  );
}
