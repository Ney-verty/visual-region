import type { Bounds } from '../region/types.js';
import type { Controller, ControllerHost, EndCause, NormalEndCause } from '../controller/types.js';
import type { Mount } from '../mount/types.js';
import type { Activation } from '../interaction/activation.js';
import type { EventPayloads, Spec, VisualRegionState } from './types.js';
import { Emitter, dispatchDomEvent } from './events.js';
import { getMount } from './registry.js';
import { createActivation } from '../interaction/activation.js';
import { createDragController } from '../controller/drag.js';
import { createFollowController } from '../controller/follow.js';
import { setStyles } from '../util/style.js';
import { isBrowser } from '../util/env.js';
import { warnOnce } from '../util/warn.js';

/** With no region yet, the layer is neither painted nor catching the pointer: `visibility` does not affect the box tree. */
const HIDDEN: Record<string, string> = { visibility: 'hidden' };
const SHOWN: Record<string, string> = { visibility: 'visible' };

/**
 * The ends that are a normal finish of a session, not a failure of it: only a cancellation may
 * throw away even a `persistent` region.
 *
 * Written as a `Record<NormalEndCause, true>` rather than as a list so that adding an end cause
 * to the type FAILS THE BUILD here: a new kind of end must be classified consciously, it cannot
 * silently fall into "cancel" and start clearing regions.
 */
const NORMAL_END: Record<NormalEndCause, true> = {
  pointerup: true,
  pointerout: true,
  ineligible: true,
};

function isNormalEnd(cause: EndCause): cause is NormalEndCause {
  return cause in NORMAL_END;
}

/**
 * Who asked for the geometry. The engine's own writes (setRegion, clearRegion, losing the top
 * layer, teardown) are always applied; a controller's writes are not, while the page is showing
 * a region it set itself. See Engine.controllerHost.
 */
type WriteSource = 'engine' | 'controller';

/**
 * The instance engine: owns the state, the layer and the lifecycle.
 *
 * The separation of duties fixed here:
 *   Mount    — where the layer lives (and whether it guarantees the result);
 *   Renderer — what the effect looks like (writes styles on the layer itself);
 *   Effect   — what the effect is, without pixels;
 *   RegionShape — the geometry of the region;
 *   Controller  — the gesture; knows only the pointer and the geometry.
 *
 * The engine is the only one that ties them together and makes the decisions
 * ("keep the region after release", "what to do if the page closed our popover").
 */
export class Engine implements ControllerHost {
  readonly events = new Emitter<EventPayloads>();

  private spec: Spec;
  private state: VisualRegionState = 'idle';
  private layer: HTMLElement | null = null;
  private mount: Mount | null = null;
  private controller: Controller | null = null;
  private activation: Activation | null = null;
  private lastBounds: Bounds | null = null;
  /** The region was created programmatically — it lives until clearRegion(), not until release. */
  private pinned = false;
  /** We are closing the popover ourselves; the resulting toggle event must not look like "the page closed it". */
  private closingOurselves = false;
  /** The inline touch-action value on the surface before we touched it — restore it as it was. */
  private touchActionBefore: string | null = null;

  constructor(spec: Spec) {
    this.spec = spec;
  }

  getState(): VisualRegionState {
    return this.state;
  }

  getLayer(): HTMLElement | null {
    return this.layer;
  }

  getBounds(): Bounds | null {
    return this.lastBounds;
  }

  /**
   * Enabling. Returns false if the environment gives no guaranteed way: there is
   * no silent fallback to legacy `fixed` — otherwise the user would get a visually
   * wrong result while the API "succeeded".
   */
  enable(): boolean {
    if (this.state === 'destroyed') {
      warnOnce('enable-destroyed', 'instance destroyed: enable() no longer works');
      return false;
    }
    if (this.state === 'enabled') return true;

    if (!isBrowser) {
      // Not a caller's error: an SSR import is legal. Hence no warn.
      this.fail('no DOM: the library only works in a browser', true);
      return false;
    }

    const mount = getMount(this.spec.mountKind);
    if (mount === null) {
      this.fail(`unknown mount kind "${this.spec.mountKind}"`);
      return false;
    }
    if (!mount.supported()) {
      this.fail(
        `Popover API is unavailable: the top layer is the only mount v0.1 guarantees. ` +
          `The legacy mount is opt-in: { mount: 'fixed' }`,
      );
      return false;
    }
    if (!mount.guaranteed) {
      warnOnce(
        `legacy-mount-${mount.kind}`,
        `legacy mount "${mount.kind}": the result is not guaranteed (transparency/transform on ` +
          `html/body and the page's own z-index break it). See the support section of the README.`,
      );
    }

    let layer: HTMLElement;
    try {
      layer = mount.create({ zIndex: this.spec.zIndex });
    } catch (error) {
      this.fail(`could not create the layer: ${String(error)}`);
      return false;
    }
    this.layer = layer;
    this.mount = mount;

    try {
      this.spec.renderer.apply(layer, this.spec.effect);
    } catch (error) {
      this.fail(`renderer "${this.spec.renderer.kind}" failed to apply: ${String(error)}`);
      return false;
    }

    setStyles(layer, HIDDEN);
    layer.addEventListener('toggle', this.onToggle);
    this.applyTouchAction();

    this.activation = createActivation({
      kind: this.spec.activation,
      modifier: this.spec.modifier,
      touch: this.spec.touch,
      surface: this.spec.surface,
    });

    if (this.activation.listens) {
      // 'programmatic' means "no controller at all" and is settled above by `listens`; the
      // remaining choice is the life cycle of the geometry, and it is a name, not a consequence.
      this.controller =
        this.spec.controller === 'follow'
          ? createFollowController(this.activation, this.spec.followSize)
          : createDragController(this.activation, this.spec.threshold);
      this.controller.attach(this.spec.interactionRoot, this.controllerHost());
    }

    this.state = 'enabled';
    return true;
  }

  /** Disabling: the page returns to its original state, the instance stays alive. */
  disable(): void {
    if (this.state === 'enabled') this.teardown();
    if (this.state === 'idle' || this.state === 'enabled') this.state = 'disabled';
  }

  /** Destruction: re-enabling is impossible. Idempotent. */
  destroy(): void {
    if (this.state === 'destroyed') return;
    this.teardown();
    this.state = 'destroyed';
    this.emit('destroy', null);
    this.events.clear();
  }

  /** Full replacement of the settings. Works on the fly too: the layer is recreated. */
  reconfigure(spec: Spec): void {
    if (this.state === 'destroyed') {
      warnOnce('reconfigure-destroyed', 'instance destroyed: options are not applied');
      return;
    }
    const wasActive = this.state === 'enabled' || this.state === 'unsupported' || this.state === 'idle';
    const pinnedBounds = this.pinned ? this.lastBounds : null;
    this.teardown();
    this.spec = spec;
    this.state = 'idle';
    if (!wasActive) return;
    if (this.enable() && pinnedBounds !== null) this.applyGeometry(pinnedBounds);
  }

  // --- ControllerHost -------------------------------------------------------

  applyGeometry(bounds: Bounds | null): void {
    this.writeGeometry(bounds, 'engine');
  }

  /**
   * The host a CONTROLLER writes through.
   *
   * It exists so that the engine can tell its own writes from a controller's, without asking
   * the controller who it is (the controllers stay dumb). While a programmatic region is shown
   * (PLAN §2 step 3.5), a pointer's geometry is ignored: the page asked for that region, and a
   * gesture must not quietly replace it. `clearRegion()` lifts this.
   */
  private controllerHost(): ControllerHost {
    return {
      applyGeometry: (bounds) => this.writeGeometry(bounds, 'controller'),
      onStart: () => this.onStart(),
      onFinish: (cause, bounds) => this.onFinish(cause, bounds),
    };
  }

  private writeGeometry(bounds: Bounds | null, source: WriteSource): void {
    if (this.pinned && source === 'controller') return;

    const layer = this.layer;
    if (layer === null) return;
    if (bounds === null) {
      setStyles(layer, HIDDEN);
      this.lastBounds = null;
      return;
    }
    // The shape may occupy less than it was asked for (a circle inside a non-square box).
    // We fit ONCE, here, and from this point on everyone — the layer, getBounds(), the
    // `change` event — sees the same rectangle. For `rect` fit() is the identity, so the
    // object is the caller's own and v0.1 behavior is bit-for-bit unchanged.
    const fitted = this.spec.shape.fit(bounds);
    this.spec.shape.apply(layer, fitted);
    setStyles(layer, SHOWN);
    this.lastBounds = fitted;
    this.emit('change', { bounds: fitted });
  }

  onStart(): void {
    this.emit('start', { source: 'pointer' });
  }

  onFinish(cause: EndCause, _bounds: Bounds | null): void {
    /* The geometry reported is the engine's OWN last geometry, not the one the controller
       passed: only the engine knows the normalized bounds (a circle in a non-square box was
       fitted — region/types.ts), and only the engine knows whether a write was applied at all. */
    if (!isNormalEnd(cause)) {
      this.emit('cancel', { reason: cause });
      /* A cancel never leaves the region behind, `persistent` or not. The write goes through the
         CONTROLLER source: a region the page put on screen with setRegion() is not ours to
         remove because a pointer was cancelled. */
      this.writeGeometry(null, 'controller');
      return;
    }

    this.emit('end', { bounds: this.lastBounds });

    // persistent keeps the region only after a session that happened: a cancel (loss of focus,
    // pointercancel) must not leave junk on the screen.
    const keep = this.lastBounds !== null && (this.spec.persistent || this.pinned);
    if (!keep) this.writeGeometry(null, 'controller');
  }

  // --- programmatic region --------------------------------------------------

  /** Show a region without a gesture. Enables the layer if it is not enabled yet. */
  setRegion(bounds: Bounds): boolean {
    if (this.state !== 'enabled' && !this.enable()) return false;
    this.pinned = true;
    this.emit('start', { source: 'programmatic' });
    this.applyGeometry(bounds);
    return true;
  }

  /**
   * Remove the region — both one shown programmatically and one left by a persistent
   * gesture. In v0.1 there is a single region, so the method takes no argument.
   */
  clearRegion(): void {
    this.pinned = false;
    this.applyGeometry(null);
  }

  // --- internals ------------------------------------------------------------

  private fail(reason: string, silent = false): void {
    this.teardown();
    this.state = 'unsupported';
    if (!silent) warnOnce('unsupported', `${reason} — state is "unsupported", the page was untouched`);
    this.emit('unsupported', { reason });
  }

  private teardown(): void {
    this.controller?.detach();
    this.controller = null;
    this.activation = null;
    this.pinned = false;
    this.restoreTouchAction();

    const layer = this.layer;
    const mount = this.mount;
    this.layer = null;
    this.mount = null;
    this.lastBounds = null;
    if (layer === null || mount === null) return;

    layer.removeEventListener('toggle', this.onToggle);
    try {
      this.spec.renderer.clear(layer);
    } catch {
      /* we remove the layer anyway: a renderer error has no right to leave a node on the page */
    }
    this.closingOurselves = true;
    try {
      mount.destroy(layer);
    } catch (error) {
      warnOnce('destroy-failed', `the layer could not be removed cleanly: ${String(error)}`);
    }
    this.closingOurselves = false;
  }

  /**
   * A touch gesture is possible only where `touch-action` was already cleared BEFORE
   * the gesture: changing this property inside pointerdown is a race (measured: 1 of 6
   * gestures was cancelled by pointercancel). So we set it in advance on the surface
   * the user named explicitly, and restore the previous value on disabling.
   */
  private applyTouchAction(): void {
    if (this.spec.touch !== 'surface' || this.spec.surface === null) return;
    const style = this.spec.surface.style;
    this.touchActionBefore = style.getPropertyValue('touch-action');
    style.setProperty('touch-action', 'none');
  }

  private restoreTouchAction(): void {
    const surface = this.spec.surface;
    const before = this.touchActionBefore;
    this.touchActionBefore = null;
    if (surface === null || before === null) return;
    if (before === '') surface.style.removeProperty('touch-action');
    else surface.style.setProperty('touch-action', before);
  }

  /**
   * The page may close our popover from the outside (`hidePopover()`, `showModal()`
   * elsewhere in the top layer, and so on). We do not fight for the top layer: we report
   * it and leave things as they are — the page is not damaged, the effect just stops
   * being shown.
   */
  private readonly onToggle = (event: Event): void => {
    if (this.closingOurselves) return;
    const newState = (event as Event & { newState?: string }).newState;
    if (newState !== 'closed') return;
    this.applyGeometry(null);
    this.emit('lost-top-layer', {
      reason: 'the popover was closed from outside — the top layer is no longer ours',
    });
  };

  private emit<K extends keyof EventPayloads>(name: K, payload: EventPayloads[K]): void {
    this.events.emit(name, payload);
    dispatchDomEvent(this.spec.interactionRoot, String(name), payload);
  }
}
