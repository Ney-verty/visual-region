import type { Controller, ControllerHost } from './types.js';
import type { Activation } from '../interaction/activation.js';
import { createPointerTracker, type PointerTracker } from '../interaction/pointer.js';

/**
 * The "drag" controller. The only one in v0.1, which is why there is no controller
 * registry either: it is chosen not by name but by `activation` ('programmatic' → no
 * controller at all).
 *
 * The controller knows nothing about layers, the top layer or inversion. It knows about
 * the pointer and reports geometry to the host — precisely that allows a second controller
 * (lasso, circular selection) to be added later without touching effect, mount or render.
 */
export function createDragController(activation: Activation, threshold: number): Controller {
  let tracker: PointerTracker | null = null;

  return {
    kind: 'drag',

    attach(root: EventTarget, host: ControllerHost): void {
      tracker = createPointerTracker({
        root,
        accepts: (event) => activation.accepts(event),
        threshold,
        onStart: () => {
          host.onStart();
        },
        onChange: (bounds) => {
          host.applyGeometry(bounds);
        },
        onEnd: (cause, bounds) => {
          // Whether to hide the region or keep it is decided by the host, not the controller:
          // it is the only one that knows about persistent and about a programmatic region.
          host.onFinish(cause, bounds);
        },
      });
      tracker.attach();
    },

    detach(): void {
      tracker?.detach();
      tracker = null;
    },
  };
}
