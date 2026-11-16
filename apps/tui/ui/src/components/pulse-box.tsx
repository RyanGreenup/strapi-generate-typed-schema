// Custom-renderable registration exemplar, pattern adapted from opencode
// (.agents/opencode/packages/tui/src/component/bg-pulse.tsx).
// Dropped: the GoUpsellArt painter, useTheme context coupling, and the
// renderer FPS mutation. What remains is the three-part recipe for adding
// a new JSX intrinsic to @opentui/solid:
//   1. Subclass a Renderable (here FrameBufferRenderable) and override
//      renderSelf; option setters call requestRender so prop changes
//      repaint.
//   2. Augment the OpenTUIComponents interface via declare module
//      "@opentui/solid" so the new tag is typed in JSX.
//   3. Call extend({ tag: Class }) at module load to register it with the
//      Solid reconciler.
import type { OptimizedBuffer, RenderableOptions, RenderContext } from "@opentui/core";

import { FrameBufferRenderable, RGBA } from "@opentui/core";
import { extend } from "@opentui/solid";

const DEFAULT_PULSE_COLOR = RGBA.fromHex("#fab283");
const PULSE_PERIOD_SECONDS = 2;

type PulseBoxOptions = RenderableOptions<FrameBufferRenderable> & {
  color?: RGBA;
};

/** Paints an opaque color pulse with a two-second period and live redraws by default. */
export class PulseBoxRenderable extends FrameBufferRenderable {
  private _color: RGBA = DEFAULT_PULSE_COLOR;
  private elapsed = 0;

  constructor(ctx: RenderContext, options: PulseBoxOptions = {}) {
    const width = typeof options.width === "number" ? options.width : 1;
    const height = typeof options.height === "number" ? options.height : 1;
    super(ctx, {
      ...options,
      width,
      height,
      live: options.live ?? true,
      respectAlpha: false,
    });

    if (options.width !== undefined && typeof options.width !== "number")
      this.width = options.width;
    if (options.height !== undefined && typeof options.height !== "number")
      this.height = options.height;
    if (options.color) this._color = options.color;
  }

  get color(): RGBA {
    return this._color;
  }

  set color(value: RGBA | undefined) {
    const next = value ?? DEFAULT_PULSE_COLOR;
    if (next === this._color) return;
    this._color = next;
    this.requestRender();
  }

  protected override renderSelf(buffer: OptimizedBuffer, deltaTime = 0): void {
    if (!this.visible || this.isDestroyed) return;

    this.elapsed += deltaTime / 1000;
    const phase = (this.elapsed % PULSE_PERIOD_SECONDS) / PULSE_PERIOD_SECONDS;
    const intensity = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(phase * 2 * Math.PI));
    const { r, g, b } = this._color;
    this.frameBuffer.clear(RGBA.fromValues(r * intensity, g * intensity, b * intensity, 1));
    super.renderSelf(buffer);
  }
}

declare module "@opentui/solid" {
  interface OpenTUIComponents {
    pulse_box: typeof PulseBoxRenderable;
  }
}

extend({ pulse_box: PulseBoxRenderable });

export interface PulseBoxProps {
  readonly color?: RGBA;
  readonly width?: number | `${number}%`;
  readonly height?: number | `${number}%`;
}

/** Fills the available area with a live color pulse, independent of theme context. */
export function PulseBox(props: PulseBoxProps) {
  return (
    <pulse_box
      width={props.width ?? "100%"}
      height={props.height ?? "100%"}
      color={props.color ?? DEFAULT_PULSE_COLOR}
      live
    />
  );
}
