/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode, MIT
 * licensed). Upstream has no standalone chip visual: its
 * packages/tui/src/component/dialog-tag.tsx is a file-mention autocomplete
 * dialog, and the only chip-like renders are the " QUEUED " badge span
 * (routes/session/index.tsx#L1435, ported as Badge) and the "[x]" rows in
 * ui/dialog-export-options.tsx. Tag composes the Badge surface into a
 * removable chip: a compact box row over theme.backgroundElement with an
 * optional trailing remove glyph wired to onMouseUp (mouse pattern from
 * ui/dialog-alert.tsx#L42). The resource-backed picker pattern from
 * dialog-tag.tsx (createResource keyed on the filter, options memo, select
 * reports the value) lives in the example, fed by the Phase 3
 * FilteredSelect. Dropped from dialog-tag.tsx: useSDK file search,
 * useProject workspace scoping, useDialog, and its dead `filter` store
 * wiring (the filter is live here via FilteredSelect's onFilter).
 */
import type { RGBA } from "@opentui/core";

import { Show } from "solid-js";

import { useTheme } from "../context/theme";

export interface TagProps {
  readonly label: string;
  readonly color?: RGBA;
  readonly fg?: RGBA;
  readonly onRemove?: () => void;
}

/** Shows a padded label with an optional mouse-only remove action. */
export function Tag(props: TagProps) {
  const { theme } = useTheme();
  const bg = () => props.color ?? theme.backgroundElement;
  const fg = () => props.fg ?? theme.text;

  return (
    <box flexDirection="row" backgroundColor={bg()}>
      <text fg={fg()}>{` ${props.label} `}</text>
      <Show when={props.onRemove}>
        <text fg={theme.textMuted} onMouseUp={() => props.onRemove?.()}>
          {"x "}
        </text>
      </Show>
    </box>
  );
}
