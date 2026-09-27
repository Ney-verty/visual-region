# Recorded smoke runs

The numbers below are a recorded run of the browser battery on all three engines, kept as a
reference point. **Nothing in the suite compares a run against them automatically**: `npm run
smoke` writes a fresh result and reports its own pass/fail per check. A difference from the
recorded numbers is a signal to look into, not a failing check.

The JSON files these numbers came from are no longer committed: two fixtures of 188 548 B in
total (20,0 % of the tree), read by no tool — removed on 2026-10-03, so the accepted numbers live
here, in prose, and a run of the same shape is re-recorded on demand by the recipe below.

## The recorded runs

| Profile | Checks  | Records | Failures |
| ------- | ------- | ------- | -------- |
| DPR=1   | 125 × 3 | 149 × 3 | 0        |
| DPR=2   | 99 × 3  | 108 × 3 | 0        |

Both profiles are full runs of three engines (chromium 153.0.8010.12 / firefox 155.0 / webkit 26.6,
Node v20.19.6, linux x64). Re-recording a reference run is deliberate, not a side effect of running
the battery:

```
npm ci
npm run build
SMOKE_OUT=tests/smoke/out/reference-dpr1.json npm run smoke
SMOKE_DPR=2 SMOKE_OUT=tests/smoke/out/reference-dpr2.json npm run smoke
```

Read the two `summary` objects in the resulting files: the number of records is the check count and
the per-engine `items` count is the record count. Then update the table above.

Dated runs in `tests/smoke/out/` are temporary: every run writes one, they are what a specific run
is investigated from, and CI uploads them as an artifact when a job fails. They are ignored by
`.gitignore`, because otherwise the directory grows by a file per run and turns into an archive of
numbers.

## What is pinned by the project and what by the host

Keeping the two apart is what makes a run reproducible at all:

- **pinned by the project**: `playwright@1.63.0` exactly, without `^`; every step is an
  `npm run` script;
- **pinned by the host, not by the project**: Ubuntu 22.04, Node v20.19.6, linux x64, a free port,
  sudo for the browsers' system libraries;
- **reproducible without the same host**: the official image
  `mcr.microsoft.com/playwright:v1.63.0-jammy`. A full run of the battery inside that container has
  **not been done yet** — that is a claim with a caveat, not a fact.

The Node version, the Playwright version, the platform and the DPR are written into the result file
itself (`environment` in the JSON), not only into this document.

Steps on a clean machine:

```
npm ci
npx playwright install --with-deps chromium firefox webkit
npm run build
```

then the smoke commands from the table above.

`install --with-deps` calls sudo itself for the system libraries (the WebKit build on Ubuntu 22.04
needs the system `libavif13`) — recorded here rather than implied. There are no workarounds in the
runner: no `LD_LIBRARY_PATH`, no `PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS`, no wrappers of our
own.

`npm run build` is needed because the checks in the `dist` block bring up a page that imports
`dist/index.js` and loads `dist/visual-region.global.js`. Without a build the runner does not fail
silently: it reports "no dist/index.js — run npm run build"
([run.mjs:1319](run.mjs#L1319)).

## The HiDPI profile (DPR=2): `SMOKE_DPR=2`

The same runner, the same comparator, a different `deviceScaleFactor`. A separate profile rather
than a second run of the whole matrix: the clip is specified in CSS pixels and the image arrives DPR
times larger, so the comparator's boxes and areas are recomputed (`imgRect`/`imgBox`/`insetInClip`)
— that is, the checks are written once for both profiles.

What runs: the lifecycle and hygiene battery, the required roots (including the hostile
`html { transform }`, `body { opacity/filter }`, `pos-fixed-maxz`), input, `::backdrop`, gestures
and a destroy in the middle of a gesture, top layer (a DOM scenario: two layers in the top layer at
once with exact geometry), the `dist` block and CSP (`dist`).

What does not run — recorded as a note inside the run rather than left unsaid: the observational
roots, the pixel top-layer scenarios, the source page's CSP battery, the legacy mount and
performance. Each for its own reason: the observational roots and the pixel top-layer scenarios are
about compositing behaviour rather than about scale, while the CSP policy and performance do not
depend on DPR.

### The 2 CSS-px fringe: rasterisation behaviour, not an inversion error

The interior of the region at DPR=2 is exact everywhere: `fraction=1, strict=1, maxErr=0` — under
the hostile transforms too. The fringe (2 CSS px along the region's edge) is measured separately:

| Root                    | DPR=1 (uninverted px)                       | DPR=2 (uninverted px)     |
| ----------------------- | ------------------------------------------- | ------------------------- |
| `control`               | 0 of 2256                                   | 0 of 9024                 |
| `body-opacity-50`       | 0 of 2256                                   | 0 of 9024                 |
| `pos-fixed-maxz`        | 0 of 2256                                   | 0 of 9024                 |
| `html-transform-scale`  | 434 of 2856 (chromium, webkit), 0 (firefox) | 868 of 11424 (all three)  |
| `html-transform-rotate` | 925 of 2300 (chromium, webkit), 0 (firefox) | 1392–1852 of 9200 (all 3) |

Uninverted pixels live **only in the fringe**, and only under a hostile transform of a parent: the
fringe's share falls as DPR grows (the same absolute border width in CSS pixels covers more image
pixels), while the interior stays exact. This is the edge of the region's physical boundary when its
position after the transform is fractional — classified as **rasterisation behaviour**, and enlarging
the region does not cure it (decision of 2026-09-26).

## The `::backdrop` checks

`::backdrop` cannot be addressed by an event, so what is checked is the page's observable behaviour
(six verdicts, on all three engines): a pointer at four points lands exactly as it does without the
layer; a click on a button inside and outside the region reaches it; `pointerdown`/`mousedown` over
the region reach the target under the layer; the wheel scrolls the page (`scrollY` matches the
control); a touch tap reaches the button; and no event reaches the layer itself (0 of the layer's
counters). Plus a note on what the UA reports about the pseudo-element: `pointer-events: none` and
`background: rgba(0, 0, 0, 0)`. No CSS hack against `::backdrop` was added: the limitation is
inherited by the pseudo-element from the layer, and there is nothing to cure.

## What is verified under a strict CSP

The claim is stated narrowly: **`dist` works under the tested strict CSP configuration** —
`default-src 'self'; style-src 'self'; style-src-attr 'none'` (the `/csp-dist/` route, served from
the production artifact in `dist/`). The phrasing "CSP-compatible" without that qualification is not
used: what was tested is specific policies, not CSP in general.

Verified: the policy is really applied (a positive control by effect — a forbidden `style`
attribute did not apply); the library writes no CSP message to the console; the library creates a
region, it is in the top layer and visible; the region inverts; `destroy` returns the page exactly
to its auto-initialized state; and no `securitypolicyviolation` entry refers to the library's files.
Everything else in the log is accounted for by two measured sources: the positive control and the
tool's screenshots (in WebKit every `page.screenshot()` under `style-src` leaves its own entry).

## What the smoothness check knows and does not know

"Gesture smoothness does not degrade against the control" is the only **threshold** in the
performance block (the rest there are notes). It compares `rAF` intervals during a real gesture
(`page.mouse`, 60 steps with a frame awaited after each) with the same gesture on the same page
**without the library**. The threshold is relative on purpose (`fps with the library ≥ 0.5 × fps
without`): absolute FPS in headless is capped at 60 Hz and depends on the machine.

What it does not know: in headless Chromium, Firefox and WebKit compositing is software and frames
arrive at exactly 16.7 ms — so the threshold catches a gross degradation, not a subtle one. The
absolute compositing profile is left to a real device. In Chromium the engine's counters are
additionally read through the CDP `Performance.getMetrics` (a note on the cost of a render per
profile); Firefox and WebKit have no CDP, so there the entry is `NOT MEASURED`. This block does not
run in the DPR=2 profile.
