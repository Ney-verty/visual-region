import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { normalizeSpec } from '../../src/core/spec.js';
import { resetWarnings } from '../../src/util/warn.js';

/*
 * The option matrix — what is checked in a browser by one or two cases (smoke:
 * "validation: configuration errors fail loudly"), and here is checked in full
 * and instantly. A configuration error is a programmer's error: it must be loud
 * (TypeError), unlike environment problems (those give `unsupported`).
 */

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

describe('normalizeSpec: defaults', () => {
  it('empty options give a safe set', () => {
    const spec = normalizeSpec(undefined);
    expect(spec.activation).toBe('modifier');
    expect(spec.modifier).toBe('alt');
    expect(spec.touch).toBe('off');
    expect(spec.mountKind).toBe('top-layer');
    expect(spec.persistent).toBe(false);
    expect(spec.threshold).toBe(3);
    expect(spec.zIndex).toBe(2147483646);
    expect(spec.surface).toBeNull();
    expect(spec.shape.kind).toBe('rect');
    expect(spec.effect.kind).toBe('invert');
    expect(spec.renderer.kind).toBe('blend');
  });

  it('the spec contains exactly the expected field set — a new option will not appear silently', () => {
    // The contract between `Spec` and the implementation: if a field is added, the test fails
    // and forces a conscious decision about what it means.
    expect(Object.keys(normalizeSpec(undefined)).sort()).toEqual([
      'activation',
      'effect',
      'interactionRoot',
      'modifier',
      'mountKind',
      'persistent',
      'renderer',
      'shape',
      'surface',
      'threshold',
      'touch',
      'zIndex',
    ]);
  });

  it('{} and undefined are not different', () => {
    expect(normalizeSpec({})).toEqual(normalizeSpec(undefined));
  });

  it('modifier is reset to null if activation is not by modifier', () => {
    expect(normalizeSpec({ activation: 'always' }).modifier).toBeNull();
    expect(normalizeSpec({ activation: 'programmatic' }).modifier).toBeNull();
  });
});

describe('normalizeSpec: loud errors', () => {
  /* The table's values are forbidden by the types — and that is the point of the
     check: we fix that the library fails loudly when a call comes from JS (without
     types) with garbage. `wrong()` is a way to say "deliberately outside the
     contract" in one place, instead of `as any` on every line. The types of the
     other options below are checked strictly. */
  const wrong =
    (options: unknown): (() => unknown) =>
    () =>
      normalizeSpec(options as never);

  const cases: Array<[string, () => unknown]> = [
    ['unknown effect', wrong({ effect: 'blur' })],
    ['unknown shape', wrong({ shape: 'circle' })],
    ['unknown mount', wrong({ mount: 'fixed-like' })],
    ['unknown activation', wrong({ activation: 'hover' })],
    ['unknown touch', wrong({ touch: 'always' })],
    ['modifier: null with the default activation', wrong({ modifier: null })],
    ['element without surface', wrong({ activation: 'element' })],
    ['touch:surface without surface', wrong({ touch: 'surface' })],
    ['negative threshold', wrong({ threshold: -1 })],
    ['non-numeric threshold', wrong({ threshold: '3' })],
    ['threshold NaN', wrong({ threshold: Number.NaN })],
    ['fractional zIndex', wrong({ zIndex: 1.5 })],
    ['surface is not an element', wrong({ surface: {} })],
    ['interactionRoot without addEventListener', wrong({ interactionRoot: {} })],
  ];

  for (const [name, fn] of cases) {
    it(`${name} → TypeError with the library prefix`, () => {
      expect(fn).toThrowError(TypeError);
      expect(fn).toThrowError(/^\[visual-region\] /);
    });
  }
});

describe('normalizeSpec: warnings instead of exceptions', () => {
  it('an unknown option is named in the console but does not break creation', () => {
    const spec = normalizeSpec({ effect: 'invert', heigth: 10 } as never);
    expect(spec.effect.kind).toBe('invert');
    expect(warnings.join('\n')).toContain('unknown option "heigth"');
  });

  it('modifier with an activation that has no modifier is a warning, not an error', () => {
    const spec = normalizeSpec({ activation: 'always', modifier: 'shift' });
    expect(spec.modifier).toBeNull();
    expect(warnings.join('\n')).toContain('modifier given');
  });

  it('the warning repeats once per key (warnOnce)', () => {
    normalizeSpec({ alpha: 1 } as never);
    normalizeSpec({ alpha: 1 } as never);
    normalizeSpec({ beta: 2 } as never);
    const unknownOptionWarnings = warnings.filter((w) => w.includes('unknown option'));
    expect(unknownOptionWarnings).toHaveLength(2);
  });
});

describe('normalizeSpec: boundary values are accepted', () => {
  it('threshold: 0 is allowed (gesture without a threshold)', () => {
    expect(normalizeSpec({ threshold: 0 }).threshold).toBe(0);
  });

  it('threshold: Infinity is rejected', () => {
    expect(() => normalizeSpec({ threshold: Number.POSITIVE_INFINITY })).toThrowError(TypeError);
  });

  it('persistent is enabled only with a strict true', () => {
    expect(normalizeSpec({ persistent: true }).persistent).toBe(true);
    // a truthy value must not silently enable the "region stays on screen" mode
    expect(normalizeSpec({ persistent: 1 } as never).persistent).toBe(false);
    expect(normalizeSpec({ persistent: 'yes' } as never).persistent).toBe(false);
  });

  it('zIndex: 0 and negative are accepted — they are integers', () => {
    expect(normalizeSpec({ zIndex: 0 }).zIndex).toBe(0);
    expect(normalizeSpec({ zIndex: -1 }).zIndex).toBe(-1);
  });

  it('surface is accepted and lands in the spec with activation:element', () => {
    const surface = { contains: () => true } as unknown as HTMLElement;
    const spec = normalizeSpec({ activation: 'element', surface });
    expect(spec.surface).toBe(surface);
    expect(spec.activation).toBe('element');
  });

  it('the renderer is chosen by capability, not by name', () => {
    const spec = normalizeSpec({ effect: 'invert' });
    expect(spec.renderer.supports(spec.effect)).toBe(true);
    expect(spec.renderer.capabilities.intents).toContain(spec.effect.intent);
  });
});
