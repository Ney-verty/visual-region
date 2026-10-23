import type { Renderer } from './types.js';
import type { Effect } from '../effect/types.js';
import { clearStyles, setStyles } from '../util/style.js';

const PROPS = ['background-color', 'mix-blend-mode', 'opacity'] as const;

/**
 * The difference effect via `mix-blend-mode: difference` on an opaque layer.
 *
 * With an opaque operand `C`, `difference` gives `|input − C|` per channel; white (`#ffffff`,
 * the default) is therefore exact inversion, `255 − before` — measured in Chromium 148,
 * Firefox 150 and WebKit 26.4 with error 0 and ratio 1.0. The colour is normalized before the
 * renderer sees it: this code neither validates nor substitutes a default.
 *
 * Why not `backdrop-filter: invert(1)`: it silently fails in Firefox and WebKit, while
 * `CSS.supports('backdrop-filter', 'invert(1)')` returns true in all three engines — that is, the
 * supports() check lies.
 *
 * We set `opacity: 1` explicitly: an inherited or UA-set `opacity < 1` on the layer would destroy
 * the blending accuracy.
 */
export const blendRenderer: Renderer = {
  kind: 'blend',
  capabilities: { intents: ['invert'] },

  supports(effect: Effect): boolean {
    return blendRenderer.capabilities.intents.includes(effect.intent);
  },

  apply(layer: HTMLElement, effect: Effect): void {
    if (!blendRenderer.supports(effect)) {
      throw new Error(`renderer "blend" cannot render intent "${effect.intent}"`);
    }
    setStyles(layer, {
      'background-color': effect.color,
      'mix-blend-mode': 'difference',
      opacity: '1',
    });
  },

  clear(layer: HTMLElement): void {
    clearStyles(layer, PROPS);
  },
};
