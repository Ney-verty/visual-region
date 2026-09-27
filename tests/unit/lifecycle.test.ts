import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VisualRegion, autoInit, init, supported, visualRegion } from '../../src/index.js';
import type { Bounds } from '../../src/index.js';
import { DOM_EVENT_PREFIX } from '../../src/core/events.js';
import { resetWarnings } from '../../src/util/warn.js';

/*
 * Lifecycle in Node. The temptation is to call this an "SSR test" and be done,
 * but not only import safety is checked here: in Node the instance REALLY runs
 * the whole degradation branch (`unsupported`), which is unreachable in a
 * browser — the Popover API is there and the `fail()` path never fires in e2e.
 * So this file is the only place where the "the environment provides no
 * guaranteed way" branch is checked for real rather than mocked.
 *
 * Deliberately NOT included: creating/destroying the layer, enable/disable in a
 * working state, multiple instances and DOM cleanliness after destroy. All of
 * that needs the real Popover API and a live page, i.e. tests/smoke (three
 * engines). In jsdom these scenarios would give `unsupported`, not a check.
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

const warns = (): string => warnings.join('\n');

describe('import and creation outside the browser', () => {
  it('supported === false, but the import does not throw', () => {
    expect(supported).toBe(false);
    expect(VisualRegion.supported).toBe(false);
  });

  it('the instance is created and honestly reports unsupported', () => {
    const instance = new VisualRegion();
    expect(instance.state).toBe('unsupported');
    expect(instance.element).toBeNull();
    expect(instance.bounds).toBeNull();
    expect(instance.enable()).toBe(false);
  });

  it('the "no DOM" path stays silent in the console: it is not the caller\'s error', () => {
    // The opposite decision (warning) would make the SSR import noisy: any
    // server-side render would log something that is not a code problem.
    new VisualRegion();
    expect(warnings).toEqual([]);
    expect(warnings).not.toContain('unsupported');
  });

  it('init() returns null — "create if you can" without dissecting states', () => {
    expect(init()).toBeNull();
  });

  it('autoInit() returns an empty list and does not touch document', () => {
    expect(autoInit()).toEqual([]);
  });

  it('disable() does not rewrite the state: unsupported is about the environment, not the toggle', () => {
    const instance = new VisualRegion();
    instance.disable();
    expect(instance.state).toBe('unsupported');
    expect(instance.enable()).toBe(false);
  });
});

describe('factory and state', () => {
  it('visualRegion() — the same short form', () => {
    expect(visualRegion()).toBeInstanceOf(VisualRegion);
  });

  it('description: disabled:true gives disabled, not idle', () => {
    // In a browser this is distinguishable in e2e; here we check that the Node path
    // does not overwrite the user's decision with its degradation.
    const instance = new VisualRegion({ disabled: true });
    expect(instance.state).toBe('disabled');
  });
});

describe('events', () => {
  it('unsupported arrives both in JS and as a regular DOM event on the interaction root', () => {
    // Subscription is before enabling: `disabled: true` keeps the instance in 'disabled',
    // otherwise the event would fire in the constructor when there are no listeners yet.
    const root = new EventTarget();
    const domEvents: string[] = [];
    root.addEventListener(DOM_EVENT_PREFIX + 'unsupported', (event) => {
      domEvents.push((event as CustomEvent<{ reason: string }>).detail.reason);
    });

    const reasons: string[] = [];
    const instance = new VisualRegion({ disabled: true, interactionRoot: root });
    instance.on('unsupported', (payload) => reasons.push(payload.reason));

    expect(instance.enable()).toBe(false);
    expect(instance.state).toBe('unsupported');
    expect(domEvents.join('\n')).toContain('no DOM');
    expect(reasons.join('\n')).toContain('no DOM');
  });

  it('an exception in a foreign listener does not escape', () => {
    // Otherwise a throw from the site's callback would leave the region hanging on screen.
    const instance = new VisualRegion();
    instance.on('unsupported', () => {
      throw new Error('foreign callback');
    });
    expect(() => instance.enable()).not.toThrow();
    expect(warns()).toContain('threw');
  });

  it('off() and the unsubscribe returned by on() are equivalent', () => {
    const instance = new VisualRegion();
    const seen: string[] = [];
    const handler = (payload: { reason: string }): void => {
      seen.push(payload.reason);
    };
    instance.on('unsupported', handler);
    instance.off('unsupported', handler);
    instance.enable();
    expect(seen).toEqual([]);

    const unsubscribe = instance.on('unsupported', handler);
    unsubscribe();
    instance.enable();
    expect(seen).toEqual([]);
  });
});

describe('destroy', () => {
  it('idempotent: the destroy event arrives once', () => {
    const instance = new VisualRegion();
    let count = 0;
    instance.on('destroy', () => {
      count += 1;
    });
    instance.destroy();
    instance.destroy();
    expect(count).toBe(1);
    expect(instance.state).toBe('destroyed');
  });

  it('after destroy() enable() no longer works and says why', () => {
    const instance = new VisualRegion();
    instance.destroy();
    expect(instance.enable()).toBe(false);
    expect(warns()).toContain('destroyed');
  });

  it('a programmatic region is not created after destroy()', () => {
    const instance = new VisualRegion();
    instance.destroy();
    const bounds: Bounds = { x: 0, y: 0, width: 10, height: 10 };
    expect(instance.setRegion(bounds)).toBe(false);
    expect(() => instance.clearRegion()).not.toThrow();
  });
});

describe('legacy fixed outside the browser', () => {
  it('degrades through the same silent path: the DOM check runs before the mount choice', () => {
    // Order in `enable()`: `!isBrowser` first, then the mount lookup. Therefore
    // the warning "legacy gives no guarantees" is browser-only: outside a browser
    // it is never reached, and that is correct (SSR must not get a browser tip).
    // The legacy warnings themselves are checked in tests/smoke, on a live page.
    const instance = new VisualRegion({ mount: 'fixed' });
    expect(instance.state).toBe('unsupported');
    expect(warnings).toEqual([]);
  });

  it('an unknown mount is still loud: it is a configuration error, not an environment one', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => new VisualRegion({ mount: 'fixed-like' as any })).toThrowError(TypeError);
  });
});

describe('setOptions', () => {
  it('on a dead instance warns instead of throwing', () => {
    const instance = new VisualRegion();
    instance.destroy();
    expect(() => instance.setOptions({ persistent: true })).not.toThrow();
    expect(warns()).toContain('destroyed');
  });

  it('a configuration error stays loud after creation', () => {
    const instance = new VisualRegion();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => instance.setOptions({ effect: 'blur' as any })).toThrowError(TypeError);
  });
});
