import type { ActivationKind, ModifierSpec, TouchMode } from '../interaction/activation.js';
import type { ControllerKind, FollowSize } from '../controller/types.js';
import type { Spec, VisualRegionOptions } from './types.js';
import {
  effectKinds,
  getEffect,
  getMount,
  getRenderer,
  getShape,
  mountKinds,
  shapeKinds,
} from './registry.js';
import { documentRoot, nullTarget } from '../util/env.js';
import { warnOnce } from '../util/warn.js';

const ACTIVATIONS: readonly ActivationKind[] = ['modifier', 'always', 'element', 'programmatic'];
const TOUCH_MODES: readonly TouchMode[] = ['off', 'surface'];
/**
 * Exported for the markup parser (`data-controller` in index.ts), not for the public API: the
 * names of the controllers exist in exactly one place, so the declarative path cannot drift from
 * the JS one.
 */
export const CONTROLLERS: readonly ControllerKind[] = ['drag', 'follow'];

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'effect',
  'effectColor',
  'shape',
  'controller',
  'followSize',
  'activation',
  'modifier',
  'interactionRoot',
  'surface',
  'touch',
  'mount',
  'persistent',
  'disabled',
  'threshold',
  'zIndex',
]);

function fail(message: string): never {
  throw new TypeError(`[visual-region] ${message}`);
}

/**
 * The one colour grammar: exactly `#rrggbb`, case-insensitive. Exported for the markup parser
 * (`data-effect-color` in index.ts), not for the public API — the grammar exists in one place,
 * so the JS path and the declarative path cannot drift.
 *
 * Deliberately absent: `#rgb`, alpha forms, CSS names and `rgb()/hsl()`. The operand must be
 * opaque for the arithmetic to be exact, and one strict grammar gives one clear diagnostic.
 */
const EFFECT_COLOR = /^#[0-9a-fA-F]{6}$/;

export function isEffectColor(value: unknown): value is string {
  return typeof value === 'string' && EFFECT_COLOR.test(value);
}

/** Canonical form: lower-case `#rrggbb`. `undefined` is handled by the caller (default). */
function normalizeEffectColor(value: unknown): string {
  if (!isEffectColor(value)) {
    fail(`effectColor: expected a hex colour "#rrggbb", got ${String(value)}`);
  }
  return value.toLowerCase();
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], key: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(`${key}: expected ${allowed.map((v) => `"${v}"`).join(' | ')}, got ${String(value)}`);
  }
  return value as T;
}

/**
 * A side of a followed region. The same check the markup grammar of §2 step 6.1 mirrors:
 * a finite positive number. Zero is refused rather than treated as "invisible": a size of
 * zero is never what a caller meant, and silently showing nothing is the worst of the answers.
 */
function positiveSide(value: unknown, key: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    fail(`${key}: expected a finite positive number, got ${String(value)}`);
  }
  return value;
}

/**
 * One or two numbers → a width × height pair. A fresh object every time, the default
 * included: a shared one would be a single mutation away from changing every instance
 * on the page.
 *
 * `undefined` never reaches here: the default is applied at the call site as the plain
 * number `120`, so the documentation gate can derive it from the source instead of
 * reading a constant (scripts/verify-docs.mjs `sourceDefault` — the gate is not edited,
 * the source is written so that it can be read).
 */
function normalizeFollowSize(value: Exclude<VisualRegionOptions['followSize'], undefined>): FollowSize {
  if (typeof value === 'number') {
    const side = positiveSide(value, 'followSize');
    return { width: side, height: side };
  }
  if (typeof value !== 'object' || value === null) {
    fail(`followSize: expected a positive number or {width, height}, got ${String(value)}`);
  }
  return {
    width: positiveSide(value.width, 'followSize.width'),
    height: positiveSide(value.height, 'followSize.height'),
  };
}

/**
 * Options → a normalized spec. A configuration error is a programmer error, so we
 * throw here (unlike environment problems: those yield the `unsupported` state and
 * do not break the page).
 */
export function normalizeSpec(options: VisualRegionOptions | undefined): Spec {
  const o = options ?? {};

  for (const key of Object.keys(o)) {
    if (!KNOWN_KEYS.has(key)) {
      warnOnce(`unknown-option-${key}`, `unknown option "${key}" — ignored`);
    }
  }

  const effectKind = o.effect ?? 'invert';
  const baseEffect = getEffect(effectKind);
  if (baseEffect === null) fail(`effect: unknown "${effectKind}", known: ${effectKinds().join(', ')}`);
  /* The registry object is shared and must never be mutated: a different colour gets a fresh
     object, the default keeps the registry one. `undefined` yields the default through an
     explicit ternary (not `??`), so `null` still reaches the validator and fails loudly. */
  const effectColorRaw = o.effectColor === undefined ? '#ffffff' : o.effectColor;
  const effectColor = normalizeEffectColor(effectColorRaw);
  const effect = effectColor === baseEffect.color ? baseEffect : { ...baseEffect, color: effectColor };
  const renderer = getRenderer(effect);
  if (renderer === null) fail(`effect "${effectKind}": no renderer for intent "${effect.intent}"`);

  const shapeName = o.shape ?? 'rect';
  const shape = getShape(shapeName);
  if (shape === null) fail(`shape: unknown "${shapeName}", known: ${shapeKinds().join(', ')}`);

  const mountKind = o.mount ?? 'top-layer';
  if (getMount(mountKind) === null) fail(`mount: unknown "${mountKind}", known: ${mountKinds().join(', ')}`);

  const activation = o.activation === undefined ? 'modifier' : oneOf(o.activation, ACTIVATIONS, 'activation');
  const touch = o.touch === undefined ? 'off' : oneOf(o.touch, TOUCH_MODES, 'touch');
  const surface = o.surface ?? null;
  if (surface !== null && typeof surface.contains !== 'function') {
    fail('surface: expected an HTMLElement');
  }

  if (activation === 'modifier' && o.modifier === null) {
    fail("activation:'modifier' without a modifier — nothing would start the gesture");
  }
  if (activation !== 'modifier' && o.modifier !== undefined) {
    warnOnce('modifier-ignored', `modifier given with activation:'${activation}' — not used`);
  }

  if ((activation === 'element' || touch === 'surface') && surface === null) {
    fail(`activation:'${activation}'/touch:'${touch}' require a surface`);
  }

  const interactionRoot = o.interactionRoot ?? documentRoot() ?? nullTarget();
  if (typeof (interactionRoot as EventTarget).addEventListener !== 'function') {
    fail('interactionRoot: expected an EventTarget');
  }

  const threshold = o.threshold ?? 3;
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0) {
    fail(`threshold: expected a non-negative number, got ${String(o.threshold)}`);
  }

  const zIndex = o.zIndex ?? 2147483646;
  if (!Number.isInteger(zIndex)) fail(`zIndex: expected an integer, got ${String(o.zIndex)}`);

  const modifier: ModifierSpec | null = activation === 'modifier' ? (o.modifier ?? 'alt') : null;

  const controller = o.controller === undefined ? 'drag' : oneOf(o.controller, CONTROLLERS, 'controller');
  /* 120 by default: one side, i.e. a square — the same thing the object form would say.
     Written as a literal here and not as a named constant so that the number the README
     documents is the number the source carries (the documented default is checked against
     this line, not against a copy of it). */
  const followSize = normalizeFollowSize(o.followSize === undefined ? 120 : o.followSize);

  if (controller === 'drag' && o.followSize !== undefined) {
    // Same kind of diagnostic as `modifier` with activation:'always': the option is
    // accepted (the spec has one shape) but has no effect, and silence about that would be
    // a lie by omission. Nothing is thrown: it is not a contradiction, just dead weight.
    warnOnce('follow-size-ignored', "followSize is given, but controller is 'drag' — the size is not used");
  }
  if (controller === 'follow' && activation === 'programmatic') {
    warnOnce(
      'follow-programmatic',
      "controller: 'follow' with activation: 'programmatic' — no pointer controller is attached, " +
        'the region is only shown by setRegion()',
    );
  }

  return {
    activation,
    controller,
    followSize,
    modifier,
    touch,
    mountKind,
    persistent: o.persistent === true,
    threshold,
    zIndex,
    interactionRoot,
    surface,
    shape,
    effect,
    renderer,
  };
}
