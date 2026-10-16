import type { Controller, ControllerHost, EndCause, FollowSize } from './types.js';
import type { Activation } from '../interaction/activation.js';
import type { Bounds, Point } from '../region/types.js';
import { pointFromEvent } from '../util/geometry.js';
import { cancelFrame, requestFrame } from '../util/raf.js';

/*
 * The two listener helpers are repeated here, not imported from interaction/pointer.ts.
 * Reason, and it is temporary on purpose: in this slice the drag path is frozen (PLAN §2 step 3)
 * and pointer.ts must not be touched at all, not even to widen an export. The duplication is
 * ten lines of `addEventListener` with a cast, and unifying it is a separate cleanup — the same
 * one that will decide whether the two frame loops merge.
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
 * The "follow" controller: no gesture at all. The region appears under the pointer while the
 * activation right holds and goes away when the right is lost — there is nothing to press and
 * nothing to release.
 *
 * Why a separate controller rather than a mode of drag: a drag's life is bounded by pointerdown
 * and pointerup, and its geometry is the rectangle between them. A follow has neither boundary —
 * its life is measured by the RIGHT (PLAN §2 step 3.0), so `activation` is tested on every
 * accepted event instead of once at the start. One value, two life cycles; that is why
 * `activation` stays a description of rights and the life cycle is chosen by `controller`.
 *
 * `pointerdown` is deliberately never listened to: a click on a link while following must not
 * end the region. `pointerup` ends a session only for touch, where it really is the end of the
 * contact (step 3.3).
 */
export function createFollowController(activation: Activation, size: FollowSize): Controller {
  const win: EventTarget | null = typeof window !== 'undefined' ? window : null;
  const doc: Document | null = typeof document !== 'undefined' ? document : null;

  let root: EventTarget | null = null;
  let host: ControllerHost | null = null;

  let active = false;
  /** The pointer that opened the session: a second finger neither moves nor closes it. */
  let pointerId = -1;
  /** The last accepted point. The pointer handler only records it — the frame does the writing. */
  let pending: Point | null = null;
  let lastBounds: Bounds | null = null;
  let frame = 0;

  /** The region is centred on the pointer: it appears under it, not beside it. */
  const boundsAt = (point: Point): Bounds => ({
    x: point.x - size.width / 2,
    y: point.y - size.height / 2,
    width: size.width,
    height: size.height,
  });

  const flush = (): void => {
    frame = 0;
    if (!active || pending === null || host === null) return;
    const bounds = boundsAt(pending);
    lastBounds = bounds;
    host.applyGeometry(bounds);
  };

  const schedule = (): void => {
    if (frame !== 0) return;
    frame = requestFrame(flush);
  };

  const finish = (cause: EndCause): void => {
    if (!active || host === null) return;
    // The last motion may not have reached the DOM yet — play it out before ending, exactly as
    // the drag tracker does, otherwise the geometry at the moment of the end lags by a frame.
    if (frame !== 0) {
      cancelFrame(frame);
      frame = 0;
      flush();
    }
    const bounds = lastBounds;
    active = false;
    pointerId = -1;
    pending = null;
    lastBounds = null;
    host.onFinish(cause, bounds);
  };

  function onMove(event: PointerEvent): void {
    if (event.isPrimary !== true) return; // a second finger is not the pointer we follow

    if (active) {
      if (event.pointerId !== pointerId) return;
      /* The right is checked on EVERY event. Releasing the modifier, or leaving the surface the
         activation names, ends the session — and it ends it NORMALLY, not as a cancellation:
         the region was not lost, it was dismissed. */
      if (!activation.accepts(event)) {
        finish('ineligible');
        return;
      }
    } else {
      // Nothing has begun, so there is nothing to end: only an accepted move opens a session.
      if (!activation.accepts(event)) return;
      active = true;
      pointerId = event.pointerId;
      host?.onStart();
    }

    pending = pointFromEvent(event);
    schedule();
  }

  function onOut(event: PointerEvent): void {
    if (!active || event.pointerId !== pointerId) return;
    /* The single leaving rule (step 3.2): `pointerout` also fires on every transition INSIDE the
       page — without the null check, following would end on each move between elements. A null
       relatedTarget in all three engines means the pointer left the document (measured in
       step 0.2), and `pointerleave` was rejected there as the rule: WebKit does not send it at
       all, and Firefox sends it per element of the chain. */
    if (event.relatedTarget !== null) return;
    finish('pointerout');
  }

  function onUp(event: PointerEvent): void {
    if (!active || event.pointerId !== pointerId) return;
    // A mouse release does not end following — that is why these events are not listened to at
    // all in the mouse case. A touch release does end it: it is the end of the contact (3.3).
    if (event.pointerType !== 'touch') return;
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

  /** Where the listeners live. Window by default — the same reason as in the drag tracker. */
  const target = (): EventTarget | null => win ?? root;

  return {
    kind: 'follow',

    attach(nextRoot: EventTarget, nextHost: ControllerHost): void {
      root = nextRoot;
      host = nextHost;
      const to = target();
      if (to === null) return;

      // Capture on purpose: a page that calls stopPropagation() on pointermove must not be able
      // to freeze the region. Nothing is prevented or stopped here, so the page sees no change.
      listen(to, 'pointermove', onMove, { capture: true, passive: true });
      listen(to, 'pointerout', onOut, { capture: true, passive: true });
      listen(to, 'pointerup', onUp, { capture: true, passive: true });
      listen(to, 'pointercancel', onCancel, { capture: true, passive: true });
      listen(to, 'blur', onBlur);
      doc?.addEventListener('visibilitychange', onVisibility);
    },

    detach(): void {
      const to = target();
      if (to !== null) {
        unlisten(to, 'pointermove', onMove, { capture: true });
        unlisten(to, 'pointerout', onOut, { capture: true });
        unlisten(to, 'pointerup', onUp, { capture: true });
        unlisten(to, 'pointercancel', onCancel, { capture: true });
        unlisten(to, 'blur', onBlur);
      }
      doc?.removeEventListener('visibilitychange', onVisibility);

      if (frame !== 0) cancelFrame(frame);
      frame = 0;
      active = false;
      pointerId = -1;
      pending = null;
      lastBounds = null;
      host = null;
      root = null;
    },
  };
}
