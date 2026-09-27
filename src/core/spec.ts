import type { ActivationKind, ModifierSpec, TouchMode } from '../interaction/activation.js';
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

const KNOWN_KEYS: ReadonlySet<string> = new Set([
  'effect',
  'shape',
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

function oneOf<T extends string>(value: unknown, allowed: readonly T[], key: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(`${key}: expected ${allowed.map((v) => `"${v}"`).join(' | ')}, got ${String(value)}`);
  }
  return value as T;
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
  const effect = getEffect(effectKind);
  if (effect === null) fail(`effect: unknown "${effectKind}", known: ${effectKinds().join(', ')}`);
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

  return {
    activation,
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
