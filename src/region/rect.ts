import type { Bounds, RegionShape } from './types.js';
import { setStyles } from '../util/style.js';
import { round2 } from '../util/geometry.js';

/**
 * A rectangle via `transform` — compositor-only, with no layout on every frame.
 *
 * The layer's base size is a unit 1×1 box (the mount sets it, because popover UA styles impose
 * `fit-content` and have to be overridden anyway). The region comes from scaling that box:
 * `scale(w, h)`.
 *
 * Important: what gets scaled is a SOLID white color, so quality does not depend on how the
 * compositor rasterizes the tiny source.
 */
export const rectShape: RegionShape = {
  kind: 'rect',

  apply(layer: HTMLElement, bounds: Bounds): void {
    const x = round2(bounds.x);
    const y = round2(bounds.y);
    const w = round2(bounds.width);
    const h = round2(bounds.height);
    setStyles(layer, {
      'transform-origin': '0 0',
      transform: `translate3d(${x}px, ${y}px, 0) scale(${w}, ${h})`,
    });
  },

  reset(layer: HTMLElement): void {
    setStyles(layer, { transform: 'none' });
  },
};
