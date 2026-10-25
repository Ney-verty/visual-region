/*
 * Build the static demo site for GitHub Pages: `_site/` = `demo/` + `dist/`
 * (plus a generated index page in the root).
 *
 * Why a separate script instead of three `cp` lines right in the workflow: this
 * way the same result can be built and checked locally. The layout under `_site/`
 * mirrors the repository — `demo/` next to `dist/` — so the page's relative links
 * (`../dist/index.js`, `./clip.mp4`) work both locally and on Pages. A deploy
 * cannot "fail to find" the assets: it publishes the same set of files.
 *
 * Mutations: deletes and overwrites `_site/` (the directory is entirely ours, in
 * .gitignore).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const site = path.join(root, '_site');
const demo = path.join(root, 'demo');
const dist = path.join(root, 'dist');

if (!fs.existsSync(path.join(dist, 'index.js'))) {
  console.error('no dist/index.js — run npm run build');
  process.exit(1);
}
if (!fs.existsSync(path.join(demo, 'index.html'))) {
  console.error('no demo/index.html — the demo cannot be built');
  process.exit(1);
}

fs.rmSync(site, { recursive: true, force: true });
fs.mkdirSync(site, { recursive: true });
fs.cpSync(demo, path.join(site, 'demo'), { recursive: true });
fs.cpSync(dist, path.join(site, 'dist'), { recursive: true });

/* The index page: on Pages a project site's root has to serve something, otherwise
   `…/repo/` is a 404 even though the demo lives at `…/repo/demo/`. */
fs.writeFileSync(
  path.join(site, 'index.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>visual-region 0.2</title>
    <meta http-equiv="refresh" content="0; url=./demo/" />
    <link rel="canonical" href="./demo/" />
  </head>
  <body>
    <p><a href="./demo/">visual-region 0.2 demo</a></p>
  </body>
</html>
`,
  'utf8',
);

function size(dir) {
  let total = 0;
  let files = 0;
  for (const relative of fs.readdirSync(dir, { recursive: true })) {
    const file = path.join(dir, relative);
    if (!fs.statSync(file).isFile()) continue;
    files += 1;
    total += fs.statSync(file).size;
  }
  return { files, total };
}

const { files, total } = size(site);
console.log(`_site built: ${files} files, ${(total / 1024).toFixed(0)} kB`);
