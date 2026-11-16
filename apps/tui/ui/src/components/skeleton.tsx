/*
 * Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/component/spinner.tsx#L12, MIT licensed): the
 * animation-preference pattern - upstream gates its animated spinner
 * behind `kv.get("animations_enabled", true)` and falls back to a static
 * placeholder glyph. Kept: the same gate shape, adapted per the porting
 * rule as an `animated` prop with the same default (like Spinner's
 * `enabled`). Changed: upstream has no skeleton component; the animated
 * placeholder here is the Phase 0 PulseBox exemplar (breathing
 * backgroundElement block) and the static fallback is a plain
 * backgroundElement box of the same size.
 */
import { Show } from "solid-js";

import { useTheme } from "../context/theme";
import { PulseBox } from "./pulse-box";

export interface SkeletonProps {
  readonly width?: number | `${number}%`;
  readonly height?: number | `${number}%`;
  readonly animated?: boolean;
}

/** Shows a placeholder surface with a pulse unless `animated` is false. */
export function Skeleton(props: SkeletonProps) {
  const { theme } = useTheme();
  const width = () => props.width ?? "100%";
  const height = () => props.height ?? 1;

  return (
    <Show
      when={props.animated ?? true}
      fallback={<box width={width()} height={height()} backgroundColor={theme.backgroundElement} />}
    >
      <box width={width()} height={height()}>
        <PulseBox color={theme.backgroundElement} />
      </box>
    </Show>
  );
}
