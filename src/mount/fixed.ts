import type { Mount, MountConfig } from './types.js';
import { setStyles } from '../util/style.js';
import { documentRoot } from '../util/env.js';

/**
 * LEGACY, only on explicit request (`mount: 'fixed'`). Not full support.
 *
 * The measured failures of this method:
 *   body{opacity:0.5}        → coverage 0 (the layer blends inside the transparency group);
 *   html{transform:scale(…)}  → the layer is 1152×810 instead of 1280×900, coverage 0.809, geometry drifts;
 *   html{transform:translate} → coverage 0.9472;
 *   html{transform:rotate(1deg)} → coverage 0.988;
 *   z-index: 2147483647 on the content → the layer is under the content, 0/5760 matches.
 *
 * That is why this is a deliberate opt-in under the caller's responsibility, not a fallback:
 * silently sliding in here gives a visually wrong result while the API "works" — the worst of
 * all possible outcomes.
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
  'pointer-events': 'none',
  'transform-origin': '0 0',
  background: 'transparent',
  color: 'transparent',
  'user-select': 'none',
  outline: 'none',
};

export const fixedMount: Mount = {
  kind: 'fixed',
  guaranteed: false,

  supported(): boolean {
    return true; // position:fixed exists everywhere; "support" here is not the same as correctness
  },

  create(config: MountConfig): HTMLElement {
    const root = documentRoot();
    if (root === null) throw new Error('no document.body/documentElement');

    const layer = document.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    layer.setAttribute('data-visual-region-layer', 'fixed');
    setStyles(layer, { ...RESET, 'z-index': String(config.zIndex) });
    root.appendChild(layer);
    return layer;
  },

  destroy(layer: HTMLElement): void {
    layer.remove();
  },
};
