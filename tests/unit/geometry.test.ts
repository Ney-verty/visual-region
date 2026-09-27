import { describe, it, expect } from 'vitest';
import { boundsFromPoints, distance, pointFromEvent, round2 } from '../../src/util/geometry.js';

/*
 * The unit layer covers what is expensive or awkward to check in a browser:
 * the matrix of variants, exact arithmetic and edge behavior. Everything that
 * needs the real Popover API and pixels stays in tests/smoke (jsdom is powerless
 * there: it has no Popover API, and the instance honestly goes to `unsupported`).
 */

describe('boundsFromPoints', () => {
  it('drag to the right and down', () => {
    expect(boundsFromPoints({ x: 10, y: 20 }, { x: 110, y: 70 })).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
  });

  it('a drag to the left and up gives the same region', () => {
    const forward = boundsFromPoints({ x: 10, y: 20 }, { x: 110, y: 70 });
    const backward = boundsFromPoints({ x: 110, y: 70 }, { x: 10, y: 20 });
    expect(backward).toEqual(forward);
  });

  it('a mixed direction (right-up) gives no negative sizes', () => {
    const bounds = boundsFromPoints({ x: 0, y: 100 }, { x: 40, y: 40 });
    expect(bounds).toEqual({ x: 0, y: 40, width: 40, height: 60 });
    expect(bounds.width).toBeGreaterThanOrEqual(0);
    expect(bounds.height).toBeGreaterThanOrEqual(0);
  });

  it('a zero drag gives a zero-size region, not a negative one', () => {
    expect(boundsFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({
      x: 5,
      y: 5,
      width: 0,
      height: 0,
    });
  });

  it('fractional coordinates are kept as is', () => {
    expect(boundsFromPoints({ x: 0.5, y: 1.25 }, { x: 10.75, y: 3.5 })).toEqual({
      x: 0.5,
      y: 1.25,
      width: 10.25,
      height: 2.25,
    });
  });
});

describe('distance', () => {
  it('computes the Euclidean distance', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('unchanged by swapping the points', () => {
    expect(distance({ x: 3, y: 4 }, { x: 0, y: 0 })).toBe(distance({ x: 0, y: 0 }, { x: 3, y: 4 }));
  });

  it('zero between coincident points', () => {
    expect(distance({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });

  it('a fractional threshold is not "eaten" by rounding', () => {
    // Default threshold is 3: a 3 px gesture must cross the threshold exactly.
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 0 })).toBe(3);
    expect(distance({ x: 0, y: 0 }, { x: 2.99, y: 0 })).toBeLessThan(3);
  });
});

describe('pointFromEvent', () => {
  it('takes VIEWPORT coordinates, not page coordinates', () => {
    // The event also has pageX/pageY — the library must read clientX/clientY,
    // otherwise the region drifts on scroll (verified in smoke: "bound to the viewport").
    const event = { clientX: 12, clientY: 34, pageX: 112, pageY: 1034 };
    expect(pointFromEvent(event)).toEqual({ x: 12, y: 34 });
  });
});

describe('round2', () => {
  it('rounds to 1/100', () => {
    expect(round2(1.234567)).toBe(1.23);
    expect(round2(1.006)).toBe(1.01);
    expect(round2(-1.006)).toBe(-1.01);
  });

  it('does not corrupt integers or already-rounded values', () => {
    expect(round2(0)).toBe(0);
    expect(round2(7)).toBe(7);
    expect(round2(2.5)).toBe(2.5);
  });

  it('subpixels are preserved — rounding does not "collapse" small sizes to zero', () => {
    expect(round2(0.004)).toBe(0);
    expect(round2(0.4)).toBe(0.4);
  });

  it('0.5 on the boundary is rounded by binary-fraction arithmetic, not "as taught in school"', () => {
    // 1.005 in binary floating point is 1.00499999…, so 100.49999… rounds down.
    // The check fixes the fact: "fixing" this would mean adding custom arithmetic
    // for a hundredth of a pixel that is not visible on screen.
    expect(round2(1.005)).toBe(1);
    expect(round2(1.015)).toBe(1.01);
  });

  it('does not accumulate error over a long series of increments', () => {
    // 1000 steps of 0.1: without rounding at each step it would accumulate to 99.9999999999986.
    let acc = 0;
    for (let i = 0; i < 1000; i++) acc = round2(acc + 0.1);
    expect(acc).toBe(100);
  });
});
