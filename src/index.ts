import type { Bounds } from './region/types.js';
import type { EventPayloads, VisualRegionOptions, VisualRegionState } from './core/types.js';
import type { Unsubscribe } from './core/events.js';
import type { ActivationKind, ModifierKey, TouchMode } from './interaction/activation.js';
import type { FollowSize } from './controller/types.js';
import type { MountKind } from './core/types.js';
import { Engine } from './core/engine.js';
import { CONTROLLERS, isEffectColor, normalizeSpec } from './core/spec.js';
import { shapeKinds } from './core/registry.js';
import { popoverApiAvailable } from './mount/capability.js';
import { isBrowser } from './util/env.js';
import { warnOnce } from './util/warn.js';

/**
 * Whether this environment gives a guaranteed result. Feature detection of the Popover API, with no
 * UA strings and no version tables (decision 1).
 *
 * false is not "the library is broken" but "here we honestly do not show the effect": the legacy
 * mount is enabled explicitly through `mount: 'fixed'`, and its limitations are described in the
 * README.
 */
export const supported: boolean = popoverApiAvailable();

export class VisualRegion {
  static get supported(): boolean {
    return supported;
  }

  private readonly engine: Engine;
  private options: VisualRegionOptions;

  constructor(options: VisualRegionOptions = {}) {
    this.options = { ...options };
    this.engine = new Engine(normalizeSpec(this.options));
    // Enabled by default: "created means it works". To turn it off: { disabled: true }.
    // With disabled the state is 'disabled' right away, not 'idle': 'idle' means "enabling was
    // never attempted", and publicly these two states must be distinguishable.
    if (options.disabled !== true) this.engine.enable();
    else this.engine.disable();
  }

  get state(): VisualRegionState {
    return this.engine.getState();
  }

  /**
   * The layer, for as long as it exists. **Not part of the public contract.** Meant for debugging
   * and e2e checks; it is stripped from the published types (`dist/index.d.ts`), via
   * `stripInternal`, so that outside code is not tempted to change the styles or attributes of the
   * renderer node, or to remove it — the library's invariants would not survive that.
   *
   * Outside code that needs to find the layer (in tests, for example) should use the DOM marker:
   * `[data-visual-region-layer]`.
   *
   * @internal
   */
  get element(): HTMLElement | null {
    return this.engine.getLayer();
  }

  get bounds(): Bounds | null {
    return this.engine.getBounds();
  }

  /** false — the environment has no top layer. State: 'unsupported'. */
  enable(): boolean {
    return this.engine.enable();
  }

  /** Turn it off. The page returns to its original state, the instance stays alive. */
  disable(): void {
    this.engine.disable();
  }

  /** Remove everything and forbid re-enabling. Idempotent. */
  destroy(): void {
    this.engine.destroy();
  }

  /**
   * Change the options. Works on the fly as well: if the instance is enabled, the layer is
   * recreated and stays enabled. A programmatic region survives if it can be restored under the new
   * options.
   *
   * An unknown option or an incompatible combination throws a TypeError — just as in the
   * constructor: a configuration error must not degrade silently. A refused patch changes
   * nothing: the instance keeps its previous options and behaviour.
   */
  setOptions(patch: VisualRegionOptions): void {
    /* Validation first: the merge used to be written back before normalizeSpec() could throw,
       which left the stored options diverging from the active spec and poisoned later patches. */
    const next = { ...this.options, ...patch };
    const spec = normalizeSpec(next);
    const destroyed = this.engine.getState() === 'destroyed';
    this.engine.reconfigure(spec);
    /* A dead engine ignores the patch, so it must not accumulate options it will never apply. */
    if (!destroyed) this.options = next;
  }

  /**
   * Show a region without a gesture (the programmatic API). Enables the layer if it has to.
   * In v0.1 there is one region: a second call replaces the geometry instead of adding another.
   */
  setRegion(bounds: Bounds): boolean {
    return this.engine.setRegion(bounds);
  }

  /** Remove the region — both a programmatic one and one left by a persistent gesture. */
  clearRegion(): void {
    this.engine.clearRegion();
  }

  on<K extends keyof EventPayloads>(name: K, fn: (payload: EventPayloads[K]) => void): Unsubscribe {
    return this.engine.events.on(name, fn);
  }

  off<K extends keyof EventPayloads>(name: K, fn: (payload: EventPayloads[K]) => void): void {
    this.engine.events.off(name, fn);
  }
}

/** `new VisualRegion(options)` — the short form. */
export function visualRegion(options?: VisualRegionOptions): VisualRegion {
  return new VisualRegion(options);
}

/**
 * Create an instance if the environment supports it. Returns null if it does not: convenient for
 * code that would rather not know about feature detection.
 */
export function init(options?: VisualRegionOptions): VisualRegion | null {
  if (!isBrowser) return null;
  const instance = new VisualRegion(options);
  if (instance.state === 'unsupported') {
    instance.destroy();
    return null;
  }
  return instance;
}

// --- auto-initialization from data attributes ---------------------------------

const ACTIVATIONS: readonly ActivationKind[] = ['modifier', 'always', 'element', 'programmatic'];
const TOUCH_MODES: readonly TouchMode[] = ['off', 'surface'];
const MOUNTS: readonly MountKind[] = ['top-layer', 'fixed'];
const MODIFIER_KEYS: readonly ModifierKey[] = ['alt', 'shift', 'ctrl', 'meta'];

/** The shape names, taken from the registry rather than from a second copy of the list. */
type ShapeName = NonNullable<VisualRegionOptions['shape']>;

/**
 * `data-follow-size`: one number (a square) or two separated by a lowercase `x`, with no spaces —
 * `"120"`, `"120x80"`, `"120.5x80"`. Zero and negative values are refused here as well as in the
 * spec (spec.ts `positiveSide`), because markup has the same right to a clear answer as
 * JavaScript does.
 */
const FOLLOW_SIZE_SIDE = /^\d+(\.\d+)?$/;
const FOLLOW_SIZE_PAIR = /^\d+(\.\d+)?x\d+(\.\d+)?$/;

function readFollowSize(value: string | undefined): number | FollowSize | undefined {
  if (value === undefined) return undefined;
  if (FOLLOW_SIZE_SIDE.test(value)) {
    const side = Number(value);
    if (side > 0) return side;
  } else if (FOLLOW_SIZE_PAIR.test(value)) {
    const [w, h] = value.split('x');
    const width = Number(w);
    const height = Number(h);
    if (width > 0 && height > 0) return { width, height };
  }
  /* Not thrown: the element still initializes, on the default size. The shape of the mistake is
     named in the message, so the page can be fixed without reading the source. */
  warnOnce(
    'data-follow-size-invalid',
    `data-follow-size="${value}": expected a positive number ("120") or a pair ("120x80") — using the default`,
  );
  return undefined;
}

/**
 * `data-effect-color`: the same `#rrggbb` grammar as the JS option, in either case, stored
 * lower-case. Invalid markup does not break the element: one warning, the default colour.
 */
function readEffectColor(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (isEffectColor(value)) return value.toLowerCase();
  warnOnce(
    'data-effect-color-invalid',
    `data-effect-color="${value}": expected "#rrggbb" — using the default`,
  );
  return undefined;
}

function readEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  key: string,
): T | undefined {
  if (value === undefined) return undefined;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  warnOnce(
    `data-${key}-invalid`,
    `data-${key}: expected ${allowed.map((v) => `"${v}"`).join(' | ')}, got "${value}" — using the default`,
  );
  return undefined;
}

function readFlag(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === '' || value === 'true') return true;
  if (value === 'false') return false;
  warnOnce('data-flag-invalid', `boolean data value: expected "" | "true" | "false", got "${value}"`);
  return undefined;
}

function readElement(value: string | undefined, self: HTMLElement): HTMLElement | null | undefined {
  if (value === undefined) return undefined;
  if (value === 'self') return self;
  const found = self.ownerDocument.querySelector(value);
  if (found instanceof HTMLElement) return found;
  warnOnce(`data-selector-${value}`, `data-selector "${value}" matched nothing — ignoring it`);
  return undefined;
}

/**
 * Build the options from the element's data attributes.
 *
 * Markup contract: `data-visual-region="invert"` marks the element the instance should work on.
 * Activation and mount kind are exactly the same options as in JS; the "invert" value on the
 * marker itself duplicates `effect` deliberately: the marker has to say what exactly it turns on.
 */
function optionsFromData(el: HTMLElement): VisualRegionOptions | null {
  const data = el.dataset;
  const effect = data['visualRegion'];
  if (effect !== 'invert') {
    warnOnce(
      `data-effect-${String(effect)}`,
      `data-visual-region="${String(effect)}": v0.1 supports only "invert" — element skipped`,
    );
    return null;
  }

  const options: VisualRegionOptions = { effect: 'invert' };

  const effectColor = readEffectColor(data['effectColor']);
  if (effectColor !== undefined) options.effectColor = effectColor;

  const activation = readEnum(data['activation'], ACTIVATIONS, 'activation');
  if (activation !== undefined) options.activation = activation;

  const controller = readEnum(data['controller'], CONTROLLERS, 'controller');
  if (controller !== undefined) options.controller = controller;

  /* `as readonly ShapeName[]`: the registry owns the list, the type owns the union, and the two
     are kept in step by the runtime lookup in normalizeSpec, which refuses an unknown name. */
  const shape = readEnum(data['shape'], shapeKinds() as readonly ShapeName[], 'shape');
  if (shape !== undefined) options.shape = shape;

  const followSize = readFollowSize(data['followSize']);
  if (followSize !== undefined) options.followSize = followSize;

  const modifier = data['modifier'];
  if (modifier !== undefined) {
    const keys = modifier
      .split(',')
      .map((part) => part.trim())
      .filter((part): part is ModifierKey => (MODIFIER_KEYS as readonly string[]).includes(part));
    if (keys.length === 0) {
      warnOnce('data-modifier-invalid', `data-modifier="${modifier}": unknown keys — using the default`);
    } else {
      options.modifier = keys;
    }
  }

  const touch = readEnum(data['touch'], TOUCH_MODES, 'touch');
  if (touch !== undefined) options.touch = touch;

  const mount = readEnum(data['mount'], MOUNTS, 'mount');
  if (mount !== undefined) options.mount = mount;

  const persistent = readFlag(data['persistent']);
  if (persistent !== undefined) options.persistent = persistent;

  const disabled = readFlag(data['disabled']);
  if (disabled !== undefined) options.disabled = disabled;

  const threshold = data['threshold'];
  if (threshold !== undefined) {
    const parsed = Number(threshold);
    if (Number.isFinite(parsed) && parsed >= 0) options.threshold = parsed;
    else
      warnOnce('data-threshold-invalid', `data-threshold="${threshold}" is not a number — using the default`);
  }

  const surface = readElement(data['surface'], el);
  if (surface !== undefined) options.surface = surface;

  const interactionRoot = readElement(data['interactionRoot'], el);
  if (interactionRoot !== undefined) options.interactionRoot = interactionRoot;

  return options;
}

/**
 * Enable everything marked in the DOM as `data-visual-region="invert"`.
 *
 * It does not run by itself on import: importing the library has no right to change someone else's
 * page. In ESM that is one `autoInit()` call; in the CDN build auto-start lives in the IIFE entry,
 * where a test can cover it.
 *
 * @param root where to look for the markup. For an SPA it is convenient to call it after render:
 *             `autoInit(container)`, rather than scanning the whole document.
 */
export function autoInit(root?: ParentNode): VisualRegion[] {
  if (!isBrowser) return [];
  const scope: ParentNode = root ?? document;
  const created: VisualRegion[] = [];
  for (const node of scope.querySelectorAll('[data-visual-region]')) {
    if (!(node instanceof HTMLElement)) continue;
    const options = optionsFromData(node);
    if (options === null) continue;
    try {
      const instance = init(options);
      if (instance !== null) created.push(instance);
    } catch (error) {
      warnOnce(
        `auto-init-${String(error)}`,
        `could not enable on <${node.tagName.toLowerCase()}>: ${String(error)}`,
      );
    }
  }
  return created;
}

export type { Bounds, Point } from './region/types.js';
export type { VisualRegionOptions, VisualRegionState, EventPayloads } from './core/types.js';
export type { ActivationKind, ModifierSpec, TouchMode } from './interaction/activation.js';
export type { MountKind } from './core/types.js';
export type { Unsubscribe } from './core/events.js';
