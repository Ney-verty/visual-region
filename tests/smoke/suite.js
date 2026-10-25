/*
 * Battery of checks executed IN THE PAGE ITSELF.
 *
 * The split with the runner (run.mjs) is this:
 *   here — everything checked without images and without real input:
 *     state, geometry, DOM hygiene, events, activation, touch, cleanup, CSP;
 *   the runner — what needs Playwright:
 *     pixels (screenshots → tests/lib/decoder.html), real click/wheel/selection,
 *     top-layer ordering scenarios, static source scan.
 *
 * Synthetic PointerEvents are appropriate here: they check the LOGIC of the
 * library (what we accept as a gesture), not the browser's behavior. Browser
 * behavior (real gestures, touch scrolling) is checked by real input in the runner.
 */
import { VisualRegion, visualRegion, init, autoInit, supported } from '../../.tmp-build/index.js';

/* ----------------------------------------------------------------- journal */

const violations = [];
document.addEventListener('securitypolicyviolation', (event) => {
  violations.push({
    directive: event.effectiveDirective,
    blocked: String(event.blockedURI || '').slice(0, 120),
    sample: String(event.sample || '').slice(0, 120),
  });
});

const created = [];
function track(vr) {
  created.push(vr);
  return vr;
}
function destroyAll() {
  while (created.length) {
    const vr = created.pop();
    try {
      vr.destroy();
    } catch (error) {
      /* the check "destroy must not throw" exists separately */
      results.push({ name: 'cleanup after check', ok: false, detail: String(error) });
    }
  }
}

/* ----------------------------------------------------------- hostile root */

const ROOTS = {
  'body-opacity-50': ['body', 'root-body-opacity-50'],
  'body-filter-blur': ['body', 'root-body-filter-blur'],
  'html-transform-scale': ['html', 'root-html-transform-scale'],
  'html-transform-translate': ['html', 'root-html-transform-translate'],
  'html-transform-rotate': ['html', 'root-html-transform-rotate'],
  /* Case "pos-fixed-maxz": content with the maximum z-index. For legacy `fixed`
     it meant "layer under the content, 0/5760 matches"; the top layer must not
     notice it — and that is what is checked. */
  'pos-fixed-maxz': ['body', 'root-pos-fixed-maxz'],
};
const rootParam = new URLSearchParams(location.search).get('root') || 'control';
if (ROOTS[rootParam]) {
  const [selector, className] = ROOTS[rootParam];
  document.querySelector(selector).classList.add(className);
}

/* --------------------------------------------------------------- utilities */

const results = [];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function near(actual, expected, tol, what) {
  if (!(Math.abs(actual - expected) <= tol)) {
    throw new Error(`${what}: expected ${expected} ±${tol}, got ${actual}`);
  }
}
const frames = (n = 2) =>
  new Promise((resolve) => {
    let i = 0;
    const step = () => (++i >= n ? resolve() : requestAnimationFrame(step));
    requestAnimationFrame(step);
  });

function rectOf(target) {
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}

function snapshot() {
  const els = [...document.querySelectorAll('*')];
  let inlineStyles = 0;
  for (const el of els) if (el.hasAttribute('style')) inlineStyles++;
  return {
    html: document.documentElement.outerHTML,
    nodes: els.length,
    inlineStyles,
    popovers: document.querySelectorAll(':popover-open').length,
  };
}

let seq = 0;
function pointer(type, target, opts = {}) {
  const buttons =
    opts.buttons === undefined ? (type === 'pointerup' || type === 'pointercancel' ? 0 : 1) : opts.buttons;
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    pointerId: opts.pointerId === undefined ? 1 : opts.pointerId,
    pointerType: opts.pointerType === undefined ? 'mouse' : opts.pointerType,
    isPrimary: opts.isPrimary === undefined ? true : opts.isPrimary,
    button: opts.button === undefined ? 0 : opts.button,
    buttons,
    clientX: opts.clientX === undefined ? 0 : opts.clientX,
    clientY: opts.clientY === undefined ? 0 : opts.clientY,
    altKey: !!opts.altKey,
    shiftKey: !!opts.shiftKey,
    ctrlKey: !!opts.ctrlKey,
    metaKey: !!opts.metaKey,
  });
  target.dispatchEvent(event);
  return event;
}
const down = (opts) => pointer('pointerdown', opts.target || document.body, opts);
const move = (opts) => pointer('pointermove', window, opts);
const up = (opts) => pointer('pointerup', window, opts);

async function drag({
  from,
  to,
  altKey = true,
  pointerType = 'mouse',
  pointerId = undefined,
  target = undefined,
}) {
  const id = pointerId === undefined ? ++seq : pointerId;
  const common = { altKey, pointerType, pointerId: id };
  down({ ...common, target, clientX: from.x, clientY: from.y });
  move({ ...common, clientX: (from.x + to.x) / 2, clientY: (from.y + to.y) / 2 });
  await frames(2);
  move({ ...common, clientX: to.x, clientY: to.y });
  await frames(2);
  up({ ...common, clientX: to.x, clientY: to.y });
  await frames(2);
}

/* ------------------------------------------------------------------ checks */

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

check('environment: Popover API is defined (supported)', () => {
  eq(supported, true, 'supported');
  eq(VisualRegion.supported, true, 'VisualRegion.supported');
});

check('lifecycle: the instance enables itself, the layer is in the top layer', () => {
  const vr = track(visualRegion());
  eq(vr.state, 'enabled', 'state');
  const layer = vr.element;
  assert(layer, 'layer was not created');
  eq(layer.parentElement, document.body, 'the layer must live in body');
  eq(layer.getAttribute('popover'), 'manual', 'popover=manual (Esc and an outside click do not close it)');
  eq(layer.matches(':popover-open'), true, ':popover-open');
  eq(layer.matches(':modal'), false, ':modal — this is a popover, not a dialog');
});

check('lifecycle: disabled:true does not enable, enable() does', () => {
  const vr = track(new VisualRegion({ disabled: true }));
  eq(vr.state, 'disabled', 'state after creation');
  eq(vr.element, null, 'there must be no layer');
  eq(vr.enable(), true, 'enable()');
  eq(vr.state, 'enabled', 'state after enable()');
  assert(vr.element, 'the layer must appear');
});

check('hygiene: the popover UA styles are fully reset', () => {
  const vr = track(visualRegion());
  const layer = vr.element;
  const cs = getComputedStyle(layer);
  const want = {
    position: 'fixed',
    top: '0px',
    left: '0px',
    marginTop: '0px',
    marginRight: '0px',
    marginBottom: '0px',
    marginLeft: '0px',
    paddingTop: '0px',
    paddingRight: '0px',
    paddingBottom: '0px',
    paddingLeft: '0px',
    borderTopWidth: '0px',
    borderRightWidth: '0px',
    borderBottomWidth: '0px',
    borderLeftWidth: '0px',
    borderTopStyle: 'none',
    width: '1px',
    height: '1px',
    maxWidth: 'none',
    maxHeight: 'none',
    overflowX: 'visible',
    overflowY: 'visible',
    boxSizing: 'border-box',
    pointerEvents: 'none',
    visibility: 'hidden',
  };
  for (const [prop, value] of Object.entries(want)) eq(cs[prop], value, `computed ${prop}`);

  /* right/bottom in getComputedStyle for a positioned box are the USED value
     (1280 - left - width), not 'auto', so we check the declared value in the
     inline style and, above all, the actual box: the UA rule for popover gives
     `inset: 0; margin: auto; width/height: fit-content`, and if the reset did
     not work, the box will inevitably leave the corner or shrink to its content.
     (`style.inset` is useless here: the shorthand serializes together with the
     longhands — "0px auto auto 0px", because we set left/top explicitly.) */
  eq(layer.style.right, 'auto', 'declared right');
  eq(layer.style.bottom, 'auto', 'declared bottom');
  const box = rectOf(layer);
  eq(
    `${box.x},${box.y},${box.width},${box.height}`,
    '0,0,1,1',
    'a unit box in the top-left corner (otherwise the popover UA styles are not reset)',
  );
});

check('hygiene: the layer is decorative and empty (not in the a11y flow)', () => {
  const vr = track(visualRegion());
  const layer = vr.element;
  eq(layer.getAttribute('aria-hidden'), 'true', 'aria-hidden');
  eq(layer.childNodes.length, 0, 'there must be no children');
  eq(layer.textContent, '', 'there must be no text');
  eq(layer.getAttribute('role'), null, 'we do not set role');
});

check('hygiene: enabling does not change focus', () => {
  const btn = document.getElementById('click-target');
  btn.focus();
  eq(document.activeElement, btn, 'focus before enabling');
  track(visualRegion());
  eq(document.activeElement, btn, 'focus after enabling');
});

check('geometry: the programmatic region matches the requested one', () => {
  const probe = rectOf('#probe');
  const want = { x: Math.round(probe.x), y: Math.round(probe.y), width: 400, height: 300 };
  const vr = track(visualRegion({ activation: 'programmatic' }));
  eq(vr.setRegion(want), true, 'setRegion');
  const got = rectOf(vr.element);
  const d = {
    x: +(got.x - want.x).toFixed(2),
    y: +(got.y - want.y).toFixed(2),
    w: +(got.width - want.width).toFixed(2),
    h: +(got.height - want.height).toFixed(2),
  };
  const ok = [d.x, d.y, d.w, d.h].every((v) => Math.abs(v) <= 0.5);
  assert(ok, `geometry mismatch ${JSON.stringify(d)} (requested ${JSON.stringify(want)})`);
  return `Δxywh=${JSON.stringify(d)}`;
});

check('geometry: fractional coordinates do not accumulate error', () => {
  const want = { x: 100.37, y: 200.62, width: 333.33, height: 199.99 };
  const vr = track(visualRegion({ activation: 'programmatic' }));
  vr.setRegion(want);
  const got = rectOf(vr.element);
  const d = {
    x: +(got.x - want.x).toFixed(3),
    y: +(got.y - want.y).toFixed(3),
    w: +(got.width - want.width).toFixed(3),
    h: +(got.height - want.height).toFixed(3),
  };
  assert(
    [d.x, d.y, d.w, d.h].every((v) => Math.abs(v) <= 0.5),
    `mismatch ${JSON.stringify(d)}`,
  );
  return `Δxywh=${JSON.stringify(d)}`;
});

check('geometry: the region is bound to the viewport, not to the document', async () => {
  const vr = track(visualRegion({ activation: 'programmatic' }));
  const want = { x: 120, y: 300, width: 240, height: 160 };
  vr.setRegion(want);
  const before = rectOf(vr.element);
  window.scrollBy(0, 200);
  await frames(2);
  const after = rectOf(vr.element);
  window.scrollTo(0, 0);
  await frames(2);
  near(after.x, before.x, 0.5, 'x after scroll');
  near(after.y, before.y, 0.5, 'y after scroll');
});

check('lifecycle: destroy returns the page to its initial state', () => {
  window.scrollTo(0, 0);
  const before = snapshot();
  const vr = visualRegion();
  vr.setRegion(rectOf('#probe'));
  vr.destroy();
  const after = snapshot();
  eq(after.html, before.html, 'the document HTML changed');
  eq(after.nodes, before.nodes, 'node count');
  eq(after.inlineStyles, before.inlineStyles, 'number of elements with inline style');
  eq(after.popovers, 0, 'open popovers');
  eq(vr.element, null, 'element after destroy');
});

check('lifecycle: disable is just as clean, enabling is possible again', () => {
  const before = snapshot();
  const vr = track(visualRegion());
  vr.setRegion({ x: 10, y: 10, width: 100, height: 100 });
  vr.disable();
  eq(vr.state, 'disabled', 'state');
  eq(snapshot().html, before.html, 'HTML after disable');
  eq(vr.enable(), true, 'second enable');
  assert(vr.element && vr.element.matches(':popover-open'), 'the layer is back in the top layer');
  vr.disable();
  eq(snapshot().html, before.html, 'HTML after the second disable');
});

check('setOptions: applies on the fly and keeps the region', () => {
  const vr = track(visualRegion({ activation: 'programmatic' }));
  const want = { x: 200, y: 220, width: 300, height: 180 };
  vr.setRegion(want);
  const first = vr.element;
  vr.setOptions({ threshold: 8 });
  eq(vr.state, 'enabled', 'state');
  assert(vr.element && vr.element !== first, 'the layer must be recreated');
  assert(!document.contains(first), 'the old layer must be removed from the DOM');
  const got = rectOf(vr.element);
  near(got.width, want.width, 0.5, 'region width after setOptions');
  near(got.x, want.x, 0.5, 'region x after setOptions');
});

check('setOptions: a rejected patch leaves the live instance untouched', () => {
  const vr = track(visualRegion({ activation: 'programmatic', effectColor: '#ff00ff' }));
  const want = { x: 160, y: 180, width: 260, height: 170 };
  vr.setRegion(want);
  const layer = vr.element;
  assert(layer, 'the layer exists');
  assert(vr.bounds, 'the bounds exist');
  const color = getComputedStyle(layer).backgroundColor;
  const bounds = { ...vr.bounds };

  let thrown = null;
  try {
    vr.setOptions({ shape: 'ellipse', effectColor: 'invalid' });
  } catch (error) {
    thrown = error;
  }

  assert(thrown instanceof TypeError, `expected TypeError, got ${thrown ? String(thrown) : 'nothing'}`);
  eq(vr.element, layer, 'the layer must not be recreated');
  eq(vr.state, 'enabled', 'state');
  eq(getComputedStyle(vr.element).backgroundColor, color, 'the operand colour');
  near(vr.bounds.x, bounds.x, 0.5, 'bounds x');
  near(vr.bounds.width, bounds.width, 0.5, 'bounds width');
  near(vr.bounds.height, bounds.height, 0.5, 'bounds height');

  /* The old valid colour survives the rejected patch — including the valid field that came
     in the same mixed patch — and is what the next successful patch builds on. */
  vr.setOptions({ threshold: 8 });
  assert(vr.element && vr.element !== layer, 'a valid patch recreates the layer');
  eq(
    getComputedStyle(vr.element).backgroundColor,
    'rgb(255, 0, 255)',
    'the rejected patch did not replace the operand',
  );
  near(vr.bounds.width, want.width, 0.5, 'bounds width after a valid patch');
  eq(vr.state, 'enabled', 'state after a valid patch');
});

check('setOptions: a rejected patch in one instance does not change another', () => {
  const a = track(new VisualRegion({ activation: 'programmatic', effectColor: '#ff00ff' }));
  const b = track(new VisualRegion({ activation: 'programmatic', effectColor: '#00ffff' }));
  a.setRegion({ x: 40, y: 60, width: 120, height: 90 });
  b.setRegion({ x: 240, y: 60, width: 120, height: 90 });
  const bLayer = b.element;
  assert(bLayer && b.bounds, 'B has a layer and bounds');
  const bColor = getComputedStyle(bLayer).backgroundColor;
  const bBounds = { ...b.bounds };

  let thrown = null;
  try {
    a.setOptions({ effectColor: 'invalid' });
  } catch (error) {
    thrown = error;
  }
  assert(thrown instanceof TypeError, `expected TypeError, got ${thrown ? String(thrown) : 'nothing'}`);

  eq(b.element, bLayer, "B's layer");
  eq(getComputedStyle(b.element).backgroundColor, bColor, "B's operand");
  near(b.bounds.x, bBounds.x, 0.5, "B's bounds x");
  eq(a.state, 'enabled', 'A stays enabled');
  eq(b.state, 'enabled', 'B stays enabled');

  a.setOptions({ effectColor: '#ffffff' });
  eq(getComputedStyle(a.element).backgroundColor, 'rgb(255, 255, 255)', 'A applies the valid patch');
  eq(getComputedStyle(b.element).backgroundColor, bColor, 'B is untouched by A');
});

check('validation: configuration errors fail loudly (TypeError)', () => {
  const cases = [
    /* The stale example replaced, not the expectation: this case is "an unknown shape
       name is refused", and `circle` was only ever the name picked to be unknown. In
       v0.2 it is a real shape (PLAN step 4), so the example had to move — the check
       itself is untouched, and the positive side lives in the two `shapes:` checks. */
    [{ shape: 'triangle' }, 'shape'],
    [{ effect: 'rainbow' }, 'effect'],
    [{ mount: 'portal' }, 'mount'],
    [{ activation: 'element' }, 'activation:element without surface'],
    [{ activation: 'modifier', modifier: null }, 'modifier:null'],
    [{ touch: 'surface' }, 'touch:surface without surface'],
    [{ threshold: -1 }, 'threshold'],
    [{ zIndex: 1.5 }, 'zIndex'],
  ];
  for (const [opts, what] of cases) {
    let thrown = null;
    try {
      track(new VisualRegion(opts));
    } catch (error) {
      thrown = error;
    }
    assert(
      thrown instanceof TypeError,
      `${what}: expected TypeError, got ${thrown ? String(thrown) : 'nothing'}`,
    );
  }
});

check('gesture: threshold, order start → change → end, final geometry', async () => {
  const vr = track(visualRegion({ modifier: 'alt' }));
  const log = [];
  vr.on('start', (p) => log.push(`start:${p.source}`));
  vr.on('change', (p) => log.push(`change:${Math.round(p.bounds.width)}`));
  vr.on('end', (p) => log.push(`end:${p.bounds ? Math.round(p.bounds.width) : null}`));

  const id = ++seq;
  down({ pointerId: id, altKey: true, clientX: 300, clientY: 250 });
  move({ pointerId: id, altKey: true, clientX: 301, clientY: 251 }); // 1.41px < threshold 3
  await frames(2);
  eq(log.length, 0, 'the gesture started before the threshold');
  move({ pointerId: id, altKey: true, clientX: 700, clientY: 550 });
  await frames(2);
  move({ pointerId: id, altKey: true, clientX: 700, clientY: 550 });
  up({ pointerId: id, altKey: true, clientX: 700, clientY: 550 });
  await frames(2);

  const names = log.map((l) => l.split(':')[0]);
  eq(names[0], 'start', 'first event');
  assert(names.includes('change'), 'there was no change event');
  eq(names[names.length - 1], 'end', 'last event');
  eq(log[log.length - 1], 'end:400', 'width in end');
  eq(getComputedStyle(vr.element).visibility, 'hidden', 'the region must disappear after pointerup');
  return log.join(' ');
});

check('gesture: the real region geometry equals the drag', async () => {
  const vr = track(visualRegion());
  await drag({ from: { x: 300, y: 200 }, to: { x: 720, y: 560 } });
  const r = rectOf(vr.element);
  near(r.x, 300, 0.5, 'x');
  near(r.y, 200, 0.5, 'y');
  near(r.width, 420, 0.5, 'width');
  near(r.height, 360, 0.5, 'height');
});

check('gesture: the region is visible during the drag and disappears after release', async () => {
  const vr = track(visualRegion());
  const id = ++seq;
  down({ pointerId: id, altKey: true, clientX: 200, clientY: 200 });
  move({ pointerId: id, altKey: true, clientX: 500, clientY: 400 });
  await frames(2);
  eq(getComputedStyle(vr.element).visibility, 'visible', 'during the drag');
  move({ pointerId: id, altKey: true, clientX: 520, clientY: 420 });
  await frames(2);
  eq(getComputedStyle(vr.element).visibility, 'visible', 'during the drag (2)');
  up({ pointerId: id, altKey: true, clientX: 520, clientY: 420 });
  await frames(2);
  eq(getComputedStyle(vr.element).visibility, 'hidden', 'after release');
});

check('activation: no modifier / not the left button / not primary — no gesture', async () => {
  const vr = track(visualRegion());
  let started = 0;
  vr.on('start', () => started++);

  await drag({ from: { x: 100, y: 100 }, to: { x: 200, y: 200 }, altKey: false });
  eq(started, 0, 'without Alt');

  const id2 = ++seq;
  down({ pointerId: id2, altKey: true, button: 2, buttons: 2, clientX: 100, clientY: 100 });
  move({ pointerId: id2, altKey: true, button: 2, clientX: 200, clientY: 200 });
  up({ pointerId: id2, altKey: true, button: 2, clientX: 200, clientY: 200 });
  await frames(2);
  eq(started, 0, 'right button');

  const id3 = ++seq;
  down({ pointerId: id3, altKey: true, isPrimary: false, clientX: 100, clientY: 100 });
  move({ pointerId: id3, altKey: true, isPrimary: false, clientX: 200, clientY: 200 });
  up({ pointerId: id3, altKey: true, isPrimary: false, clientX: 200, clientY: 200 });
  await frames(2);
  eq(started, 0, 'not primary');

  await drag({ from: { x: 100, y: 100 }, to: { x: 200, y: 200 }, altKey: true });
  eq(started, 1, 'with Alt and the left button');
});

check('interaction: a foreign event is not suppressed, ours is', () => {
  track(visualRegion());
  const target = document.getElementById('click-target');

  const foreign = down({ target, altKey: false, clientX: 40, clientY: 40 });
  eq(foreign.defaultPrevented, false, 'without activation preventDefault is not ours');
  up({ clientX: 40, clientY: 40 });

  const ours = down({ target, altKey: true, clientX: 40, clientY: 40 });
  eq(ours.defaultPrevented, true, 'on our own gesture preventDefault is mandatory');
  up({ clientX: 40, clientY: 40 });
});

check('gesture: pointercancel gives cancel, not end', async () => {
  const vr = track(visualRegion());
  const log = [];
  vr.on('end', () => log.push('end'));
  vr.on('cancel', (p) => log.push(`cancel:${p.reason}`));
  const id = ++seq;
  down({ pointerId: id, altKey: true, clientX: 100, clientY: 100 });
  move({ pointerId: id, altKey: true, clientX: 400, clientY: 300 });
  await frames(2);
  pointer('pointercancel', window, { pointerId: id, clientX: 400, clientY: 300 });
  await frames(2);
  eq(log.join(','), 'cancel:pointercancel', 'events');
  eq(getComputedStyle(vr.element).visibility, 'hidden', 'region hidden');
});

check('gesture: window blur closes the gesture', async () => {
  const vr = track(visualRegion());
  const log = [];
  vr.on('cancel', (p) => log.push(p.reason));
  const id = ++seq;
  down({ pointerId: id, altKey: true, clientX: 100, clientY: 100 });
  move({ pointerId: id, altKey: true, clientX: 300, clientY: 300 });
  await frames(2);
  window.dispatchEvent(new Event('blur'));
  await frames(2);
  eq(log.join(','), 'blur', 'cancel reason');
  eq(getComputedStyle(vr.element).visibility, 'hidden', 'region hidden');
});

check('events: CustomEvent on the interaction root', async () => {
  track(visualRegion());
  let detail = null;
  const onEnd = (event) => {
    detail = event.detail;
  };
  document.body.addEventListener('visual-region:end', onEnd);
  try {
    await drag({ from: { x: 200, y: 200 }, to: { x: 500, y: 400 } });
  } finally {
    document.body.removeEventListener('visual-region:end', onEnd);
  }
  assert(detail && detail.bounds, 'detail.bounds in the DOM event: ' + JSON.stringify(detail));
  eq(Math.round(detail.bounds.width), 300, 'width');
});

check('top layer: the site closed our popover — we report it and do not fight back', async () => {
  const vr = track(visualRegion());
  const layer = vr.element;
  let reason = null;
  vr.on('lost-top-layer', (p) => {
    reason = p.reason;
  });
  vr.setRegion({ x: 50, y: 50, width: 200, height: 100 });
  layer.hidePopover();
  await frames(2);
  assert(reason, 'no lost-top-layer event');
  eq(layer.matches(':popover-open'), false, 'we must not put ourselves back into the top layer');
  eq(vr.state, 'enabled', 'the instance stays alive');
  eq(getComputedStyle(layer).visibility, 'hidden', 'region hidden');
});

check('persistent: the region remains after release', async () => {
  const vr = track(visualRegion({ persistent: true }));
  await drag({ from: { x: 350, y: 250 }, to: { x: 750, y: 550 } });
  eq(getComputedStyle(vr.element).visibility, 'visible', 'the region must remain');
  const r = rectOf(vr.element);
  near(r.width, 400, 0.5, 'width');
  near(r.height, 300, 0.5, 'height');
  vr.clearRegion();
  eq(getComputedStyle(vr.element).visibility, 'hidden', 'clearRegion hides the region');
});

check('persistent: cancel does not leave the region on screen', async () => {
  const vr = track(visualRegion({ persistent: true }));
  const id = ++seq;
  down({ pointerId: id, altKey: true, clientX: 300, clientY: 300 });
  move({ pointerId: id, altKey: true, clientX: 600, clientY: 500 });
  await frames(2);
  eq(getComputedStyle(vr.element).visibility, 'visible', 'during the drag');
  pointer('pointercancel', window, { pointerId: id, clientX: 600, clientY: 500 });
  await frames(2);
  eq(getComputedStyle(vr.element).visibility, 'hidden', 'after cancel');
});

check('touch: touch-action is set in advance and returned as it was', () => {
  const surface = document.getElementById('touch-surface');
  // We set the value ourselves, through CSSOM: under strict CSP an inline attribute
  // in the markup is a violation of the page itself, and we need a clean journal.
  surface.style.setProperty('touch-action', 'pan-y');
  const before = surface.style.getPropertyValue('touch-action');
  eq(before, 'pan-y', 'initial value');
  const vr = new VisualRegion({ touch: 'surface', surface, activation: 'element' });
  eq(surface.style.getPropertyValue('touch-action'), 'none', 'on enable');
  vr.destroy();
  eq(surface.style.getPropertyValue('touch-action'), before, 'after destroy');
  surface.style.removeProperty('touch-action');
});

check('touch: a sensor gesture is accepted only with touch:surface', async () => {
  const surface = document.getElementById('touch-surface');

  const off = track(new VisualRegion({ surface, activation: 'element' }));
  let offStarted = 0;
  off.on('start', () => offStarted++);
  await drag({
    from: { x: 300, y: 300 },
    to: { x: 340, y: 340 },
    altKey: false,
    pointerType: 'touch',
    target: surface,
  });
  eq(offStarted, 0, 'touch with touch:off must not activate');

  const on = track(new VisualRegion({ surface, activation: 'element', touch: 'surface' }));
  let onStarted = 0;
  on.on('start', () => onStarted++);
  await drag({
    from: { x: 300, y: 300 },
    to: { x: 340, y: 340 },
    altKey: false,
    pointerType: 'touch',
    target: surface,
  });
  eq(onStarted, 1, 'touch with touch:surface must activate');
});

check('touch: if the surface touch-action is not cleared — refuse, do not race', () => {
  const surface = document.getElementById('touch-surface');
  const vr = track(new VisualRegion({ surface, activation: 'element', touch: 'surface' }));
  // Simulate "a foreign CSS won": we give the surface its scroll back after enable().
  surface.style.setProperty('touch-action', 'pan-y');
  let started = 0;
  vr.on('start', () => started++);
  const ev = down({ pointerType: 'touch', target: surface, altKey: false, clientX: 300, clientY: 300 });
  move({ pointerType: 'touch', clientX: 340, clientY: 340 });
  up({ pointerType: 'touch', clientX: 340, clientY: 340 });
  eq(started, 0, 'the gesture must not start: the browser will cancel it anyway (pointercancel)');
  eq(ev.defaultPrevented, false, 'we do not suppress a foreign gesture');
  surface.style.removeProperty('touch-action');
});

check('activation: element — gesture only on the surface', async () => {
  const surface = document.getElementById('surface');
  const vr = track(visualRegion({ surface, activation: 'element' }));
  let started = 0;
  vr.on('start', () => started++);
  await drag({
    from: { x: 300, y: 300 },
    to: { x: 400, y: 400 },
    altKey: false,
    target: document.getElementById('click-target'),
  });
  eq(started, 0, 'outside the surface');
  await drag({ from: { x: 300, y: 300 }, to: { x: 400, y: 400 }, altKey: false, target: surface });
  eq(started, 1, 'on the surface');
});

check('degradation: without the Popover API — unsupported, no silent fallback to fixed', () => {
  const proto = HTMLElement.prototype;
  const saved = {
    showPopover: Object.getOwnPropertyDescriptor(proto, 'showPopover'),
    hidePopover: Object.getOwnPropertyDescriptor(proto, 'hidePopover'),
    togglePopover: Object.getOwnPropertyDescriptor(proto, 'togglePopover'),
  };
  delete proto.showPopover;
  delete proto.hidePopover;
  delete proto.togglePopover;
  try {
    const vr = track(visualRegion());
    eq(vr.state, 'unsupported', 'state');
    eq(vr.element, null, 'the layer must not be created');
    eq(
      document.querySelectorAll('[data-visual-region]').length,
      1,
      'only the marked-up page element is in the DOM',
    );
    eq(init({}), null, 'init() must return null');
    eq(vr.enable(), false, 'enable() must honestly return false');
  } finally {
    for (const [name, descriptor] of Object.entries(saved)) {
      if (descriptor !== undefined) Object.defineProperty(proto, name, descriptor);
    }
  }
  const back = track(visualRegion());
  eq(back.state, 'enabled', 'after the API is restored everything works');
});

check('autoInit: the data-visual-region markup works', async () => {
  const found = autoInit(document);
  for (const vr of found) created.push(vr);
  eq(found.length, 1, 'how many instances were created');
  const [vr] = found;
  eq(vr.state, 'enabled', 'state');
  let started = 0;
  vr.on('start', () => started++);
  await drag({
    from: { x: 300, y: 300 },
    to: { x: 400, y: 400 },
    altKey: false,
    target: document.getElementById('surface'),
  });
  eq(started, 1, 'gesture on the marked-up surface');
});

check('autoInit: data-shape, data-controller and data-follow-size are read from the markup', async () => {
  /* The page itself is not touched: this check builds its own container, so the count of
     marked-up elements the other checks rely on (`found.length === 1`) stays what it is.
     The element is removed again at the end. */
  const host = document.createElement('div');
  host.innerHTML =
    '<div id="mr-valid" data-visual-region="invert" data-controller="follow" ' +
    'data-activation="always" data-shape="circle" data-follow-size="120x80"></div>' +
    '<div id="mr-invalid" data-visual-region="invert" data-controller="follow" ' +
    'data-activation="always" data-follow-size="120 x 80"></div>' +
    '<div id="mr-color" data-visual-region="invert" data-activation="programmatic" ' +
    'data-effect-color="#FF00FF"></div>' +
    '<div id="mr-color-invalid" data-visual-region="invert" data-activation="programmatic" ' +
    'data-effect-color="ff00ff"></div>';
  document.body.appendChild(host);

  const warnings = [];
  const realWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map(String).join(' '));
  };
  let found;
  try {
    found = autoInit(host);
  } finally {
    console.warn = realWarn;
  }
  for (const vr of found) created.push(vr);

  eq(found.length, 4, 'every marked-up element was initialized');
  eq(found[0].state, 'enabled', 'the valid one: state');

  /* No pointerdown anywhere: `data-controller="follow"` really made a follow controller,
     `data-shape="circle"` a circle and `data-follow-size="120x80"` a 120×80 box — which a
     circle then fits to the 80×80 square it reports. */
  move({ clientX: 400, clientY: 300 });
  await frames(2);
  const b = found[0].bounds;
  eq(`${b.x},${b.y},${b.width},${b.height}`, '360,260,80,80', 'the followed circle from the markup');
  const clip = getComputedStyle(found[0].element).clipPath;
  assert(clip.includes('path('), 'the silhouette from the markup: ' + clip);

  /* The invalid size warns (the message names the attribute, so a page author can find it)
     and leaves the default 120 in place; the element still initializes. */
  eq(found[1].state, 'enabled', 'the invalid one: state');
  const warned = warnings.filter((line) => line.includes('data-follow-size'));
  eq(warned.length, 1, 'a single warning for the invalid grammar: ' + JSON.stringify(warnings));
  const d = found[1].bounds;
  eq(`${d.width},${d.height}`, '120,120', 'the default size is used instead');

  /* The colour from the markup: the same strict grammar as in JS, canonical lower-case.
     `programmatic` keeps these instances out of the pointer path driven by `move()` above. */
  eq(found[2].state, 'enabled', 'the coloured one: state');
  eq(
    getComputedStyle(found[2].element).backgroundColor,
    'rgb(255, 0, 255)',
    'the operand colour is read from data-effect-color',
  );
  eq(found[3].state, 'enabled', 'the invalid colour one: state');
  eq(
    getComputedStyle(found[3].element).backgroundColor,
    'rgb(255, 255, 255)',
    'an invalid colour falls back to white',
  );
  const colorWarned = warnings.filter((line) => line.includes('data-effect-color'));
  eq(colorWarned.length, 1, 'a single warning for the invalid colour: ' + JSON.stringify(warnings));

  /* Destroyed here rather than left to destroyAll(): the assertion below is about the page's own
     markup, and it has to hold now, not two checks later. */
  for (const vr of found) {
    vr.destroy();
    created.splice(created.indexOf(vr), 1);
  }
  host.remove();
  eq(document.querySelectorAll('[data-visual-region]').length, 1, 'the page has its own markup back');
});

check('effectColor: two live instances keep their own colour across recreation', async () => {
  /* The proof is not "two freshly built objects differ" but "recreating one instance does not
     repaint the other". If the registry effect were shared and mutated, setOptions() on A would
     leak its colour into B through the common object. */
  const layersBefore = document.querySelectorAll('[data-visual-region-layer]').length;
  const a = new VisualRegion({ activation: 'programmatic', effectColor: '#ff00ff' });
  const b = new VisualRegion({ activation: 'programmatic', effectColor: '#00ffff' });
  try {
    a.setRegion({ x: 40, y: 40, width: 120, height: 80 });
    b.setRegion({ x: 220, y: 40, width: 120, height: 80 });

    eq(getComputedStyle(a.element).backgroundColor, 'rgb(255, 0, 255)', 'A: its own operand');
    eq(getComputedStyle(b.element).backgroundColor, 'rgb(0, 255, 255)', 'B: its own operand');

    a.setOptions({ effectColor: '#ffffff' });
    eq(getComputedStyle(a.element).backgroundColor, 'rgb(255, 255, 255)', 'A after recreation');
    eq(getComputedStyle(b.element).backgroundColor, 'rgb(0, 255, 255)', 'B is untouched by A');
    eq(a.state, 'enabled', 'A stays enabled');
    eq(b.state, 'enabled', 'B stays enabled');
    assert(a.bounds !== null && b.bounds !== null, 'both regions survived the recreation');

    b.setOptions({ effectColor: '#ff00ff' });
    eq(getComputedStyle(b.element).backgroundColor, 'rgb(255, 0, 255)', 'B after recreation');
    eq(getComputedStyle(a.element).backgroundColor, 'rgb(255, 255, 255)', 'A is untouched by B');

    a.destroy();
    b.destroy();
    eq(document.querySelectorAll('[data-visual-region-layer]').length, layersBefore, 'both layers are gone');
  } finally {
    a.destroy();
    b.destroy();
  }
});

check('CSP: there are no library violations in the journal', () => {
  eq(violations.length, 0, 'securitypolicyviolation: ' + JSON.stringify(violations.slice(0, 3)));
  return 'the violation journal is empty (auxiliary signal — see the positive control in the runner)';
});

check('CSP: no <style>, adoptedStyleSheets or cssText', () => {
  const styleTags = document.querySelectorAll('style').length;
  const sheets = document.adoptedStyleSheets ? document.adoptedStyleSheets.length : 0;
  const vr = track(visualRegion());
  vr.setRegion({ x: 5, y: 5, width: 50, height: 50 });
  eq(document.querySelectorAll('style').length, styleTags, 'number of <style> in the document');
  eq(document.adoptedStyleSheets ? document.adoptedStyleSheets.length : 0, sheets, 'adoptedStyleSheets');
  const inline = vr.element.getAttribute('style') || '';
  assert(inline.includes('mix-blend-mode'), 'the layer styles were not applied: ' + inline);
  assert(!inline.includes('undefined'), 'garbage in the inline styles: ' + inline);
});

check('events: the region is reused after a series of gestures', async () => {
  const vr = track(visualRegion());
  let ends = 0;
  vr.on('end', () => ends++);
  for (let i = 0; i < 3; i++) {
    await drag({ from: { x: 100, y: 100 }, to: { x: 300 + i * 20, y: 300 } });
  }
  eq(ends, 3, 'number of completed gestures');
  eq(vr.state, 'enabled', 'state');
  assert(vr.element && vr.element.matches(':popover-open'), 'the layer is still in the top layer');
});

/* ------------------------------------------------------- v0.2: shapes ---- */

check('shapes: a programmatic circle reports the fitted square, not the requested box', async () => {
  const vr = track(visualRegion({ shape: 'circle' }));
  const seen = [];
  vr.on('change', ({ bounds }) => seen.push(bounds));
  vr.setRegion({ x: 100, y: 100, width: 300, height: 200 });
  await frames(2);
  const b = vr.bounds;
  eq(b.x, 150, 'centred horizontally: x');
  eq(b.y, 100, 'the smaller side decides: y');
  eq(b.width, 200, 'the diameter is the smaller side: width');
  eq(b.height, 200, 'the reported box is a square: height');
  eq(seen.length, 1, 'one change per setRegion call');
  eq(seen[0].width, 200, 'and the change payload carries the fitted box');
  /* The layer itself, measured in the engine, not reconstructed from our own numbers. */
  const rect = rectOf(vr.element);
  near(rect.x, 150, 0.5, 'the layer sits where the fitted box says: x');
  near(rect.y, 100, 0.5, 'y');
  near(rect.width, 200, 0.5, 'the layer is the fitted square: width');
  near(rect.height, 200, 0.5, 'height');
  vr.clearRegion();
});

check('shapes: an ellipse fills the requested box exactly', async () => {
  const vr = track(visualRegion({ shape: 'ellipse' }));
  vr.setRegion({ x: 100, y: 100, width: 300, height: 200 });
  await frames(2);
  const b = vr.bounds;
  eq(`${b.x},${b.y},${b.width},${b.height}`, '100,100,300,200', 'the ellipse is the identity on the box');
  const rect = rectOf(vr.element);
  near(rect.width, 300, 0.5, 'the layer keeps the requested size');
  near(rect.height, 200, 0.5, 'and both sides of it');
  vr.clearRegion();
});

/* -------------------------------------------------- v0.2: follow (3.1) --- */

check('follow: a pointer move opens the region, with no press at all', async () => {
  const vr = track(visualRegion({ controller: 'follow', activation: 'always' }));
  const order = [];
  vr.on('start', (p) => order.push(`start:${p.source}`));
  vr.on('change', () => order.push('change'));
  vr.on('end', () => order.push('end'));
  eq(getComputedStyle(vr.element).visibility, 'hidden', 'nothing is shown before a move');

  move({ clientX: 400, clientY: 300 }); // no pointerdown anywhere
  await frames(2);
  eq(order[0], 'start:pointer', 'the accepted move itself opens the session');
  eq(getComputedStyle(vr.element).visibility, 'visible', 'and the region is on screen');
  const b = vr.bounds;
  eq(
    `${b.x},${b.y},${b.width},${b.height}`,
    '340,240,120,120',
    'the default 120 square, centred on the pointer',
  );

  /* A follow is not bounded by a press, so a release must not close it. */
  up({ clientX: 400, clientY: 300 });
  await frames(2);
  eq(order.filter((e) => e === 'end').length, 0, 'a mouse release does not end a follow');
  eq(getComputedStyle(vr.element).visibility, 'visible', 'the region is still there');

  pointer('pointerout', window, { relatedTarget: null });
  await frames(2);
  eq(order[order.length - 1], 'end', 'leaving the document does end it');
  eq(getComputedStyle(vr.element).visibility, 'hidden', 'and the region goes away');
});

check('follow: five moves inside one frame give one write, and the last point wins', async () => {
  const vr = track(visualRegion({ controller: 'follow', activation: 'always' }));
  let changes = 0;
  let last = null;
  vr.on('change', ({ bounds }) => {
    changes++;
    last = bounds;
  });
  for (let i = 0; i < 5; i++) move({ clientX: 200 + i, clientY: 200 });
  await frames(2);
  eq(changes, 1, 'writes per frame');
  assert(last, 'a change has arrived');
  eq(last.x, 204 - 60, 'the last point of the frame wins');
});

check('follow: losing the right is a normal end, and holding it again starts a new session', async () => {
  const vr = track(visualRegion({ controller: 'follow', activation: 'modifier' }));
  const order = [];
  vr.on('start', () => order.push('start'));
  vr.on('end', () => order.push('end'));
  vr.on('cancel', () => order.push('cancel'));

  move({ altKey: true, clientX: 300, clientY: 300 });
  await frames(2);
  move({ altKey: false, clientX: 340, clientY: 300 });
  await frames(2);
  eq(order.join(','), 'start,end', 'the right was lost, not the region: end, not cancel');
  eq(getComputedStyle(vr.element).visibility, 'hidden', 'a non-persistent region is cleared');

  move({ altKey: true, clientX: 400, clientY: 300 });
  await frames(2);
  eq(order.filter((e) => e === 'start').length, 2, 'holding the key again is a NEW session');
});

check('follow: leaving the allowed surface ends the session', async () => {
  const surface = document.getElementById('surface');
  const vr = track(visualRegion({ controller: 'follow', activation: 'element', surface }));
  const order = [];
  vr.on('start', () => order.push('start'));
  vr.on('end', () => order.push('end'));
  /* The move is dispatched ON the surface: the follow controller really does look at
     the target of every event, which is exactly what is being checked here. */
  pointer('pointermove', surface, { clientX: 300, clientY: 300 });
  await frames(2);
  eq(order.join(','), 'start', 'inside the surface the session opens');
  pointer('pointermove', document.body, { clientX: 900, clientY: 600 });
  await frames(2);
  eq(order.join(','), 'start,end', 'outside it the session ends');
});

check('follow: a touch release ends the session — the contact is over', async () => {
  const surface = document.getElementById('touch-surface');
  const vr = track(visualRegion({ controller: 'follow', activation: 'element', surface, touch: 'surface' }));
  const order = [];
  vr.on('start', () => order.push('start'));
  vr.on('end', () => order.push('end'));
  pointer('pointermove', surface, { pointerType: 'touch', clientX: 300, clientY: 300 });
  await frames(2);
  eq(order.join(','), 'start', 'a touch move opens it');
  up({ pointerType: 'touch', clientX: 300, clientY: 300 });
  await frames(2);
  eq(order.join(','), 'start,end', 'the release closes it: for touch this is the end of the contact');
});

check('follow: persistent keeps the last geometry after the end', async () => {
  const vr = track(visualRegion({ controller: 'follow', activation: 'always', persistent: true }));
  move({ clientX: 500, clientY: 300 });
  await frames(2);
  const kept = vr.bounds;
  pointer('pointerout', window, { relatedTarget: null });
  await frames(2);
  eq(getComputedStyle(vr.element).visibility, 'visible', 'kept after the session ended');
  eq(vr.bounds.x, kept.x, 'the last geometry, not an empty one');
  move({ clientX: 140, clientY: 140 });
  await frames(2);
  eq(vr.bounds.x, 140 - 60, 'the next accepted move resumes following');
  vr.clearRegion();
  await frames(2);
  eq(getComputedStyle(vr.element).visibility, 'hidden', 'clearRegion removes it');
});

check('follow: a cancel does not leave the region, even with persistent', async () => {
  const vr = track(visualRegion({ controller: 'follow', activation: 'always', persistent: true }));
  move({ clientX: 300, clientY: 300 });
  await frames(2);
  eq(getComputedStyle(vr.element).visibility, 'visible', 'shown while following');
  pointer('pointercancel', window, { clientX: 300, clientY: 300 });
  await frames(2);
  eq(getComputedStyle(vr.element).visibility, 'hidden', 'a cancel never leaves the region behind');
});

check('follow: while a programmatic region is shown, the pointer does not replace it', async () => {
  const vr = track(visualRegion({ controller: 'follow', activation: 'always' }));
  vr.setRegion({ x: 40, y: 40, width: 200, height: 100 });
  await frames(2);
  let changes = 0;
  vr.on('change', () => changes++);
  move({ clientX: 600, clientY: 400 });
  await frames(2);
  eq(changes, 0, 'no geometry writes while the programmatic region is shown');
  eq(vr.bounds.x, 40, 'the geometry the page set is untouched');
  vr.clearRegion();
  move({ clientX: 620, clientY: 400 });
  await frames(2);
  eq(changes, 1, 'clearRegion hands the geometry back to the controller');
  eq(vr.bounds.x, 620 - 60, 'and the pointer geometry is applied');
});

/* ------------------------------------------------ scenes for the runner ---- */

const scene = { instances: [] };

function sceneShow(bounds, options = {}) {
  sceneHide();
  const vr = new VisualRegion({ activation: 'programmatic', persistent: true, ...options });
  scene.instances.push(vr);
  vr.setRegion(bounds);
  return { state: vr.state, actual: rectOf(vr.element) };
}
function sceneHide() {
  while (scene.instances.length) scene.instances.pop().destroy();
}
function sceneState() {
  const vr = scene.instances[0];
  if (!vr || !vr.element) return null;
  const cs = getComputedStyle(vr.element);
  return {
    state: vr.state,
    visibility: cs.visibility,
    blend: cs.mixBlendMode,
    background: cs.backgroundColor,
    rect: rectOf(vr.element),
    topLayer: vr.element.matches(':popover-open'),
  };
}

/* Pointer pass-through: click, wheel, selection — counted in JS, the DOM is untouched. */
const pass = { clicks: 0, scroll: 0, selection: '' };
document.getElementById('click-target').addEventListener('click', () => {
  pass.clicks++;
});
window.addEventListener('scroll', () => {
  pass.scroll = Math.round(window.scrollY);
});

/*
 * `::backdrop` — the invisible part of the top layer over the whole page. What we
 * check is NOT "does the pseudo-element exist" and not "what styles it has", but
 * the observable behavior: does it intercept input. A pseudo-element cannot be
 * addressed by an event, but if it intercepts something, that is visible from
 * where the input lands and what has happened to the page.
 *
 * The counters hang on the ELEMENTS themselves, not on `window`: a listener on
 * window would catch bubbling from our layer too, and the interception would stay
 * unnoticed. Plus a separate counter on the layer itself — it is the direct
 * "an event reached the layer".
 */
const backdrop = {
  counts: {},
  layerHits: 0,
  points() {
    const center = (sel) => {
      const r = rectOf(sel);
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    };
    const box = rectOf('#probe');
    /* The region — over the probe: a point inside the region pierces the layer
       itself, points below (button, text, neighbor) — only `::backdrop`. */
    const region = { x: box.x + 8, y: box.y + 8, width: box.width - 16, height: box.height - 16 };
    return {
      region,
      points: {
        insideRegion: center('#probe'),
        outside: center('#outside'),
        target: center('#click-target'),
        text: center('#text'),
      },
    };
  },
  show(region) {
    sceneShow(region);
    this.layerHits = 0;
    const layer = scene.instances[0].element;
    for (const event of ['click', 'pointerdown', 'touchstart']) {
      layer.addEventListener(event, () => {
        backdrop.layerHits++;
      });
    }
    return sceneState();
  },
  hide() {
    sceneHide();
    this.layerHits = 0;
    return null;
  },
  reset() {
    this.counts = {};
    this.layerHits = 0;
    window.scrollTo(0, 0);
  },
  read() {
    const out = { scrollY: Math.round(window.scrollY), layerHits: this.layerHits };
    for (const [k, v] of Object.entries(this.counts)) out[k] = v;
    return out;
  },
  /* Who gets the input at this point. `pointer-events: none` on the layer means
     that elementFromPoint returns NOT it; if `::backdrop` were hit-testable, the
     layer would be returned — that is, a miss shows up as ours: true. */
  hit() {
    const { points } = this.points();
    const out = {};
    for (const [name, p] of Object.entries(points)) {
      const el = document.elementFromPoint(p.x, p.y);
      out[name] = el
        ? {
            id: el.id || el.tagName.toLowerCase(),
            ours: !!(el.closest && el.closest('[data-visual-region-layer]')),
          }
        : null;
    }
    return out;
  },
  /* Observational part: what the UA reports at all about our layer's `::backdrop`. */
  ua() {
    const vr = scene.instances[0];
    if (!vr || !vr.element) return null;
    const cs = getComputedStyle(vr.element, '::backdrop');
    return {
      background: cs.backgroundColor,
      pointerEvents: cs.pointerEvents,
      visibility: cs.visibility,
      position: cs.position,
      inset: `${cs.top} ${cs.right} ${cs.bottom} ${cs.left}`,
      content: cs.content,
    };
  },
};

for (const id of ['probe', 'outside', 'click-target', 'text']) {
  const el = document.getElementById(id);
  for (const event of ['click', 'pointerdown', 'mousedown', 'touchstart']) {
    el.addEventListener(event, () => {
      const key = `${event}:${id}`;
      backdrop.counts[key] = (backdrop.counts[key] || 0) + 1;
    });
  }
}
window.addEventListener(
  'wheel',
  () => {
    backdrop.counts.wheel = (backdrop.counts.wheel || 0) + 1;
  },
  { passive: true },
);

/* Order in the top layer: we observe, without trying to beat the site's UI. */
const topLayer = {
  dialogBox() {
    const dialog = document.getElementById('site-dialog');
    dialog.showModal();
    const box = rectOf(dialog);
    dialog.close();
    return box;
  },
  async ourLayerThenSiteDialog() {
    const dialog = document.getElementById('site-dialog');
    const box = topLayer.dialogBox();
    sceneShow(box);
    dialog.showModal();
    await frames(2);
    const ours = sceneState();
    return {
      box,
      ourTopLayer: ours && ours.topLayer,
      ourVisibility: ours && ours.visibility,
      dialogOpen: dialog.open,
    };
  },
  async siteDialogThenOurLayer() {
    const dialog = document.getElementById('site-dialog');
    dialog.showModal();
    const box = rectOf(dialog);
    sceneShow(box);
    await frames(2);
    const ours = sceneState();
    return {
      box,
      ourTopLayer: ours && ours.topLayer,
      ourVisibility: ours && ours.visibility,
      dialogOpen: dialog.open,
    };
  },
  async ourLayerThenSitePopover() {
    const popover = document.getElementById('site-popover');
    const box = rectOf('#probe');
    sceneShow(box);
    popover.showPopover();
    await frames(2);
    const ours = sceneState();
    return {
      box,
      ourTopLayer: ours && ours.topLayer,
      ourVisibility: ours && ours.visibility,
      sitePopoverOpen: popover.matches(':popover-open'),
      openCount: document.querySelectorAll(':popover-open').length,
    };
  },
  async twoInstances() {
    const box = rectOf('#probe');
    sceneShow(box);
    const second = new VisualRegion({ activation: 'programmatic' });
    scene.instances.push(second);
    const secondBox = { x: box.x + 40, y: box.y + 40, width: 160, height: 120 };
    second.setRegion(secondBox);
    await frames(2);
    return {
      boxes: [box, secondBox],
      layers: [...document.querySelectorAll('[data-visual-region-layer]')].map((el) => ({
        rect: rectOf(el),
        topLayer: el.matches(':popover-open'),
      })),
    };
  },
  async sitePopoverThenOurLayer() {
    const popover = document.getElementById('site-popover');
    popover.showPopover();
    const box = rectOf('#probe');
    sceneShow(box);
    await frames(2);
    const ours = sceneState();
    return { box, ourTopLayer: ours && ours.topLayer, sitePopoverOpen: popover.matches(':popover-open') };
  },

  /* Scenario 4: several manual popovers at once.
     Entry order into the top layer: A → our layer → B. Expectation: A under us
     (inverted), B above us (not inverted). It is checked pixel by pixel, so here
     both regions and two crops for the shots are returned:
     the overlap A∩B and a strip inside A, guaranteed to the left of B. */
  async severalManualPopovers() {
    const a = document.getElementById('site-popover');
    const b = document.getElementById('site-popover-2');
    a.showPopover();
    const boxA = rectOf(a);
    sceneShow(boxA);
    await frames(2);
    b.showPopover();
    await frames(2);
    const boxB = rectOf(b);

    const inset = 6;
    const overlap = {
      x: Math.max(boxA.x, boxB.x) + inset,
      y: Math.max(boxA.y, boxB.y) + inset,
      width: Math.min(boxA.x + boxA.width, boxB.x + boxB.width) - Math.max(boxA.x, boxB.x) - inset * 2,
      height: Math.min(boxA.y + boxA.height, boxB.y + boxB.height) - Math.max(boxA.y, boxB.y) - inset * 2,
    };
    const stripA = {
      x: boxA.x + inset,
      y: boxA.y + inset,
      width: Math.min(80, boxB.x - boxA.x - inset * 2),
      height: 40,
    };

    return {
      boxA,
      boxB,
      overlap,
      stripA,
      setupOk:
        overlap.width >= 20 &&
        overlap.height >= 20 &&
        stripA.width >= 20 &&
        stripA.x + stripA.width <= boxB.x,
      open: [...document.querySelectorAll(':popover-open')].map((el) => el.id || el.tagName.toLowerCase()),
    };
  },

  /* Scenario 5: fullscreen with an active layer. Entering fullscreen requires
     user activation, so it is called from a click handler (the runner clicks),
     not from evaluate(). */
  async fullscreenRequest() {
    const target = document.getElementById('fullscreen-target');
    window.__fsError = null;
    try {
      await target.requestFullscreen();
    } catch (error) {
      window.__fsError = String((error && error.message) || error);
    }
    await frames(2);
    return topLayer.fullscreenState();
  },
  async fullscreenPrepare() {
    const box = rectOf('#fullscreen-target');
    sceneShow(box);
    await frames(2);
    return { box, state: sceneState() };
  },
  fullscreenState() {
    const target = document.getElementById('fullscreen-target');
    const ours = sceneState();
    return {
      fullscreenElement: document.fullscreenElement ? document.fullscreenElement.id : null,
      error: window.__fsError || null,
      ourTopLayer: ours && ours.topLayer,
      ourVisibility: ours && ours.visibility,
      targetBox: rectOf(target),
    };
  },
  async fullscreenExit() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* exiting failed — that is not the subject of the check: what matters is that we entered */
    }
    return document.fullscreenElement === null;
  },

  cleanup() {
    sceneHide();
    const dialog = document.getElementById('site-dialog');
    if (dialog.open) dialog.close();
    for (const id of ['site-popover', 'site-popover-2']) {
      const popover = document.getElementById(id);
      if (popover.matches(':popover-open')) popover.hidePopover();
    }
  },
};

/* Fullscreen button handler. The runner clicks — real input, because
   requestFullscreen from evaluate() is rejected without user activation. */
document.getElementById('fullscreen-button').addEventListener('click', () => {
  topLayer.fullscreenRequest();
});

/* --------------------------------------------------- performance ---
   Three separate measurements.
     1) smoothness    — rAF intervals during a real gesture (control: a gesture
                        without the library);
     2) our JS       — performance.now() around public API calls;
     3) render cost  — NOT by our timer: engine counters (Chromium, CDP),
                       the runner reads them.
   The split is deliberate: mixing "our JS" and "render" into one number is not
   allowed — it would then be impossible to tell what exactly degraded. */
const perf = {
  deltas: [],
  recording: false,

  start() {
    perf.deltas = [];
    perf.recording = true;
    let last = performance.now();
    const tick = (t) => {
      if (!perf.recording) return;
      perf.deltas.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return true;
  },

  stop() {
    perf.recording = false;
    /* The first interval — from the start() call to the first frame: it is not an
       interval between frames, and it does not go into the statistics. */
    const d = perf.deltas.slice(1);
    if (d.length === 0) return { count: 0 };
    const sorted = [...d].sort((a, b) => a - b);
    const sum = d.reduce((acc, v) => acc + v, 0);
    const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    return {
      count: d.length,
      mean: +at(0.5).toFixed(1),
      p95: +at(0.95).toFixed(1),
      max: +sorted[sorted.length - 1].toFixed(1),
      fps: +(1000 / (sum / d.length)).toFixed(1),
      long32: d.filter((v) => v > 32).length,
      long50: d.filter((v) => v > 50).length,
    };
  },

  /* An instance with 'always' activation: a gesture without a modifier, so that the
     runner's real input (the page must not know about alt) creates a region. */
  arm() {
    perf.vr = new VisualRegion({ activation: 'always' });
    return perf.vr.state;
  },
  disarm() {
    if (perf.vr) perf.vr.destroy();
    perf.vr = null;
    return document.querySelectorAll('[data-visual-region-layer]').length;
  },

  /* Our JS: n programmatic region updates. This is work we can measure honestly
     with our own timer — a public API call is entirely ours. */
  regionUpdates(n) {
    const vr = new VisualRegion({ activation: 'programmatic' });
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      vr.setRegion({ x: 10 + (i % 100), y: 20 + (i % 80), width: 120, height: 90 });
    }
    const t1 = performance.now();
    vr.destroy();
    return { n, total: +(t1 - t0).toFixed(2), perUpdate: +(((t1 - t0) / n) * 1000).toFixed(1) };
  },

  /* Full instance lifetime: mount + renderer + activation + controller + cleanup. */
  createDestroyCycles(n) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) new VisualRegion().destroy();
    const t1 = performance.now();
    return { n, total: +(t1 - t0).toFixed(2), perCycle: +(((t1 - t0) / n) * 1000).toFixed(1) };
  },
};

/* Positive control of CSP strictness. Without it, "no violations" proves nothing
   — and, more importantly, the securitypolicyviolation journal is NOT proof by
   itself: the policy is checked by effect, because the event arrives
   ASYNCHRONOUSLY (measured: all three engines — the record about the style
   attribute appears in the next task, while in the synchronous block the journal
   is still empty; a synchronous counter showed 0 and that looked like "the event
   does not happen"). If the style attribute did apply after all, the page lives
   without a policy, and all the checks below are a waste of time. */
async function cspControl() {
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
}

/* -------------------------------------------------------------------- API -- */

async function run() {
  results.length = 0;
  for (const [name, fn] of checks) {
    destroyAll();
    window.scrollTo(0, 0);
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail: detail === undefined ? '' : String(detail) });
    } catch (error) {
      results.push({ name, ok: false, detail: String((error && error.message) || error) });
    }
  }
  destroyAll();
  return results;
}

window.__suite = {
  ready: true,
  root: rootParam,
  run,
  violations: () => violations.map((v) => ({ ...v })),
  cspControl,
  snapshot,
  scene: { show: sceneShow, hide: sceneHide, state: sceneState },
  pass,
  passReset() {
    pass.clicks = 0;
    pass.selection = '';
    window.scrollTo(0, 0);
  },
  passRead() {
    return {
      clicks: pass.clicks,
      scrollY: Math.round(window.scrollY),
      selection: String(window.getSelection() || '').length,
    };
  },
  topLayer,
  perf,
  backdrop,
  probeRect: () => rectOf('#probe'),
  outsideRect: () => rectOf('#outside'),
  textRect: () => rectOf('#text'),
  targetRect: () => rectOf('#click-target'),

  /* An enabled but regionless instance: we check that enabling alone changes
     nothing on screen. */
  idle: {
    on() {
      if (window.__idleVr) return window.__idleVr.state;
      window.__idleVr = new VisualRegion();
      return window.__idleVr.state;
    },
    off() {
      if (window.__idleVr) {
        window.__idleVr.destroy();
        window.__idleVr = null;
      }
      return true;
    },
  },

  /* Lifecycle scenarios driven by the runner (real input is needed). */
  life: {
    begin() {
      /* Snapshot BEFORE creating the instance — otherwise it lands in the "initial state". */
      window.__lifeBefore = snapshot();
      window.__lifeVr = new VisualRegion();
      return window.__lifeVr.state;
    },
    layerState() {
      const vr = window.__lifeVr;
      if (!vr || !vr.element) return null;
      const cs = getComputedStyle(vr.element);
      return {
        state: vr.state,
        visibility: cs.visibility,
        rect: rectOf(vr.element),
        topLayer: vr.element.matches(':popover-open'),
      };
    },
    destroy() {
      const vr = window.__lifeVr;
      if (!vr) return { error: 'instance was not created' };
      vr.destroy();
      const after = snapshot();
      const before = window.__lifeBefore;
      window.__lifeVr = null;
      return {
        state: vr.state,
        sameHtml: after.html === before.html,
        nodes: [before.nodes, after.nodes],
        inlineStyles: [before.inlineStyles, after.inlineStyles],
        openPopovers: after.popovers,
        layersLeft: document.querySelectorAll('[data-visual-region-layer]').length,
      };
    },
  },

  /* An unknown option must produce a console warning (checked by the runner). */
  warnUnknownOption() {
    const vr = new VisualRegion({ bogusOption: 1 });
    vr.destroy();
    return true;
  },

  /* Legacy mounting: enabled only by an explicit request, and it warns.
     We also check cleanup: the node has no right to stay on the page. */
  legacyFixed() {
    const vr = new VisualRegion({ mount: 'fixed', activation: 'programmatic' });
    const layer = vr.element;
    const info = {
      state: vr.state,
      inTopLayer: layer ? layer.matches(':popover-open') : null,
      marker: layer ? layer.getAttribute('data-visual-region-layer') : null,
      zIndex: layer ? getComputedStyle(layer).zIndex : null,
      afterDestroy: 0,
    };
    vr.destroy();
    info.afterDestroy = document.querySelectorAll('[data-visual-region-layer]').length;
    return info;
  },
};
