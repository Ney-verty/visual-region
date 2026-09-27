/*
 * The demo script. The only dependency is the built package: `../dist/index.js`.
 * Internal `src/*` modules are deliberately not imported here: the page must verify
 * exactly the contract an external consumer gets from npm.
 */
import { autoInit, supported, visualRegion } from '../dist/index.js';

const byId = (id) => document.getElementById(id);

const playground = byId('playground');
const controls = {
  activation: byId('opt-activation'),
  modifier: byId('opt-modifier'),
  mount: byId('opt-mount'),
  persistent: byId('opt-persistent'),
  touch: byId('opt-touch'),
};

/* The settings the page opened with. "Reset settings" returns them — this way the
   button has an unambiguous definition rather than "the library defaults, which a
   visitor has no way of knowing". */
const INITIAL = {
  activation: 'element',
  modifier: 'alt',
  mount: 'top-layer',
  persistent: false,
  touch: 'off',
};

/** The options in the form the public API accepts. */
function optionsFromControls() {
  const activation = controls.activation.value;
  return {
    activation,
    // With another activation `modifier` is not merely superfluous — the library
    // warns about it in the console. So we clear it explicitly (undefined) rather
    // than leaving it as is.
    modifier: activation === 'modifier' ? controls.modifier.value : undefined,
    mount: controls.mount.value,
    persistent: controls.persistent.checked,
    touch: controls.touch.checked ? 'surface' : 'off',
    surface: playground,
  };
}

let region = null;

/* --- event log -------------------------------------------------------------- */

const logEl = byId('log');
const started = performance.now();
let logEntries = 0;

function log(text) {
  if (logEntries === 0) logEl.textContent = '';
  logEntries += 1;
  const item = document.createElement('li');
  item.textContent = `+${((performance.now() - started) / 1000).toFixed(1)}s ${text}`;
  logEl.prepend(item);
  while (logEl.children.length > 7) logEl.lastElementChild.remove();
}

function subscribe(instance) {
  instance.on('start', ({ source }) => log(`start (${source})`));
  instance.on('end', ({ bounds }) => log(bounds === null ? 'end (region cleared)' : `end ${format(bounds)}`));
  instance.on('cancel', ({ reason }) => log(`cancel — ${reason}`));
  instance.on('lost-top-layer', ({ reason }) => log(`lost-top-layer — ${reason}`));
  instance.on('unsupported', ({ reason }) => log(`unsupported — ${reason}`));
  instance.on('destroy', () => log('destroy'));
  instance.on('change', ({ bounds }) => {
    byId('st-bounds').textContent = format(bounds);
  });
}

function format(bounds) {
  const round = (n) => Math.round(n);
  return `${round(bounds.x)}, ${round(bounds.y)} — ${round(bounds.width)}×${round(bounds.height)}`;
}

/* --- panel ------------------------------------------------------------------ */

const HINTS = {
  element: 'The gesture starts only inside the playground (surface). This is how the page opens by default.',
  modifier: 'The gesture starts with the modifier held, anywhere on the page. Pick the key below.',
  always: 'The gesture starts anywhere without a modifier — and selecting text on the page stops working.',
  programmatic:
    'The library does not listen to the pointer at all: the region is shown only by the "Show region" button.',
};

function render() {
  const state = region.state;
  const badge = byId('st-state');
  badge.textContent = state;
  badge.dataset.state = state;

  byId('st-supported').textContent = supported
    ? 'yes — the Popover API is here, the top layer is available'
    : 'no — the Popover API is missing. Only mount: fixed (Legacy) is left, and it does not guarantee the result: see its caveats below';

  const dead = state === 'destroyed';
  controls.activation.disabled = dead;
  controls.mount.disabled = dead;
  controls.persistent.disabled = dead;
  controls.touch.disabled = dead;
  controls.modifier.disabled = dead || controls.activation.value !== 'modifier';

  byId('btn-toggle').textContent = state === 'enabled' ? 'Turn off' : 'Turn on';
  byId('btn-toggle').disabled = dead;
  byId('btn-show').disabled = dead;
  byId('btn-remove').disabled = dead;
  byId('btn-reset').disabled = dead;
  byId('btn-destroy').disabled = dead;
  byId('btn-recreate').hidden = !dead;

  byId('hint-activation').textContent = HINTS[controls.activation.value];
  byId('hint-mount').textContent =
    controls.mount.value === 'top-layer'
      ? 'The layer is a popover in the top layer: the guaranteed variant — the page cannot push it down with z-index, transform, opacity or filter.'
      : 'Legacy: the layer is outside the top layer, with inline styles on body. It breaks on hostile transform/opacity/filter on html/body and on a high z-index in the content.';
  if (state === 'unsupported') {
    byId('hint-mount').textContent +=
      ' The state is unsupported right now: this environment needs mount: fixed (Legacy) exactly.';
  }

  const quick = byId('btn-touch-quick');
  quick.textContent = controls.touch.checked
    ? 'Touch gesture is on — turn it off'
    : 'Turn on the touch gesture';
  quick.disabled = dead;
}

function create() {
  region = visualRegion(optionsFromControls());
  subscribe(region);
  render();
}

create();

/* The markup instance in the "Connecting" section. A separate autoInit() call on
   the container rather than the document: the document has other elements with
   instances of their own, and "enable everything" here would mean something other
   than what we are showing. */
autoInit(byId('declarative'));

function applyControls() {
  region.setOptions(optionsFromControls());
  render();
}

for (const control of Object.values(controls)) {
  control.addEventListener('change', applyControls);
}

/* The touch-gesture quick button — only for devices without hover. It turns on the
   same `touch` option as the checkbox in the panel: there is no second state, and
   `render()` writes the label from the checkbox's actual value. */
byId('btn-touch-quick').addEventListener('click', () => {
  controls.touch.checked = !controls.touch.checked;
  applyControls();
});

byId('btn-toggle').addEventListener('click', () => {
  if (region.state === 'enabled') region.disable();
  else region.enable();
  render();
});

byId('btn-show').addEventListener('click', () => {
  const box = playground.getBoundingClientRect();
  const width = Math.min(280, box.width - 40);
  const height = 160;
  const ok = region.setRegion({
    x: Math.round(Math.min(box.left + 20, window.innerWidth - width - 8)),
    y: Math.round(Math.min(box.top + 60, window.innerHeight - height - 8)),
    width: Math.round(width),
    height,
  });
  if (!ok) log('setRegion: the instance is not enabled (see state)');
  render();
});

byId('btn-remove').addEventListener('click', () => {
  region.clearRegion();
  byId('st-bounds').textContent = 'none';
  log('clearRegion');
  render();
});

byId('btn-reset').addEventListener('click', () => {
  controls.activation.value = INITIAL.activation;
  controls.modifier.value = INITIAL.modifier;
  controls.mount.value = INITIAL.mount;
  controls.persistent.checked = INITIAL.persistent;
  controls.touch.checked = INITIAL.touch === 'surface';
  applyControls();
  log('setOptions — the page settings at load time');
});

byId('btn-destroy').addEventListener('click', () => {
  region.destroy();
  render();
});

byId('btn-recreate').addEventListener('click', () => {
  // destroy is irreversible: the only way forward is a new instance.
  create();
  log('a new instance after destroy');
});

/* --- page content ----------------------------------------------------------- */

let clicks = 0;
byId('pg-button').addEventListener('click', () => {
  clicks += 1;
  byId('click-count').textContent = String(clicks);
});

byId('btn-dialog').addEventListener('click', () => {
  byId('demo-dialog').showModal();
});

/* The bar chart: a canvas is one more kind of content that is inverted along with
   the page (it is not an image in the DOM but its own pixels). */
const chart = byId('chart');
const ctx = chart.getContext('2d');
const values = [42, 78, 55, 96, 30, 66, 88];
ctx.fillStyle = '#22304a';
ctx.fillRect(0, 0, chart.width, chart.height);
const step = chart.width / values.length;
values.forEach((value, index) => {
  const height = (value / 100) * (chart.height - 24);
  ctx.fillStyle = index % 2 === 0 ? '#ffb454' : '#6bb6ff';
  ctx.fillRect(index * step + 8, chart.height - height - 8, step - 16, height);
});
