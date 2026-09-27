import { warnOnce } from '../util/warn.js';

export type ActivationKind = 'modifier' | 'always' | 'element' | 'programmatic';

/** The touch mode. `off` by default: the page's scroll and pinch-zoom stay untouched. */
export type TouchMode = 'off' | 'surface';

export type ModifierKey = 'alt' | 'shift' | 'ctrl' | 'meta';
export type ModifierPredicate = (event: PointerEvent) => boolean;
export type ModifierSpec = ModifierKey | readonly ModifierKey[] | ModifierPredicate;

export interface ActivationConfig {
  kind: ActivationKind;
  modifier: ModifierSpec | null;
  touch: TouchMode;
  surface: HTMLElement | null;
}

export interface Activation {
  readonly kind: ActivationKind;
  /** Whether we listen for pointer events at all. For 'programmatic' — no. */
  readonly listens: boolean;
  /**
   * Whether this pointerdown may start a region. It changes nothing in the event:
   * preventDefault is the caller's job, and only after an affirmative answer.
   */
  accepts(event: PointerEvent): boolean;
}

const KEYS: Record<ModifierKey, (event: PointerEvent) => boolean> = {
  alt: (e) => e.altKey,
  shift: (e) => e.shiftKey,
  ctrl: (e) => e.ctrlKey,
  meta: (e) => e.metaKey,
};

function isModifierKey(value: unknown): value is ModifierKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(KEYS, value);
}

function testModifier(spec: ModifierSpec, event: PointerEvent): boolean {
  if (typeof spec === 'function') return spec(event) === true;
  if (isModifierKey(spec)) return KEYS[spec](event);
  if (Array.isArray(spec)) {
    const keys = spec as readonly unknown[];
    const known = keys.filter((k): k is ModifierKey => isModifierKey(k));
    if (known.length !== keys.length) {
      warnOnce('modifier-unknown', `modifier contains an unknown key: ${String(spec)}`);
    }
    return known.some((key) => KEYS[key](event));
  }
  warnOnce('modifier-unknown', `unknown modifier: ${String(spec)}`);
  return false;
}

/**
 * Activation describes only "who is allowed to start the gesture".
 *
 * A modifier is not a fundamental part of the API but one of the strategies (Alt is not
 * hard-coded). It is merely the default, because it does not get in the page's way: an ordinary
 * click, a scroll and a selection pass us by.
 *
 * Touch input cannot press modifiers, so for pointerType==='touch' the only possible activation is
 * a surface, and it has to be enabled explicitly (`touch: 'surface'`). A pen does not
 * belong here: a pen has a keyboard, and the modifiers in its events arrive for real.
 */
export function createActivation(config: ActivationConfig): Activation {
  const { kind, modifier, touch, surface } = config;

  if (kind === 'programmatic') {
    return { kind, listens: false, accepts: () => false };
  }

  if (touch === 'surface' && surface === null) {
    // Checked in spec.ts with a clear error; here it is a safety net against silence.
    warnOnce('touch-without-surface', "touch:'surface' without a surface — a touch gesture is impossible");
  }

  const accepts = (event: PointerEvent): boolean => {
    if (event.isPrimary !== true) return false; // multitouch and secondary buttons are out
    if (event.button !== 0) return false; // right/middle button — not our gesture

    if (event.pointerType === 'touch') {
      if (touch !== 'surface' || surface === null) return false;
      if (!isInside(surface, event.target)) return false;
      /* The surface's `touch-action` must be cleared BEFORE the gesture. We set it
         ourselves in enable(), but on someone else's page the owner's CSS may win
         (more specific, set later, !important). We check the fact, not our own write:
         the browser will claim the gesture — and we get pointercancel instead of a
         region. A silent race is worse than a refusal, so we refuse and report it. */
      if (!touchActionIsNone(surface)) {
        warnOnce(
          'touch-action-not-none',
          `touch: 'surface', but the surface's actual touch-action is "${computedTouchAction(surface)}": ` +
            `the browser will claim the gesture. Not starting the drag — clear touch-action on the surface beforehand.`,
        );
        return false;
      }
      return true;
    }

    switch (kind) {
      case 'always':
        return true;
      case 'element':
        return surface !== null && isInside(surface, event.target);
      case 'modifier':
        return modifier !== null && testModifier(modifier, event);
      default:
        return false;
    }
  };

  return { kind, listens: true, accepts };
}

function isInside(surface: HTMLElement, target: EventTarget | null): boolean {
  return target instanceof Node && surface.contains(target);
}

/**
 * The element's actual `touch-action`. In an environment without getComputedStyle
 * (which should not happen in a browser, but let it not kill the gesture) we assume
 * the property is not cleared.
 */
function computedTouchAction(surface: HTMLElement): string {
  if (typeof getComputedStyle !== 'function') return 'auto';
  return getComputedStyle(surface).touchAction || 'auto';
}

function touchActionIsNone(surface: HTMLElement): boolean {
  return computedTouchAction(surface) === 'none';
}
