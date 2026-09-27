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
  /** Writes the layer's geometry. Only through util/style.ts (CSSOM, see PLAN §3.6). */
  apply(layer: HTMLElement, bounds: Bounds): void;
  /** Returns the layer to its neutral state. */
  reset(layer: HTMLElement): void;
}
