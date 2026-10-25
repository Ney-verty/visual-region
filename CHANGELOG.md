# Changelog

Notable changes to this project, one section per released version.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is `0.x`, the public
API is frozen per minor version: within `0.1.x` names, signatures and semantics do not change; a
breaking change bumps the minor version.

## [Unreleased]

Not released. Nothing below is in `0.1.0` on npm, or in the `v0.1.0` tag.

### Added

- **Two more shapes:** `shape: 'ellipse'` and `shape: 'circle'`, on a geometry contract that every
  shape implements. `circle` fits the largest circle the requested box allows and reports that square as
  the region's geometry, so `bounds` and the payloads of `change` and `end` always describe what is
  actually on screen. The round silhouette is a `clip-path` with an SVG path written once in unit-box
  coordinates, so it costs no per-frame work beyond the transform the rectangle already needed.
- **The `follow` controller:** `controller: 'follow'` with `followSize` (120 px square by default, or
  `{ width, height }`) — a region that appears under the pointer while the activation right holds, with
  no gesture at all: no press, no release, and no `pointerdown` listener. The activation right is
  checked on **every** accepted event, so releasing the modifier or leaving the allowed surface ends the
  session; a mouse release does not end it, a touch release does.
- **A marked source for geometry writes** inside the engine — the engine's own writes and a
  controller's are distinguishable, which is what makes the rule under _Changed_ possible without
  adding a verb to the controller contract.
- **The declarative markup grew three attributes:** `data-shape`, `data-controller` and
  `data-follow-size`, so the two shapes and the follow controller can be turned on without
  JavaScript. `data-follow-size` is read as `"120"` or `"120x80"` (a lowercase `x`, no spaces);
  anything else warns once and leaves the default size in place rather than throwing, because
  markup cannot be typed and one bad attribute should not take the page down.

### Changed

- **A gesture no longer replaces a programmatic region.** While a region shown by `setRegion()` is on
  screen, geometry coming from a controller is ignored; `clearRegion()` hands the geometry back. In
  `0.1.0` a drag overwrote such a region. The rule covers both controllers and is not specific to
  `follow`.
- **The internal list of end causes** gained a third normal end, `'ineligible'` — losing the activation
  right in the middle of a follow. It is a normal end, so it produces `end` and never `cancel`; the
  public union of `cancel.reason` (`'pointercancel' | 'blur' | 'visibility'`) is unchanged.
- **Both size budgets were raised**, each by an explicit decision and each against a measurement
  rather than an estimate: the full-consumer ESM budget from 6.00 KB to 6.50 KB gzip (6.02 KB
  measured, up from 5.03 KB in `0.1.0`), and the IIFE budget from 7.00 KB to 7.50 KB (6.87 → 7.05 KB)
  when the declarative parser gained the three attributes above — that build is the one that runs
  auto-init, and the growth was attributed to `src/index.ts` alone by building the same tree with the
  parser reverted. The consumer build was unchanged by that step (6.00 KB in both builds), so nothing
  was duplicated into the runtime. Both remain hard gates, and cutting validation or diagnostics to
  save bytes is not an option this project takes.

### Fixed

- **`setOptions()` validation is atomic.** A patch refused by the option validator leaves the
  stored options and the active configuration exactly as they were. Before, the merge into the
  stored options happened before validation, so a rejected patch could poison later updates (an
  invalid `effectColor` kept failing every subsequent call that did not overwrite it) and could
  remember the valid half of a mixed patch that was never applied. A failure after
  `reconfigure()` has begun is outside this guarantee.

## [0.1.0] — 2026-10-11

**Released 2026-10-11.** Published to npm as `visual-region@0.1.0`; this version's source is tagged
`v0.1.0`. Everything below is the state of the source tree at this version.

### Added

- **The library.** Drag a rectangle over a page and invert only what is inside it, without touching
  the page's DOM: the layer is a `popover="manual"` in the top layer, and the inversion is a
  `mix-blend-mode: difference` blend on an opaque white layer.
- **Options:** `effect`, `shape`, `activation` (`modifier` | `always` | `element` | `programmatic`),
  `modifier`, `surface`, `interactionRoot`, `touch`, `mount` (`top-layer` | `fixed`), `persistent`,
  `disabled`, `threshold`, `zIndex`.
- **Programmatic regions:** `setRegion(bounds)`, `clearRegion()`, `bounds` — one region per instance
  in this version.
- **Events:** `start`, `change`, `end`, `cancel`, `lost-top-layer`, `unsupported`, `destroy`.
- **Lifecycle:** `enable()`, `disable()`, `destroy()`, live `setOptions(patch)`.
- **Declarative markup:** `data-visual-region="invert"` plus the option attributes, and the
  `visual-region/auto` entry that initializes them; `autoInit(root?)` for SPA route changes.
- **Three ways in:** ESM (`import`), CommonJS (`require`), and an IIFE build that puts the API on
  `window.VisualRegion`; TypeScript types for all of them. Zero runtime dependencies.
- **Touch input as an explicit opt-in** (`touch: 'surface'`), with `touch-action` set on the surface
  when the instance is enabled and restored when it is disabled.
- **Examples** for vanilla, React, Vue and Next.js, each connecting the library by package name.
- **A demo playground**, published to GitHub Pages at <https://ney-verty.github.io/visual-region/>.
- **Runtime diagnostics in English**, including the `reason` payloads of `unsupported` and
  `lost-top-layer`. They are written to be read by a person and are not a stable machine-readable
  identifier — the README states the rule, and v0.1 exposes no field for classifying why a region
  went away.

### Verified at this version

Measured, not asserted — details and numbers in [README.md](README.md) and
`tests/smoke/BASELINE.md`:

- 125 checks × 3 engines at DPR=1, 99 × 3 at DPR=2 (Chromium 153, Firefox 155, WebKit 26.6, Linux);
- bundle budgets: 5.03 KB gzip for the full ESM consumer (budget 6.00), 5.88 KB gzip for the IIFE
  build (budget 7.00);
- both tested CSP configurations pass, including `style-src-attr 'none'`.

### Known limitations

Listed in full under [Known limitations](README.md#known-limitations) in the README. The two worth
repeating here: Safari is **not** confirmed (Linux WebKit is not a Safari result), and a region is
anchored to the viewport rather than to the document.

Real-device Safari/iOS validation was not performed for v0.1.0. This is an accepted validation gap
for this version, not a found defect and not a release blocker.
