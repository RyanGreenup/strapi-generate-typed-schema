/* Adapted from @opencode-ai/tui (github.com/anomalyco/opencode,
 * packages/tui/src/util/scroll.ts, MIT licensed). Kept: the fixed-speed
 * CustomSpeedScroll fallback. Dropped: useTuiConfig plumbing and the
 * MacOSScrollAccel branch; the speed is a plain argument with the same
 * default of 3 that upstream uses when no config is present. The Phase 3
 * listbox and Phase 5 empty-state exemplars inlined this class before it
 * was shared; new composites import it from here.
 */
import type { ScrollAcceleration } from "@opentui/core";

/** Gives the same configured scroll amount on every tick, independent of time. */
export class CustomSpeedScroll implements ScrollAcceleration {
  constructor(private readonly speed: number) {}

  tick(_now?: number): number {
    return this.speed;
  }

  reset(): void {}
}

/** Creates fixed-speed scroll acceleration with a default amount of three per tick. */
export function getScrollAcceleration(speed = 3): ScrollAcceleration {
  return new CustomSpeedScroll(speed);
}
