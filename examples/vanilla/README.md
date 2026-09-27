# Vanilla example

The smallest useful consumer: a plain HTML page, no bundler, no build step.

```sh
npm install                    # links ../../ (the library) into node_modules/
node ../../scripts/check-examples.mjs vanilla --serve
# then open the printed URL
```

`index.html` maps the bare specifier `visual-region` to the built file with an import map,
because a browser cannot resolve a package name on its own — a bundler or a CDN would.
Any static server works; the module must be served over HTTP, `file://` will not do.

What it demonstrates:

- `visualRegion({ activation: 'element', surface, persistent: true })` — a gesture that starts
  inside the card, and a region that stays put after the pointer is released;
- `setRegion(bounds)` / `clearRegion()` — showing and hiding a region without any gesture;
- `destroy()` — putting the page back and making the instance unusable;
- the `start` / `change` / `end` / `unsupported` events;
- `draggable="false"` on the link, the consumer-side fix for the native HTML5 drag that
  otherwise competes with the gesture.
