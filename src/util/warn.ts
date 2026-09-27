const PREFIX = '[visual-region]';

const seen = new Set<string>();

/**
 * Warn exactly once per key. We throw no exceptions outward on background paths
 * (auto-initialization, degradation) — the library has no right to break someone else's page
 * because of its own problem.
 */
export function warnOnce(key: string, message: string): void {
  if (seen.has(key)) return;
  seen.add(key);
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`${PREFIX} ${message}`);
  }
}

/** Reset the "once-only" state — tests only. */
export function resetWarnings(): void {
  seen.clear();
}
