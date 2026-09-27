import type { Bounds } from '../region/types.js';
import type { Controller, ControllerHost } from '../controller/types.js';
import type { EndCause } from '../controller/types.js';
import type { Mount } from '../mount/types.js';
import type { Activation } from '../interaction/activation.js';
import type { EventPayloads, Spec, VisualRegionState } from './types.js';
import { Emitter, dispatchDomEvent } from './events.js';
import { getMount } from './registry.js';
import { createActivation } from '../interaction/activation.js';
import { createDragController } from '../controller/drag.js';
import { setStyles } from '../util/style.js';
import { isBrowser } from '../util/env.js';
import { warnOnce } from '../util/warn.js';

/** With no region yet, the layer is neither painted nor catching the pointer: `visibility` does not affect the box tree. */
const HIDDEN: Record<string, string> = { visibility: 'hidden' };
const SHOWN: Record<string, string> = { visibility: 'visible' };

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
      this.controller = createDragController(this.activation, this.spec.threshold);
      this.controller.attach(this.spec.interactionRoot, this);
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
    const layer = this.layer;
    if (layer === null) return;
    if (bounds === null) {
      setStyles(layer, HIDDEN);
      this.lastBounds = null;
      return;
    }
    this.spec.shape.apply(layer, bounds);
    setStyles(layer, SHOWN);
    this.lastBounds = bounds;
    this.emit('change', { bounds });
  }

  onStart(): void {
    this.emit('start', { source: 'pointer' });
  }

  onFinish(cause: EndCause, bounds: Bounds | null): void {
    if (cause === 'pointerup') this.emit('end', { bounds });
    else this.emit('cancel', { reason: cause });

    // persistent keeps the region only after a gesture that happened: a cancel
    // (loss of focus, pointercancel) must not leave junk on the screen.
    const keep = cause === 'pointerup' && bounds !== null && (this.spec.persistent || this.pinned);
    if (!keep) this.applyGeometry(null);
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
