/**
 * Popover API detection — by the presence of methods on the prototype only.
 *
 * Why not UA/version: sniffing lies on WebViews, on "trimmed" builds and on
 * future engines, and what we need is an answer to "will showPopover() work here
 * and now", not "which Safari version do you have".
 */
export function popoverApiAvailable(): boolean {
  if (typeof HTMLElement === 'undefined') return false;
  const proto: unknown = HTMLElement.prototype;
  if (proto === null || typeof proto !== 'object') return false;
  const p = proto as Record<string, unknown>;
  return (
    typeof p['showPopover'] === 'function' &&
    typeof p['hidePopover'] === 'function' &&
    typeof p['togglePopover'] === 'function' &&
    'popover' in p
  );
}

/**
 * Is the layer really in the top layer? We check the state, not the fact of the call:
 * `showPopover()` may complete without giving the top layer (the attribute was overridden,
 * the element is already in the top layer as a <dialog>, and so on).
 */
export function isInTopLayer(el: HTMLElement): boolean {
  try {
    return el.matches(':popover-open');
  } catch {
    // The selector is unknown — there is no Popover API, hence no top layer either.
    return false;
  }
}
