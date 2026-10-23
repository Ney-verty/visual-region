import type { Effect } from './types.js';

/**
 * Inversion as a pure intent. How exactly to show it is up to the renderer (`blend`). Swapping the
 * renderer (WebGL/WebGPU/…) does not change this object, because it holds not a single pixel: only
 * the "what", not the "how".
 */
export const invertEffect: Effect = {
  kind: 'invert',
  intent: 'invert',
  color: '#ffffff',
};
