/*
 * Minimal vanilla example — deliberately without a build step.
 *
 * Everything here uses only the public API documented in the README. The library is
 * imported by its package name; `index.html` maps that name to the built file with an
 * import map (a bundler or a CDN would do the same thing for you).
 */
import { supported, visualRegion } from 'visual-region';

const status = document.querySelector('#status');
const surface = document.querySelector('#surface');

const say = (text) => {
  status.textContent = text;
};

if (!supported) {
  // Without the Popover API the default top-layer mount is unavailable. An instance
  // can still be created, but its state is 'unsupported' and nothing is shown.
  say('Popover API unavailable — see README, "Mounting".');
}

const region = visualRegion({
  // Only gestures that start inside #surface open a region. The rest of the page keeps
  // its normal click, drag and selection behaviour.
  activation: 'element',
  // Required by activation: 'element' — an element, not a CSS selector.
  surface,
  // persist: the region stays after the pointer is released.
  persistent: true,
});

region.on('start', ({ source }) => say(`start (${source})`));
region.on('change', ({ bounds }) => say(`dragging ${Math.round(bounds.width)}×${Math.round(bounds.height)}`));
region.on('end', ({ bounds }) =>
  say(
    bounds === null ? 'end (cancelled)' : `region: ${Math.round(bounds.width)}×${Math.round(bounds.height)}`,
  ),
);
region.on('unsupported', ({ reason }) => say(`unsupported: ${reason}`));

// A region can also be shown with no gesture at all. `Bounds` is in viewport
// coordinates, the same space the pointer events use.
document.querySelector('#show').addEventListener('click', () => {
  const box = surface.getBoundingClientRect();
  const shown = region.setRegion({
    x: box.left + 16,
    y: box.top + 16,
    width: Math.min(280, box.width - 32),
    height: Math.min(120, box.height - 32),
  });
  say(shown ? 'setRegion → shown' : `setRegion refused (state: ${region.state})`);
});

document.querySelector('#clear').addEventListener('click', () => {
  region.clearRegion();
  say('clearRegion → nothing is shown');
});

document.querySelector('#destroy').addEventListener('click', () => {
  region.destroy();
  // After destroy() the page is back to its original state and stays that way.
  say(`destroy → state: ${region.state}`);
});

say(`state: ${region.state}`);
