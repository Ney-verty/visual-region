/**
 * The frame scheduler. At most one DOM write per frame: the pointer handler only records the point,
 * and the geometry is computed in the frame.
 *
 * The setTimeout fallback exists for non-browser environments and for test setups where rAF may be
 * disabled.
 */
export function requestFrame(fn: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(() => fn());
  return setTimeout(fn, 16) as unknown as number;
}

export function cancelFrame(id: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
  else clearTimeout(id);
}
