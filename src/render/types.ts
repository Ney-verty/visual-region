import type { Effect, EffectIntent } from '../effect/types.js';

/** What a renderer can do. Read before applying: cannot → an honest error, not silence. */
export interface RendererCapabilities {
  readonly intents: readonly EffectIntent[];
}

export interface Renderer {
  readonly kind: string;
  readonly capabilities: RendererCapabilities;
  supports(effect: Effect): boolean;
  /**
   * Writes styles ONTO THE LAYER ITSELF. Blending on a child element is forbidden: a child blends
   * inside the layer's own group, and the page is not inverted (measured: 99.2% of pixels differ).
   */
  apply(layer: HTMLElement, effect: Effect): void;
  /** Removes its own styles. Resetting the layer as a whole is not its job. */
  clear(layer: HTMLElement): void;
}
