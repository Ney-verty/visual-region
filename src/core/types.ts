import type { ActivationKind, ModifierSpec, TouchMode } from '../interaction/activation.js';
import type { Bounds } from '../region/types.js';
import type { Effect } from '../effect/types.js';
import type { RegionShape } from '../region/types.js';
import type { Renderer } from '../render/types.js';
import type { CancelCause, ControllerKind, FollowSize } from '../controller/types.js';

/** How the layer is placed. `fixed` is legacy, only on explicit request. */
export type MountKind = 'top-layer' | 'fixed';

/**
 * `idle`        — created, enabling has not been attempted yet.
 * `enabled`     — listening, the layer is in the top layer, a region may appear.
 * `disabled`    — turned off explicitly; the page is in its original state, the instance is alive.
 * `unsupported` — the environment offers no guaranteed way to show a region.
 * `destroyed`   — the instance is dead, re-enabling is impossible.
 */
export type VisualRegionState = 'idle' | 'enabled' | 'disabled' | 'unsupported' | 'destroyed';

export interface EventPayloads {
  start: { source: 'pointer' | 'programmatic' };
  change: { bounds: Bounds };
  end: { bounds: Bounds | null };
  /**
   * A session that ended in a cancellation, not a normal finish (see NormalEndCause).
   * `CancelCause` keeps every internal normal-end name out of the public union, so adding one
   * does not widen the published contract.
   */
  cancel: { reason: CancelCause };
  /** The `reason` is human-readable diagnostic text, not a stable identifier (see the README). */
  'lost-top-layer': { reason: string };
  /** The `reason` is human-readable diagnostic text, not a stable identifier (see the README). */
  unsupported: { reason: string };
  destroy: null;
}

/**
 * The public options — flat, with a default for every key.
 * `| undefined` is written out on purpose: with `exactOptionalPropertyTypes` there is otherwise no
 * way to write `{ modifier: undefined }`, which is the normal way to unset an option.
 */
export interface VisualRegionOptions {
  /** The effect of the region. In v0.1 only 'invert' (decision 3). */
  effect?: 'invert' | undefined;
  /**
   * The operand colour of the difference effect, `#rrggbb`.
   * `output = abs(input - effectColor)` per channel; `#ffffff` (default) is exact inversion.
   * Not the requested output colour: black content becomes this colour, white becomes its
   * per-channel complement.
   */
  effectColor?: string | undefined;
  /** The shape of the region: 'rect' (default), 'ellipse' or 'circle'. */
  shape?: 'rect' | 'ellipse' | 'circle' | undefined;
  /**
   * How the region's geometry is produced. 'drag' by default: press, pull, release.
   * 'follow' has no gesture at all — the region appears under the pointer while the
   * activation right holds, and there is nothing to press. See the README.
   */
  controller?: ControllerKind | undefined;
  /** The size of a followed region, in CSS px. 120 (a square) by default. Not used by 'drag'. */
  followSize?: number | FollowSize | undefined;
  /** What starts the gesture. 'modifier' by default. */
  activation?: ActivationKind | undefined;
  /** The modifier for activation:'modifier'. 'alt' by default. */
  modifier?: ModifierSpec | undefined;
  /** Where pointerdown is listened for. document.body by default. */
  interactionRoot?: EventTarget | null | undefined;
  /** The surface element: needed for activation:'element' and touch:'surface'. */
  surface?: HTMLElement | null | undefined;
  /** Touch input. 'off' by default — mobile scroll and zoom stay untouched (decision 4). */
  touch?: TouchMode | undefined;
  /** How the layer is placed. 'top-layer' by default (decision 1). */
  mount?: MountKind | undefined;
  /** Keep the region after the pointer is released. */
  persistent?: boolean | undefined;
  /** Do not enable on creation. */
  disabled?: boolean | undefined;
  /** The threshold in px after which the gesture counts as started. 3 by default. */
  threshold?: number | undefined;
  /** z-index for the legacy mount. Means nothing in the top layer. */
  zIndex?: number | undefined;
}

/**
 * The normalized, validated options of an instance. Options are validated once, so the hot path
 * (a drag frame) does no validation at all.
 */
export interface Spec {
  readonly activation: ActivationKind;
  readonly controller: ControllerKind;
  /** Normalized to width × height even for 'drag', where it is unused: the spec has one shape. */
  readonly followSize: FollowSize;
  readonly modifier: ModifierSpec | null;
  readonly touch: TouchMode;
  readonly mountKind: MountKind;
  readonly persistent: boolean;
  readonly threshold: number;
  readonly zIndex: number;
  readonly interactionRoot: EventTarget;
  readonly surface: HTMLElement | null;
  readonly shape: RegionShape;
  readonly effect: Effect;
  readonly renderer: Renderer;
}
