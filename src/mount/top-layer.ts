import type { Mount, MountConfig } from './types.js';
import { isInTopLayer, popoverApiAvailable } from './capability.js';
import { setStyles } from '../util/style.js';
import { documentRoot } from '../util/env.js';

/**
 * A full reset of the popover UA styles. The UA table gives an element with `popover`:
 *   position: fixed; inset: 0; margin: auto; width: fit-content; height: fit-content;
 *   border: solid; padding: 0.25em; overflow: auto; color/background — Canvas.
 *
 * Without this reset the region geometry drifts twice over: the box is centred
 * (`margin: auto`) and shrinks to its content (`fit-content`). The layer needs a
 * predictable zero anchor in the top-left corner of the viewport.
 *
 * The base size is 1×1 px. This is a "unit box": the region shape comes from transform
 * (`translate3d(x,y,0) scale(w,h)`), see region/rect.ts.
 */
const RESET: Record<string, string> = {
  position: 'fixed',
  inset: 'auto',
  left: '0',
  top: '0',
  margin: '0',
  padding: '0',
  border: '0',
  width: '1px',
  height: '1px',
  'max-width': 'none',
  'max-height': 'none',
  'min-width': '0',
  'min-height': '0',
  overflow: 'visible',
  'box-sizing': 'border-box',
  // The layer only paints: it must not catch clicks, scroll, touch or selection.
  'pointer-events': 'none',
  'transform-origin': '0 0',
  background: 'transparent',
  color: 'transparent',
  // A decorative element: it appears neither in the a11y tree nor in the tab order.
  'user-select': 'none',
  outline: 'none',
};

export const topLayerMount: Mount = {
  kind: 'top-layer',
  guaranteed: true,

  supported: popoverApiAvailable,

  create(_config: MountConfig): HTMLElement {
    const root = documentRoot();
    if (root === null) throw new Error('no document.body/documentElement');

    const layer = document.createElement('div');
    layer.setAttribute('popover', 'manual'); // manual: not closed by Esc or an outside click
    layer.setAttribute('aria-hidden', 'true');
    layer.setAttribute('data-visual-region-layer', 'top-layer');
    setStyles(layer, RESET);

    root.appendChild(layer);

    try {
      layer.showPopover();
    } catch (error) {
      layer.remove();
      throw error instanceof Error ? error : new Error(String(error));
    }

    if (!isInTopLayer(layer)) {
      // The method exists but the top layer did not happen — we do not pretend all is well.
      topLayerMount.destroy(layer);
      throw new Error('showPopover() did not reach the top layer');
    }

    return layer;
  },

  destroy(layer: HTMLElement): void {
    if (isInTopLayer(layer)) {
      try {
        layer.hidePopover();
      } catch {
        // No longer in the top layer (for example, someone outside called hidePopover).
        // There is nothing to remove from the top layer; we delete the node anyway.
      }
    }
    layer.remove();
  },
};

export { RESET as TOP_LAYER_RESET };
