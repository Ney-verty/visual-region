# Vue example

The Vue runtime directly, with a render function — no Single File Component, no template compiler, no
`@vitejs/plugin-vue`. An SFC would add a framework build stack of its own; the thing being
demonstrated here is the library integration, not Vue's tooling.

```sh
npm install                     # vue, and ../../ (the library) as file:../..
npm run build                   # bundles src/main.js into dist/bundle.js
node ../../tests/examples/run.mjs vue --serve
# then open the printed URL
```

What it demonstrates:

- `visualRegion({ activation: 'element', surface, persistent: true })` created in `onMounted`, on the
  node held by the ref — the element exists by then, and nothing runs during setup;
- every subscription kept and released in `onBeforeUnmount` along with `region.destroy()`;
- `setRegion(bounds)` / `clearRegion()` from click handlers, with the rect measured from the node;
- the `start` / `change` / `end` / `unsupported` events driving a `ref` used by the render function.

Two details of this file are Vue-specific, not library-specific: the render function returns an array
(multiple root nodes are fine in Vue 3), and `#app` uses `display: contents` so the mount node does
not change the layout. `Bounds` is in viewport coordinates — an element-bound region is not part of
v0.1 (see the README roadmap).
