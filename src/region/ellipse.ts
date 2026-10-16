import type { Bounds, RegionShape } from './types.js';
import { setStyles } from '../util/style.js';
import { round2 } from '../util/geometry.js';

/**
 * Round regions: an ellipse (the box itself) and a circle (the `min(width, height)` square
 * inside it).
 *
 * Both share one silhouette: a circle inscribed in the layer's unit 1×1 box, written as an
 * SVG path in the box's own coordinates. The size, as with `rect`, comes from the same
 * `transform` (`scale(w, h)` over the unit box), so no new geometry path appears in the
 * engine and a round region costs exactly what a rectangle costs.
 *
 * The path is written ONCE and is the same for both forms and for every size: scaling a unit
 * circle gives an ellipse, and a circle is an ellipse whose fitted box is square.
 *
 * Why this mechanism: step 0 (spike/v02-shape, tasks/2026-10-13-v02-follow-and-shapes)
 * measured the candidates on 18 engine × DPR cells with two independent instruments, and the
 * human closed the choice on 2026-10-14 (STOP 3) — including the known limitation recorded
 * in REPORT.md ("Known limitations"): WebKit shifts the shoulder of a large ellipse by up to
 * ~2 device-px at DPR 2. This is not a defect of the call site; nothing here works around it.
 */
const SILHOUETTE = "path('M 0.5 0 A 0.5 0.5 0 0 1 0.5 1 A 0.5 0.5 0 0 1 0.5 0 Z')";

function roundShape(kind: string, fit: (bounds: Bounds) => Bounds): RegionShape {
  return {
    kind,

    fit,

    apply(layer: HTMLElement, bounds: Bounds): void {
      const x = round2(bounds.x);
      const y = round2(bounds.y);
      const w = round2(bounds.width);
      const h = round2(bounds.height);
      setStyles(layer, {
        'transform-origin': '0 0',
        transform: `translate3d(${x}px, ${y}px, 0) scale(${w}, ${h})`,
        'clip-path': SILHOUETTE,
      });
    },

    reset(layer: HTMLElement): void {
      setStyles(layer, { transform: 'none', 'clip-path': 'none' });
    },
  };
}

/** An ellipse: fills the whole box it was given. */
export const ellipseShape: RegionShape = roundShape('ellipse', (bounds) => bounds);

/**
 * A circle: the largest one that fits the box, centred in it. The requested box is a bounding
 * box, exactly as the drag produced it — a 600×400 drag over a circle gives a 400×400 region
 * in the middle, and that fitted square is what the engine reports as the bounds.
 */
export const circleShape: RegionShape = roundShape('circle', (bounds) => {
  const side = Math.min(bounds.width, bounds.height);
  return {
    x: bounds.x + (bounds.width - side) / 2,
    y: bounds.y + (bounds.height - side) / 2,
    width: side,
    height: side,
  };
});
