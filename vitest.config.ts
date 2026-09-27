import { defineConfig } from 'vitest/config';

/*
 * The unit harness: only `tests/unit/**` and only the `node` environment.
 *
 * Why not jsdom: the region lifecycle rests entirely on the Popover API, which
 * jsdom does not have. An instance there would honestly end up `unsupported`, and
 * a "lifecycle" test would check for the absence of the API rather than our code.
 * So everything that needs a real popover, real pixels and three engines lives in
 * tests/smoke (Playwright), while here we keep the options matrix, geometry
 * arithmetic and registry contracts.
 *
 * Why `include` is listed explicitly instead of left at its default: an explicit
 * list keeps the harness narrow — unit tests live only in `tests/unit`. Browser
 * scenarios sit next to them, in `tests/smoke` and `tests/examples`, and a
 * `.test.*` file from there must not accidentally run in the node environment.
 *
 * `globals` is deliberately off: every test imports describe/it/expect from
 * 'vitest' explicitly — then the file does not depend on environment magic and
 * reads as an ordinary module.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/unit/**/*.test.ts'],
  },
});
