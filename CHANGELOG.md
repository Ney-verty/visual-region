# Changelog

Notable changes to this project, one section per released version.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). While the version is `0.x`, the public
API is frozen per minor version: within `0.1.x` names, signatures and semantics do not change; a
breaking change bumps the minor version.

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
