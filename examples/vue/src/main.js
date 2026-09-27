/*
 * Vue example — no SFC, no template compiler.
 *
 * Why no `.vue` file: a Single File Component would pull in `@vitejs/plugin-vue` (or
 * `vue-tsc`) — a framework build stack of its own. This example is about integrating
 * the library, so it uses the Vue runtime directly and a render function. The Vue
 * runtime-only build (what a bundler picks for `import 'vue'`) has no template
 * compiler at all, which makes `h()` the natural choice here.
 *
 * The library needs a real DOM node, so the instance is created in `onMounted`, on a
 * node held by a ref — after the element exists, and never during setup on the server.
 */
import { createApp, h, onBeforeUnmount, onMounted, ref } from 'vue';
import { visualRegion } from 'visual-region';

const App = {
  setup() {
    const surface = ref(null);
    const status = ref('state: —');
    let region = null;
    let unsubscribes = [];

    onMounted(() => {
      if (surface.value === null) return;
      const instance = visualRegion({
        // Gestures may start inside the card only; the rest of the page is untouched.
        activation: 'element',
        surface: surface.value,
        persistent: true,
      });
      region = instance;
      status.value = `state: ${instance.state}`;

      unsubscribes = [
        instance.on('start', ({ source }) => {
          status.value = `start (${source})`;
        }),
        instance.on('change', ({ bounds }) => {
          status.value = `dragging ${Math.round(bounds.width)}×${Math.round(bounds.height)}`;
        }),
        instance.on('end', ({ bounds }) => {
          status.value =
            bounds === null
              ? 'end (cancelled)'
              : `region: ${Math.round(bounds.width)}×${Math.round(bounds.height)}`;
        }),
        instance.on('unsupported', ({ reason }) => {
          status.value = `unsupported: ${reason}`;
        }),
      ];
    });

    onBeforeUnmount(() => {
      // Vue removes its own DOM listeners, but not the subscriptions made through the
      // library: those have to be given up explicitly, together with the instance.
      for (const unsubscribe of unsubscribes) unsubscribe();
      unsubscribes = [];
      region?.destroy();
      region = null;
    });

    const show = () => {
      if (region === null) return;
      const box = surface.value.getBoundingClientRect();
      // `Bounds` is in viewport coordinates, the same space pointer events use.
      const shown = region.setRegion({
        x: box.left + 16,
        y: box.top + 16,
        width: Math.min(280, box.width - 32),
        height: Math.min(120, box.height - 32),
      });
      status.value = shown ? 'setRegion → shown' : `setRegion refused (state: ${region.state})`;
    };

    const clear = () => {
      region?.clearRegion();
      status.value = 'clearRegion → nothing is shown';
    };

    const destroy = () => {
      if (region === null) return;
      const instance = region;
      region = null;
      instance.destroy();
      status.value = `destroy → state: ${instance.state}`;
    };

    // An array is a valid root for a Vue 3 render function: no wrapper element is
    // added to the page, so the DOM here is the same as in the other examples.
    return () => [
      h('h1', 'visual-region — Vue example'),
      h(
        'p',
        { class: 'hint' },
        'Drag inside the card: only what is inside the region changes, and releasing the pointer puts the page back. Clicking the link and selecting the text still work as usual.',
      ),
      h('section', { id: 'surface', ref: surface }, [
        h('p', [h('strong', 'This card is the surface.')]),
        h(
          'p',
          'The region inverts the pixels underneath it. Nothing in this DOM is modified: the text, the link and the selection behave exactly as they would without the library.',
        ),
        // draggable="false": a plain <a> starts the native HTML5 drag, which competes
        // with the region gesture. That is the consumer's side to fix, as documented.
        h('p', [
          h(
            'a',
            { href: 'https://example.com/', draggable: 'false', style: { color: '#fff' } },
            'A link that stays clickable',
          ),
        ]),
      ]),
      h('div', { class: 'controls' }, [
        h('button', { type: 'button', id: 'show', onClick: show }, 'Show a region programmatically'),
        h('button', { type: 'button', id: 'clear', onClick: clear }, 'Clear it'),
        h('button', { type: 'button', id: 'destroy', onClick: destroy }, 'Destroy the instance'),
      ]),
      h('p', { id: 'status', role: 'status' }, status.value),
    ];
  },
};

createApp(App).mount('#app');
