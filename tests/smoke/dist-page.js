/*
 * Scenario 1 of loading the built package: ESM import of the clean entry point.
 *
 * The file is external rather than a `<script type="module">` inside `dist.html`
 * for exactly one reason: the same page is served under strict CSP (`/csp-dist/`,
 * `default-src 'self'`), and such a policy blocks an inline script. A library
 * checked on a page with an inline script is not fully checked.
 *
 * The import is absolute (`/dist/index.js`) — the path does not depend on the
 * prefix under which the document is served; the origin is the same, so `'self'`
 * lets it through.
 */
import * as api from '/dist/index.js';

const violations = [];
document.addEventListener('securitypolicyviolation', (event) => {
  violations.push({
    directive: event.effectiveDirective,
    blocked: String(event.blockedURI || '').slice(0, 120),
    /* Source and text sample — so "there is a violation" can be turned into
       "this exact place is to blame", instead of guessing. */
    source: String(event.sourceFile || '').slice(0, 200),
    line: event.lineNumber,
    col: event.columnNumber,
    sample: String(event.sample || '').slice(0, 200),
  });
});

/* Page snapshot for the "after destroy — as it was" check. Three counters
   independently: HTML, node count, inline style count (the library writes through
   CSSOM, and a single HTML snapshot does not always show that). */
function snapshot() {
  const els = [...document.querySelectorAll('*')];
  let inlineStyles = 0;
  for (const el of els) if (el.hasAttribute('style')) inlineStyles++;
  return {
    html: document.documentElement.outerHTML,
    nodes: els.length,
    inlineStyles,
    popovers: document.querySelectorAll(':popover-open').length,
    layers: document.querySelectorAll('[data-visual-region-layer]').length,
  };
}

window.__dist = {
  esm: {
    exports: Object.keys(api).sort(),
    hasClass: typeof api.VisualRegion === 'function',
    supported: api.supported,
    /* The module is deferred, so by the time it runs the markup is already parsed
       while the classic IIFE <script> has not been added yet — the runner adds it
       itself in a separate step. Thus "the import created nothing" is checked honestly. */
    layersAfterImport: document.querySelectorAll('[data-visual-region-layer]').length,
    nodesAfterImport: document.getElementsByTagName('*').length,
    /* Which scripts the document actually loaded — proof that we worked with the
       production artifact from `dist/`, not with the `tsc` build of the sources. */
    scripts: performance
      .getEntriesByType('resource')
      .map((e) => e.name)
      .filter((n) => /\.(js|cjs)$/.test(n)),
  },

  violations: () => violations.map((v) => ({ ...v })),
  page: snapshot,

  /* Positive control of the policy: the `style` attribute must be blocked, while a
     CSSOM write must apply. Without this, "no violations" proves nothing (the CSP
     proof relies on a positive control).

     The function is async not for beauty. Measured (all three engines): a
     `securitypolicyviolation` from `setAttribute('style', …)` arrives
     ASYNCHRONOUSLY — in the same synchronous block the journal is empty, the
     record appears in the next task. A synchronous counter therefore
     systematically showed 0 and "no violations from the control", although the
     record exists (its source is this very file). We wait a task before each read
     so the number means what it says. */
  async cspControl() {
    const tick = () => new Promise((r) => setTimeout(r, 0));

    const probe = document.createElement('div');
    document.body.appendChild(probe);
    const before = violations.length;

    probe.setAttribute('style', 'color: rgb(1, 2, 3)');
    const attrApplied = getComputedStyle(probe).color;
    await tick();
    const afterSetAttribute = violations.length;

    probe.style.setProperty('color', 'rgb(4, 5, 6)');
    const cssomApplied = getComputedStyle(probe).color;
    await tick();
    const afterCssom = violations.length;

    probe.remove();
    return {
      policyEnforcedByEffect: attrApplied !== 'rgb(1, 2, 3)',
      attrApplied,
      violationsFromSetAttribute: afterSetAttribute - before,
      violationsFromCssom: afterCssom - afterSetAttribute,
      cssomApplied,
    };
  },
};
