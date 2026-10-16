import type { Effect } from '../effect/types.js';
import type { Mount } from '../mount/types.js';
import type { RegionShape } from '../region/types.js';
import type { Renderer } from '../render/types.js';
import { rectShape } from '../region/rect.js';
import { circleShape, ellipseShape } from '../region/ellipse.js';
import { invertEffect } from '../effect/invert.js';
import { blendRenderer } from '../render/blend.js';
import { topLayerMount } from '../mount/top-layer.js';
import { fixedMount } from '../mount/fixed.js';

/**
 * Implementation tables. There are two and a half of them, not six registries:
 * a registry is justified where there is a real choice between several variants.
 *
 *   shapes    — choice by name (`shape: 'rect'`), the name needs validation;
 *   effects   — choice by name (`effect: 'invert'`), the name needs validation;
 *   renderers — choice BY CAPABILITY (the first one that can do the intent), not choice by name;
 *   mounts    — two genuinely different ways of placing the layer;
 *   controllers — no registry at all: there is exactly one controller, and it is chosen not
 *                 by name but as a consequence of `activation` ('programmatic' → no controller).
 *
 * There is still no public `register*`. The extension point exists as these tables: the round
 * shapes (v0.2) were added as entries here, not as a new mechanism, and the contract stays
 * closed until an implementation appears that we did not write.
 */
const shapes = new Map<string, RegionShape>([
  ['rect', rectShape],
  ['ellipse', ellipseShape],
  ['circle', circleShape],
]);
const effects = new Map<string, Effect>([['invert', invertEffect]]);
const renderers: readonly Renderer[] = [blendRenderer];
const mounts = new Map<string, Mount>([
  ['top-layer', topLayerMount],
  ['fixed', fixedMount],
]);

export function shapeKinds(): string[] {
  return [...shapes.keys()];
}

export function effectKinds(): string[] {
  return [...effects.keys()];
}

export function mountKinds(): string[] {
  return [...mounts.keys()];
}

export function getShape(kind: string): RegionShape | null {
  return shapes.get(kind) ?? null;
}

export function getEffect(kind: string): Effect | null {
  return effects.get(kind) ?? null;
}

/** The first renderer that can handle this intent. The order in the list is the priority. */
export function getRenderer(effect: Effect): Renderer | null {
  for (const renderer of renderers) {
    if (renderer.supports(effect)) return renderer;
  }
  return null;
}

export function getMount(kind: string): Mount | null {
  return mounts.get(kind) ?? null;
}
