# React example

A plain client-side React app — no wrapper component, no extra package. The library needs a real
DOM node, so the instance is created in an effect on a node held by a ref.

```sh
npm install                     # react, react-dom, and ../../ (the library) as file:../..
npm run build                   # bundles src/main.jsx into dist/bundle.js
node ../../tests/examples/run.mjs react --serve
# then open the printed URL
```

What it demonstrates:

- `visualRegion({ activation: 'element', surface, persistent: true })` created in `useEffect`, with
  every subscription returned as an unsubscribe function;
- cleanup on unmount (`region.destroy()`), so a hot reload cannot leave a live instance behind;
- `setRegion(bounds)` / `clearRegion()` from click handlers, with the rect measured from the node;
- the `start` / `change` / `end` / `unsupported` events driving React state.

Two notes that matter beyond this file:

- the instance is **not** created during render. Server rendering has no DOM, and a render pass must
  stay free of side effects — see the Next example for the Client Component boundary;
- `Bounds` is in viewport coordinates, which is why the rect is measured with
  `getBoundingClientRect()`. An element-bound region is not part of v0.1 (see the README roadmap).
