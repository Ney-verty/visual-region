import { defineConfig } from 'tsup';

/*
 * Build. Two configurations, because they have different entries and formats:
 *  1) library entries: ESM + CJS. `.` (index) is clean, `./auto` is an effect module;
 *  2) IIFE for <script>: a different entry (cdn.ts) and a different global name.
 *
 * Types are NOT built here (dts: false). They are emitted by
 * `tsc -p tsconfig.build.json`: only it applies `stripInternal` and removes the
 * internal `element` from the published types. A type-bundling tool does not do
 * that, and the internal access would leak into the public contract.
 *
 * `clean: true` only on the first configuration: the second must not wipe its output.
 */
export default defineConfig([
  {
    entry: { index: 'src/index.ts', auto: 'src/auto.ts' },
    format: ['esm', 'cjs'],
    target: 'es2020',
    platform: 'browser',
    outDir: 'dist',
    clean: true,
    minify: true,
    sourcemap: true,
    treeshake: true,
    dts: false,
    outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  },
  {
    /* The IIFE bundles everything itself — a deliberate exception to "zero code
       duplication": it has no external imports and has to work as a single tag. */
    entry: { 'visual-region': 'src/cdn.ts' },
    format: ['iife'],
    globalName: 'VisualRegion',
    target: 'es2020',
    platform: 'browser',
    outDir: 'dist',
    clean: false,
    minify: true,
    sourcemap: true,
    treeshake: true,
    dts: false,
  },
]);
