# visual-region

Drag a rectangle over any page and visually alter only what is inside it. Release the pointer and
the page goes back to normal.

The page's DOM is not touched: no elements are copied, moved or re-rendered, and the library writes to
nothing but its own layer. The single exception is the inline `touch-action` it puts on your surface
when you opt into touch input, which it also restores — see [Touch input](#touch-input). Everything
under the layer keeps working: clicks reach their elements, the wheel scrolls the page, and text stays
selectable while a region is on screen. The effect in v0.1 is **inversion** — the region renders the
pixels underneath it as a colour negative.

- zero runtime dependencies, framework-agnostic;
- ESM, CommonJS and a `<script>` build; TypeScript types included;
- requires the Popover API (feature-detected, never user-agent sniffed) — see
  [Browser support](#browser-support);
- v0.1 is **not published yet**. The public API below is frozen for v0.1: names, signatures and
  semantics will not change before the release.

## Install

```sh
npm install visual-region
```

The package has no dependencies of its own and no post-install steps. `engines.node` is `>=18`
(only for tooling; the library itself runs in the browser).

| Entry      | How to load                                         | Notes                                                                                          |
| ---------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| ESM        | `import { visualRegion } from 'visual-region'`      | `exports["."].import` → `dist/index.js`; tree-shakeable                                        |
| CommonJS   | `const { visualRegion } = require('visual-region')` | `exports["."].require` → `dist/index.cjs`; `main` points here too. Loads in Node without a DOM |
| Auto entry | `import 'visual-region/auto'`                       | the only entry with a side effect: it initializes marked-up elements                           |
| `<script>` | `dist/visual-region.global.js`                      | IIFE build; puts the API on `window.VisualRegion` and initializes marked-up elements on load   |
| Types      | `dist/index.d.ts`, `dist/auto.d.ts`                 | declared through `exports` for both conditions                                                 |

### From a CDN or a `<script>` tag

The IIFE build is served by any static host, and any CDN that mirrors npm will find it through the
`unpkg` / `jsdelivr` fields:

```html
<script src="https://your-cdn.example/visual-region@0.1.0/dist/visual-region.global.js"></script>
<script>
  const region = VisualRegion.visualRegion({ activation: 'always' });
</script>
```

`visual-region@0.1.0` is the shape of the URL once the package is published; use whatever URL your
host or CDN gives you. A `<script>` tag is the one case where the library initializes marked-up
elements on its own — connecting it that way is already a statement that it may act by itself.
`import`ing it is not: the main entry has no side effects.

## Quick start

```js
import { visualRegion } from 'visual-region';

const region = visualRegion({
  activation: 'element', // drags may start inside `surface` only
  surface: document.querySelector('#card'), // an element, not a selector
  persistent: true, // the region stays after the pointer is released
});

region.on('end', ({ bounds }) => {
  if (bounds !== null) console.log(`kept a region: ${bounds.width}×${bounds.height}`);
});
```

That is the whole integration: one element, one call. Everything else — modules, options, events,
lifecycle — is below.

## Declarative markup

`import 'visual-region/auto'` (or the `<script>` build) scans the document for
`data-visual-region="invert"` and creates one instance per marked element. The value is the effect
name: the marker has to say what it turns on, and in v0.1 `"invert"` is the only value — any other
value warns once and skips the element.

```html
<section data-visual-region="invert" data-activation="element" data-persistent>
  <p>Drag inside this card. The instance is created by the marker, no JavaScript needed.</p>
</section>
```

| Attribute               | Same as option    | Value                                                 |
| ----------------------- | ----------------- | ----------------------------------------------------- |
| `data-visual-region`    | —                 | `"invert"` (required marker)                          |
| `data-activation`       | `activation`      | `modifier` \| `always` \| `element` \| `programmatic` |
| `data-modifier`         | `modifier`        | comma-separated keys: `alt`, `shift`, `ctrl`, `meta`  |
| `data-touch`            | `touch`           | `off` \| `surface`                                    |
| `data-mount`            | `mount`           | `top-layer` \| `fixed`                                |
| `data-persistent`       | `persistent`      | empty or `"true"` \| `"false"`                        |
| `data-disabled`         | `disabled`        | empty or `"true"` \| `"false"`                        |
| `data-threshold`        | `threshold`       | a non-negative number                                 |
| `data-surface`          | `surface`         | a CSS selector, or `"self"` for the marked element    |
| `data-interaction-root` | `interactionRoot` | a CSS selector, or `"self"`                           |

Values are read leniently: an unknown keyword falls back to the default and warns once, rather than
throwing — markup cannot be typed, and one bad attribute should not take the page down. In
JavaScript the same mistakes throw (see [Validation](#validation)).

If you would rather control the moment, call `autoInit(root?)` yourself — handy after a client-side
route change:

```js
import { autoInit } from 'visual-region';

autoInit(document.querySelector('#main'));
```

If the script sits in `<head>`, the auto entry waits for `DOMContentLoaded`; otherwise it scans
immediately. An element that fails to initialize warns once and is skipped — the rest still work.

## API

Everything the package exports:

| Export                   | Kind     | What it does                                                                                                                                              |
| ------------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `visualRegion(options?)` | function | creates an instance; short form of `new VisualRegion(options)`                                                                                            |
| `init(options?)`         | function | creates an instance, or returns `null` when the environment cannot show a region                                                                          |
| `autoInit(root?)`        | function | initializes everything marked up with `data-visual-region`; returns the created instances                                                                 |
| `VisualRegion`           | class    | the instance type, if you prefer `new` or need it in a signature                                                                                          |
| `supported`              | boolean  | whether this environment can show a region at all                                                                                                         |
| types                    |          | `Bounds`, `Point`, `VisualRegionOptions`, `VisualRegionState`, `EventPayloads`, `ActivationKind`, `ModifierSpec`, `TouchMode`, `MountKind`, `Unsubscribe` |

The class is also reachable as `VisualRegion.visualRegion` / `VisualRegion.supported` from the IIFE
build.

### `class VisualRegion`

| Member              | Signature           | What it does                                                                                                              |
| ------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `state`             | `VisualRegionState` | `idle` \| `enabled` \| `disabled` \| `unsupported` \| `destroyed`                                                         |
| `bounds`            | `Bounds \| null`    | geometry of the region that is shown right now                                                                            |
| `enable()`          | `boolean`           | starts listening and mounts the layer; `false` when the environment has no top layer, and the state becomes `unsupported` |
| `disable()`         | `void`              | stops and puts the page back; the instance stays alive and can be enabled again                                           |
| `destroy()`         | `void`              | removes everything and makes the instance permanently unusable; idempotent                                                |
| `setOptions(patch)` | `void`              | merges options and re-applies them, validates eagerly                                                                     |
| `setRegion(bounds)` | `boolean`           | shows a region without a gesture; `false` if the instance could not be enabled                                            |
| `clearRegion()`     | `void`              | hides the region, whether it came from a gesture or from `setRegion()`                                                    |
| `on(name, fn)`      | `Unsubscribe`       | subscribes to an event; the returned function unsubscribes                                                                |
| `off(name, fn)`     | `void`              | unsubscribes a specific listener                                                                                          |

A new instance enables itself: "created" means "working", unless you pass `disabled: true`. When the
environment cannot show a region, creation still succeeds and `state` is `unsupported` — nothing is
broken, there is simply no honest way to draw the effect. `init()` saves you the check by returning
`null` in that case.

### `VisualRegionOptions`

Every option is optional and flat. Defaults are the values the instance actually uses:

| Option            | Type                   | Default         | Meaning                                                                                               |
| ----------------- | ---------------------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| `effect`          | `'invert'`             | `'invert'`      | what the region does; v0.1 has exactly one effect                                                     |
| `shape`           | `'rect'`               | `'rect'`        | shape of the region; v0.1 has exactly one shape                                                       |
| `activation`      | `ActivationKind`       | `'modifier'`    | who may start a gesture                                                                               |
| `modifier`        | `ModifierSpec \| null` | `'alt'`         | key(s) for `activation: 'modifier'`; also accepts a predicate                                         |
| `surface`         | `HTMLElement \| null`  | `null`          | the element the gesture belongs to; required by `activation: 'element'` and `touch: 'surface'`        |
| `interactionRoot` | `EventTarget \| null`  | `document.body` | where `pointerdown` is listened for, in the capture phase; `pointermove`/`up`/`cancel` go on `window` |
| `touch`           | `TouchMode`            | `'off'`         | touch input: `off` or `surface`                                                                       |
| `mount`           | `MountKind`            | `'top-layer'`   | how the layer is placed; see [Mounting](#mounting)                                                    |
| `persistent`      | `boolean`              | `false`         | keep the region after the pointer is released                                                         |
| `disabled`        | `boolean`              | `false`         | create the instance without enabling it                                                               |
| `threshold`       | `number`               | `3`             | how far the pointer must move before it counts as a gesture (pixels)                                  |
| `zIndex`          | `number`               | `2147483646`    | used by the legacy `fixed` mount only; ignored in the top layer                                       |

`| undefined` on every key is for `exactOptionalPropertyTypes`: `{ modifier: undefined }` is the
ordinary way to drop a setting. `null` is a real value in three places, and it does not mean the same
thing in them: for `surface` it is "no surface", for `interactionRoot` it falls back to the default
(`document.body`), and for `modifier` it is rejected under `activation: 'modifier'` — there would be
nothing left to start the gesture with.

### Events

| Event            | Payload                                                 | When                                                                                                     |
| ---------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `start`          | `{ source: 'pointer' \| 'programmatic' }`               | a gesture began, or `setRegion()` was called                                                             |
| `change`         | `{ bounds }`                                            | the region moved or resized; on the pointer path at most one per frame, `setRegion()` emits one per call |
| `end`            | `{ bounds: Bounds \| null }`                            | the gesture finished normally; `null` when nothing was kept                                              |
| `cancel`         | `{ reason: 'pointercancel' \| 'blur' \| 'visibility' }` | the gesture was interrupted                                                                              |
| `lost-top-layer` | `{ reason: string }`                                    | the site opened something above our layer; the region stops showing                                      |
| `unsupported`    | `{ reason: string }`                                    | this environment cannot show a region                                                                    |
| `destroy`        | `null`                                                  | the instance was destroyed                                                                               |

`end` and `cancel` are mutually exclusive: a pointer that ends normally produces `end`, everything
else produces `cancel`. `change` is the only high-frequency event; on the pointer path the moves are
coalesced through `requestAnimationFrame`, so a fast trackpad produces one per frame, not five. A
programmatic `setRegion()` emits `change` immediately, once per call.

A `reason` — the one on `cancel` is an enum, the two on `lost-top-layer` and `unsupported` are not —
is human-readable diagnostic text, written to be read by a person. It is not a stable
machine-readable identifier: do not match on its wording, which may change in a patch release. The
same is true of the text of the library's `TypeError`s and of its console warnings. If a program
ever needs to classify why a region went away, that calls for a dedicated field, not for parsing
these strings; v0.1 has no such field.

### Validation

Options are validated once, when the instance is created or `setOptions()` is called. What happens to
a mistake depends on whether it has a safe reading:

| Mistake                                                                          | Result                                                                  |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| unknown key                                                                      | warns once, the key is ignored                                          |
| unknown value for `effect`, `shape`, `mount`, `activation` or `touch`            | `TypeError`                                                             |
| `surface` that is not an element, `interactionRoot` that is not an `EventTarget` | `TypeError`                                                             |
| `threshold` that is not a non-negative finite number, non-integer `zIndex`       | `TypeError`                                                             |
| `activation: 'element'` or `touch: 'surface'` without `surface`                  | `TypeError`                                                             |
| `activation: 'modifier'` with `modifier: null`                                   | `TypeError`                                                             |
| `modifier` given with an activation that does not use it                         | warns once, has no effect                                               |
| `persistent` / `disabled` given a non-boolean                                    | not validated; only `true` is "on"                                      |
| the site's CSS winning over our `touch-action`                                   | warns once, the touch drag is refused (see [Touch input](#touch-input)) |

A `TypeError` names the option and what was expected. Configuration errors throw because a silently
ignored option is a bug report waiting to happen; `setOptions()` validates the same way, so a rejected
patch changes nothing and says so. Warnings are printed once per reason, not once per event.

## Activation

| `activation`           | A gesture starts when…                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `'modifier'` (default) | the pointer is pressed with the modifier key held (`alt` by default). The page keeps its ordinary mouse behaviour otherwise |
| `'always'`             | any primary button press, anywhere                                                                                          |
| `'element'`            | the press happens inside `surface`                                                                                          |
| `'programmatic'`       | never — this instance only responds to `setRegion()`. No pointer listeners are attached at all                              |

Only the primary button, only the primary pointer, and only a single pointer at a time.

For a **touch** pointer the activation kind is not consulted at all: a finger gesture is allowed when
`touch: 'surface'` is on and the press lands inside `surface`. A touch has no way to hold a modifier
key, which is exactly why touch has a switch of its own instead of a fifth kind. A pen is not in this
category — it has a keyboard behind it and delivers real modifiers, so it goes through the table above
like a mouse.

### Modifier

`modifier` accepts a key name, an array of key names (any of them is enough), or a predicate
function:

```js
visualRegion({ activation: 'modifier' }); // alt
visualRegion({ modifier: 'shift' });
visualRegion({ modifier: ['ctrl', 'meta'] });
visualRegion({ modifier: (event) => event.clientX > window.innerWidth / 2 });
```

It belongs to `activation: 'modifier'` alone. Giving it with another activation is not an error, but
it has no effect and warns once, rather than pretending to work.

### Surface

`surface` is an **element**, not a selector — a DOM node you already have (or a ref). It matters in
two places: `activation: 'element'` restricts the gesture to it, and `touch: 'surface'` uses it to
make touch input possible. Both fail loudly at configuration time if `surface` is missing, because
there is no sensible fallback.

### Touch input

`touch: 'off'` is the default, and that is a product decision rather than an oversight. To drive a
region with a finger, the surface has to give up its own scroll and pinch-zoom: a browser only
releases a touch gesture to the page when the element's `touch-action` allows it. Taking that away
from an arbitrary page — silently, on a phone, from a library — would be worse than not working.

So touch is opt-in, and it is opt-in on a specific element:

```js
visualRegion({ activation: 'element', surface: card, touch: 'surface' });
```

With `touch: 'surface'` the library sets `touch-action: none` on the surface when the instance is
enabled and restores the previous inline value when it is disabled or destroyed. The trade-off is
explicit: **while touch is on, that element does not scroll and does not pinch-zoom**. Put it on the
element that should own the gesture, not on `<body>`.

If the page's own CSS still wins over that (`!important`, a later rule, higher specificity), the
library does not fight it and does not silently produce a broken gesture: it checks the _computed_
value, refuses to start the drag and warns once with the value it saw
(`touch-action-not-none`). Setting `touch-action: none` on the surface in your own CSS is the
reliable way — then nothing depends on who wins a style conflict.

## Showing a region without a gesture

```js
const shown = region.setRegion({ x: 0, y: 0, width: 320, height: 200 });
region.clearRegion();
```

`bounds` is in **viewport coordinates**, the same space pointer events use, and width/height are
absolute. `setRegion()` enables the instance if needed and emits `start` with
`source: 'programmatic'`; it returns `false` when the instance cannot be enabled (destroyed, or an
environment without a top layer). `bounds` still reports the geometry that is currently shown.

In v0.1 an instance has **one** region: calling `setRegion()` again replaces the geometry instead of
adding a second one, and `clearRegion()` removes it. `clearRegion()` also clears a region left
behind by `persistent`. More than one region per instance is not implemented — see
[Roadmap](#roadmap--not-implemented).

If you want the region to follow something on screen, measure it yourself: `getBoundingClientRect()`
plus `setRegion()`. An element-bound region (the library tracking the element for you) is not part of
v0.1.

## Mounting

By default the layer lives in the **top layer** — the element is a `popover="manual"`, opened when the
instance is enabled. This is what makes the effect work over page content with any `z-index`,
`transform`, `opacity` or `filter` on the way down, without the library having to out-`z-index`
anything. UA styles for popovers are reset in full (margin, border, padding, background, inset,
overflow, colour).

The top layer has one ordering rule: last in wins. If the site opens its own modal dialog or popover
_after_ us, that thing is above our layer and inside the region you would see the dialog, not the
effect. The library does not fight for the position: it reports `lost-top-layer` and leaves the page
as it is. Closing and re-enabling the instance puts it back on top.

### Legacy `mount: 'fixed'`

For environments without the Popover API there is an explicit opt-in:

```js
visualRegion({ mount: 'fixed', zIndex: 2147483646 });
```

`mount: 'fixed'` is **legacy and not equivalent**. It breaks under a `transform`, `opacity` or
`filter` on `html`/`body` (they make `position: fixed` relative to the transformed ancestor), and
under page content with a higher `z-index`: a layer that no top-layer ordering protects is a layer
something else can cover, silently.

Use it only when you have decided those conditions do not apply to your page. The default
`mount: 'top-layer'` needs no such reasoning, which is why `supported` is false (and `init()` returns
`null`) rather than falling back to it automatically.

## SSR and environments without a DOM

The main entry is import-safe on the server:

```js
import { visualRegion, supported } from 'visual-region'; // fine in Node
```

`init()` returns `null` outside a browser; `autoInit()` returns `[]`; `supported` is `false`. Creating
an instance directly is also possible — `new VisualRegion()` in Node gives `state: 'unsupported'` and
touches nothing. In component frameworks, create the instance on the client, on a node you already
have — see the [examples](#framework-examples).

## Content Security Policy

Tested under both documented strict CSP configurations:

| Policy                                                        | Where                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------ |
| `default-src 'self'; style-src 'self'`                        | the source build and the built package                 |
| `default-src 'self'; style-src 'self'; style-src-attr 'none'` | the same two, with inline style _attributes_ forbidden |

The library writes styles exclusively through CSSOM (`element.style.setProperty`), never through the
`style` attribute and never with `eval`/`new Function`, so `style-src-attr 'none'` is the interesting
case — and it passes. This is what was measured on those pages and policies; it is not a general
claim that the library is compatible with whatever policy you have.

## Multiple instances and overlapping regions

Instances are independent and do not coordinate. Two of them on one page both work; where their
regions overlap, each applies the effect to what is underneath it, so **the overlap comes out
unaffected** — invert twice returns the original pixels. That is arithmetic, not a bug, and it is the
current semantics: with the difference renderer, overlapping regions cancel.

Consequences worth knowing before wiring two of them together:

- nested or intersecting regions cannot be composed into a union today;
- the layers are separate elements, so the one that was mounted later is above the other one in the
  top layer.

A single instance cannot overlap itself in v0.1: it has exactly one region. For what a future
multiple-region model is intended to do, see the [roadmap](#roadmap--not-implemented) — including the
intended default of union semantics, where an overlap receives the effect once.

## Framework examples

Four runnable examples live in `examples/`, each a small self-contained package with its own
dependencies. They use nothing but the public API documented above, and they connect the library by
its package name (through `file:../..` in their own `package.json`), not by a relative path into
`dist/` — so `exports`, the type declarations and the module format are all exercised for real.

| Example                                 | What it is                                                                                   | How it is verified                                                                                                                                                               |
| --------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`examples/vanilla`](examples/vanilla/) | plain HTML, no build step; the bare specifier is resolved by an import map                   | served, then a headless Chromium run: instance created, `setRegion` and a real pointer drag both invert the pixels, `clearRegion` and `destroy` put the page back                |
| [`examples/react`](examples/react/)     | client-side React; the instance is created in an effect on a ref                             | bundled with esbuild, then the same battery, plus "no page errors"                                                                                                               |
| [`examples/vue`](examples/vue/)         | Vue runtime with a render function — no SFC, no template compiler                            | same                                                                                                                                                                             |
| [`examples/next`](examples/next/)       | Next.js App Router: a server component plus one `'use client'` component owning the instance | a real `next build` (which includes the type check), library presence checked in the _client_ chunks, then the production server is started and the same battery runs against it |

```sh
npm run check:examples            # all four; needs `npm run build` first
npm run check:examples -- react   # one of them
```

The library itself never depends on any framework — there are no wrappers here, and the examples show
why none are needed.

## Browser support

| Engine         | Version (Playwright 1.63.0) | Result                                |
| -------------- | --------------------------- | ------------------------------------- |
| Chromium       | 153.0.8010.12               | 125 checks pass at DPR=1, 99 at DPR=2 |
| Firefox        | 155.0                       | same set, same result                 |
| WebKit (Linux) | 26.6                        | same set, same result                 |

The matrix covers geometry, the pointer path, top-layer ordering with the site's own dialogs and
popovers, hostile roots (`transform`/`opacity`/`filter` on `html`/`body`), pixel-exact inversion,
both CSP configurations, HiDPI (`deviceScaleFactor: 2`), lifecycle and destroy-in-the-middle-of-a-
gesture.

What this does **not** say:

- **Safari is not confirmed.** Linux WebKit is a different build of a related engine on a different
  platform, and its results are not a Safari result. macOS and iOS Safari are not verified yet;
- no minimum browser versions are claimed. The requirement is the Popover API, which is detected at
  runtime (no user-agent sniffing) — if it is present, the default mount works; if it is not,
  `supported` is `false` and nothing pretends otherwise. Without it, `mount: 'fixed'` is the explicit
  way in;
- touch was verified with synthetic pointer events and only on a prepared surface (`touch-action`
  removed) — real devices, inertial scrolling and pinch-zoom are not covered yet.

## Bundle size

Gzip, from the built artifacts:

| Artifact                                   | Raw      | Gzip        | Budget    |
| ------------------------------------------ | -------- | ----------- | --------- |
| Consumer using the whole drag-region (ESM) | 14.16 KB | **5.03 KB** | ≤ 6.00 KB |
| The same as the CDN/IIFE build             | 16.72 KB | **5.88 KB** | ≤ 7.00 KB |
| Consumer using only `supported`            | 0.27 KB  | 0.17 KB     | —         |
| `index.cjs` (CommonJS entry)               | 16.55 KB | 5.81 KB     | —         |
| `index.d.ts` (types, no runtime cost)      | 3.42 KB  | 1.45 KB     | —         |

"Whole drag-region" means everything a normal consumer gets: the instance, the pointer controller,
the rectangle geometry, the layer and the blend renderer. The two budgets are hard gates, not
warnings, and zero runtime dependencies is asserted next to them.

## Demo

![The demo page with an active region: part of the paragraph and part of the bar chart inside the
rectangle are inverted, while the rest of that same chart and the page around it keep their normal
colours](assets/demo-invert.png)

<!-- Repository-relative on purpose: the image has to render on GitHub and in a working tree. It is not
     part of the npm package — `files` is dist, README.md and LICENSE only. -->

The screenshot above is the demo page with an active region: the rectangle covers part of the text
and part of the bar chart, and the unfilled part of that same chart stays outside it, so the original
and the altered pixels are visible on one object.

```sh
npm run demo        # build + a local server: http://127.0.0.1:4317/demo/
npm run demo:site   # the same page as a built static site
```

The demo is a playground: a main drag scenario, a panel with the real options of v0.1, programmatic
`setRegion()`, and a stress-test section (hostile roots, HiDPI, CSP) below the main playground.
`.github/workflows/pages.yml` publishes it to GitHub Pages.

## Available in v0.1

The complete list of what this version does, so nothing above has to be inferred:

- drag a rectangle with a pointer, with a modifier key, inside an element, or not at all;
- one programmatic region per instance: `setRegion(bounds)` / `clearRegion()` / `bounds`;
- the `invert` effect, with the rectangular shape;
- layers in the top layer by default, legacy `fixed` mounting by explicit opt-in;
- `persistent` regions, `threshold`, `zIndex` (legacy mount only);
- touch input as an explicit opt-in on one element, with `touch-action` handled and restored;
- options from JavaScript or from `data-*` markup, with `visualRegion()`, `init()`, `autoInit()`,
  `supported`;
- the seven events above, `enable()` / `disable()` / `destroy()`, and live `setOptions()`.

## Roadmap / not implemented

None of this exists in v0.1, none of it is promised for a particular version, and none of it should be
inferred from the API above. It is recorded so the direction is not a mystery.

- **Multiple regions per instance.** The intended default is union semantics: overlapping regions
  receive the effect once, not twice. A per-region API would follow the shape
  `addRegion(bounds) → id`, `updateRegion(id, bounds)`, `removeRegion(id)`, `clearRegions()`. Note
  the name: `createRegion` and `removeRegion(bounds)` do not exist and never did in a released
  version — v0.1 has `setRegion()` / `clearRegion()`, and the plural API is a separate, later design.
- **Element-bound regions.** `addElementRegion(element, options)`: the library tracking an element's
  box instead of you measuring it. It needs a resize/scroll watch and a decision about
  `position: fixed` versus document coordinates, neither of which is designed yet.
- **Shapes.** Circle, ellipse and rounded rectangles, behind a geometry contract that today's
  rectangle does not have.
- **Other effects, in two separate directions.** (1) A _configurable difference colour_ — the current
  renderer is a live-DOM blend of one colour, so choosing that colour is a natural extension of what
  already ships. (2) A _true palette / `colorMap`_ — mapping every source colour through an arbitrary
  lookup table. That one the current renderer cannot honestly promise: it likely needs a separate
  pixel or raster renderer.
- **Motion.** Pulse, fade-in and animated transitions of a region, as a layer above geometry and
  effect rather than inside either.
- **A cursor follower** as another controller type, and **other renderers**, including WebGL/WebGPU,
  if a raster path is ever justified by use.

## Known limitations

- **The region is anchored to the viewport, not the document.** A `persistent` region stays where it
  is while the page scrolls underneath it. Document-anchored regions would need the scroll to move
  them, and that is not implemented.
- **A 2 CSS-px edge is not always inverted exactly** under hostile `html { transform: scale/rotate }`.
  The interior is exact (`ratio = 1`, `maxErr = 0`); the edge is rasterization of a physical boundary,
  and the affected share shrinks as DPR grows.
- **Overlapping regions cancel** — see [above](#multiple-instances-and-overlapping-regions).
- **Top layer ordering is last-in-wins**, and the library does not contest it (`lost-top-layer`).
- **Native HTML5 drag competes with the gesture.** `<img>` and `<a>` are draggable by default, and
  the browser's drag beats our pointerdown. Add `draggable="false"` to those elements — fixing it
  inside the library would mean editing the consumer's markup, which is exactly what this library
  promises not to do.
- **Touch is opt-in and costs `touch-action`** on the chosen element (see
  [Touch input](#touch-input)).
- **Legacy `mount: 'fixed'`** is limited in the ways listed under [Mounting](#mounting).
- **Text selection is not touched by default.** While a region is shown, selecting text works exactly
  as it does without the library. During an accepted gesture the library calls `preventDefault()` on
  that one `pointerdown`, which is what keeps the browser from starting a selection mid-drag. Nothing
  is added to your CSS for it, and `user-select` is never set for you.
- **Two instances are not coordinated**: no merge, no union, no shared layer.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the checks that must pass and what a change is expected to
include.

## License

MIT — see [LICENSE](LICENSE).
