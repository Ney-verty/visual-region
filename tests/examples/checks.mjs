/*
 * Example page check battery — one for all frameworks.
 *
 * Why one: vanilla, React, Vue and Next show the same minimal scenario, and
 * what must be checked in them is the integration, not the differences between
 * frameworks. If the checks spread across files, "works in React" would stop
 * being comparable to "works in vanilla".
 *
 * Example contract (must be satisfied by any example in this directory):
 *   #surface  — the gesture surface element;
 *   #show     — button that shows the region programmatically (setRegion);
 *   #clear    — button that removes the region (clearRegion);
 *   #destroy  — button that destroys the instance (destroy);
 *   #status   — status text line.
 * Plus the marker `[data-visual-region-layer]` — the documented way to find the
 * layer from outside (see README): the region geometry is taken from it, not
 * from the numbers in the example, which would otherwise have to be duplicated
 * here.
 *
 * Pixels are compared on a separate decoder page (`tests/lib/decoder.html`):
 * exactly the same comparator as in the smoke harness, so "inversion" here means
 * the same as there and does not turn into a homemade "looks alike / does not".
 *
 * DPR here is always 1 (examples are checked at a single scale — the HiDPI
 * profile stays with the smoke harness), so page coordinates match image
 * coordinates and no recalculation is needed.
 */

const TOL = 3;
/* Inset into the region: the rasterization rim lies exactly on the boundary
   (see tests/smoke/BASELINE.md), and "a pixel on the boundary" would test it,
   not the inversion. */
const INSET = 6;
/* Share of matching pixels inside the region. Not 1.0: under the region lies
   text with font antialiasing, and the text's rim is not the same as the
   region's rim. */
const REGION_RATIO = 0.9;

export const LAYER = '[data-visual-region-layer]';

async function shot(page) {
  return (await page.screenshot()).toString('base64');
}

function compare(decoder, before, after, opts) {
  return decoder.evaluate(({ b, a, o }) => window.__px.compare(b, a, o), { b: before, a: after, o: opts });
}

function box(rect, label, mode) {
  return {
    label,
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    w: Math.round(rect.width),
    h: Math.round(rect.height),
    mode,
  };
}

function inset(rect, px) {
  return {
    x: rect.x + px,
    y: rect.y + px,
    width: Math.max(1, rect.width - 2 * px),
    height: Math.max(1, rect.height - 2 * px),
  };
}

/** Region geometry from the documented marker. null — there is no region. */
function layerRect(page) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (el === null || el.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) === false) {
      return null;
    }
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, LAYER);
}

/** "after" frame + comparator error count in one report line. */
function cmpLine(cmp) {
  const boxes = cmp.boxes
    .map(
      (b) =>
        `${b.label}: errMax=${b.errMax} (${b.mode}, was ${b.before.join(',')} → now ${b.after.join(',')})`,
    )
    .join('; ');
  const region = cmp.region
    ? `; ratio=${cmp.region.ratio}, mae=${cmp.region.mae}, maxErr=${cmp.region.maxErr}`
    : '';
  return boxes + region;
}

const allOk = (cmp) => cmp.boxes.every((b) => b.ok === true);

export async function runPageChecks({ page, decoder, label }) {
  const checks = [];
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(String(error.message)));

  const add = (name, state, detail) => checks.push({ name, state, detail });
  const settle = () =>
    page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))),
    );
  const status = async () => ((await page.textContent('#status')) ?? '').trim();

  const finish = () => ({
    label,
    ok: checks.every((c) => c.state !== 'fail'),
    checks,
    pageErrors,
  });

  /* 0. The app rendered at all — until this there is nothing to check. */
  try {
    await page.waitForSelector('#surface', { timeout: 15_000 });
  } catch {
    add('example rendered #surface', 'fail', 'selector did not appear within 15 s');
    return finish();
  }
  add('example rendered #surface', 'pass', '');

  /* 1. Instance created. We wait for the status line specifically, not just the
     markup: in React it appears in an effect, in Next — after hydration, and
     "#surface is already there" says nothing about the library having finished
     loading. */
  try {
    await page.waitForFunction(
      () =>
        /state: (enabled|disabled|unsupported|destroyed)/.test(
          document.querySelector('#status')?.textContent ?? '',
        ),
      { timeout: 15_000 },
    );
  } catch {
    add('instance reported its state', 'fail', (await status()) || 'status line did not appear within 15 s');
    return finish();
  }
  const first = await status();
  const state = /state: (\w+)/.exec(first)?.[1] ?? null;
  add('instance reported its state', state === null ? 'fail' : 'pass', first);
  if (state === 'unsupported') {
    add(
      'region works',
      'skip',
      'environment without the Popover API — there will be no effect in any example',
    );
    return finish();
  }

  const base = await shot(page);
  const viewport = page.viewportSize();
  const away = { x: viewport.width - 90, y: viewport.height - 50, width: 50, height: 30 };

  /* 1. Programmatic region: setRegion. */
  await page.click('#show');
  await settle();
  const shown = await layerRect(page);
  add(
    'setRegion showed the layer',
    shown === null ? 'fail' : 'pass',
    shown === null ? '' : JSON.stringify(shown),
  );
  if (shown === null) return finish();

  const inside = inset(shown, INSET);
  const cmp1 = await compare(decoder, base, await shot(page), {
    boxes: [box(inside, 'inside the region', 'complement'), box(away, 'outside the region', 'unchanged')],
    region: { x: inside.x, y: inside.y, w: inside.width, h: inside.height },
    tol: TOL,
  });
  add(
    'setRegion inverts only inside the region',
    allOk(cmp1) && cmp1.region.ratio >= REGION_RATIO ? 'pass' : 'fail',
    cmpLine(cmp1),
  );

  /* 2. clearRegion: the page returned to its initial state. */
  await page.click('#clear');
  await settle();
  const cmp2 = await compare(decoder, base, await shot(page), {
    boxes: [box(inside, 'inside after clearRegion', 'unchanged')],
    tol: TOL,
  });
  add('clearRegion returned the page to its initial state', allOk(cmp2) ? 'pass' : 'fail', cmpLine(cmp2));

  /* 3. Gesture: a real pointer over the surface. */
  const surface = await page.locator('#surface').boundingBox();
  const from = { x: surface.x + 40, y: surface.y + 40 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 150, from.y + 90, { steps: 8 });
  await settle();
  const during = await layerRect(page);
  /* The state is read BEFORE the release: after mouse.up the status line has
     already been overwritten by the `end` event, and "the gesture started" cannot
     be checked from it. Two moments — two facts: during the gesture there was
     `start (pointer)`/`change`, after the release — `end` with bounds. */
  const duringStatus = await status();
  await page.mouse.up();
  await settle();
  const afterUp = await layerRect(page);
  const afterStatus = await status();

  add(
    'gesture started as a pointer and reported changes',
    /start \(pointer\)|dragging/.test(duringStatus) ? 'pass' : 'fail',
    duringStatus,
  );
  add('release reported bounds (end)', /region: \d+×\d+/.test(afterStatus) ? 'pass' : 'fail', afterStatus);
  add(
    'gesture created the region',
    during === null ? 'fail' : 'pass',
    during === null ? '' : JSON.stringify(during),
  );
  if (during !== null) {
    add(
      'persistent: the region remained after release',
      afterUp !== null && Math.abs(afterUp.x - during.x) <= 1 && Math.abs(afterUp.width - during.width) <= 1
        ? 'pass'
        : 'fail',
      `during ${JSON.stringify(during)}, after ${JSON.stringify(afterUp)}`,
    );
    const dragBox = inset(during, INSET);
    const cmp3 = await compare(decoder, base, await shot(page), {
      boxes: [box(dragBox, 'inside the gesture region', 'complement')],
      region: { x: dragBox.x, y: dragBox.y, w: dragBox.width, h: dragBox.height },
      tol: TOL,
    });
    add(
      'gesture inverts inside the region',
      allOk(cmp3) && cmp3.region.ratio >= REGION_RATIO ? 'pass' : 'fail',
      cmpLine(cmp3),
    );
  }

  /* 4. destroy: the page is in its initial state, there is no layer, the instance is dead. */
  await page.click('#destroy');
  await settle();
  const cmp4 = await compare(decoder, base, await shot(page), {
    boxes: [box(inside, 'inside after destroy', 'unchanged')],
    tol: TOL,
  });
  add('destroy returned the page to its initial state', allOk(cmp4) ? 'pass' : 'fail', cmpLine(cmp4));
  add(
    'destroy removed the layer from the DOM',
    (await page.locator(LAYER).count()) === 0 ? 'pass' : 'fail',
    '',
  );
  const last = await status();
  add('state after destroy', /state: destroyed/.test(last) ? 'pass' : 'fail', last);
  add('page without errors', pageErrors.length === 0 ? 'pass' : 'fail', pageErrors.join(' | '));

  return finish();
}
