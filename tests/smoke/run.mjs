/*
 * Smoke-check runner.
 *
 * What it does:
 *   0) static scan of the sources for forbidden ways to write styles and code;
 *   1) builds src → .tmp-build (plain tsc, no bundler — but ESM is needed,
 *      which the browser will load itself);
 *   2) starts a static server (with routes under a CSP header);
 *   3) in each engine:
 *      – runs the in-page battery (tests/smoke/suite.js);
 *      – checks the inversion pixel by pixel, including hostile roots;
 *      – checks pointer pass-through with REAL input (click, wheel,
 *        selection, Esc) and compares with the state without the layer;
 *      – checks destroy() in an intermediate state (mid-gesture);
 *      – observes the order in the top layer (a site dialog/popover, two instances);
 *      – repeats the effect and the battery under strict CSP.
 *   4) writes tests/smoke/out/results-<date>.json and prints a report.
 *
 * Pixels are compared on a SEPARATE decoder page (tests/lib/decoder.html):
 * under CSP neither addScriptTag nor eval works, and a screenshot can be decoded anywhere.
 *
 * Running: npm run smoke  (or: node tests/smoke/run.mjs [chromium,firefox,webkit])
 *   SMOKE_BROWSERS=chromium,firefox,webkit   which engines (all three by default)
 *   SMOKE_PORT=8790                          static server port
 *
 * About playwright: taken ONLY from the project's devDependencies, the version
 * pinned exactly (`playwright@1.63.0`, no ^). The version must match the browser
 * revisions in ~/.cache/ms-playwright: each playwright version has its own
 * revisions (1.63.0 → chromium-1243 / firefox-1543 / webkit-2359), and a foreign
 * playwright simply will not find the binaries.
 *
 * Environment setup (once):
 *   npm install
 *   npx playwright install --with-deps chromium firefox webkit
 * On Ubuntu 22.04 the WebKit build needs the system libavif13 — `install-deps`
 * installs it. There are deliberately no workarounds here (custom wrappers,
 * LD_LIBRARY_PATH, symlinks): the test must run the standard way.
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startServer, CSP_VARIANTS } from '../lib/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(HERE, 'out');
const PORT = Number(process.env.SMOKE_PORT || 8790);
const VIEWPORT = { width: 1280, height: 900 };
const WANTED = (process.env.SMOKE_BROWSERS || 'chromium,firefox,webkit')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const TOL = 3;

/*
 * HiDPI profile. `deviceScaleFactor` affects everything measured pixel-wise:
 * the clip is given in CSS pixels while the image comes back DPR times larger, so
 * the comparator's boxes and regions are recalculated through imgRect/insetInClip/imgBox
 * (see below). DPR=1 by default — a normal run is unchanged.
 *
 * SMOKE_DPR=2 runs a critical subset: running the whole matrix at two
 * scales is expensive without benefit, and whatever was not checked in this run is
 * listed in notes — more honest than silently skipping it.
 */
const DPR = Number(process.env.SMOKE_DPR || 1);
const HIDPI = DPR !== 1;

/* Roots on which legacy mounting broke — they must pass; the rest are
   observational. */
const ROOTS = [
  { id: 'control', must: true },
  { id: 'body-opacity-50', must: true },
  { id: 'html-transform-scale', must: true },
  { id: 'html-transform-rotate', must: true },
  { id: 'pos-fixed-maxz', must: true },
  { id: 'html-transform-translate', must: false },
  { id: 'body-filter-blur', must: false },
];

/* ------------------------------------------------------------- utilities ---- */

const short = (d) => (typeof d === 'string' ? d.slice(0, 200) : JSON.stringify(d).slice(0, 200));

/* The run environment goes into the result file itself, not only into the docs.
   The Node version and the playwright version determine which browsers and which
   numbers came out; without them a baseline file cannot be compared with a run on
   another machine. The playwright version is taken from the installed package;
   if not found — the field is null, and the run does not fail because of it. */
function environmentInfo() {
  let playwright = null;
  try {
    playwright = createRequire(import.meta.url)('playwright/package.json').version;
  } catch {
    /* The version was not determined (package not installed) — the field stays null. */
  }
  return {
    node: process.version,
    playwright,
    platform: `${process.platform} ${process.arch}`,
    dpr: DPR,
    /* The distribution and the presence of sudo are not pinned by the project —
       they are a property of the host. We record only what is visible from the
       process. */
  };
}

function makeReport(browser) {
  const items = [];
  return {
    browser,
    items,
    add(name, ok, detail = '') {
      const item = { name, ok: !!ok, detail: String(detail).slice(0, 400) };
      items.push(item);
      const mark = item.ok ? 'PASS' : 'FAIL';
      console.log(`  ${mark}  ${name}${item.detail ? ' — ' + item.detail : ''}`);
      return item;
    },
    note(name, detail) {
      items.push({ name, ok: null, detail: String(detail).slice(0, 600) });
      console.log(`  ····  ${name} — ${short(detail)}`);
    },
  };
}

async function settle(page) {
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
  );
  await page.waitForTimeout(60);
}

function toClip(rect) {
  const x = Math.max(0, Math.round(rect.x));
  const y = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(VIEWPORT.width, Math.round(rect.x + rect.width));
  const y1 = Math.min(VIEWPORT.height, Math.round(rect.y + rect.height));
  if (x1 - x < 4 || y1 - y < 4) return null;
  return { x, y, width: x1 - x, height: y1 - y };
}

/*
 * Coordinates in the comparator are IMAGE PIXELS, while `page.screenshot({clip})`
 * takes CSS pixels: with `deviceScaleFactor: 2` the image is twice the clip, and
 * the point (0,0) stays the top-left of the cropped fragment. So everything that
 * goes into `compare()` passes through these two functions — otherwise on HiDPI
 * the boxes would silently measure the wrong place.
 */
function imgRect(clip) {
  return { x: 0, y: 0, w: Math.round(clip.width * DPR), h: Math.round(clip.height * DPR) };
}

function imgBox(cssRect) {
  return {
    x: Math.round(cssRect.x * DPR),
    y: Math.round(cssRect.y * DPR),
    w: Math.round(cssRect.w * DPR),
    h: Math.round(cssRect.h * DPR),
  };
}

function insetInClip(rect, clip, f) {
  const x = (rect.x - clip.x) * DPR;
  const y = (rect.y - clip.y) * DPR;
  const w = rect.width * DPR;
  const h = rect.height * DPR;
  const dx = w * f;
  const dy = h * f;
  return { x: x + dx, y: y + dy, w: Math.max(1, w - 2 * dx), h: Math.max(1, h - 2 * dy) };
}

async function shot(page, clip) {
  if (clip === null) return null;
  return (await page.screenshot({ clip })).toString('base64');
}

function compare(decoder, before, after, opts) {
  return decoder.evaluate(({ b, a, o }) => window.__px.compare(b, a, o), { b: before, a: after, o: opts });
}

async function loadPlaywright() {
  /* Playwright is taken only from the project's devDependencies (exact version).
     No fallback paths: a playwright of another version slipped in from outside
     will not find the browser binaries and will fail with a vague error — better
     to say it directly. */
  try {
    return await import('playwright');
  } catch {
    throw new Error(
      'playwright is not installed in the project. Run: npm install && npx playwright install --with-deps chromium firefox webkit',
    );
  }
}

/* --------------------------------------- pixels: shape silhouettes ----- */

/*
 * The round shapes, checked where only pixels can check them.
 *
 * The geometry half of the contract — "a circle reports the square it really
 * occupies" — is pinned by the in-page battery, which compares the reported box
 * with an independently computed one. Here the question is the other half: does
 * the SILHOUETTE clip the effect at all, and does it clip it where the shape says.
 *
 * The numbers below are the test's own expectation, computed from the requested
 * box, never read back from the library:
 *   ellipse — fills its box, so ≈ π/4 of the box is inverted and the four corners
 *             of the box are NOT (an inscribed ellipse misses them by ~13% of the
 *             radius, which at this size is ~15 px — far from any antialiasing);
 *   circle  — the largest circle the box allows, i.e. the square it reports.
 * A missing `clip-path` shows up immediately as ratio ≈ 1.0 instead of ≈ 0.785.
 */
function fitSquare(box) {
  const side = Math.min(box.width, box.height);
  return {
    x: box.x + (box.width - side) / 2,
    y: box.y + (box.height - side) / 2,
    width: side,
    height: side,
  };
}

async function shapeChecks(page, decoder, url, report) {
  await page.goto(url);
  await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });

  const geo = await page.evaluate(() => {
    const vp = { width: innerWidth, height: innerHeight };
    const r = window.__suite.probeRect();
    const x = Math.max(0, r.x + 8);
    const y = Math.max(0, r.y + 8);
    const x1 = Math.min(vp.width, r.x + r.width - 8);
    const y1 = Math.min(vp.height, r.y + r.height - 8);
    return {
      requested: { x, y, width: Math.max(0, x1 - x), height: Math.max(0, y1 - y) },
      outside: window.__suite.outsideRect(),
    };
  });

  const requested = geo.requested;
  if (requested.width < 40 || requested.height < 40) {
    report.add('pixels [shapes]: the probe is on screen', false, JSON.stringify(requested));
    return;
  }
  const clipOut = toClip(geo.outside);

  for (const shape of ['ellipse', 'circle']) {
    /* The box the shape must occupy, computed here: for the circle — the largest
       square the requested box allows, centred in it. It is deliberately not what
       the library reports (that is `state.rect`, compared below). */
    const fitted = shape === 'circle' ? fitSquare(requested) : requested;
    const clip = toClip(fitted);
    if (clip === null) {
      report.add(`pixels [${shape}]: the region is inside the viewport`, false, JSON.stringify(fitted));
      continue;
    }

    const m = 0.1; // the corner sample: 0.1 of each side of the fitted box
    const corners = [
      ['corner top-left', fitted.x, fitted.y],
      ['corner top-right', fitted.x + fitted.width * (1 - m), fitted.y],
      ['corner bottom-left', fitted.x, fitted.y + fitted.height * (1 - m)],
      ['corner bottom-right', fitted.x + fitted.width * (1 - m), fitted.y + fitted.height * (1 - m)],
    ].map(([label, x, y]) => ({ label, x, y, width: fitted.width * m, height: fitted.height * m }));

    /* A centred box of 0.6 of each side: its corners sit at 0.85 of the radius, so
       it is well inside the inscribed ellipse of the fitted box. */
    const centre = {
      x: fitted.x + fitted.width * 0.2,
      y: fitted.y + fitted.height * 0.2,
      width: fitted.width * 0.6,
      height: fitted.height * 0.6,
    };

    await page.evaluate(() => window.__suite.scene.hide());
    await settle(page);
    const before = await shot(page, clip);
    const beforeOut = await shot(page, clipOut);

    await page.evaluate(({ box, kind }) => window.__suite.scene.show(box, { shape: kind }), {
      box: requested,
      kind: shape,
    });
    await settle(page);
    const state = await page.evaluate(() => window.__suite.scene.state());
    const after = await shot(page, clip);
    const afterOut = await shot(page, clipOut);
    await page.evaluate(() => window.__suite.scene.hide());

    const inside = await compare(decoder, before, after, {
      boxes: [
        { label: 'inside the silhouette', ...insetInClip(centre, clip, 0.2), mode: 'complement' },
        ...corners.map((c) => ({ label: c.label, ...insetInClip(c, clip, 0), mode: 'unchanged' })),
      ],
      region: imgRect(clip),
      tol: TOL,
    });

    const box = inside.boxes[0];
    const ratio = inside.region.ratio;
    const cornersOk = inside.boxes.slice(1).every((b) => b.ok);

    report.add(
      `pixels [${shape}]: the effect is inverted inside the silhouette`,
      box && box.ok,
      box && box.ok
        ? `errMax=${box.errMax}`
        : `before=[${box && box.before}] after=[${box && box.after}] expected=[${box && box.expected}]`,
    );
    report.add(
      `pixels [${shape}]: the silhouette clips the effect (≈ π/4 of the fitted box)`,
      ratio >= 0.72 && ratio <= 0.84,
      `ratio=${ratio}, strict=${inside.region.strictRatio}, fitted=${Math.round(fitted.width)}×${Math.round(fitted.height)}` +
        ` at (${Math.round(fitted.x)},${Math.round(fitted.y)})`,
    );
    report.add(
      `pixels [${shape}]: the corners of the box are outside the silhouette`,
      cornersOk,
      cornersOk
        ? `4 boxes, errMax=${Math.max(...inside.boxes.slice(1).map((b) => b.errMax || 0))}`
        : JSON.stringify(inside.boxes.slice(1).filter((b) => !b.ok)),
    );
    report.add(
      `pixels [${shape}]: the layer occupies exactly the box the shape reports`,
      state !== null &&
        state.visibility === 'visible' &&
        state.topLayer === true &&
        Math.abs(state.rect.x - fitted.x) <= 0.5 &&
        Math.abs(state.rect.y - fitted.y) <= 0.5 &&
        Math.abs(state.rect.width - fitted.width) <= 0.5 &&
        Math.abs(state.rect.height - fitted.height) <= 0.5,
      state === null
        ? 'no layer'
        : `topLayer=${state.topLayer}, visibility=${state.visibility}, Δ=${JSON.stringify({
            x: +(state.rect.x - fitted.x).toFixed(2),
            y: +(state.rect.y - fitted.y).toFixed(2),
            w: +(state.rect.width - fitted.width).toFixed(2),
            h: +(state.rect.height - fitted.height).toFixed(2),
          })}`,
    );

    if (clipOut !== null) {
      const outside = await compare(decoder, beforeOut, afterOut, {
        boxes: [{ label: 'outside', ...insetInClip(geo.outside, clipOut, 0.25), mode: 'unchanged' }],
        tol: TOL,
      });
      const o = outside.boxes[0];
      report.add(
        `pixels [${shape}]: nothing changed outside the shape's box`,
        o.ok,
        o.ok ? `errMax=${o.errMax}` : `before=[${o.before}] after=[${o.after}]`,
      );
    }
  }
}

/* --------------------------------------------- 0. static scan -------- */

const FORBIDDEN = [
  { re: /\bcssText\b/, why: 'style.cssText' },
  { re: /setAttribute\(\s*['"]style['"]/, why: "setAttribute('style', …)" },
  { re: /createElement\(\s*['"]style['"]/, why: '<style> injection' },
  { re: /\binsertRule\b/, why: 'CSSStyleSheet.insertRule' },
  { re: /\binnerHTML\b/, why: 'innerHTML' },
  { re: /\bouterHTML\s*=/, why: 'outerHTML assignment' },
  { re: /document\.write/, why: 'document.write' },
  { re: /\beval\s*\(/, why: 'eval' },
  { re: /new\s+Function\s*\(/, why: 'new Function' },
];

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

async function listSources(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listSources(full)));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

async function scanSources(report) {
  const files = await listSources(path.join(ROOT, 'src'));
  const hits = [];
  for (const file of files) {
    const code = stripComments(await fs.readFile(file, 'utf8'));
    code.split('\n').forEach((line, index) => {
      for (const { re, why } of FORBIDDEN) {
        if (re.test(line)) hits.push(`${path.relative(ROOT, file)}:${index + 1} ${why}`);
      }
    });
  }
  report.add(
    'static scan of src: CSSOM only, no cssText/style attribute/innerHTML/eval',
    hits.length === 0,
    hits.length ? hits.slice(0, 6).join(' | ') : `${files.length} files`,
  );
}

/* -------------------------------------------------------- 1-2. build ---- */

function build(report) {
  const tsc = path.join(ROOT, 'node_modules', '.bin', 'tsc');
  if (!fsSync.existsSync(tsc)) {
    report.add('build: tsc found', false, 'no node_modules/.bin/tsc — npm install');
    return false;
  }
  const res = spawnSync(
    tsc,
    ['--outDir', '.tmp-build', '--declaration', 'false', '--declarationMap', 'false'],
    { cwd: ROOT, encoding: 'utf8' },
  );
  const ok = res.status === 0;
  report.add('build: tsc → .tmp-build', ok, ok ? 'no errors' : (res.stdout + res.stderr).slice(0, 300));
  return ok;
}

/* ------------------------------------------- pixel check of the region -- */

/** `#rrggbb` → the per-channel operand used by the pixel comparator. */
function operandOf(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function rgbCss([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

async function inversionCheck(page, decoder, url, label, report, { must, effectColor }) {
  const operand = effectColor ? operandOf(effectColor) : [255, 255, 255];
  await page.goto(url);
  await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });

  const geo = await page.evaluate(() => {
    const vp = { width: innerWidth, height: innerHeight };
    const clamp = (r) => {
      const x = Math.max(0, r.x);
      const y = Math.max(0, r.y);
      const x1 = Math.min(vp.width, r.x + r.width);
      const y1 = Math.min(vp.height, r.y + r.height);
      return { x, y, width: Math.max(0, x1 - x), height: Math.max(0, y1 - y) };
    };
    return { probe: clamp(window.__suite.probeRect()), outside: clamp(window.__suite.outsideRect()) };
  });

  const region = {
    x: geo.probe.x + 8,
    y: geo.probe.y + 8,
    width: geo.probe.width - 16,
    height: geo.probe.height - 16,
  };
  /* A second region — 2px inward. Needed to distinguish "the effect is inaccurate"
     from "the region rim is antialiased": under html{transform:scale/rotate} the
     layer edge lands on a fractional physical pixel, and the pixels of the boundary
     itself get mixed. */
  const inner = { x: region.x + 2, y: region.y + 2, width: region.width - 4, height: region.height - 4 };
  const clipIn = toClip(region);
  const clipInner = toClip(inner);
  const clipOut = toClip(geo.outside);
  if (clipIn === null) {
    report.add(`pixels [${label}]: the region is inside the viewport`, false, JSON.stringify(region));
    return null;
  }

  await page.evaluate(() => window.__suite.scene.hide());
  await settle(page);
  const beforeIn = await shot(page, clipIn);
  const beforeInner = await shot(page, clipInner);
  const beforeOut = await shot(page, clipOut);

  await page.evaluate(
    ({ b, color }) => window.__suite.scene.show(b, color ? { effectColor: color } : undefined),
    { b: region, color: effectColor },
  );
  await settle(page);
  const state = await page.evaluate(() => window.__suite.scene.state());
  const afterIn = await shot(page, clipIn);
  const afterInner = await shot(page, clipInner);
  const afterOut = await shot(page, clipOut);
  await page.evaluate(() => window.__suite.scene.hide());

  const inside = await compare(decoder, beforeIn, afterIn, {
    boxes: [{ label: 'inside', ...insetInClip(region, clipIn, 0.2), mode: 'complement' }],
    region: imgRect(clipIn),
    operand,
    tol: TOL,
  });
  const innerCmp =
    clipInner === null
      ? null
      : await compare(decoder, beforeInner, afterInner, {
          region: imgRect(clipInner),
          operand,
          tol: TOL,
        });
  const outside =
    clipOut === null
      ? null
      : await compare(decoder, beforeOut, afterOut, {
          boxes: [{ label: 'outside', ...insetInClip(geo.outside, clipOut, 0.25), mode: 'unchanged' }],
          operand,
          tol: TOL,
        });

  const box = inside.boxes[0];
  const ratio = inside.region.ratio;
  const strict = inside.region.strictRatio;
  const outsideBox = outside ? outside.boxes[0] : null;

  /* The region rim 2 CSS pixels wide — the difference between the full region and
     the inner one. At DPR=2 it is twice as thick in image pixels, and this is exactly
     where `mix-blend-mode` mixes colors on a fractional physical boundary. A separate
     figure is needed to distinguish "the effect is inaccurate" from "the boundary is
     antialiased". */
  const rim =
    innerCmp && innerCmp.region && innerCmp.region.n > 0 && innerCmp.region.n < inside.region.n
      ? {
          n: inside.region.n - innerCmp.region.n,
          match: inside.region.match - innerCmp.region.match,
        }
      : null;
  if (rim) {
    rim.ratio = rim.n ? +(rim.match / rim.n).toFixed(4) : 0;
  }

  const geometryOk =
    Math.abs(state.rect.x - region.x) <= 0.5 &&
    Math.abs(state.rect.y - region.y) <= 0.5 &&
    Math.abs(state.rect.width - region.width) <= 0.5 &&
    Math.abs(state.rect.height - region.height) <= 0.5;

  const kind = effectColor ? `difference with ${effectColor}` : 'inversion';
  report.add(
    `pixels [${label}]: ${kind} inside the region (per-channel error ≤ ${TOL})`,
    box && box.ok,
    box && box.ok
      ? `errMax=${box.errMax}, ratio=${ratio}, strict=${strict}`
      : `before=[${box && box.before}] after=[${box && box.after}] expected=[${box && box.expected}]`,
  );
  report.add(
    effectColor
      ? `pixels [${label}]: fraction of pixels matching |input - ${effectColor}| ≥ 0.97`
      : `pixels [${label}]: fraction of inverted pixels ≥ 0.97`,
    ratio >= 0.97,
    `ratio=${ratio}, strict=${strict}, maxErr=${inside.region.maxErr}, almost-white before=${inside.region.nonWhiteBefore}`,
  );
  const expectedBackground = rgbCss(operand);
  report.add(
    `pixels [${label}]: the layer's computed background-color is ${expectedBackground}`,
    state.background === expectedBackground,
    `background-color=${state.background}`,
  );
  if (innerCmp) {
    report.note(
      `pixels [${label}]: region without the 2px rim`,
      `ratio=${innerCmp.region.ratio}, strict=${innerCmp.region.strictRatio}, maxErr=${innerCmp.region.maxErr}` +
        (rim
          ? `; rim 2 CSS-px (${rim.n} image px at DPR=${DPR}): ratio=${rim.ratio}, ` +
            `not inverted=${rim.n - rim.match} of ${rim.n}`
          : ''),
    );
  }
  if (outsideBox) {
    report.add(
      `pixels [${label}]: nothing changed outside the region`,
      outsideBox.ok,
      outsideBox.ok
        ? `errMax=${outsideBox.errMax}`
        : `before=[${outsideBox.before}] after=[${outsideBox.after}]`,
    );
  }
  report.add(
    `pixels [${label}]: the layer is in the top layer and the geometry is exact`,
    state.topLayer === true && geometryOk,
    `topLayer=${state.topLayer}, blend=${state.blend}, Δ=${JSON.stringify({
      x: +(state.rect.x - region.x).toFixed(2),
      y: +(state.rect.y - region.y).toFixed(2),
      w: +(state.rect.width - region.width).toFixed(2),
      h: +(state.rect.height - region.height).toFixed(2),
    })}${must ? '' : ' (observational root)'}`,
  );
  return { region, ratio, strict, errMax: box ? box.errMax : null, state };
}

/* Scrolling in WebKit is animated: right after wheel, scrollY is still "settling"
   (measured: 297 against 300). We wait until the value stabilizes, otherwise we
   measure the moment in time rather than the result of the scroll. */
async function scrollSettled(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        let last = -1;
        let stable = 0;
        let ticks = 0;
        const tick = () => {
          const y = Math.round(window.scrollY);
          if (y === last) stable++;
          else {
            stable = 0;
            last = y;
          }
          if (stable >= 3 || ++ticks > 90) resolve(y);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/* ------------------------------------------------------ performance ------- */

/**
 * A gesture with real input, recording rAF intervals between frames.
 *
 * `page.mouse` specifically, not `dispatchEvent`: a synthetic event from
 * evaluate() produces no compositor frames, and "smoothness" would turn into a
 * measurement of evaluate itself. An instance with `activation: 'always'` is
 * created by the runner before the measurement, so no modifier is needed.
 *
 * After each step we wait for a frame (`requestAnimationFrame` in the page).
 * Without that, engines coalesce frames differently: measured — WebKit gave
 * 5 frames over 40 mouse steps, while Chromium gave 81, and a relative threshold
 * on such samples means nothing. Waiting for a roundtrip is the same in both runs
 * (with and without the library), so the comparison stays honest and the sample
 * stays comparable.
 */
async function dragRecorded(page, { steps = 60 } = {}) {
  await page.evaluate(() => window.__suite.perf.start());
  await page.mouse.move(120, 120);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await page.mouse.move(120 + 280 * t, 120 + 180 * t);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  }
  await page.mouse.up();
  return page.evaluate(() => window.__suite.perf.stop());
}

/**
 * Engine counters. This is NOT our timer: the values come from CDP
 * `Performance.getMetrics`, that is, measured by the browser.
 *
 * Chromium only: Firefox/WebKit have no CDP, and there the render cost stays
 * unmeasured (in the report — NOT MEASURED, not "zero").
 */
async function cdpMetrics(page) {
  try {
    const session = await page.context().newCDPSession(page);
    await session.send('Performance.enable');
    return {
      async read() {
        const { metrics } = await session.send('Performance.getMetrics');
        const out = {};
        for (const metric of metrics) out[metric.name] = metric.value;
        return out;
      },
      async close() {
        await session.detach().catch(() => {});
      },
    };
  } catch {
    return null;
  }
}

const ms = (from, to, key) => ((to[key] ?? 0) - (from[key] ?? 0)) * 1000;

/** The minimum number of frames at which a smoothness comparison makes any sense. */
const MIN_FRAMES = 10;

/* ------------------------------------------------- pass-through ------ */
async function passThrough(page, url, visible) {
  await page.goto(url);
  await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });
  await page.evaluate(() => window.__suite.passReset());
  if (visible) {
    const probe = await page.evaluate(() => window.__suite.probeRect());
    await page.evaluate((b) => window.__suite.scene.show(b), probe);
    await settle(page);
  }

  const target = await page.evaluate(() => window.__suite.targetRect());
  await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);

  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.mouse.wheel(0, 300);
  const scrollY = await scrollSettled(page);

  /* We return the scroll deterministically, otherwise the selection would start on
     a different line and "change" because of one pixel of scroll rather than because
     of the layer. */
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);

  const text = await page.evaluate(() => window.__suite.textRect());
  await page.mouse.move(text.x + 10, text.y + 10);
  await page.mouse.down();
  await page.mouse.move(text.x + 600, text.y + 34, { steps: 10 });
  await page.mouse.up();

  await page.keyboard.press('Escape');
  await settle(page);

  const read = await page.evaluate(() => window.__suite.passRead());
  const state = await page.evaluate(() => window.__suite.scene.state());
  return { read: { ...read, scrollY }, state };
}

/* --- C2. `::backdrop` -----------------------------------------------------
 *
 * `::backdrop` is a separate top-layer element stretched over the whole viewport,
 * and in the hygiene checks it was covered only indirectly (`pointer-events: none`
 * on the layer is inherited by the pseudo-element — that is a HYPOTHESIS, not a
 * measurement). Here it is covered directly: a page with a visible region and the
 * same page without it receive one and the same real input, and the behavior must
 * match.
 *
 * A pseudo-element cannot be addressed by an event, so we measure the observable:
 * who gets the input at a point (`elementFromPoint`), what happened to the click,
 * the drag, the wheel and the touch, and how many events reached the layer itself.
 *
 * The window here is its own, with `hasTouch: true`: without it `page.touchscreen`
 * does not work, and touch cannot be enabled in the shared context — it changes the
 * pointer behavior in other checks.
 */
async function backdropChecks(report, browser, origin) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR, hasTouch: true });
  try {
    const page = await ctx.newPage();
    const url = `${origin}/tests/smoke/page.html`;
    const withLayer = await backdropPass(page, url, true);
    const without = await backdropPass(page, url, false);
    const a = withLayer.read;
    const b = without.read;
    const ours = Object.entries(withLayer.hits).filter(([, v]) => v && v.ours);

    report.add(
      '::backdrop: pointer hit-testing at the points matches the state without the layer',
      ours.length === 0 &&
        JSON.stringify(withLayer.hits) === JSON.stringify(without.hits) &&
        Object.values(without.hits).every((h) => h && h.id),
      `with layer=${Object.entries(withLayer.hits)
        .map(([k, v]) => `${k}→${v ? v.id : '—'}`)
        .join(', ')}; without layer=${Object.entries(without.hits)
        .map(([k, v]) => `${k}→${v ? v.id : '—'}`)
        .join(', ')}`,
    );

    report.add(
      '::backdrop: a click on the button reaches it (inside and outside the region)',
      a['click:click-target'] >= 1 &&
        a['click:click-target'] === b['click:click-target'] &&
        a['click:outside'] >= 1 &&
        a['click:outside'] === b['click:outside'],
      `button clicks with layer=${a['click:click-target']}, without layer=${b['click:click-target']}; ` +
        `on the neighboring block with layer=${a['click:outside']}, without layer=${b['click:outside']}`,
    );

    report.add(
      '::backdrop: press and release over the region reach the target under the layer',
      a['pointerdown:probe'] >= 1 &&
        a['pointerdown:probe'] === b['pointerdown:probe'] &&
        a['mousedown:probe'] === b['mousedown:probe'],
      `pointerdown on the probe with layer=${a['pointerdown:probe']}, without layer=${b['pointerdown:probe']}`,
    );

    report.add(
      '::backdrop: the wheel scrolls the page with a visible region',
      a.wheel >= 1 && b.wheel >= 1 && a.scrollY > 0 && Math.abs(a.scrollY - b.scrollY) <= 5,
      `scrollY with layer=${a.scrollY}, without layer=${b.scrollY}, wheel events with layer=${a.wheel}, without layer=${b.wheel}`,
    );

    /* Touch: if an engine did not deliver a single touchstart even without the
       layer, that is not a failure of the library — it is the absence of touch in
       the environment, and that is what must be said. */
    if (b['touchstart:click-target'] === 0) {
      report.note(
        '::backdrop: touch tap',
        `in this environment touch is not delivered even without the layer — the check was not performed (touchstart without layer=${b['touchstart:click-target']})`,
      );
    } else {
      report.add(
        '::backdrop: a touch tap on the button reaches it',
        a['touchstart:click-target'] === b['touchstart:click-target'] && a['touchstart:click-target'] >= 1,
        `touchstart on the button with layer=${a['touchstart:click-target']}, without layer=${b['touchstart:click-target']}`,
      );
    }

    report.add(
      '::backdrop: not a single event reached the layer itself',
      a.layerHits === 0,
      `events on the layer with layer=${a.layerHits} (without the layer there is no counter), ` +
        `topLayer=${withLayer.state ? withLayer.state.topLayer : '—'}, visibility=${withLayer.state ? withLayer.state.visibility : '—'}`,
    );

    /* What the UA reports at all about `::backdrop` — a fact for the report, without a verdict. */
    report.note(
      '::backdrop: what the UA reports about our layer pseudo-element',
      withLayer.ua ? JSON.stringify(withLayer.ua) : 'the pseudo-element is not readable',
    );
  } finally {
    await ctx.close();
  }
}

/** One pass: the page with a visible region (`visible`) or without it. */
async function backdropPass(page, url, visible) {
  await page.goto(url);
  await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });
  const { region, points } = await page.evaluate(() => window.__suite.backdrop.points());

  await page.evaluate(() => window.__suite.backdrop.reset());
  const state = visible
    ? await page.evaluate((r) => window.__suite.backdrop.show(r), region)
    : await page.evaluate(() => window.__suite.backdrop.hide());
  await settle(page);
  const hits = await page.evaluate(() => window.__suite.backdrop.hit());
  const ua = visible ? await page.evaluate(() => window.__suite.backdrop.ua()) : null;

  /* Real input. The order matters: the wheel is last — it changes the scroll, and
     the point coordinates were measured before it. */
  await page.mouse.click(points.target.x, points.target.y);
  await page.mouse.click(points.outside.x, points.outside.y);
  await page.mouse.move(points.insideRegion.x, points.insideRegion.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.touchscreen.tap(points.target.x, points.target.y);
  await settle(page);
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  await page.mouse.wheel(0, 300);
  await scrollSettled(page);

  const read = await page.evaluate(() => window.__suite.backdrop.read());
  if (visible) await page.evaluate(() => window.__suite.backdrop.hide());
  return { hits, ua, read, state };
}

/* ------------------------------------------------------------ single engine */

async function runBrowser(report, browsers, name, origin) {
  const browser = await browsers[name].launch({ headless: true });
  report.version = browser.version();

  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DPR });
  const decoder = await ctx.newPage();
  await decoder.goto(`${origin}/tests/lib/decoder.html`);
  const page = await ctx.newPage();
  const consoleLines = [];
  const pageErrors = [];
  page.on('console', (m) => consoleLines.push({ type: m.type(), text: m.text() }));
  page.on('pageerror', (e) => pageErrors.push(String(e.message)));

  const url = `${origin}/tests/smoke/page.html`;

  /* HiDPI profile: the full matrix at two scales is not needed, but "what exactly
     was not checked in this run" must be written down, not implied. */
  if (HIDPI) {
    report.note(
      'HiDPI profile',
      `deviceScaleFactor=${DPR}: the battery, mandatory roots, input, ` +
        '::backdrop, gestures, destroy mid-gesture, enable hygiene, the silhouette pixels of the ' +
        'shapes, top layer (DOM), dist and CSP (dist) run; ' +
        'NOT run: observational roots, pixel top-layer scenarios, ' +
        'CSP battery of the sources page, legacy mount, performance',
    );
  }

  /* --- A. in-page battery --- */
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });
    const results = await page.evaluate(() => window.__suite.run());
    for (const r of results) report.add(r.name, r.ok, r.detail);
    report.add(
      'page: no JS error and no console error',
      pageErrors.length === 0 && consoleLines.every((l) => l.type !== 'error'),
      pageErrors
        .concat(consoleLines.filter((l) => l.type === 'error').map((l) => l.text))
        .slice(0, 3)
        .join(' | '),
    );

    const before = consoleLines.length;
    await page.evaluate(() => window.__suite.warnUnknownOption());
    const warned = consoleLines.slice(before).some((l) => l.text.includes('bogusOption'));
    report.add(
      'warnings: the unknown option is named in the console',
      warned,
      warned ? '' : 'there was no warning',
    );
  } catch (error) {
    report.add('in-page battery', false, String(error.message || error));
  }

  /* --- B. pixels per root --- */
  /* In the HiDPI profile — only the mandatory roots: they give both the inversion
     inside and "nothing changed outside the region", and the hostile html
     transforms. */
  for (const root of HIDPI ? ROOTS.filter((r) => r.must) : ROOTS) {
    try {
      const res = await inversionCheck(page, decoder, `${url}?root=${root.id}`, root.id, report, {
        must: root.must,
      });
      if (res && !root.must && res.ratio < 0.97) {
        report.note(`root ${root.id}`, `observational: ratio ${res.ratio}, error ${res.errMax}`);
      }
    } catch (error) {
      report.add(`pixels [${root.id}]`, false, String(error.message || error));
    }
  }

  /* --- B1. pixels: the operand colour (one point check, not an audit) --- */
  try {
    await inversionCheck(page, decoder, url, 'effectColor #ff00ff', report, {
      must: true,
      effectColor: '#ff00ff',
    });
  } catch (error) {
    report.add('pixels [effectColor #ff00ff]', false, String(error.message || error));
  }

  /* --- B2. pixels: the silhouettes of the round shapes --- */
  try {
    await shapeChecks(page, decoder, url, report);
  } catch (error) {
    report.add('pixels [shapes]', false, String(error.message || error));
  }

  /* --- C. pass-through with real input --- */
  try {
    const withLayer = await passThrough(page, url, true);
    const without = await passThrough(page, url, false);
    const a = withLayer.read;
    const b = without.read;
    report.add(
      'input: a click on the button reaches it with a visible region',
      a.clicks >= 1 && a.clicks === b.clicks,
      `clicks with layer=${a.clicks}, without layer=${b.clicks}`,
    );
    report.add(
      'input: the wheel scrolls the page with a visible region',
      a.scrollY > 0 && Math.abs(a.scrollY - b.scrollY) <= 5,
      `scrollY with layer=${a.scrollY}, without layer=${b.scrollY}`,
    );
    report.add(
      'input: text selection works with a visible region',
      a.selection > 0 && a.selection === b.selection,
      `characters with layer=${a.selection}, without layer=${b.selection}`,
    );
    report.add(
      'input: Esc does not close our manual popover',
      withLayer.state && withLayer.state.topLayer === true && withLayer.state.visibility === 'visible',
      `topLayer=${withLayer.state && withLayer.state.topLayer}, visibility=${withLayer.state && withLayer.state.visibility}`,
    );
  } catch (error) {
    report.add('input pass-through', false, String(error.message || error));
  }

  /* --- C2. ::backdrop — does the invisible part of the top layer intercept input --- */
  try {
    await backdropChecks(report, browser, origin);
  } catch (error) {
    report.add('::backdrop: input', false, String(error.message || error));
  }

  /* --- D. real gesture with Alt --- */
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });
    await page.evaluate(() => window.__suite.life.begin());
    await page.keyboard.down('Alt');
    await page.mouse.move(300, 200);
    await page.mouse.down();
    await page.mouse.move(720, 560, { steps: 10 });
    await settle(page);
    const mid = await page.evaluate(() => window.__suite.life.layerState());
    await page.mouse.up();
    await settle(page);
    const end = await page.evaluate(() => window.__suite.life.layerState());
    await page.keyboard.up('Alt');
    const okGeom =
      mid &&
      Math.abs(mid.rect.x - 300) <= 2 &&
      Math.abs(mid.rect.y - 200) <= 2 &&
      Math.abs(mid.rect.width - 420) <= 2 &&
      Math.abs(mid.rect.height - 360) <= 2;
    report.add(
      'gesture: a real Alt+drag gives a 420×360 region at (300,200)',
      mid && mid.visibility === 'visible' && mid.topLayer === true && okGeom,
      mid
        ? `rect=${JSON.stringify(mid.rect)}, visibility=${mid.visibility}, topLayer=${mid.topLayer}`
        : 'there is no layer',
    );
    report.add(
      'gesture: after release the region disappeared, the layer stayed in the top layer',
      end && end.visibility === 'hidden' && end.topLayer === true,
      end ? `visibility=${end.visibility}, topLayer=${end.topLayer}` : 'there is no layer',
    );
  } catch (error) {
    report.add('real gesture with Alt', false, String(error.message || error));
  }

  /* --- E. destroy() in an intermediate state --- */
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });
    await page.evaluate(() => window.__suite.life.begin());
    await page.keyboard.down('Alt');
    await page.mouse.move(200, 200);
    await page.mouse.down();
    await page.mouse.move(600, 500, { steps: 6 });
    await settle(page);
    const during = await page.evaluate(() => window.__suite.life.layerState());
    const destroyed = await page.evaluate(() => window.__suite.life.destroy());
    await page.mouse.move(650, 520, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await settle(page);
    const after = await page.evaluate(() => ({
      layers: document.querySelectorAll('[data-visual-region-layer]').length,
      popovers: document.querySelectorAll(':popover-open').length,
      left: window.__suite.scene.state(),
    }));
    report.add(
      'destroy mid-gesture: the layer was visible before destroy',
      during && during.visibility === 'visible' && during.topLayer === true,
      during ? `visibility=${during.visibility}, topLayer=${during.topLayer}` : 'there is no layer',
    );
    report.add(
      'destroy mid-gesture: the DOM returned to its initial state',
      destroyed.sameHtml === true &&
        destroyed.nodes[0] === destroyed.nodes[1] &&
        destroyed.inlineStyles[0] === destroyed.inlineStyles[1],
      `sameHtml=${destroyed.sameHtml}, nodes=${JSON.stringify(destroyed.nodes)}, inline=${JSON.stringify(destroyed.inlineStyles)}`,
    );
    report.add(
      'destroy mid-gesture: after releasing the pointer the region did not appear',
      after.layers === 0 && after.popovers === 0 && after.left === null,
      `layers=${after.layers}, popover=${after.popovers}`,
    );
  } catch (error) {
    report.add('destroy mid-gesture', false, String(error.message || error));
  }

  /* --- F. enabling alone changes nothing --- */
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });
    await settle(page);
    const idleClip = { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height };
    const before = await shot(page, idleClip);
    const on = await page.evaluate(() => ({
      state: window.__suite.idle.on(),
      layers: document.querySelectorAll('[data-visual-region-layer]').length,
    }));
    await settle(page);
    const after = await shot(page, idleClip);
    const cmp = await compare(decoder, before, after, {
      boxes: [
        {
          label: 'viewport',
          ...imgBox({ x: 0, y: 0, w: VIEWPORT.width, h: VIEWPORT.height }),
          mode: 'unchanged',
        },
      ],
      tol: 0,
    });
    await page.evaluate(() => window.__suite.idle.off());
    report.add(
      'hygiene: an enabled instance without a region changes not a single pixel',
      cmp.boxes[0].ok && on.state === 'enabled' && on.layers === 1,
      `errMax=${cmp.boxes[0].errMax}, state=${on.state}, layers in DOM=${on.layers}`,
    );
  } catch (error) {
    report.add('enabling changes no pixels', false, String(error.message || error));
  }

  /* --- G. order in the top layer (observation) --- */
  if (HIDPI) {
    /* In HiDPI there are no pixel scenarios: from block G only the fact of
       mounting into the top layer and the exactness of the geometry are needed —
       that is DOM, not pixels. */
    try {
      await page.goto(url);
      await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });
      const dialog = await page.evaluate(() => window.__suite.topLayer.ourLayerThenSiteDialog());
      const two = await page.evaluate(() => window.__suite.topLayer.twoInstances());
      await page.evaluate(() => window.__suite.topLayer.cleanup());
      const geometry = two.layers.map((l, i) => ({ ...l, want: two.boxes[i] }));
      const exact = geometry.every(
        (g) =>
          g.topLayer &&
          Math.abs(g.rect.x - g.want.x) <= 0.5 &&
          Math.abs(g.rect.y - g.want.y) <= 0.5 &&
          Math.abs(g.rect.width - g.want.width) <= 0.5 &&
          Math.abs(g.rect.height - g.want.height) <= 0.5,
      );
      report.add(
        'HiDPI: two layers mount into the top layer at once with exact geometry',
        two.layers.length === 2 && two.layers.every((l) => l.topLayer) && exact,
        `our topLayer=${dialog.ourTopLayer}, visibility=${dialog.ourVisibility}, dialog open=${dialog.dialogOpen}; ` +
          `layers=${two.layers.length}, geometry=${exact ? 'matched' : JSON.stringify(geometry)}`,
      );
      await page.evaluate(() => window.__suite.scene.hide());
    } catch (error) {
      report.add('HiDPI: top layer (DOM)', false, String(error.message || error));
    }
  } else {
    try {
      await page.goto(url);
      await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });

      const dialogOver = await page.evaluate(() => window.__suite.topLayer.ourLayerThenSiteDialog());
      await settle(page);
      const ourState = await page.evaluate(() => window.__suite.scene.state());
      const dialogClip = toClip(dialogOver.box);
      const withRegion = await shot(page, dialogClip);
      await page.evaluate(() => window.__suite.scene.hide());
      await settle(page);
      const withoutRegion = await shot(page, dialogClip);
      if (withRegion && withoutRegion) {
        const cmp = await compare(decoder, withoutRegion, withRegion, {
          region: imgRect(dialogClip),
          tol: TOL,
        });
        report.note(
          'top layer: our layer is open → the site called showModal()',
          `fraction of inverted dialog pixels=${cmp.region.ratio} (1 — the dialog is under us and inverted, 0 — the dialog is above us)`,
        );
      }
      report.note(
        'top layer: our layer is open → the site called showModal() (state)',
        `our topLayer=${ourState && ourState.topLayer}, visibility=${ourState && ourState.visibility}, dialog open=${dialogOver.dialogOpen}`,
      );

      await page.goto(url);
      await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });
      const dialogFirst = await page.evaluate(() => window.__suite.topLayer.siteDialogThenOurLayer());
      await settle(page);
      const clip2 = toClip(dialogFirst.box);
      const withRegion2 = await shot(page, clip2);
      await page.evaluate(() => window.__suite.scene.hide());
      await settle(page);
      const dialogOnly = await shot(page, clip2);
      await page.evaluate(() => window.__suite.topLayer.cleanup());
      if (withRegion2 && dialogOnly) {
        const cmp = await compare(decoder, dialogOnly, withRegion2, {
          region: imgRect(clip2),
          tol: TOL,
        });
        report.note(
          'top layer: the site opened a dialog → then our layer',
          `fraction of inverted dialog pixels=${cmp.region.ratio} (1 — we are above and invert the dialog)`,
        );
      }

      await page.goto(url);
      await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });
      const popoverFirst = await page.evaluate(() => window.__suite.topLayer.ourLayerThenSitePopover());
      report.note(
        'top layer: our layer is open → the site called showPopover()',
        `our topLayer=${popoverFirst.ourTopLayer}, site popover open=${popoverFirst.sitePopoverOpen}, total open popovers=${popoverFirst.openCount}`,
      );

      await page.goto(url);
      await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });
      const sitePopoverFirst = await page.evaluate(() => window.__suite.topLayer.sitePopoverThenOurLayer());
      report.note(
        'top layer: the site opened a popover → then our layer',
        `our topLayer=${sitePopoverFirst.ourTopLayer}, site popover stayed open=${sitePopoverFirst.sitePopoverOpen}`,
      );

      await page.goto(url);
      await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });
      const two = await page.evaluate(() => window.__suite.topLayer.twoInstances());
      await settle(page);
      const overlap = {
        x: two.boxes[1].x + 8,
        y: two.boxes[1].y + 8,
        width: two.boxes[1].width - 16,
        height: two.boxes[1].height - 16,
      };
      const overlapClip = toClip(overlap);
      const both = await shot(page, overlapClip);
      await page.evaluate(() => window.__suite.scene.hide());
      await settle(page);
      const none = await shot(page, overlapClip);
      let overlapRatio = null;
      if (both && none) {
        const cmp = await compare(decoder, none, both, {
          region: imgRect(overlapClip),
          tol: TOL,
        });
        overlapRatio = cmp.region.ratio;
      }
      await page.evaluate(() => window.__suite.topLayer.cleanup());
      report.note(
        'top layer: two VisualRegion instances',
        `layers=${two.layers.length}, in top layer=${two.layers.filter((l) => l.topLayer).length}, ` +
          `overlap inversion ratio=${overlapRatio} (0 — double inversion restored the original)`,
      );
    } catch (error) {
      report.add('order in the top layer', false, String(error.message || error));
    }
  }

  /* --- H. CSP --- */
  if (HIDPI) {
    /* The CSP battery of the sources page is not repeated in HiDPI: the policy is
       about style delivery, not about scale. The dist check under CSP (block K) is
       performed in this profile — it is about the artifact. */
    report.note('CSP: sources page battery', 'was not run in the HiDPI profile (see the profile note)');
  } else {
    for (const [prefix, policy] of Object.entries(CSP_VARIANTS)) {
      try {
        const cspUrl = `${origin}${prefix}tests/smoke/page.html`;
        /* An index into consoleLines rather than an error count: otherwise lines
         from the previous run would land in the journal — errors are filtered, and
         the slice is taken by position. */
        const linesBefore = consoleLines.length;
        await page.goto(cspUrl);
        await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });
        const results = await page.evaluate(() => window.__suite.run());
        const failed = results.filter((r) => !r.ok);
        report.add(
          `CSP ${prefix}: the check battery passes (${policy})`,
          failed.length === 0,
          failed.length
            ? failed
                .map((f) => `${f.name}: ${f.detail}`)
                .slice(0, 2)
                .join(' | ')
            : `${results.length} checks`,
        );

        /* Before the positive control: the library must not complain in the console. */
        const cspErrors = consoleLines
          .slice(linesBefore)
          .filter((l) => l.type === 'error' && /content security policy|violates/i.test(l.text));
        report.add(
          `CSP ${prefix}: the library produced no CSP message in the console`,
          cspErrors.length === 0,
          cspErrors.length ? cspErrors[0].text.slice(0, 200) : 'clean',
        );

        const violations = await page.evaluate(() => window.__suite.violations());
        report.add(
          `CSP ${prefix}: the securitypolicyviolation journal from the library is empty`,
          violations.length === 0,
          violations.length ? JSON.stringify(violations.slice(0, 3)) : 'journal empty (auxiliary signal)',
        );

        /* Positive control: the policy must really block, otherwise all the checks
         above prove nothing. The proof is the effect (the attribute was not
         applied), not the journal: in Chromium the style attribute violates the
         policy without producing a securitypolicyviolation. */
        const errorsBeforeControl = consoleLines.length;
        const control = await page.evaluate(() => window.__suite.cspControl());
        const controlConsole = consoleLines.slice(errorsBeforeControl).filter((l) => l.type === 'error');
        report.add(
          `CSP ${prefix}: the policy is really enforced (the style attribute has no effect)`,
          control.policyEnforcedByEffect === true,
          `color from the style attribute = ${control.attrApplied} (expected "not applied"), ` +
            `console messages=${controlConsole.length}, securitypolicyviolation events=${control.violationsFromSetAttribute}`,
        );
        report.add(
          `CSP ${prefix}: a CSSOM write does not violate the policy and applies`,
          control.violationsFromCssom === 0 && control.cssomApplied === 'rgb(4, 5, 6)',
          `violations from CSSOM=${control.violationsFromCssom}, applied color=${control.cssomApplied}`,
        );

        const res = await inversionCheck(page, decoder, cspUrl, `CSP ${prefix}`, report, { must: true });
        if (res) report.note(`CSP ${prefix}: inversion`, `ratio=${res.ratio}, error=${res.errMax}`);
      } catch (error) {
        report.add(`CSP ${prefix}`, false, String(error.message || error));
      }
    }
  }

  /* --- I. legacy mounting: works, but warns --- */
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });
    const before = consoleLines.length;
    const res = await page.evaluate(() => window.__suite.legacyFixed());
    const warned = consoleLines.slice(before).some((l) => l.text.includes('legacy'));
    report.add(
      'legacy mount: enabled only by an explicit request, warns, does not enter the top layer',
      res.state === 'enabled' &&
        res.inTopLayer === false &&
        res.marker === 'fixed' &&
        res.afterDestroy === 0 &&
        warned,
      `state=${res.state}, inTopLayer=${res.inTopLayer}, marker=${res.marker}, ` +
        `layers after destroy=${res.afterDestroy}, warning=${warned}`,
    );
    report.add(
      'legacy mount: the legacy layer is not marked as an auto-init surface',
      res.marker === 'fixed',
      `data-visual-region-layer=${res.marker}`,
    );
  } catch (error) {
    report.add('legacy mount', false, String(error.message || error));
  }

  /* --- G2. scenario 4: several manual popovers at once --- */
  if (!HIDPI) {
    try {
      await page.goto(url);
      await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });
      const four = await page.evaluate(() => window.__suite.topLayer.severalManualPopovers());
      await settle(page);
      const overlapClip = toClip(four.overlap);
      const stripClip = toClip(four.stripA);
      const overlapWith = await shot(page, overlapClip);
      const stripWith = await shot(page, stripClip);
      await page.evaluate(() => window.__suite.scene.hide());
      await settle(page);
      const overlapWithout = await shot(page, overlapClip);
      const stripWithout = await shot(page, stripClip);
      await page.evaluate(() => window.__suite.topLayer.cleanup());

      if (four.setupOk && overlapWith && stripWith && overlapWithout && stripWithout) {
        /* Control — the same scene without our layer. In the overlap we expect 0
         (B entered the top layer after us and covers us), in the strip of A outside
         B — 1 (A entered before us, so we invert it). */
        const inOverlap = await compare(decoder, overlapWithout, overlapWith, {
          region: imgRect(overlapClip),
          tol: TOL,
        });
        const inStrip = await compare(decoder, stripWithout, stripWith, {
          region: imgRect(stripClip),
          tol: TOL,
        });
        report.note(
          'top layer: several manual popovers at once',
          `open popovers=${four.open.length} [${four.open.join(', ')}], entry order: A → our layer → B; ` +
            `in the overlap A∩B inverted=${inOverlap.region.ratio} (≈0 — B is above us), ` +
            `in the strip of A outside B=${inStrip.region.ratio} (≈1 — A is under us)`,
        );
      } else {
        report.note(
          'top layer: several manual popovers at once',
          `the measurement did not happen: setup=${four.setupOk}, overlap=${JSON.stringify(four.overlap)}, ` +
            `strip=${JSON.stringify(four.stripA)}`,
        );
      }
    } catch (error) {
      report.add('top layer: several manual popovers', false, String(error.message || error));
    }
  }

  /* --- G3. scenario 5: fullscreen with an active layer --- */
  if (!HIDPI) {
    try {
      await page.goto(url);
      await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });
      await page.evaluate(() => window.__suite.topLayer.fullscreenPrepare());
      /* A real click: without user activation requestFullscreen is rejected. */
      await page.click('#fullscreen-button');
      await settle(page);
      const fs = await page.evaluate(() => window.__suite.topLayer.fullscreenState());

      if (fs.fullscreenElement === null) {
        /* No eyeballed PASS: if we did not enter, we did not check. */
        report.note(
          'top layer: fullscreen with an active layer',
          `NOT TESTED: entering fullscreen did not happen in headless (${fs.error || 'the element did not become fullscreen'}) — ` +
            'the check goes to live browsers',
        );
      } else {
        const clip = toClip(fs.targetBox);
        const withRegion = await shot(page, clip);
        await page.evaluate(() => window.__suite.scene.hide());
        await settle(page);
        const withoutRegion = await shot(page, clip);
        let ratio = null;
        if (withRegion && withoutRegion) {
          const cmp = await compare(decoder, withoutRegion, withRegion, {
            region: imgRect(clip),
            tol: TOL,
          });
          ratio = cmp.region.ratio;
        }
        report.note(
          'top layer: fullscreen with an active layer',
          `fullscreen element=${fs.fullscreenElement}, our layer in the top layer=${fs.ourTopLayer}; ` +
            `fraction of inverted fullscreen region pixels=${ratio} (0 — fullscreen is above us)`,
        );
      }
      await page.evaluate(() => window.__suite.topLayer.fullscreenExit());
    } catch (error) {
      report.add('top layer: fullscreen', false, String(error.message || error));
    }
  }

  /* --- P. performance: three separate measurements --- */
  if (!HIDPI) {
    try {
      await page.goto(url);
      await page.waitForFunction(() => window.__suite && window.__suite.ready, null, { timeout: 20000 });

      const cdp = await cdpMetrics(page);

      /* Control: the same gesture on the same page without the library. */
      const controlBefore = cdp ? await cdp.read() : null;
      const control = await dragRecorded(page);
      const controlAfter = cdp ? await cdp.read() : null;

      await page.evaluate(() => window.__suite.perf.arm());
      const withBefore = cdp ? await cdp.read() : null;
      const withLayer = await dragRecorded(page);
      const withAfter = cdp ? await cdp.read() : null;
      const leftLayers = await page.evaluate(() => window.__suite.perf.disarm());
      if (cdp) await cdp.close();

      report.note(
        'performance: gesture frames and the control without the library',
        `with the library: ${JSON.stringify(withLayer)}; without the library: ${JSON.stringify(control)}`,
      );

      if (withLayer.count < MIN_FRAMES || control.count < MIN_FRAMES) {
        /* Not a "PASS by default": too few frames is not a measurement.
         The threshold is on the number of frames, not on fps: fps in headless
         saturates at 60 Hz and barely distinguishes runs. */
        report.add(
          'performance: gesture frames were measured',
          false,
          `frames below the threshold ${MIN_FRAMES}: with library=${withLayer.count}, without=${control.count}`,
        );
      } else {
        /* A relative threshold: the absolute FPS in headless depends on the machine
         and the load, while "no worse than half the control" survives a slow CI too.
         No layers were left after the gesture — otherwise the frame count would be
         measuring a leak. */
        const ratio = withLayer.fps / control.fps;
        report.add(
          'performance: gesture smoothness does not degrade relative to the control',
          leftLayers === 0 && ratio >= 0.5,
          `fps with library=${withLayer.fps} (${withLayer.count} frames), without=${control.fps} ` +
            `(${control.count} frames), ratio=${ratio.toFixed(2)}, ` +
            `long frames >32 ms=${withLayer.long32}, >50 ms=${withLayer.long50}, layers left=${leftLayers}`,
        );
      }

      const updates = await page.evaluate(() => window.__suite.perf.regionUpdates(500));
      const cycles = await page.evaluate(() => window.__suite.perf.createDestroyCycles(200));
      report.note(
        'performance: our JS (our timer)',
        `programmatic region update: ${updates.perUpdate} µs each (${updates.total} ms for ${updates.n}); ` +
          `create→destroy instance cycle: ${cycles.perCycle} µs each (${cycles.total} ms for ${cycles.n})`,
      );

      if (cdp && controlBefore && controlAfter && withBefore && withAfter) {
        report.note(
          'performance: Chromium engine counters (CDP, not our timer)',
          `per gesture: script=${ms(withBefore, withAfter, 'ScriptDuration').toFixed(1)} ms, ` +
            `recalcStyle=${ms(withBefore, withAfter, 'RecalcStyleDuration').toFixed(1)} ms, ` +
            `layout=${ms(withBefore, withAfter, 'LayoutDuration').toFixed(1)} ms, ` +
            `task=${ms(withBefore, withAfter, 'TaskDuration').toFixed(1)} ms; ` +
            `control: script=${ms(controlBefore, controlAfter, 'ScriptDuration').toFixed(1)} ms, ` +
            `layout=${ms(controlBefore, controlAfter, 'LayoutDuration').toFixed(1)} ms`,
        );
      } else {
        report.note(
          'performance: render cost by profiler',
          `NOT MEASURED in this engine: CDP counters are available only in Chromium. ` +
            'An absolute compositing profile — a live device',
        );
      }
    } catch (error) {
      report.add('performance', false, String(error.message || error));
    }
  }

  /* --- J. cleanup: the page is in its initial state --- */
  try {
    const clean = await page.evaluate(() => {
      const snap = window.__suite.snapshot();
      return {
        layers: document.querySelectorAll('[data-visual-region-layer]').length,
        popovers: snap.popovers,
        nodes: snap.nodes,
      };
    });
    report.add(
      'summary: after all checks the page has no nodes of ours and no open popovers',
      clean.layers === 0 && clean.popovers === 0,
      JSON.stringify(clean),
    );
  } catch (error) {
    report.add('final cleanup', false, String(error.message || error));
  }

  /* --- K. built package: ESM import and a plain <script> --- */
  await distChecks(page, decoder, origin, report);
  /* The same scenario on the `/csp-dist/` route: the document is served under
     `default-src 'self'; style-src 'self'; style-src-attr 'none'`, and the
     production artifact from `dist/` is loaded, not the `src` build in `.tmp-build`. */
  await distChecks(page, decoder, origin, report, { prefix: '/csp-dist' });

  await browser.close();
}

/* ------------------------- K. the built package in a real browser -------- */

/**
 * Scenarios of loading the built `dist/` — what cannot be checked in the sources:
 * an ESM import and a plain `<script>`. We check in the browser because "the import
 * is clean" and "the global variable appeared" are statements about actually loading
 * the module, not about the text of a file.
 *
 * Requires a prior `npm run build` (the `dist/` files).
 */
async function distChecks(page, decoder, origin, report, opts = {}) {
  if (!fsSync.existsSync(path.join(ROOT, 'dist', 'index.js'))) {
    report.add('dist: build is present', false, 'no dist/index.js — run npm run build');
    return;
  }

  /* The same scenarios are run twice: on the normal route and on `/csp-dist/`,
     where the document is served under `default-src 'self'; style-src 'self'; style-src-attr 'none'`.
     The second run is exactly the check "the production artifact works under strict
     CSP"; it needs no separate set of checks, names are shifted by the prefix. */
  const prefix = opts.prefix || '';
  const title = (s) => (prefix === '' ? s : `CSP (dist): ${s}`);
  const url = `${origin}${prefix}/tests/smoke/dist.html`;

  /* Its own console journal and response header: the CSP checks below refer to this
     very run, while the runner's shared journal is shared for the whole page. The
     listeners are removed at the end — the page is reused by the following blocks. */
  const localConsole = [];
  const onConsole = (m) => localConsole.push({ type: m.type(), text: m.text() });
  page.on('console', onConsole);
  let policyHeader = null;
  /* The journal length right after the positive control (see CSP part #1). */
  let journalAfterControl = 0;
  const onResponse = (r) => {
    if (r.url() === url) policyHeader = r.headers()['content-security-policy'] || null;
  };
  page.on('response', onResponse);

  await page.goto(url);
  await page.waitForFunction(() => window.__dist !== undefined, null, { timeout: 20000 });

  /* The screenshots of this run are counted: under the policy they themselves leave
     a trace in the violation journal (see CSP part #2), and the price of that trace
     must be known exactly. */
  const shots = { n: 0 };
  const takeShot = async (clip) => {
    const data = await shot(page, clip);
    if (data !== null) shots.n++;
    return data;
  };

  /* --- ESM --- */
  const esm = await page.evaluate(() => window.__dist.esm);
  report.add(
    title('dist ESM: importing `dist/index.js` gives the expected exports'),
    esm.hasClass &&
      ['VisualRegion', 'autoInit', 'init', 'supported', 'visualRegion'].every((n) => esm.exports.includes(n)),
    esm.exports.join(', '),
  );
  report.add(
    title('dist ESM: the import created nothing on the page (clean entry)'),
    esm.layersAfterImport === 0,
    `layers after import: ${esm.layersAfterImport}`,
  );

  /* --- a plain <script> --- */
  const tag = await page.evaluate(async () => {
    const script = document.createElement('script');
    script.src = '/dist/visual-region.global.js';
    const loaded = new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => reject(new Error('failed to load'));
    });
    document.head.appendChild(script);
    await loaded;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return {
      globalName: typeof window.VisualRegion,
      exports: window.VisualRegion ? Object.keys(window.VisualRegion).sort() : [],
      hasFactory: typeof window.VisualRegion?.visualRegion === 'function',
      supported: window.VisualRegion?.supported,
      /* Auto-initialization: the page has data-visual-region markup — the IIFE must
         pick it up itself, without a single line of user code. */
      autoInstances: document.querySelectorAll('[data-visual-region-layer]').length,
    };
  });
  report.add(
    title('dist <script>: the global variable VisualRegion appeared'),
    tag.globalName === 'object' && tag.hasFactory,
    `typeof VisualRegion = ${tag.globalName}, exports: ${tag.exports.join(', ')}`,
  );
  report.add(
    title('dist <script>: auto-initialization picked up the data-visual-region markup'),
    tag.autoInstances === 1,
    `layers after loading the IIFE: ${tag.autoInstances}`,
  );

  /* --- the effect through the built package: pixels --- */
  /* The reference point for the cleanup check: the page already has auto-initialization,
     but not our programmatic region. */
  const base = await page.evaluate(() => window.__dist.page());
  const geo = await page.evaluate(() => {
    const r = document.getElementById('probe').getBoundingClientRect();
    const out = document.getElementById('outside').getBoundingClientRect();
    return {
      probe: { x: r.x, y: r.y, width: r.width, height: r.height },
      outside: { x: out.x, y: out.y, width: out.width, height: out.height },
    };
  });
  const region = {
    x: geo.probe.x + 8,
    y: geo.probe.y + 8,
    width: geo.probe.width - 16,
    height: geo.probe.height - 16,
  };
  const clipIn = toClip(region);
  const clipOut = toClip(geo.outside);

  /* ---------------------------------------------------------------------
   * CSP part #1 — verdicts about the library. They are read HERE, before the
   * first screenshot, and that is not a quibble about line order.
   *
   * Measured (a probe under the same policy): in WebKit EVERY `page.screenshot()`
   * on a document under `style-src 'self'` adds exactly one `style-src-elem`
   * "inline" violation — and adds it to a page where the library was never loaded
   * at all (`styles: 0`, no source, `sample` empty: it is the tool's own internal
   * sheet). Chromium and Firefox add nothing. A check reading the journal after the
   * pixel part would blame the library for the tool — while a check reading it before
   * the screenshots asserts exactly what is needed: under this policy the library
   * violates nothing. The price of the screenshots is subtracted separately below,
   * in part #2.
   * ------------------------------------------------------------------- */
  if (prefix !== '') {
    /* A life→death cycle WITHOUT screenshots: the region is created, becomes
       visible, is removed — all under the policy. */
    const cycle = await page.evaluate((b) => {
      const before = window.__dist.page();
      const vr = window.VisualRegion.visualRegion();
      const ok = vr.setRegion(b);
      const state = vr.state;
      const visible = vr.element ? getComputedStyle(vr.element).visibility : null;
      vr.destroy();
      const after = window.__dist.page();
      return { ok, state, visible, before, after, violations: window.__dist.violations() };
    }, region);

    report.add(
      "CSP (dist): the document is served with the policy style-src 'self'; style-src-attr 'none'",
      typeof policyHeader === 'string' &&
        policyHeader.includes("style-src 'self'") &&
        policyHeader.includes("style-src-attr 'none'"),
      `content-security-policy: ${policyHeader ?? 'no header'}`,
    );

    /* The artifact, not the sources: we look at which JS the document actually loaded. */
    const loaded = esm.scripts || [];
    const fromDist = loaded.filter((n) => /\/dist\//.test(n));
    report.add(
      'CSP (dist): the production artifact from `dist/` is loaded, not the `src` build',
      fromDist.length > 0 && !loaded.some((n) => n.includes('.tmp-build')),
      fromDist.length ? fromDist.map((n) => n.split('/').pop()).join(', ') : loaded.join(', '),
    );

    report.add(
      'CSP (dist): the library creates a region, it is in the top layer and visible',
      cycle.ok === true && cycle.state === 'enabled' && cycle.visible === 'visible',
      `setRegion=${cycle.ok}, state=${cycle.state}, layer visibility=${cycle.visible}`,
    );
    report.add(
      'CSP (dist): destroy returns the page exactly to the state before the region',
      cycle.after.layers === cycle.before.layers &&
        cycle.after.popovers === cycle.before.popovers &&
        cycle.after.nodes === cycle.before.nodes &&
        cycle.after.inlineStyles === cycle.before.inlineStyles,
      `layers ${cycle.before.layers} → ${cycle.after.layers}, popovers ${cycle.before.popovers} → ${cycle.after.popovers}, ` +
        `nodes ${cycle.before.nodes} → ${cycle.after.nodes}, inline ${cycle.before.inlineStyles} → ${cycle.after.inlineStyles}`,
    );

    const cspConsole = localConsole.filter(
      (l) => l.type === 'error' && /content security policy|violates/i.test(l.text),
    );
    report.add(
      'CSP (dist): the library produced no CSP message in the console',
      cspConsole.length === 0,
      cspConsole.length
        ? cspConsole[0].text.slice(0, 200)
        : 'clean (a snapshot before the first screenshot, see the comment)',
    );
    report.add(
      'CSP (dist): the securitypolicyviolation journal from the library is empty',
      cycle.violations.length === 0,
      cycle.violations.length
        ? JSON.stringify(cycle.violations.slice(0, 3))
        : 'journal empty (auxiliary signal)',
    );

    /* Positive control: without it "no violations" proves nothing — the proof is
       built on the effect (the style attribute was not applied). */
    const control = await page.evaluate(() => window.__dist.cspControl());
    report.add(
      'CSP (dist): the policy is really enforced (the style attribute has no effect)',
      control.policyEnforcedByEffect === true,
      `color from the style attribute = ${control.attrApplied} (expected "not applied"), ` +
        `securitypolicyviolation events=${control.violationsFromSetAttribute}`,
    );
    report.add(
      'CSP (dist): a CSSOM write does not violate the policy and applies',
      control.violationsFromCssom === 0 && control.cssomApplied === 'rgb(4, 5, 6)',
      `violations from CSSOM=${control.violationsFromCssom}, applied color=${control.cssomApplied}`,
    );

    /* The control is not free: its forbidden style attribute lands in the journal
       itself (source — `dist-page.js`, the setAttribute line). We read the journal
       length in a separate evaluate, that is, in the next task, when the deferred
       violation record has definitely been delivered. Further on (part #2) exactly
       this measured value is subtracted from the remaining journal. */
    journalAfterControl = (await page.evaluate(() => window.__dist.violations())).length;
    report.note(
      'CSP (dist): the price of the positive control in the journal',
      `${journalAfterControl} records (the control's own forbidden style attribute; the library — 0)`,
    );
  }

  const beforeIn = await takeShot(clipIn);
  const beforeOut = await takeShot(clipOut);

  const created = await page.evaluate((b) => {
    const vr = window.VisualRegion.visualRegion();
    const ok = vr.setRegion(b);
    window.__distRegion = vr;
    return {
      ok,
      state: vr.state,
      layerInTopLayer: document.querySelectorAll('[data-visual-region-layer]:popover-open').length,
    };
  }, region);
  await settle(page);

  const afterIn = await takeShot(clipIn);
  const afterOut = await takeShot(clipOut);

  const cmpIn = await compare(decoder, beforeIn, afterIn, {
    boxes: [{ label: 'inside', ...insetInClip(region, clipIn, 0.2), mode: 'complement' }],
    region: imgRect(clipIn),
    tol: TOL,
  });
  const cmpOut = await compare(decoder, beforeOut, afterOut, {
    boxes: [{ label: 'outside', ...insetInClip(geo.outside, clipOut, 0.25), mode: 'unchanged' }],
    tol: TOL,
  });

  report.add(
    title('dist: the programmatic region from the IIFE build inverts the content'),
    created.ok && cmpIn.boxes[0].ok,
    `state=${created.state}, errMax=${cmpIn.boxes[0].errMax}, ratio=${cmpIn.region.ratio}`,
  );
  report.add(
    title('dist: nothing changed outside the region'),
    cmpOut.boxes[0].ok,
    `errMax=${cmpOut.boxes[0].errMax}`,
  );

  /* Cleanup: destroy must return the page to the state BEFORE the region was created.
     The reference point is the snapshot right after the IIFE loaded: the
     auto-initialization instance with its layer is already there (expected and
     unrelated to our region), so after destroy the page must match exactly that,
     not an empty page. */
  const clean = await page.evaluate((base) => {
    window.__distRegion?.destroy();
    const done = window.__dist.page();
    return { base, after: done };
  }, base);
  report.add(
    title('dist: destroy removes the region and returns the page to the auto-initialization state'),
    clean.after.layers === clean.base.layers &&
      clean.after.popovers === clean.base.popovers &&
      clean.after.nodes === clean.base.nodes &&
      clean.after.inlineStyles === clean.base.inlineStyles,
    `layers ${clean.base.layers} → ${clean.after.layers}, open popovers ${clean.base.popovers} → ${clean.after.popovers}, ` +
      `nodes ${clean.base.nodes} → ${clean.after.nodes}, inline styles ${clean.base.inlineStyles} → ${clean.after.inlineStyles}`,
  );

  /* ---------------------------------------------------------------------
   * CSP part #2 — journal bookkeeping. The verdicts about the library have already
   * been taken above, before the first screenshot; here we check that EVERYTHING
   * left in the journal by the end of the run is explained by two known sources:
   * the positive control (its forbidden style attribute) and the tool's own
   * screenshots. Neither belongs to the library.
   *
   * Both prices are not invented. The control was measured in part #1
   * (`journalAfterControl`), the price of a screenshot is measured right here, with
   * an extra screenshot at the end of the run. Separately and independently of the
   * arithmetic, the main thing is checked: among the records there is not one whose
   * source is a library file. The arithmetic can drift from a foreign trace, this
   * check cannot.
   * ------------------------------------------------------------------- */
  if (prefix !== '') {
    const records = await page.evaluate(() => window.__dist.violations());
    const v0 = records.length;
    const shotsBefore = shots.n;
    await takeShot({ x: 0, y: 0, width: 40, height: 40 });
    const v1 = (await page.evaluate(() => window.__dist.violations())).length;
    const perShot = v1 - v0;
    const expected = journalAfterControl + perShot * shotsBefore;
    const fromLibrary = records.filter((r) => /(^|\/)dist\//.test(String(r.source || '')));

    report.add(
      'CSP (dist): no journal record points at a library file',
      fromLibrary.length === 0,
      fromLibrary.length
        ? JSON.stringify(fromLibrary.slice(0, 3))
        : `${v0} records in total, none references \`/dist/\``,
    );
    report.add(
      'CSP (dist): the whole journal is explained by the control and the screenshots, not the library',
      v0 === expected,
      `violations after the pixel part=${v0}, positive control=${journalAfterControl}, ` +
        `screenshots in the run=${shotsBefore}, price of one screenshot in this engine=${perShot}, ` +
        `expected=${expected}` +
        (perShot > 0
          ? ' (in this engine a screenshot under style-src itself gives style-src-elem "inline")'
          : '') +
        (v0 === expected ? '' : `; journal: ${JSON.stringify(records.slice(0, 5))}`),
    );
  }

  page.off('console', onConsole);
  page.off('response', onResponse);
}

/* ------------------------------------------------------------------ main -- */

async function main() {
  await fs.mkdir(OUT, { recursive: true });
  console.log('— build and static scan —');
  const buildReport = makeReport('build');
  await scanSources(buildReport);
  const built = build(buildReport);
  if (!built) process.exitCode = 1;

  const playwright = await loadPlaywright();
  const server = await startServer(ROOT, PORT);
  const origin = server.origin;
  const environment = environmentInfo();
  console.log(
    `— run environment: node ${environment.node}, playwright ${environment.playwright ?? 'version not determined'}, ${environment.platform}, DPR=${DPR} —`,
  );
  const all = {
    startedAt: new Date().toISOString(),
    origin,
    dpr: DPR,
    environment,
    browsers: {},
  };
  const summary = {};
  try {
    for (const name of WANTED) {
      if (!playwright[name]) {
        console.log(`\n=== ${name}: no such browser in playwright ===`);
        continue;
      }
      console.log(`\n=== ${name} ===`);
      const report = makeReport(name);
      try {
        await runBrowser(report, playwright, name, origin);
      } catch (error) {
        report.add('engine as a whole', false, String(error.message || error));
      }
      all.browsers[name] = { version: report.version || null, items: report.items };
      for (const item of report.items) {
        if (item.ok === null) continue;
        const key = item.name;
        summary[key] = summary[key] || {};
        summary[key][name] = item.ok ? 'PASS' : 'FAIL';
      }
    }
  } finally {
    await server.close();
  }

  const names = Object.keys(all.browsers);
  console.log('\n=== summary by engine ===');
  const rows = [];
  for (const [key, byBrowser] of Object.entries(summary)) {
    const fails = names.filter((n) => byBrowser[n] === 'FAIL');
    rows.push({ key, fails, byBrowser });
  }
  const bad = rows.filter((r) => r.fails.length > 0);
  for (const row of rows) {
    const marks = names.map((n) => `${n}:${row.byBrowser[n] || '—'}`).join('  ');
    console.log(`  ${marks}  ${row.key}`);
  }
  console.log(
    bad.length === 0
      ? `\nRESULT: ${rows.length} checks passed in all engines (${names.join(', ')})`
      : `\nRESULT: ${bad.length} checks failed: ${bad.map((b) => `${b.key} [${b.fails.join(',')}]`).join('; ')}`,
  );

  /* Where to put the machine-readable result.
     By default — in `out/` under a dated name: it is a temporary file, it is not
     committed (every local run must not leave a trace in history).
     The canonical baseline goes by an explicit SMOKE_OUT: it has a stable name, and
     it is rewritten only when a baseline is really accepted.
     In CI, `out/` is uploaded as an artifact on failure. */
  const file = process.env.SMOKE_OUT
    ? path.resolve(ROOT, process.env.SMOKE_OUT)
    : path.join(
        OUT,
        `results-${new Date().toISOString().replace(/[:.]/g, '-')}${HIDPI ? `-dpr${DPR}` : ''}.json`,
      );
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ ...all, summary }, null, 2));
  console.log(`\ndetails → ${path.relative(ROOT, file)}`);
  if (bad.length > 0) process.exitCode = 1;
}

await main();
