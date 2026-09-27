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
  /** The gesture ended. `bounds` is the last geometry, or `null` if the gesture never happened. */
  onFinish(cause: EndCause, bounds: Bounds | null): void;
}

export type EndCause = 'pointerup' | 'pointercancel' | 'blur' | 'visibility';

export interface Controller {
  readonly kind: string;
  /** Attaches the listeners. The controller does not touch the DOM outside the region. */
  attach(root: EventTarget, host: ControllerHost): void;
  /** Removes ALL listeners. Idempotent. */
  detach(): void;
}
