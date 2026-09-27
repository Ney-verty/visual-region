/*
 * Screenshot for the README. Not a check — a tool: it takes a frame and produces
 * NUMERICAL proof that the frame contains what it is made for.
 *
 * Why a separate script instead of a "manual snapshot": the README shows the image
 * as evidence that the library works, so it must have verifiable properties rather
 * than the author's impression.
 *
 * What the frame must achieve:
 *   1. the top is the edge of the playground, not a cropped line of the page above
 *      it;
 *   2. the bottom is the natural gap between grid rows, nothing is cut in the middle
 *      (in particular, the SVG figure fits entirely);
 *   3. the region crosses SEVERAL kinds of content: part of the text and part of the
 *      canvas, with part of that same canvas left outside the region. This way
 *      before/transformed is visible on a single object, and it is visible that the
 *      library works with more than text.
 * That is why both the frame and the region are built from the geometry of the demo
 * elements rather than from eyeballed margins: the offsets below are the only
 * numbers, and they are labelled.
 *
 * The tools are existing ones; we do not introduce our own:
 *   - server: tests/lib/server.mjs (it also serves the decoder);
 *   - pixel comparison: tests/lib/pixel.js through tests/lib/decoder.html — the same
 *     comparator as in smoke and examples, so "inversion" here means exactly what it
 *     means there and does not become a home-grown "similar/not similar".
 *
 * The frame is taken from the FINAL demo, on a real gesture: persistent is turned
 * on, the pointer is dragged across the playground and released — the region stays,
 * as the option promises. A programmatic setRegion() would give the same pixels but
 * would not show the path the library exists for.
 *
 * Run: npm run shot:readme   (requires npm run build)
 * Output: assets/demo-invert.png + check numbers on stdout; exit code 1 on failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../tests/lib/server.mjs';

/* The only script in scripts/ that also executes code in the page (page.evaluate
   callbacks), so the browser names are declared here rather than for the whole
   scripts/ set: the premise "scripts/ is Node without DOM" stays true for the build
   and the checks. Exactly the names that appear in the callbacks are listed. */
/* global document, getComputedStyle, window */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'assets', 'demo-invert.png');
const PORT_BASE = Number(process.env.SHOT_PORT || 4400);
const VIEWPORT = { width: 1280, height: 900 };

/* The markup of this very demo. The tool captures it and only it, so it relies on
   its classes directly: there is nothing to generalise to other pages. */
const DEMO = {
  panel: '#playground',
  cell: '.pg-col',
  canvas: '#chart',
  svg: '.pg-col svg',
  /* The "drag here" hint is absolutely positioned and sits about 11 px ABOVE the
     playground's edge. A frame at the playground edge clipped its top, so the top of
     the frame is measured from the hint rather than from the panel. */
  hint: '#playground .zone-hint',
};

/* Headroom above the hint, px (review: 10–15). */
const AIR = 12;

/* The region geometry relative to the canvas box — the only offsets in the script.
   region.left = canvas.left - 214: we reach left into the text column (its right
   edge is canvas.left - 20), so the region covers text too.
   region.right = canvas.right - 84, region.bottom = canvas.bottom - 14,
   region.top = canvas.top + 6: the canvas stays partly outside on all three sides,
   so both the inverted and the original are visible within a single object. */
const REACH = { left: 214, top: 6, right: 84, bottom: 14 };

/* The threshold for "the region really covers the element", px². A smaller value
   would mean a touch rather than an intersection. */
const OVERLAP_MIN = 5000;

/* The same constants as in tests/examples/checks.mjs, and for the same reason: a
   rasterisation fringe lies on the region's very edge (tests/smoke/BASELINE.md), so
   a "pixel on the boundary" check would test that rather than the inversion. */
const TOL = 3;
const INSET = 6;
const REGION_RATIO = 0.9;

let failures = 0;
const ok = (name, detail = '') => console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
const fail = (name, detail = '') => {
  failures += 1;
  console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
};
const check = (cond, name, detail = '') => (cond ? ok(name, detail) : fail(name, detail));

async function startOnFreePort(root, from) {
  for (let port = from; port < from + 20; port++) {
    try {
      return await startServer(root, port);
    } catch (error) {
      if (error?.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error(`ports ${from}–${from + 19} are busy — free one by hand, we do not touch other processes`);
}

if (!fs.existsSync(path.join(ROOT, 'dist', 'index.js'))) {
  console.error('no dist/index.js — the demo links the built package. Run: npm run build');
  process.exit(1);
}

const round = (n) => Math.round(n);
const overlap = (a, b) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/* Reads the demo layout: the playground, the hint, the grid cells, the canvas and the svg. */
const readLayout = (page) =>
  page.evaluate(
    ({ panelSel, cellSel, canvasSel, svgSel, hintSel }) => {
      const box = (el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      };
      const panel = document.querySelector(panelSel);
      return {
        panel: box(panel),
        hint: box(document.querySelector(hintSel)),
        canvas: box(document.querySelector(canvasSel)),
        svg: box(document.querySelector(svgSel)),
        cells: [...panel.querySelectorAll(cellSel)].map((el) => ({
          ...box(el),
          text: el.querySelector('p') !== null,
          canvas: el.querySelector('canvas') !== null,
        })),
      };
    },
    {
      panelSel: DEMO.panel,
      cellSel: DEMO.cell,
      canvasSel: DEMO.canvas,
      svgSel: DEMO.svg,
      hintSel: DEMO.hint,
    },
  );

/* Elements with their own text whose box crosses the horizontal line y and also
   falls within the frame's horizontal range: their top or bottom would end up under
   the crop, that is, the frame would contain half a line. Text outside the frame in
   x is not counted — it does not get into the frame. */
const slicedText = (page, y, xFrom, xTo) =>
  page.evaluate(
    (o) => {
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
        if (!own) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.top < o.line && r.bottom > o.line && r.right > o.xFrom && r.left < o.xTo) {
          out.push(
            `${el.tagName.toLowerCase()}.${String(el.className)} "${(el.textContent ?? '').trim().slice(0, 24)}" ${Math.round(r.top)}…${Math.round(r.bottom)}`,
          );
        }
      }
      return out;
    },
    { line: y, xFrom, xTo },
  );

/* The top of the frame: AIR px above the hint, but at the nearest clean horizontal
   line — one that no text line within the frame's range crosses. Otherwise the
   "headroom" itself would cut a neighbouring paragraph: the section note ends 5 px
   before the hint, so the requested 12 px landed right in its last line. */
const cleanTop = (page, { xFrom, xTo, hintTop }) =>
  page.evaluate(
    (o) => {
      const boxes = [];
      for (const el of document.querySelectorAll('body *')) {
        const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '');
        if (!own) continue;
        const r = el.getBoundingClientRect();
        if (r.height > 0 && r.right > o.xFrom && r.left < o.xTo) boxes.push([r.top, r.bottom]);
      }
      const start = Math.round(o.hintTop - o.air);
      for (let y = start; y < o.hintTop; y += 1) {
        if (!boxes.some(([top, bottom]) => top < y && bottom > y)) return { y, air: o.hintTop - y };
      }
      return { y: start, air: o.hintTop - start };
    },
    { xFrom, xTo, hintTop, air: AIR },
  );

const rowTops = (layout) => [...new Set(layout.cells.map((c) => round(c.top)))].sort((a, b) => a - b);

/* The frame height does not depend on scrolling (both ends of the frame shift
   together), so it can be computed before scrolling — and the frame centred in the
   window. */
function frameHeightOf(layout) {
  const rows = rowTops(layout);
  if (rows.length < 2) return { error: `the demo grid has ${rows.length} row(s), expected two` };
  return { height: rows[1] - round(layout.panel.top) };
}

/* The frame and the region from the layout read. The frame: the whole playground in
   width, the top is the chosen clean horizontal line above the hint, the bottom is
   the top of the second grid row (the gap between rows). */
function frameOf(layout, top) {
  const rows = rowTops(layout);
  if (rows.length < 2) return { error: `the demo grid has ${rows.length} row(s), expected two` };
  const first = layout.cells.filter((c) => round(c.top) === rows[0]);
  const panel = {
    left: round(layout.panel.left),
    top: round(layout.panel.top),
    right: round(layout.panel.right),
  };
  const hintTop = round(layout.hint.top);
  const clip = {
    x: panel.left,
    y: Math.max(0, top),
    width: panel.right - panel.left,
    height: rows[1] - Math.max(0, top),
  };
  if (
    clip.x < 0 ||
    clip.y < 0 ||
    clip.x + clip.width > VIEWPORT.width ||
    clip.y + clip.height > VIEWPORT.height
  ) {
    return {
      error: `the frame ${JSON.stringify(clip)} does not fit in the viewport ${VIEWPORT.width}×${VIEWPORT.height}`,
    };
  }
  const canvas = {
    left: round(layout.canvas.left),
    top: round(layout.canvas.top),
    right: round(layout.canvas.right),
    bottom: round(layout.canvas.bottom),
  };
  const region = {
    left: canvas.left - REACH.left,
    top: canvas.top + REACH.top,
    right: canvas.right - REACH.right,
    bottom: canvas.bottom - REACH.bottom,
  };
  return {
    clip,
    canvas,
    region: { ...region, width: region.right - region.left, height: region.bottom - region.top },
    rowGapTop: rows[1],
    firstRowBottom: round(Math.max(...first.map((c) => c.bottom))),
    textCell: first.find((c) => c.text && !c.canvas) ?? null,
    hint: { top: hintTop, bottom: round(layout.hint.bottom) },
    panelTop: panel.top,
    svg: {
      left: round(layout.svg.left),
      top: round(layout.svg.top),
      right: round(layout.svg.right),
      bottom: round(layout.svg.bottom),
    },
  };
}

const server = await startOnFreePort(ROOT, PORT_BASE);
const { chromium } = await import('playwright');
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const page = await context.newPage();
const decoder = await context.newPage();

try {
  await decoder.goto(`${server.origin}/tests/lib/decoder.html`);
  await page.goto(`${server.origin}/demo/`, { waitUntil: 'load' });
  await page.waitForSelector(DEMO.panel, { timeout: 15_000 });

  /* Page errors are part of the proof: a frame with an exception in the console is no good. */
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error.message)));

  /* 1. persistent: otherwise the region disappears on release and there is no frame. */
  await page.check('#opt-persistent');

  /* 2. Scrolling: the frame must fit entirely in the viewport, otherwise it would
        have to be cropped at the window edge. The frame height does not depend on
        scrolling, so we compute it before scrolling and centre the frame. */
  const before = await readLayout(page);
  const sizing = frameHeightOf(before);
  if (sizing.error) throw new Error(sizing.error);
  await page.evaluate(
    (dy) => window.scrollBy(0, dy),
    round(before.panel.top + sizing.height / 2 - VIEWPORT.height / 2),
  );
  await page.waitForTimeout(80);

  const layout = await readLayout(page);
  const xRange = { xFrom: Math.round(layout.panel.left), xTo: Math.round(layout.panel.right) };
  const top = await cleanTop(page, { ...xRange, hintTop: layout.hint.top });
  const frame = frameOf(layout, top.y);
  if (frame.error) throw new Error(frame.error);
  const { clip, region, canvas, svg } = frame;
  /* The horizontal line of the frame's top edge must not fall into someone's line of
     text: otherwise the frame would contain half of it. It is checked across the
     whole page (within the frame's horizontal range), even though the chosen line is
     already clean. */
  const sliced = await slicedText(page, clip.y, xRange.xFrom, xRange.xTo);
  if (frame.textCell === null)
    throw new Error('the first demo row has no text cell — the frame would be taken without text');

  /* 3. A real gesture: the pointer travels along the region's diagonal and is released. */
  await page.mouse.move(region.left, region.top);
  await page.mouse.down();
  await page.mouse.move(region.right, region.bottom, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(120);

  /* 4. We do not look for the layer as "the first in the document": the demo has two
        instances (the main one and the markup one in the "Connecting" section), and
        querySelector would return the wrong, empty one. The sign of the right one is
        being the only VISIBLE layer: an instance without a region hides its layer via
        visibility. */
  const layer = await page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return {
            x: r.x,
            y: r.y,
            width: r.width,
            height: r.height,
            hidden: getComputedStyle(el).visibility === 'hidden',
          };
        })
        .filter((l) => !l.hidden && l.width > 0 && l.height > 0),
    '[data-visual-region-layer]',
  );
  if (layer.length !== 1) {
    fail('the gesture created a region', `${layer.length} visible layers, expected one`);
    throw new Error('no region');
  }

  /* 5. Two frames of the same place: with the region and without it. The difference
        between them is the measurement — otherwise "inversion" would have to be judged
        by eye. */
  const withRegion = (await page.screenshot({ clip, type: 'png' })).toString('base64');
  await page.click('#btn-remove');
  await page.waitForTimeout(120);
  const withoutRegion = (await page.screenshot({ clip, type: 'png' })).toString('base64');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, withRegion, 'base64');
  const bytes = fs.statSync(OUT).size;

  /* 6. Numerical checks of the frame. Coordinates inside the clip: the layer is in
        viewport coordinates anyway, so we subtract the clip origin. */
  const inside = {
    x: round(region.left - clip.x + INSET),
    y: round(region.top - clip.y + INSET),
    w: round(region.width - 2 * INSET),
    h: round(region.height - 2 * INSET),
  };
  /* Two non-inverted zones, not one. The first is right below the region, across the
     bottom edge of the canvas: it catches inversion leaking past the region boundary
     on the content itself. The second is the page background above the playground, in
     the corner of the frame, far from the region (the top of the frame is now above
     the panel — the headroom over the hint). */
  const below = { x: inside.x, y: round(region.bottom - clip.y) + 4, w: inside.w, h: 12 };
  const corner = { x: 4, y: 4, w: 14, h: 14 };
  const cmp = await decoder.evaluate(({ b, a, o }) => window.__px.compare(b, a, o), {
    b: withoutRegion,
    a: withRegion,
    o: {
      boxes: [
        {
          label: 'inside the region',
          x: inside.x,
          y: inside.y,
          w: inside.w,
          h: inside.h,
          mode: 'complement',
        },
        { label: 'outside the region, at the bottom edge of the canvas', ...below, mode: 'unchanged' },
        { label: 'outside the region, page background', ...corner, mode: 'unchanged' },
      ],
      region: inside,
      tol: TOL,
    },
  });

  /* "Not empty": not the file size but the variety of pixels. A solid fill packs
     into kilobytes and would pass a size check. The second measurement is over the
     region: inverting empty space would prove less than inverting text and a chart,
     and that is exactly why the gesture goes across a playground with content. */
  const variety = await decoder.evaluate(
    async ({ b64, box }) => {
      const im = await window.__px.decode(b64);
      const seen = new Set();
      for (let i = 0; i < im.data.length; i += 4 * 37) {
        seen.add((im.data[i] << 16) | (im.data[i + 1] << 8) | im.data[i + 2]);
      }
      const inner = new Set();
      let counted = 0;
      for (let y = box.y; y < box.y + box.h; y += 1) {
        for (let x = box.x; x < box.x + box.w; x += 1) {
          const i = (y * im.w + x) * 4;
          inner.add((im.data[i] << 16) | (im.data[i + 1] << 8) | im.data[i + 2]);
          counted += 1;
        }
      }
      return {
        sampled: Math.floor(im.data.length / (4 * 37)),
        distinct: seen.size,
        inRegion: inner.size,
        inRegionPixels: counted,
      };
    },
    { b64: withoutRegion, box: inside },
  );

  const box = (label) => cmp.boxes.find((b) => b.label === label) ?? {};
  const inBox = box('inside the region');
  const outBoxes = cmp.boxes.filter((b) => b.label.startsWith('outside the region'));
  const textHit = frame.textCell === null ? 0 : overlap(region, frame.textCell);
  const canvasHit = overlap(region, canvas);
  const canvasArea = (canvas.right - canvas.left) * (canvas.bottom - canvas.top);
  const layerHit =
    Math.abs(layer[0].x - region.left) <= 2 &&
    Math.abs(layer[0].y - region.top) <= 2 &&
    Math.abs(layer[0].width - region.width) <= 2 &&
    Math.abs(layer[0].height - region.height) <= 2;

  console.log(`\nFrame: ${path.relative(ROOT, OUT)}`);
  console.log(
    `  clip ${clip.width}×${clip.height} at ${clip.x}, ${clip.y} — the playground in full width, headroom over the hint at the top (${clip.y} → ${frame.hint.top}), the gap between rows at the bottom (${frame.firstRowBottom} → ${frame.rowGapTop})`,
  );
  console.log(
    `  region ${region.width}×${region.height} at ${region.left}, ${region.top}: text ${round(textHit)} px², canvas ${round(canvasHit)} px² of ${canvasArea} (outside ${round(canvasArea - canvasHit)} px²)`,
  );
  console.log(`  svg ${svg.left}…${svg.right} × ${svg.top}…${svg.bottom} — entirely inside the frame`);
  console.log(
    `  file ${(bytes / 1024).toFixed(1)} KB, ${variety.distinct} distinct colours out of ${variety.sampled} samples`,
  );
  console.log(`  in the region ${variety.inRegion} distinct colours over ${variety.inRegionPixels} pixels`);

  check(variety.distinct > 200, 'the frame is not empty', `${variety.distinct} distinct colours`);
  check(
    variety.inRegion > 50,
    'the region has content',
    `${variety.inRegion} distinct colours over ${variety.inRegionPixels} pixels — an empty background would give a handful`,
  );
  check(
    inBox.ok === true && cmp.region.ratio >= REGION_RATIO,
    'inversion inside the region',
    `errMax=${inBox.errMax}, ratio=${cmp.region.ratio}, mae=${cmp.region.mae}, maxErr=${cmp.region.maxErr}`,
  );
  check(
    outBoxes.length === 2 && outBoxes.every((b) => b.ok === true),
    'no inversion outside the region',
    outBoxes.map((b) => `${b.label}: errMax=${b.errMax}`).join('; '),
  );
  check(
    region.left - clip.x > 7 &&
      region.top - clip.y > 7 &&
      clip.y + clip.height - region.bottom > 7 &&
      clip.x + clip.width - region.right > 7,
    'the region boundary is entirely within the frame',
    `region ${region.left}…${region.right} × ${region.top}…${region.bottom}, frame ${clip.x}…${clip.x + clip.width} × ${clip.y}…${clip.y + clip.height}`,
  );
  check(pageErrors.length === 0, 'the page has no errors', pageErrors.join(' | '));
  check(bytes < 300 * 1024, 'file size within the target (< 300 KB)', `${(bytes / 1024).toFixed(1)} KB`);

  /* The frame contents — review requirements, each as a number. */
  check(
    layerHit,
    'the gesture created the region where intended',
    `layer ${round(layer[0].x)}, ${round(layer[0].y)} ${round(layer[0].width)}×${round(layer[0].height)} versus the region ${region.left}, ${region.top} ${region.width}×${region.height}`,
  );
  check(
    textHit >= OVERLAP_MIN && canvasHit >= OVERLAP_MIN,
    'the region crosses text and canvas',
    `text ${round(textHit)} px² (needs ≥ ${OVERLAP_MIN}), canvas ${round(canvasHit)} px²`,
  );
  check(
    canvasArea - canvasHit >= OVERLAP_MIN,
    'part of the canvas stays outside the region',
    `outside ${round(canvasArea - canvasHit)} px² of ${canvasArea}`,
  );
  check(
    clip.y + clip.height >= svg.bottom + 8,
    'the SVG is not clipped at the bottom',
    `frame bottom ${clip.y + clip.height}, figure bottom ${svg.bottom}, margin ${clip.y + clip.height - svg.bottom} px`,
  );
  check(
    frame.hint.top - clip.y >= 3 && frame.hint.bottom <= clip.y + clip.height,
    'the "drag here" hint is entirely within the frame',
    `hint ${frame.hint.top}…${frame.hint.bottom}, headroom above ${frame.hint.top - clip.y} px (requested ≈ ${AIR}, the nearest clean line was taken)`,
  );
  check(
    sliced.length === 0,
    'the frame does not cut a line of text at the top',
    sliced.length === 0
      ? `the line ${clip.y} passes above the hint and below the page text`
      : sliced.join(' | '),
  );
  check(
    clip.y + clip.height <= frame.rowGapTop && clip.y + clip.height >= frame.firstRowBottom,
    'the bottom of the frame is the gap between rows',
    `frame bottom ${clip.y + clip.height}: the first row ends at ${frame.firstRowBottom}, the second starts at ${frame.rowGapTop}`,
  );
} catch (error) {
  fail('the screenshot is taken', String(error?.message ?? error));
} finally {
  await context.close();
  await browser.close();
  await server.close();
}

console.log(
  failures === 0 ? '\nRESULT: the frame is captured and verified' : `\nRESULT: ${failures} failures`,
);
process.exit(failures === 0 ? 0 : 1);
