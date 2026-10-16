export interface Point {
  x: number;
  y: number;
}

/** A rectangle in viewport coordinates. */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The shape of a region. The contract is deliberately narrow: a shape owns the layer's geometry
 * only — pixels are the renderer's business, and "when it appears" is the controller's.
 */
export interface RegionShape {
  readonly kind: string;
  /**
   * The bounds the shape really occupies inside the requested ones. For a rectangle that is
   * the whole box (the identity); for a circle — the `min(width, height)` square in its middle.
   *
   * The engine normalizes through `fit` ONCE, so the layer, `getBounds()` and the `change`
   * event all tell the same story. Without it the API would report a rectangle the user
   * cannot see (a circle's box is not the circle's bounds), and a caller computing an
   * intersection would be wrong by the invisible margin.
   */
  fit(bounds: Bounds): Bounds;
  /** Writes the layer's geometry. Only through util/style.ts (CSSOM, see PLAN §3.6). */
  apply(layer: HTMLElement, bounds: Bounds): void;
  /** Returns the layer to its neutral state. */
  reset(layer: HTMLElement): void;
}
