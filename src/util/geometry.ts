import type { Bounds, Point } from '../region/types.js';

/**
 * Bounds from two points. The drag may go in any direction: we take min and the absolute value, so
 * a "right-up" drag gives the same region as "left-down".
 */
export function boundsFromPoints(anchor: Point, current: Point): Bounds {
  return {
    x: Math.min(anchor.x, current.x),
    y: Math.min(anchor.y, current.y),
    width: Math.abs(current.x - anchor.x),
    height: Math.abs(current.y - anchor.y),
  };
}

export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** A point in VIEWPORT coordinates: the region lives in the viewport's system, not the document's. */
export function pointFromEvent(event: { clientX: number; clientY: number }): Point {
  return { x: event.clientX, y: event.clientY };
}

/** Round to 1/100 px: less noise in the transform value, while keeping the subpixel. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
