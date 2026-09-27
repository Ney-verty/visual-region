import type { Bounds, Point } from '../region/types.js';
import type { EndCause } from '../controller/types.js';
import { boundsFromPoints, distance, pointFromEvent } from '../util/geometry.js';
import { cancelFrame, requestFrame } from '../util/raf.js';

export interface PointerWatch {
  /** Where we listen for pointerdown. move/up — on window, so that a gesture beyond the element's edge is not lost. */
  root: EventTarget;
  accepts(event: PointerEvent): boolean;
  threshold: number;
  onStart(): void;
  onChange(bounds: Bounds): void;
  onEnd(cause: EndCause, bounds: Bounds | null): void;
}

export interface PointerTracker {
  attach(): void;
  detach(): void;
}

/**
 * EventTarget in the types knows nothing about pointer events (they are described by
 * the WindowEventMap and ElementEventMap maps, and what we have in hand is the base
 * EventTarget). We narrow the type once, here: by the event type the browser always
 * sends a PointerEvent.
 */
function listen(
  target: EventTarget,
  type: string,
  handler: (event: PointerEvent) => void,
  options?: AddEventListenerOptions,
): void {
  target.addEventListener(type, handler as EventListener, options);
}

function unlisten(
  target: EventTarget,
  type: string,
  handler: (event: PointerEvent) => void,
  options?: EventListenerOptions,
): void {
  target.removeEventListener(type, handler as EventListener, options);
}

/**
 * The mechanics of a single gesture: pointerdown → threshold → motion frames → up/cancel.
 *
 * Two rules without which this breaks:
 *   1. At most one write to the DOM per frame. The handler only remembers the point
 *      (util/raf.ts), otherwise a fast trackpad gives 3-5 writes per frame.
 *   2. The gesture must always finish. pointerup may never arrive (loss of focus, a
 *      collapsed tab, the pointer leaving the window) — so blur and visibilitychange
 *      also close the gesture, otherwise the region would stay hanging.
 */
export function createPointerTracker(watch: PointerWatch): PointerTracker {
  const win: EventTarget = typeof window !== 'undefined' ? window : watch.root;
  const doc: Document | null = typeof document !== 'undefined' ? document : null;

  let active = false;
  let pointerId = -1;
  let anchor: Point | null = null;
  let latest: Point | null = null;
  let started = false;
  let lastBounds: Bounds | null = null;
  let frame = 0;

  const flush = (): void => {
    if (!active || !started || anchor === null || latest === null) return;
    const bounds = boundsFromPoints(anchor, latest);
    lastBounds = bounds;
    watch.onChange(bounds);
  };

  const schedule = (): void => {
    if (frame !== 0) return;
    frame = requestFrame(() => {
      frame = 0;
      flush();
    });
  };

  const finish = (cause: EndCause): void => {
    if (!active) return;
    // The last motion may not have reached the DOM yet — we play it out before the gesture
    // ends, otherwise the geometry on pointerup lags by a frame.
    if (frame !== 0) {
      cancelFrame(frame);
      frame = 0;
      flush();
    }
    const bounds = started ? lastBounds : null;
    cleanup();
    watch.onEnd(cause, bounds);
  };

  const cleanup = (): void => {
    unlisten(win, 'pointermove', onMove);
    unlisten(win, 'pointerup', onUp);
    unlisten(win, 'pointercancel', onCancel);
    unlisten(win, 'blur', onBlur);
    doc?.removeEventListener('visibilitychange', onVisibility);
    active = false;
    pointerId = -1;
    anchor = null;
    latest = null;
    started = false;
  };

  function onDown(event: PointerEvent): void {
    if (active) return; // a second finger/button during a gesture does not interest us
    if (!watch.accepts(event)) return;

    active = true;
    pointerId = event.pointerId;
    anchor = pointFromEvent(event);
    latest = anchor;
    started = false;
    lastBounds = null;

    // We cancel only our own event: without this the browser would start selecting text under the drag.
    event.preventDefault();

    listen(win, 'pointermove', onMove, { passive: true });
    listen(win, 'pointerup', onUp, { passive: true });
    listen(win, 'pointercancel', onCancel, { passive: true });
    listen(win, 'blur', onBlur);
    doc?.addEventListener('visibilitychange', onVisibility);
  }

  function onMove(event: PointerEvent): void {
    if (!active || event.pointerId !== pointerId) return;
    latest = pointFromEvent(event);
    if (!started) {
      if (anchor === null || distance(anchor, latest) < watch.threshold) return;
      started = true;
      watch.onStart();
    }
    schedule();
  }

  function onUp(event: PointerEvent): void {
    if (!active || event.pointerId !== pointerId) return;
    finish('pointerup');
  }

  function onCancel(event: PointerEvent): void {
    if (!active || event.pointerId !== pointerId) return;
    finish('pointercancel');
  }

  function onBlur(): void {
    finish('blur');
  }

  function onVisibility(): void {
    if (doc?.visibilityState === 'hidden') finish('visibility');
  }

  return {
    attach(): void {
      listen(watch.root, 'pointerdown', onDown, { capture: true, passive: false });
    },
    detach(): void {
      unlisten(watch.root, 'pointerdown', onDown, { capture: true });
      if (active) cleanup();
    },
  };
}
