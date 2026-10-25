import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VisualRegion, visualRegion } from '../../src/index.js';
import type { VisualRegionOptions } from '../../src/index.js';
import { resetWarnings } from '../../src/util/warn.js';

/*
 * setOptions() validation is atomic: a patch refused by normalizeSpec() leaves the stored
 * options, the active spec and the state exactly as they were. These checks run in Node, where
 * the instance is `unsupported`; that is enough, because the divergence lived in the options /
 * spec pair, not in the layer. The live-page side (layer identity, bounds, computed colour) is
 * covered by tests/smoke/suite.js.
 */

/**
 * The invariant is internal — there is no public options getter, and this slice deliberately
 * does not add one. TypeScript's `private` is erased at runtime, so the fields are readable;
 * the cast is confined to this one helper.
 */
interface Internals {
  options: Record<string, unknown>;
  engine: {
    spec: {
      effect: { color: string };
      shape: { kind: string };
      controller: string;
      activation: string;
      threshold: number;
      persistent: boolean;
      followSize: { width: number; height: number };
    };
  };
}

const internals = (instance: VisualRegion): Internals => instance as unknown as Internals;

const snapshot = (instance: VisualRegion) => {
  const { options, engine } = internals(instance);
  return {
    state: instance.state,
    options: { ...options },
    spec: {
      effectColor: engine.spec.effect.color,
      shape: engine.spec.shape.kind,
      controller: engine.spec.controller,
      activation: engine.spec.activation,
      threshold: engine.spec.threshold,
      persistent: engine.spec.persistent,
      followSize: { ...engine.spec.followSize },
    },
  };
};

/** The active spec, read through the same defaults normalizeSpec() applies. */
const activeProjection = (instance: VisualRegion) => {
  const spec = internals(instance).engine.spec;
  return {
    effectColor: spec.effect.color,
    shape: spec.shape.kind,
    controller: spec.controller,
    activation: spec.activation,
    threshold: spec.threshold,
    persistent: spec.persistent,
    followSize: `${spec.followSize.width}x${spec.followSize.height}`,
  };
};

/** The stored options, read through the same defaults normalizeSpec() applies. */
const storedProjection = (instance: VisualRegion) => {
  const o = internals(instance).options;
  const size = o.followSize as number | { width: number; height: number } | undefined;
  const followSize =
    size === undefined
      ? '120x120'
      : typeof size === 'number'
        ? `${size}x${size}`
        : `${size.width}x${size.height}`;
  return {
    effectColor: typeof o.effectColor === 'string' ? o.effectColor.toLowerCase() : '#ffffff',
    shape: (o.shape as string | undefined) ?? 'rect',
    controller: (o.controller as string | undefined) ?? 'drag',
    activation: (o.activation as string | undefined) ?? 'modifier',
    threshold: typeof o.threshold === 'number' ? o.threshold : 3,
    persistent: o.persistent === true,
    followSize,
  };
};

const apply = (instance: VisualRegion, patch: Record<string, unknown>): void =>
  instance.setOptions(patch as unknown as VisualRegionOptions);

const warnings: string[] = [];

beforeEach(() => {
  resetWarnings();
  warnings.length = 0;
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('setOptions: rejected patch changes nothing', () => {
  it('invalid effectColor: throws, stored options and active spec stay as they were', () => {
    const vr = new VisualRegion({
      activation: 'programmatic',
      effectColor: '#ff00ff',
      shape: 'circle',
    });
    const before = snapshot(vr);

    expect(() => vr.setOptions({ effectColor: 'invalid' })).toThrowError(TypeError);

    expect(snapshot(vr)).toEqual(before);
  });

  const INVALID_PATCHES: Array<[string, Record<string, unknown>]> = [
    ['shape', { shape: 'triangle' }],
    ['controller', { controller: 'pointer' }],
    ['activation', { activation: 'gesture' }],
    ['effect', { effect: 'blur' }],
    ['followSize', { followSize: 0 }],
    ['threshold', { threshold: -1 }],
    ['activation without a surface', { activation: 'element' }],
  ];

  for (const [what, patch] of INVALID_PATCHES) {
    it(`invalid ${what}: throws and leaves the instance as it was`, () => {
      const vr = new VisualRegion({ activation: 'programmatic', effectColor: '#ff00ff' });
      const before = snapshot(vr);

      expect(() => apply(vr, patch)).toThrowError(TypeError);

      expect(snapshot(vr)).toEqual(before);
    });
  }

  it('mixed patch: neither the valid nor the invalid field is stored or applied', () => {
    const vr = new VisualRegion({
      activation: 'programmatic',
      effectColor: '#ff00ff',
      shape: 'circle',
    });
    const before = snapshot(vr);

    expect(() => apply(vr, { shape: 'ellipse', effectColor: 'invalid' })).toThrowError(TypeError);
    expect(snapshot(vr)).toEqual(before);

    // Nothing from the rejected patch is remembered: an unrelated field applies cleanly.
    expect(() => apply(vr, { shape: 'rect' })).not.toThrow();
    const after = snapshot(vr);
    expect(after.spec.shape).toBe('rect');
    expect(after.spec.effectColor).toBe('#ff00ff');
    expect(after.options.effectColor).toBe('#ff00ff');
  });
});

describe('setOptions: a rejected patch does not poison later updates', () => {
  it('the colour sequence from the bug report keeps the old valid operand', () => {
    const vr = visualRegion({
      activation: 'programmatic',
      effectColor: '#ff00ff',
      shape: 'circle',
    });

    expect(() => vr.setOptions({ effectColor: 'invalid' })).toThrowError(TypeError);
    expect(() => vr.setOptions({ shape: 'rect' })).not.toThrow();

    const after = snapshot(vr);
    expect(after.spec.effectColor).toBe('#ff00ff');
    expect(after.spec.shape).toBe('rect');
    expect(after.options.effectColor).toBe('#ff00ff');
    expect(after.options.shape).toBe('rect');
  });

  it('several sequential valid patches apply cumulatively and stay in step with the spec', () => {
    const vr = new VisualRegion({ activation: 'programmatic' });

    vr.setOptions({ effectColor: '#00ffff' });
    vr.setOptions({ shape: 'ellipse' });
    vr.setOptions({ threshold: 10 });

    const after = snapshot(vr);
    expect(after.options).toMatchObject({
      effectColor: '#00ffff',
      shape: 'ellipse',
      threshold: 10,
    });
    expect(after.spec).toMatchObject({
      effectColor: '#00ffff',
      shape: 'ellipse',
      threshold: 10,
    });
  });
});

describe('setOptions: stored options correspond to the active spec', () => {
  it('holds before any patch, after a successful one and after a rejected one', () => {
    const vr = new VisualRegion({ activation: 'programmatic', effectColor: '#FF00FF' });
    expect(storedProjection(vr)).toEqual(activeProjection(vr));

    vr.setOptions({ shape: 'circle', threshold: 5 });
    expect(storedProjection(vr)).toEqual(activeProjection(vr));

    expect(() => vr.setOptions({ effectColor: 'not-a-colour' })).toThrowError(TypeError);
    expect(storedProjection(vr)).toEqual(activeProjection(vr));
  });
});

describe('setOptions: instances are independent', () => {
  it('a rejected patch in A does not change B, and A still works afterwards', () => {
    const a = new VisualRegion({ activation: 'programmatic', effectColor: '#ff00ff' });
    const b = new VisualRegion({
      activation: 'programmatic',
      effectColor: '#00ffff',
      shape: 'circle',
    });
    const bBefore = snapshot(b);

    expect(() => a.setOptions({ effectColor: 'invalid' })).toThrowError(TypeError);
    expect(snapshot(b)).toEqual(bBefore);

    a.setOptions({ effectColor: '#ffffff' });
    expect(snapshot(b)).toEqual(bBefore);
    expect(snapshot(a).spec.effectColor).toBe('#ffffff');
  });
});

describe('setOptions: destroyed instance', () => {
  it('an invalid patch is still validated and throws; nothing is stored', () => {
    const vr = new VisualRegion({ activation: 'programmatic', effectColor: '#ff00ff' });
    vr.destroy();
    const before = snapshot(vr);

    expect(() => vr.setOptions({ effectColor: 'invalid' })).toThrowError(TypeError);

    expect(snapshot(vr)).toEqual(before);
  });

  it('a valid patch warns, applies nothing and stores nothing', () => {
    const vr = new VisualRegion({ activation: 'programmatic', effectColor: '#ff00ff' });
    vr.destroy();
    const before = snapshot(vr);

    expect(() => vr.setOptions({ effectColor: '#00ffff' })).not.toThrow();

    expect(snapshot(vr)).toEqual(before);
    expect(warnings.join('\n')).toContain('destroyed');
  });
});
