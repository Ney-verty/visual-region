export type EffectIntent = 'invert';

/**
 * What has to happen to the content inside the region. In v0.1 there is one intent — inversion
 * (decision 3: filter/custom colour move to v0.2, the architectural possibility stays).
 */
export interface Effect {
  readonly kind: string;
  readonly intent: EffectIntent;
  /**
   * The operand of the difference arithmetic, a canonical `#rrggbb` string. A parameter of the
   * intent ("what"), not a pixel and not a backend setting: a renderer with the same intent must
   * honour it. Normalized once, before the renderer sees it.
   */
  readonly color: string;
}
