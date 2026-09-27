/*
 * ESLint flat config.
 *
 * Separation of concerns: ESLint is responsible for errors, Prettier for formatting.
 * That is why eslint-config-prettier comes last (it turns off the rules that
 * conflict with formatting), while eslint-plugin-prettier is NOT used:
 * `format:check` stays a separate check.
 *
 * The rule set is recommended, untuned (recommended + strict TypeScript is enough
 * for v0.1; new rules are added for a concrete reason). The only settings here
 * describe the environment — which global names are available to each kind of file.
 * This is not a weakening of the rules but their premise: without the list of
 * globals `no-undef` complains about `innerWidth` in a script that runs in a page.
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/* The library: browser. The test harness: Node outside + browser inside the page
   (suite.js and page.evaluate callbacks run in the browser, so their globals are
   listed in the same set). */
const BROWSER_GLOBALS = {
  window: 'readonly',
  document: 'readonly',
  getComputedStyle: 'readonly',
  requestAnimationFrame: 'readonly',
  location: 'readonly',
  innerWidth: 'readonly',
  innerHeight: 'readonly',
  Node: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  PointerEvent: 'readonly',
  MouseEvent: 'readonly',
  KeyboardEvent: 'readonly',
  HTMLElement: 'readonly',
  Element: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  atob: 'readonly',
  btoa: 'readonly',
  Blob: 'readonly',
  Image: 'readonly',
  createImageBitmap: 'readonly',
  matchMedia: 'readonly',
  performance: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  CSS: 'readonly',
};

export default tseslint.config(
  {
    ignores: ['dist/**', '.tmp-build/**', 'tests/smoke/out/**', 'node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['src/**/*.ts'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: BROWSER_GLOBALS },
  },

  {
    files: ['tests/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...BROWSER_GLOBALS, process: 'readonly', console: 'readonly', fetch: 'readonly' },
    },
  },

  {
    /* demo/ — the demo page: a browser script module. The demo stays under the
       linter on a par with the rest of the code: it is published on Pages, so it
       is part of the project's public face too. The Node part of the demo (site
       build and serving) lives in scripts/ and falls under the `scripts/**` set. */
    files: ['demo/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: BROWSER_GLOBALS,
    },
  },

  {
    /* scripts/ — our build and verification scripts: Node, no DOM. They stay
       under the linter along with the rest of the code: an unchecked verification
       script is a poor foundation. */
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { process: 'readonly', console: 'readonly', URL: 'readonly' },
    },
  },

  {
    /* `_name` — a parameter the implementation must accept by contract
       (for example, `config` on a mounting strategy) but does not use. */
    rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },

  prettier,
);
