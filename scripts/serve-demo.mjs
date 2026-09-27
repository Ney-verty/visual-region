/*
 * Local static server for the demo.
 *
 * We take the test harness server (`tests/lib/server.mjs`) as is: it already does
 * what the page needs — it serves modules and `.mp4` with the right types and
 * without caching. A second static server in the repository would be a 30-line
 * duplicate.
 *
 * It serves the same layout that Pages publishes (`demo/` next to `dist/`):
 *   npm run demo        → repository root (`/demo/`, only a build is needed)
 *   npm run demo:site   → the built `_site/` — exactly what will ship to Pages
 *
 * Without an argument it serves the repository root: this way whoever edits the
 * page can see it without a site-build step. `_site` verifies that the deploy
 * will get a working set of files.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { startServer } from '../tests/lib/server.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const args = process.argv.slice(2);
const useSite = args.includes('_site') || args.includes('--site');
const portArg = args.find((arg) => /^\d+$/.test(arg));
const port = Number(process.env.PORT || portArg || 4317);

const serveRoot = useSite ? path.join(root, '_site') : root;
if (useSite && !fs.existsSync(path.join(serveRoot, 'demo', 'index.html'))) {
  console.error('no _site/demo/index.html — run: npm run build && node scripts/build-demo-site.mjs');
  process.exit(1);
}
if (!fs.existsSync(path.join(root, 'dist', 'index.js'))) {
  console.error('no dist/index.js — run npm run build');
  process.exit(1);
}

try {
  const server = await startServer(serveRoot, port);
  console.log(`demo: ${server.origin}/demo/  (Ctrl+C to stop)`);
  console.log(`serving: ${serveRoot}`);
} catch (error) {
  if (error?.code === 'EADDRINUSE') {
    console.error(`port ${port} is busy — pick another: npm run demo -- --port 4318`);
    process.exit(1);
  }
  throw error;
}
