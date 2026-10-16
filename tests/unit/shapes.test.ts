import { describe, it, expect } from 'vitest';
import { circleShape, ellipseShape } from '../../src/region/ellipse.js';
import { rectShape } from '../../src/region/rect.js';
import type { Bounds } from '../../src/region/types.js';

/*
 * The geometry of a region is written through CSSOM only, so `el.style` as a plain map is a
 * faithful stand-in here. There is deliberately no DOM in the unit harness (see
 * vitest.config.ts): what needs a real box tree, real pixels and three engines lives in
 * tests/smoke. What this file fixes is the arithmetic and the SHAPE OF THE CONTRACT —
 * which bounds a shape claims (fit) and what it writes to the layer.
 */
function fakeLayer(): { el: HTMLElement; css: Map<string, string> } {
  const css = new Map<string, string>();
  const el = {
    style: {
      setProperty: (key: string, value: string): void => void css.set(key, value),
      removeProperty: (key: string): void => void css.delete(key),
      getPropertyValue: (key: string): string => css.get(key) ?? '',
    },
  } as unknown as HTMLElement;
  return { el, css };
}

/** The silhouette both round shapes are cut with — a circle inscribed in the unit 1×1 box. */
const SILHOUETTE = "path('M 0.5 0 A 0.5 0.5 0 0 1 0.5 1 A 0.5 0.5 0 0 1 0.5 0 Z')";

const BOX: Bounds = { x: 20, y: 30, width: 600, height: 400 };

describe('fit — the bounds the shape really occupies', () => {
  it('rect occupies the whole requested box, and hands back the very same object', () => {
    // Not "equal to": identical. v0.1 callers must see no change at all, not an equal copy.
    expect(rectShape.fit(BOX)).toBe(BOX);
  });

  it('ellipse occupies the whole requested box too', () => {
    expect(ellipseShape.fit(BOX)).toBe(BOX);
  });

  it('circle takes the largest square that fits, centred', () => {
    // A 600×400 drag over a circle leaves 100 px of invisible margin on each side.
    expect(circleShape.fit(BOX)).toEqual({ x: 120, y: 30, width: 400, height: 400 });
  });

  it('circle on a tall box is limited by the width', () => {
    expect(circleShape.fit({ x: 0, y: 0, width: 100, height: 250 })).toEqual({
      x: 0,
      y: 75,
      width: 100,
      height: 100,
    });
  });

  it('circle on an already square box changes nothing', () => {
    const square: Bounds = { x: 560, y: 370, width: 160, height: 160 };
    expect(circleShape.fit(square)).toEqual(square);
  });

  it('circle of a degenerate box stays degenerate instead of going negative', () => {
    expect(circleShape.fit({ x: 5, y: 5, width: 0, height: 0 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
    const line = circleShape.fit({ x: 0, y: 10, width: 0, height: 40 });
    expect(line.width).toBe(0);
    expect(line.height).toBe(0);
    expect(line.y).toBe(30); // the middle of the requested box, not its edge
  });

  it('fit never mutates the bounds it was given', () => {
    const bounds: Bounds = { x: 20, y: 30, width: 600, height: 400 };
    circleShape.fit(bounds);
    expect(bounds).toEqual(BOX);
  });

  it('fractional sizes are not rounded away before apply', () => {
    // Rounding lives in apply (one place, round2); fit must stay exact so that a
    // fraction of a pixel is not lost twice.
    expect(circleShape.fit({ x: 0, y: 0, width: 100.5, height: 100.25 })).toEqual({
      x: 0.125,
      y: 0,
      width: 100.25,
      height: 100.25,
    });
  });
});

describe('apply — what actually lands on the layer', () => {
  it('rect writes the v0.1 transform and touches nothing else', () => {
    const { el, css } = fakeLayer();
    rectShape.apply(el, BOX);
    expect(css.get('transform-origin')).toBe('0 0');
    expect(css.get('transform')).toBe('translate3d(20px, 30px, 0) scale(600, 400)');
    // The round shapes' property must not leak into a rectangle.
    expect(css.has('clip-path')).toBe(false);
  });

  it('rect rounds coordinates to 1/100 px', () => {
    const { el, css } = fakeLayer();
    rectShape.apply(el, { x: 0.12345, y: 1.005, width: 10.987, height: 3.333 });
    expect(css.get('transform')).toBe('translate3d(0.12px, 1px, 0) scale(10.99, 3.33)');
  });

  it('ellipse writes the silhouette on the unit box, scaled by the same transform', () => {
    const { el, css } = fakeLayer();
    ellipseShape.apply(el, BOX);
    expect(css.get('transform')).toBe('translate3d(20px, 30px, 0) scale(600, 400)');
    expect(css.get('clip-path')).toBe(SILHOUETTE);
  });

  it('circle writes the FITTED square, not the requested box', () => {
    // apply trusts fit: the engine always calls it with fitted bounds.
    const { el, css } = fakeLayer();
    const fitted = circleShape.fit(BOX);
    circleShape.apply(el, fitted);
    expect(css.get('transform')).toBe('translate3d(120px, 30px, 0) scale(400, 400)');
    expect(css.get('clip-path')).toBe(SILHOUETTE);
  });

  it('both round shapes are cut with one and the same path', () => {
    // One silhouette string, shared: a second copy is a second thing to keep in sync.
    const ellipse = fakeLayer();
    const circle = fakeLayer();
    ellipseShape.apply(ellipse.el, BOX);
    circleShape.apply(circle.el, BOX);
    expect(circle.css.get('clip-path')).toBe(ellipse.css.get('clip-path'));
  });

  it('the path is written in unit-box coordinates — no size enters it', () => {
    // If a size ever leaked into the path, two different boxes would give two different
    // strings, and the scale(rx, ry) in the transform is the only thing allowed to differ.
    const small = fakeLayer();
    const large = fakeLayer();
    ellipseShape.apply(small.el, { x: 0, y: 0, width: 3, height: 7 });
    ellipseShape.apply(large.el, { x: 100, y: 100, width: 1600, height: 900 });
    expect(small.css.get('clip-path')).toBe(large.css.get('clip-path'));
  });
});

describe('reset — back to the neutral state', () => {
  it('rect removes the transform', () => {
    const { el, css } = fakeLayer();
    rectShape.apply(el, BOX);
    rectShape.reset(el);
    expect(css.get('transform')).toBe('none');
  });

  it('a round shape removes the silhouette as well as the transform', () => {
    // Otherwise the next region — a rectangle — would appear cut, and the layer is reused.
    for (const shape of [ellipseShape, circleShape]) {
      const { el, css } = fakeLayer();
      shape.apply(el, BOX);
      shape.reset(el);
      expect(css.get('transform'), shape.kind).toBe('none');
      expect(css.get('clip-path'), shape.kind).toBe('none');
    }
  });
});

describe('the contract itself', () => {
  it('every shape declares fit, apply and reset', () => {
    for (const shape of [rectShape, ellipseShape, circleShape]) {
      expect(typeof shape.fit, shape.kind).toBe('function');
      expect(typeof shape.apply, shape.kind).toBe('function');
      expect(typeof shape.reset, shape.kind).toBe('function');
    }
  });
});
