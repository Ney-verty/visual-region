/**
 * The auto-initialization entry: enables everything marked in the DOM as
 * `data-visual-region="invert"`.
 *
 * A separate module — deliberately. The clean entry (`.` → `index.ts`) must stay free of side
 * effects: otherwise `sideEffects` could not be declared truthfully, and a bundler would be entitled
 * to drop the auto-initialization call as dead code. Here it is the opposite: the only purpose of
 * this module is to run on import, which is why it is listed in `sideEffects`.
 *
 * Usage: `import 'visual-region/auto'`.
 */
import { autoInit } from './index.js';
import { isBrowser } from './util/env.js';

if (isBrowser) {
  /* The script may sit in <head> before the markup — then we wait for DOMContentLoaded.
     If the markup is already there, we scan right away: the event has already fired by then. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => autoInit(), { once: true });
  } else {
    autoInit();
  }
}
