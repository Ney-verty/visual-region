import { describe, it, expect } from 'vitest';
import {
  effectKinds,
  getEffect,
  getMount,
  getRenderer,
  getShape,
  mountKinds,
  shapeKinds,
} from '../../src/core/registry.js';

/*
 * Registries are the v0.1 extension point (there is no public `register*` API).
 * The unit test fixes two properties that otherwise break silently:
 *   1) an unknown name gives null, not "something by default";
 *   2) every registered implementation has the contract fields.
 */

describe('names available in v0.1', () => {
  it('shape: rect only', () => {
    expect(shapeKinds()).toEqual(['rect']);
  });

  it('effect: invert only', () => {
    expect(effectKinds()).toEqual(['invert']);
  });

  it('mount: top-layer and legacy fixed', () => {
    expect(mountKinds()).toEqual(['top-layer', 'fixed']);
  });
});

describe('an unknown name is null, not a default', () => {
  it('getShape', () => {
    expect(getShape('circle')).toBeNull();
    expect(getShape('')).toBeNull();
  });

  it('getEffect', () => {
    expect(getEffect('blur')).toBeNull();
  });

  it('getMount', () => {
    expect(getMount('absolute')).toBeNull();
  });

  it('names are case-sensitive', () => {
    expect(getShape('Rect')).toBeNull();
    expect(getMount('Top-Layer')).toBeNull();
  });
});

describe('implementation contracts', () => {
  it('shape owns geometry only: apply and reset, no pixels', () => {
    const shape = getShape('rect');
    expect(shape?.kind).toBe('rect');
    expect(typeof shape?.apply).toBe('function');
    expect(typeof shape?.reset).toBe('function');
  });

  it('effect describes the intent, not the mechanism', () => {
    const effect = getEffect('invert');
    expect(effect?.kind).toBe('invert');
    expect(effect?.intent).toBe('invert');
  });

  it('the renderer is chosen by capability and supports the effect intent', () => {
    const effect = getEffect('invert');
    expect(effect).not.toBeNull();
    const renderer = effect === null ? null : getRenderer(effect);
    expect(renderer?.kind).toBe('blend');
    expect(effect !== null && renderer !== null && renderer.supports(effect)).toBe(true);
  });

  it('a renderer that does not support the intent is not chosen', () => {
    // A stub "foreign" intent: the registry must not return a renderer that
    // does not declare this capability — otherwise the effect would silently fail.
    const alien = { kind: 'alien', intent: 'invert-alien' } as unknown as Parameters<typeof getRenderer>[0];
    expect(getRenderer(alien)).toBeNull();
  });

  it('top layer is a guaranteed mechanism, legacy fixed is not', () => {
    // The flag is read by the README and e2e: legacy must not be sold as full support.
    expect(getMount('top-layer')?.guaranteed).toBe(true);
    expect(getMount('fixed')?.guaranteed).toBe(false);
  });

  it('both mount mechanisms have supported/create/destroy', () => {
    for (const kind of mountKinds()) {
      const mount = getMount(kind);
      expect(typeof mount?.supported, kind).toBe('function');
      expect(typeof mount?.create, kind).toBe('function');
      expect(typeof mount?.destroy, kind).toBe('function');
    }
  });

  it('supported() does not throw outside a browser', () => {
    // In Node the answer must be a value, not an exception: the import must be
    // SSR-safe. For `fixed` the answer is `true` — and that is no concession:
    // `position:fixed` really exists everywhere, and "the mechanism exists" and
    // "the result is correct" are different questions. The second is answered by
    // `guaranteed` (see the test above). SSR safety rests not on `supported()`
    // but on the `isBrowser` checks in `init`/`autoInit`/`documentRoot()`.
    for (const kind of mountKinds()) {
      expect(() => getMount(kind)?.supported()).not.toThrow();
      expect(typeof getMount(kind)?.supported(), kind).toBe('boolean');
    }
    // The only mechanism that honestly answers `false` outside a browser:
    // the Popover API is detected through `window`/`document`.
    expect(getMount('top-layer')?.supported()).toBe(false);
  });
});
