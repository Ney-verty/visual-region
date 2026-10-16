/*
 * Verify the built package.
 *
 * What is checked — what cannot be checked in the sources:
 *   A. sizes: raw and gzip per file, and separately "what the consumer actually
 *      loads" (the consumer bundle through esbuild) — because the size of a single
 *      file lies when the build is split into chunks; plus two budgets (see below);
 *   B. SSR import: `import('dist/index.js')` in Node without DOM does not throw
 *      (ESM and CJS);
 *   C. purity of the clean entry: importing `.` does not touch the DOM at all
 *      (document is a trap that throws on any access);
 *   D. auto entry: importing `visual-region/auto` does touch the DOM (otherwise it
 *      is useless);
 *   E. tree-shaking: a consumer that only needs `supported` pulls in neither
 *      auto-initialization nor mounting;
 *   F. types: the published types contain no internal `element` (`stripInternal`
 *      does not leak) and no declarations of internal entries;
 *   G. zero runtime dependencies: dist imports no external package at all.
 *
 * Budgets: a single estimate of "min+gzip ≤ 5 KB" did not hold up against the
 * actual implementation — 5.57 KB for the consumer and 6.52 KB for the IIFE.
 * Instead of fitting to an artificial number, the budget is split per artifact and
 * stays a hard gate (overrunning is a failure, not a warning): dropping approved
 * functionality (validation, warnings) to save size is forbidden.
 *
 * History of the numbers (they are measurements, not estimates — keep them dated):
 *   v0.1.0 (2026-09-26): consumer 5.03 KB, IIFE 5.88 KB → the split budgets 6/7 KiB.
 *   v0.2   (2026-10-15): consumer 6.02 KB (HEAD before the slice: 5.03 KB), IIFE
 *          6.87 KB. The consumer budget was raised to 6.5 KiB by an explicit decision
 *          (`harness/DECISIONS.md`, 2026-10-15): the growth is the approved v0.2 slice
 *          (follow controller, two round shapes, three validated options), the consumer
 *          build was re-checked for accidental bundling (the declarative parser does not
 *          reach it) and trading validation away for 20 B is forbidden.
 *   v0.2   (2026-10-15, step 6): the declarative parser gained `data-shape`,
 *          `data-controller` and `data-follow-size`, and the IIFE — the build that runs
 *          auto-init — went 6.87 → 7.05 KB, i.e. over the old 7 KiB by 0.05 KB. The IIFE
 *          budget became 7.5 KiB under a rule agreed before the step was taken (same
 *          decision, same date): measured, attributed by building the same tree with the
 *          parser reverted (+184 B gzip, +543 B raw, all of it `src/index.ts`), the
 *          consumer unchanged at 6.00 KB in both builds. The rule allowed up to 7.5 KiB;
 *          7.05 KB is what it was spent on.
 *
 * Run: npm run verify:dist   (requires a prior npm run build)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DIST = path.join(ROOT, 'dist');

/* Per-artifact budgets. The original estimate (≤ 5 KB for everything) was made
   before the shape of the public API was known; the numbers are re-measured against
   the built artifacts on every change, never estimated. Both budgets moved on
   2026-10-15 (v0.2): consumer 6 → 6.5 KiB, IIFE 7 → 7.5 KiB — see the header and
   harness/DECISIONS.md. */
const BUDGET_CONSUMER_GZIP = 6.5 * 1024; // ESM: full consumer bundle
const BUDGET_IIFE_GZIP = 7.5 * 1024; // IIFE: file for the CDN

let failures = 0;
const ok = (name, detail = '') => console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
const fail = (name, detail = '') => {
  failures += 1;
  console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
};
const check = (cond, name, detail = '') => (cond ? ok(name, detail) : fail(name, detail));

const kb = (n) => `${(n / 1024).toFixed(2)} KB`;
const read = (rel) => fs.readFileSync(path.join(DIST, rel));

/* ------------------------------------------------------- A. sizes --------- */

function sizes(rel) {
  const buf = read(rel);
  return { raw: buf.length, gzip: zlib.gzipSync(buf).length };
}

/* The consumer bundle: exactly what a real user downloads after building their
   app. esbuild removes the question of chunks and unused code. */
async function bundleConsumer(contents) {
  const result = await esbuild.build({
    stdin: { contents, resolveDir: ROOT, loader: 'js' },
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2020',
    write: false,
    external: [],
  });
  return result.outputFiles[0].contents;
}

/* ----------------------------------------------------------- run ---------- */

console.log('\nA. sizes');

const FILES = [
  'index.js',
  'index.cjs',
  'auto.js',
  'auto.cjs',
  'visual-region.global.js',
  'index.d.ts',
  'auto.d.ts',
];
for (const f of FILES) {
  if (!fs.existsSync(path.join(DIST, f))) {
    fail(`file ${f} is present`);
    continue;
  }
  const s = sizes(f);
  ok(`size ${f}`, `raw ${kb(s.raw)}, gzip ${kb(s.gzip)}`);
}

/* Two consumer profiles: minimal (support detector only) and full. */
const minimalBundle = await bundleConsumer(
  `import { supported } from '${DIST}/index.js'; console.log(supported);`,
);
const fullBundle = await bundleConsumer(
  `import { visualRegion } from '${DIST}/index.js';
   const vr = visualRegion();
   document.body.addEventListener('click', () => vr.setRegion({ x: 0, y: 0, width: 10, height: 10 }));`,
);

const fullGzip = zlib.gzipSync(fullBundle).length;
ok(
  'consumer using only `supported`',
  `raw ${kb(minimalBundle.length)}, gzip ${kb(zlib.gzipSync(minimalBundle).length)}`,
);
ok('consumer using the whole drag-region', `raw ${kb(fullBundle.length)}, gzip ${kb(fullGzip)}`);

/* Budget 1: the ESM consumer. We measure the consumer bundle, not the file: after
   code splitting the size of `dist/index.js` (0.17 KB) says nothing. */
const budget = (name, size, limit) =>
  check(
    size <= limit,
    `budget ${name} ≤ ${kb(limit)}`,
    `${kb(size)} — ${size <= limit ? 'within budget' : `OVER BY ${kb(size - limit)}`}`,
  );

budget('ESM (full consumer)', fullGzip, BUDGET_CONSUMER_GZIP);

/* Budget 2: the CDN file. Here we measure exactly what the browser downloads via <script>. */
budget('IIFE (CDN)', sizes('visual-region.global.js').gzip, BUDGET_IIFE_GZIP);

/* ------------------------------------------------------- B. SSR import ----- */

console.log('\nB. SSR import (Node without DOM)');
{
  const mod = await import(path.join(DIST, 'index.js'));
  check(typeof mod.VisualRegion === 'function', 'the VisualRegion class is exported');
  check(mod.supported === false, 'supported outside the browser = false');
  check(mod.init() === null, 'init() outside the browser returns null');
  check(Array.isArray(mod.autoInit()) && mod.autoInit().length === 0, 'autoInit() outside the browser = []');

  /* The CJS entry is published too (`require` in `exports`), and it is easy to
     forget: the ESM checks above do not touch it. `auto.cjs` must in turn load
     silently without a DOM — auto-initialization in Node must start nothing. */
  const require = createRequire(import.meta.url);
  const cjs = require(path.join(DIST, 'index.cjs'));
  check(typeof cjs.VisualRegion === 'function', 'CJS entry: the VisualRegion class is exported');
  check(cjs.supported === false && cjs.init() === null, 'CJS entry: behaves the same outside the browser');
  const cjsAuto = require(path.join(DIST, 'auto.cjs'));
  check(
    Object.keys(cjsAuto).length === 0,
    'CJS entry `./auto` loads in Node without DOM and without errors',
    `exports: ${Object.keys(cjsAuto).length}`,
  );
}

/* ---------------------- C/D. DOM purity of entry `.` and behaviour of `./auto` */

/* Both checks run in SEPARATE Node processes. This is not a formality: the
   `isBrowser` flag is computed once when the module is evaluated, and modules are
   cached. In a single process the "purity" check (no DOM) would poison the auto
   entry check (with DOM) — the cached module would stay with `isBrowser === false`.
   That is exactly how this test lied the first time. */
function inNode(code) {
  const res = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, TARGET: '' },
  });
  return { stdout: res.stdout.trim(), stderr: res.stderr.trim(), status: res.status };
}

console.log('\nC/D. purity of the clean entry and behaviour of the auto entry');
{
  /* A trap instead of document and window: any access is an error. This way
     "does not touch the DOM" is checked by fact, not by promise. */
  const purity = inNode(`
    const trap = new Proxy({}, {
      get(_t, p) { throw new Error('access to ' + String(p)); },
      has() { throw new Error('property existence check'); },
    });
    globalThis.window = trap;
    globalThis.document = trap;
    await import(${JSON.stringify(path.join(DIST, 'index.js'))});
    console.log('CLEAN');
  `);
  check(
    purity.stdout === 'CLEAN',
    'importing `.` does not touch the DOM (the trap did not fire)',
    purity.stdout || purity.stderr,
  );

  /* The reverse check: the auto entry must touch the DOM. We give it a fake
     document and see that it does exactly what it promises. */
  const auto = inNode(`
    const calls = [];
    globalThis.window = {};
    globalThis.document = {
      readyState: 'loading',
      addEventListener: (type) => calls.push(type),
      querySelectorAll: () => [],
    };
    await import(${JSON.stringify(path.join(DIST, 'auto.js'))});
    console.log(JSON.stringify(calls));
  `);
  check(
    auto.stdout.includes('DOMContentLoaded'),
    'entry `./auto` works: at readyState=loading it waits for DOMContentLoaded',
    auto.stdout || auto.stderr,
  );

  const autoReady = inNode(`
    const asked = [];
    globalThis.window = {};
    globalThis.document = {
      readyState: 'complete',
      addEventListener: () => { throw new Error('the markup is already ready — no listener needed'); },
      querySelectorAll: (sel) => { asked.push(sel); return []; },
    };
    await import(${JSON.stringify(path.join(DIST, 'auto.js'))});
    console.log(JSON.stringify(asked));
  `);
  check(
    autoReady.stdout.includes('data-visual-region'),
    'entry `./auto` works: with ready markup it scans immediately',
    autoReady.stdout || autoReady.stderr,
  );
}

/* ---------------------------------------------------- E. tree-shaking ------ */

console.log('\nE. tree-shaking');
{
  const text = minimalBundle.toString('utf8');
  check(!text.includes('data-visual-region'), 'the minimal bundle has no auto-initialization');
  check(!text.includes('popover'), 'the minimal bundle has no top-layer mounting');
  check(text.length < fullBundle.length, 'the minimal bundle is smaller than the full one');
}

/* ---------------------------------------------------------- F. types ------- */

console.log('\nF. published types');
{
  const dts = read('index.d.ts').toString('utf8');
  check(!/\belement\b/.test(dts), 'the internal `element` did not get into the published types');
  check(!dts.includes('@internal'), '@internal markers did not get into the published types');
  check(/get bounds\(\)/.test(dts) && /get state\(\)/.test(dts), 'the public getters are present');
  /* `cdn.ts` is the entry of the IIFE build, not a public module. The package's
     `files` includes `dist` entirely, so declarations of internal entries would
     ship to the consumer. */
  check(!fs.existsSync(path.join(DIST, 'cdn.d.ts')), 'the internal entry `cdn` is not published');
}

/* ----------------------------------- G. zero runtime dependencies --------- */

console.log('\nG. runtime dependencies');
{
  const external = [];
  for (const f of ['index.js', 'auto.js', 'index.cjs', 'auto.cjs', 'visual-region.global.js']) {
    const text = read(f).toString('utf8');
    for (const m of text.matchAll(/\bfrom\s*["']([^."'][^"']*)["']/g)) external.push(`${f}: ${m[1]}`);
    for (const m of text.matchAll(/\brequire\(["']([^."'][^"']*)["']\)/g)) external.push(`${f}: ${m[1]}`);
  }
  check(external.length === 0, 'the build imports no external packages', external.join(', '));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  check(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0, 'package.json has no dependencies');
}

/* ------------------------------------- H. sourcemaps and package contents - */

console.log('\nH. sourcemaps and tarball');
{
  /* External maps: the file and the map are separate artifacts, so the map is not
     part of the runtime-bundle budget (the budgets above measure gzip of the JS
     itself). We check that the reference in each file points to an existing map
     and that the map is usable for debugging (sourcesContent) rather than empty.

     The exception is a shim file that merely re-exports a shared chunk: it has no
     code of its own, and esbuild honestly emits a map without sources. The real
     map lives next to the chunk, so chunks are in the list too. */
  const JS_ARTIFACTS = fs.readdirSync(DIST).filter((f) => /\.(js|cjs)$/.test(f) && !f.endsWith('.map'));
  const isReexportShim = (text) =>
    /^export\{[^}]*\}from'\.\/[^']+';?$/.test(text.replace(/\/\/#\s*sourceMappingURL=\S+/g, '').trim());

  const maps = [];
  for (const f of JS_ARTIFACTS.sort()) {
    const text = read(f).toString('utf8');
    const refs = [...text.matchAll(/\/\/#\s*sourceMappingURL=(\S+)/g)].map((m) => m[1]);
    const ref = refs[refs.length - 1];
    if (!ref) {
      fail(`map for ${f}`, 'the file has no sourceMappingURL');
      continue;
    }
    const target = path.join(DIST, ref);
    if (!fs.existsSync(target)) {
      fail(`map for ${f}`, `the reference points to a missing ${ref}`);
      continue;
    }
    const map = JSON.parse(fs.readFileSync(target, 'utf8'));
    const complete = Array.isArray(map.sourcesContent) && map.sourcesContent.length === map.sources.length;
    const detail = `${ref}, ${kb(fs.statSync(target).size)}, sources ${map.sources.length}`;
    if (isReexportShim(text)) {
      ok(`map for ${f} (re-export shim, needs no mappings of its own)`, detail);
    } else {
      check(map.sources.length > 0 && complete, `map for ${f}`, detail);
    }
    maps.push({ file: f, map: ref });
  }

  /* The map-comment invariant. The duplicate that tsup 8.5.1 wrote (two identical
     `//# sourceMappingURL` in one file) is cut out by the build —
     `scripts/normalize-sourcemaps.mjs`. Here we check the result, not the
     intention: exactly one reference, on the last line of the file, the map
     present, and the map belonging to this very artifact (the `file` field inside
     the map). */
  const mapProblems = [];
  for (const f of JS_ARTIFACTS) {
    const text = read(f).toString('utf8');
    const refs = [...text.matchAll(/\/\/#\s*sourceMappingURL=(\S+)/g)].map((m) => m[1]);
    if (refs.length !== 1) {
      mapProblems.push(`${f}: map references ${refs.length}`);
      continue;
    }
    if (!text.trimEnd().endsWith(`//# sourceMappingURL=${refs[0]}`)) {
      mapProblems.push(`${f}: the map reference is not the last line`);
    }
    const target = path.join(DIST, refs[0]);
    if (!fs.existsSync(target)) {
      mapProblems.push(`${f}: missing ${refs[0]}`);
      continue;
    }
    const map = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (map.file !== f) mapProblems.push(`${f}: the map declares file=${map.file}`);
  }
  check(
    mapProblems.length === 0,
    'source-map invariant: one reference on the last line, the map present and belonging to the artifact',
    mapProblems.length ? mapProblems.slice(0, 4).join(' | ') : `${JS_ARTIFACTS.length} artifacts`,
  );

  /* The tarball contents and size — what the consumer really downloads from npm.
     `--dry-run` publishes nothing and writes nothing to the registry. */
  const pack = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, npm_config_loglevel: 'error' },
  });
  if (pack.status !== 0) {
    fail('npm pack --dry-run', pack.stderr.trim().split('\n')[0] ?? 'could not run');
  } else {
    const [info] = JSON.parse(pack.stdout);
    const names = info.files.map((f) => f.path);
    const packKb = (n) => `${(n / 1024).toFixed(1)} KB`;
    ok(
      'the tarball builds',
      `${info.filename}: ${packKb(info.size)} tarball, ${packKb(info.unpackedSize)} unpacked, files ${info.entryCount}`,
    );
    const missing = [...JS_ARTIFACTS, ...maps.map((m) => m.map), 'index.d.ts', 'auto.d.ts'].filter(
      (f) => !names.includes(`dist/${f}`),
    );
    check(missing.length === 0, 'all artifacts and maps made it into the tarball', missing.join(', '));
    const leaked = names.filter((n) => !/^(dist\/|README\.md$|LICENSE$|package\.json$)/.test(n));
    check(leaked.length === 0, 'the tarball has nothing extra', leaked.slice(0, 5).join(', '));
    const srcLeak = names.filter((n) => n.startsWith('src/') || n.startsWith('tests/'));
    check(srcLeak.length === 0, 'sources and tests did not ship in the package');
    const mapBytes = info.files.filter((f) => f.path.endsWith('.map')).reduce((s, f) => s + f.size, 0);
    ok(
      'maps in the package',
      `raw ${packKb(mapBytes)} — ${((mapBytes / info.unpackedSize) * 100).toFixed(0)}% of the unpacked package`,
    );
  }
}

console.log(failures === 0 ? '\nRESULT: package checks passed' : `\nRESULT: ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
