/*
 * Normalize the `//# sourceMappingURL` comment in built JS artifacts.
 *
 * Why: tsup 8.5.1 writes this comment TWICE into the same file. The cause was
 * found, not guessed: esbuild adds the comment itself (reproducible on bare
 * esbuild — `write: false` + `outfile` yields exactly one comment at the end of
 * the code), and then tsup glues on its own second one
 * (node_modules/tsup/dist/index.js:791 does
 * `info.code + getSourcemapComment(...)`). Minimal reproduction:
 *
 *   npx tsup src/index.ts --format cjs --outdir /tmp/x --minify --sourcemap
 *   → /tmp/x/index.cjs has two identical `//# sourceMappingURL=index.cjs.map`
 *
 * The duplicate is harmless for a browser (the references are identical), but it
 * is a build defect: the artifact carries two mutually exclusive statements of
 * "this is the map", and a check for "the artifact has exactly one map" means
 * nothing on such a file.
 *
 * What it does: leaves exactly one comment, separated by a newline, at the end of
 * the file. If the comments point to DIFFERENT maps it is not a duplicate but a
 * breakage: the script exits non-zero rather than silently picking one of the two.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, '..', 'dist');
const REF = /\/\/#\s*sourceMappingURL=(\S+)/g;

if (!fs.existsSync(DIST)) {
  console.error(`normalize-sourcemaps: no directory ${path.relative(process.cwd(), DIST)}`);
  process.exit(1);
}

const artifacts = fs.readdirSync(DIST).filter((f) => /\.(js|cjs)$/.test(f));
let changed = 0;

for (const name of artifacts.sort()) {
  const file = path.join(DIST, name);
  const text = fs.readFileSync(file, 'utf8');
  const refs = [...text.matchAll(REF)].map((m) => m[1]);
  if (refs.length === 0) {
    console.error(
      `normalize-sourcemaps: ${name} without sourceMappingURL — the build is not the expected one`,
    );
    process.exit(1);
  }
  const unique = [...new Set(refs)];
  if (unique.length > 1) {
    console.error(`normalize-sourcemaps: ${name} refers to different maps: ${unique.join(', ')}`);
    process.exit(1);
  }
  const body = text.replace(REF, '').replace(/\s+$/, '');
  const normalized = `${body}\n//# sourceMappingURL=${unique[0]}\n`;
  if (normalized !== text) {
    fs.writeFileSync(file, normalized);
    changed++;
  }
}

console.log(
  `normalize-sourcemaps: ${artifacts.length} artifacts, normalized ${changed} (${artifacts.join(', ')})`,
);
