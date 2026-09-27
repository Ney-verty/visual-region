export type EffectIntent = 'invert';

/**
 * What has to happen to the content inside the region. In v0.1 there is one intent — inversion
 * (decision 3: filter/custom colour move to v0.2, the architectural possibility stays).
 */
export interface Effect {
  readonly kind: string;
  readonly intent: EffectIntent;
}
