/*
 * Framework example check — release validation, not an everyday gate.
 *
 * What it proves: the library really connects as a package (by name, through a
 * real `exports`), and the example really works in a browser rather than "builds".
 * That is why the check has two parts: building/installing the example and running
 * the same battery (`tests/examples/checks.mjs`) against the live page.
 *
 * The examples are deliberately isolated: each has its own package.json and its
 * own node_modules, and the library is connected as `file:../..`. Frameworks do
 * not go into the root devDependencies — otherwise installing the library would
 * pull in React, Vue and Next.
 *
 * Run:
 *   npm run check:examples                 all examples in turn
 *   node tests/examples/run.mjs react      just one
 *   node tests/examples/run.mjs vanilla --serve   start the server and do not check
 *
 * Exit codes: 0 — all checks passed, 1 — there is a failure or the example did
 * not prepare.
 *
 * About the port: the server comes up on the first free port in a range, not on
 * a fixed one. Other processes are never killed: a busy port belongs to someone
 * else, and a human must deal with it. That the port serves EXACTLY the current
 * tree is checked by probing the content, not by the response code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from '../lib/server.mjs';
import { runPageChecks } from './checks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT = path.join(HERE, 'out');
const PORT_BASE = Number(process.env.EXAMPLES_PORT || 4390);
const VIEWPORT = { width: 1280, height: 900 };

const args = process.argv.slice(2);
const serveOnly = args.includes('--serve');
const requested = args.filter((a) => !a.startsWith('--'));
const TARGETS = ['vanilla', 'react', 'vue', 'next'];
const wanted = requested.length > 0 ? requested : TARGETS;
for (const name of wanted) {
  if (!TARGETS.includes(name)) {
    console.error(`unknown example: ${name}. Available: ${TARGETS.join(', ')}`);
    process.exit(1);
  }
}

/* ----------------------------------------------------------------- utilities ---- */

const log = (text) => console.log(text);

function run(command, cmdArgs, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, cmdArgs, { cwd, stdio: 'inherit' });
    child.on('close', (code) => resolve(code ?? 1));
    child.on('error', (error) => {
      console.error(`failed to start ${command}: ${error.message}`);
      resolve(1);
    });
  });
}

async function startOnFreePort(root, from = PORT_BASE) {
  for (let port = from; port < from + 20; port++) {
    try {
      return await startServer(root, port);
    } catch (error) {
      if (error?.code !== 'EADDRINUSE') throw error;
    }
  }
  throw new Error(
    `ports ${from}–${from + 19} are busy. Free one manually — this check never kills other processes.`,
  );
}

/** The port must serve the current tree, not an HTTP 200 from someone else's server. */
async function probe(origin) {
  const response = await fetch(`${origin}/examples/vanilla/main.js`);
  const text = await response.text();
  if (!text.includes("from 'visual-region'")) {
    throw new Error(`the server at ${origin} is not serving this tree: main.js has no library import`);
  }
}

async function ensureDeps(dir) {
  if (fs.existsSync(path.join(dir, 'node_modules'))) return true;
  log(`  no node_modules — installing dependencies into ${path.relative(ROOT, dir)}`);
  const lock = fs.existsSync(path.join(dir, 'package-lock.json'));
  const code = await run('npm', [lock ? 'ci' : 'install', '--no-audit', '--no-fund'], dir);
  return code === 0;
}

/* Framework-specific preparation. Returns the page path relative to the repository
   root (for Next — null: it is served by its own server) or null on failure. */
const PREPARE = {
  async vanilla(dir) {
    return (await ensureDeps(dir)) ? 'index.html' : null;
  },

  async react(dir) {
    if (!(await ensureDeps(dir))) return null;
    const esbuild = await import('esbuild');
    await esbuild.build({
      entryPoints: [path.join(dir, 'src', 'main.jsx')],
      bundle: true,
      format: 'esm',
      jsx: 'automatic',
      outfile: path.join(dir, 'dist', 'bundle.js'),
      logLevel: 'warning',
    });
    return 'index.html';
  },

  async vue(dir) {
    if (!(await ensureDeps(dir))) return null;
    const esbuild = await import('esbuild');
    await esbuild.build({
      entryPoints: [path.join(dir, 'src', 'main.js')],
      bundle: true,
      format: 'esm',
      outfile: path.join(dir, 'dist', 'bundle.js'),
      // Vue flags: without them the esm-bundler build warns about undefined
      // compile-time constants, and with them nothing extra gets into the bundle.
      define: {
        __VUE_OPTIONS_API__: 'true',
        __VUE_PROD_DEVTOOLS__: 'false',
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
      },
      logLevel: 'warning',
    });
    return 'index.html';
  },

  async next(dir) {
    if (!(await ensureDeps(dir))) return null;
    log('  next build (includes type checking)…');
    if ((await run('npm', ['run', 'build'], dir)) !== 0) return null;

    /* The client bundle must contain the library — otherwise "Next built" says
       nothing about the Client Component actually reaching the browser. */
    const chunks = path.join(dir, '.next', 'static', 'chunks');
    const files = fs.existsSync(chunks) ? fs.readdirSync(chunks).filter((f) => f.endsWith('.js')) : [];
    const withLibrary = files.filter((f) =>
      fs.readFileSync(path.join(chunks, f), 'utf8').includes('data-visual-region-layer'),
    );
    if (withLibrary.length === 0) {
      console.error('  the .next client chunks contain no library code — the Client Component did not build');
      return null;
    }
    log(`  library found in client chunks: ${withLibrary.join(', ')}`);
    return 'next-server';
  },
};

async function startNext(dir) {
  for (let port = PORT_BASE + 40; port < PORT_BASE + 60; port++) {
    const child = spawn('npm', ['run', 'start', '--', '-p', String(port)], { cwd: dir, stdio: 'ignore' });
    const ok = await new Promise((resolve) => {
      let done = false;
      const finish = (value) => {
        if (!done) {
          done = true;
          resolve(value);
        }
      };
      child.on('exit', () => finish(false));
      const tick = async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/`);
          if (response.ok) return finish(true);
        } catch {
          /* the server is still starting up */
        }
        if (!done) setTimeout(tick, 300);
      };
      setTimeout(tick, 500);
      setTimeout(() => finish(false), 30_000);
    });
    if (ok) return { origin: `http://127.0.0.1:${port}`, stop: () => child.kill('SIGTERM') };
    child.kill('SIGTERM');
  }
  throw new Error('failed to start next start');
}

/* -------------------------------------------------------------------- run ---- */

let rootServer = null;
let browser = null;
let context = null;
const report = [];

try {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.js'))) {
    console.error('no dist/index.js — the examples import the built package. Run: npm run build');
    process.exit(1);
  }

  rootServer = await startOnFreePort(ROOT);
  await probe(rootServer.origin);

  if (serveOnly) {
    const dir = path.join(ROOT, 'examples', wanted[0]);
    log(`example: ${rootServer.origin}/examples/${wanted[0]}/`);
    log(`serving: ${ROOT}`);
    log(`(Ctrl+C to stop; this mode checks nothing, it only serves files)`);
    if (!fs.existsSync(dir)) console.error(`no directory ${dir}`);
    await new Promise(() => {});
  }

  const { chromium } = await import('playwright').catch(() => {
    throw new Error(
      'playwright is not installed in the project: npm install && npx playwright install --with-deps chromium',
    );
  });
  browser = await chromium.launch();
  context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  const decoder = await context.newPage();
  await decoder.goto(`${rootServer.origin}/tests/lib/decoder.html`);

  for (const name of wanted) {
    const dir = path.join(ROOT, 'examples', name);
    log(`\n=== ${name} ===`);
    if (!fs.existsSync(dir)) {
      report.push({
        label: name,
        ok: false,
        checks: [{ name: 'example directory', state: 'fail', detail: dir }],
      });
      continue;
    }

    const prepared = await PREPARE[name](dir);
    if (prepared === null) {
      report.push({
        label: name,
        ok: false,
        checks: [{ name: 'example preparation', state: 'fail', detail: 'see the output above' }],
      });
      continue;
    }

    let ownServer = null;
    let origin = rootServer.origin;
    let url = `${rootServer.origin}/examples/${name}/${prepared}`;
    if (prepared === 'next-server') {
      ownServer = await startNext(dir);
      origin = ownServer.origin;
      url = `${origin}/`;
    }

    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'load' });
      const result = await runPageChecks({ page, decoder, label: `${name} ${origin}` });
      result.url = url;
      report.push(result);
      for (const check of result.checks) {
        const mark = check.state === 'pass' ? '✓' : check.state === 'skip' ? '−' : '✗';
        log(`  ${mark} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
      }
    } finally {
      await page.close();
      ownServer?.stop();
    }
  }

  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, `results-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ when: new Date().toISOString(), report }, null, 2));

  const failed = report.filter((r) => !r.ok);
  const total = report.reduce((sum, r) => sum + r.checks.length, 0);
  const skipped = report.reduce((sum, r) => sum + r.checks.filter((c) => c.state === 'skip').length, 0);
  log(
    `\ntotal: ${report.length} example(s), ${total} checks, ${skipped} skipped, failures: ${failed.length}`,
  );
  log(`result: ${path.relative(ROOT, file)}`);
  process.exitCode = failed.length > 0 ? 1 : 0;
} catch (error) {
  console.error(String(error?.message ?? error));
  process.exitCode = 1;
} finally {
  await context?.close();
  await browser?.close();
  await rootServer?.close();
}
