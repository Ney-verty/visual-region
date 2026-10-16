import type { Bounds } from '../region/types.js';

/**
 * The controller's host — what the controller knows about the world. Exactly three verbs:
 * show the geometry, say "the gesture started", say "the gesture ended". The decisions about what
 * that means (persistent, events, removing the layer) are made by the engine.
 */
export interface ControllerHost {
  /** Show the region's geometry, or hide it (`null`). At most once per frame. */
  applyGeometry(bounds: Bounds | null): void;
  /** The threshold has been passed, the gesture has really started. */
  onStart(): void;
  /**
   * The session ended. `bounds` is the last geometry the controller asked for, or `null` if
   * the session never happened. The engine prefers its OWN last geometry for the `end` event
   * (it is the normalized one — see region/types.ts `fit`), so this value is informational.
   */
  onFinish(cause: EndCause, bounds: Bounds | null): void;
}

/**
 * Why a session ended.
 *
 * The split that matters is normal end vs cancellation, because only a cancellation may throw
 * the region away (`persistent` does not survive it). `NormalEndCause` names that split once,
 * so a new normal end cannot silently leak into the public `cancel.reason` union.
 */
export type EndCause =
  | NormalEndCause
  /** The pointer went away in a way we did not cause: a cancelled pointer, a lost focus, a hidden tab. */
  | 'pointercancel'
  | 'blur'
  | 'visibility';

export type NormalEndCause =
  /** The pointer was released (a touch contact — a mouse release does not end a follow session). */
  | 'pointerup'
  /** The pointer left the document: `pointerout` with `relatedTarget === null` (measured in all three engines). */
  | 'pointerout'
  /**
   * The pointer stayed, but lost the right to act: the modifier was released, or it left the
   * surface the activation names. This is NOT a `pointerout` — naming it so would be a false
   * statement about what happened, and this file is the only place the name is used.
   */
  | 'ineligible';

export type CancelCause = Exclude<EndCause, NormalEndCause>;

/** The size of a followed region, in CSS px. A number is a square; the object is width × height. */
export interface FollowSize {
  width: number;
  height: number;
}

/**
 * The controllers, by name. v0.1 has one, and it is chosen by `activation`
 * ('programmatic' → none); v0.2 adds `follow`, which is not a consequence of anything and
 * therefore needs a name of its own.
 *
 * This is still not a registry: the table in core/registry.ts is justified where there is a
 * real choice between several variants (shapes, effects), and here the choice is between two
 * implementations of one verb. The engine does the choosing.
 */
export type ControllerKind = 'drag' | 'follow';

export interface Controller {
  readonly kind: string;
  /** Attaches the listeners. The controller does not touch the DOM outside the region. */
  attach(root: EventTarget, host: ControllerHost): void;
  /** Removes ALL listeners. Idempotent. */
  detach(): void;
}
