/**
 * The entry for `<script src="…">` (the IIFE build). Here the API is placed on the global object
 * and auto-initialization runs right away.
 *
 * Why auto-initialization is enabled here specifically: whoever loads the library with a `<script>`
 * tag has already agreed that it does something on its own — otherwise they would have used
 * `import`. On a page with no `data-visual-region` markup it does exactly nothing: `autoInit()`
 * finds no elements and creates no nodes.
 *
 * The ESM entry (`.` → `index.ts`) has no auto-initialization: the import must be clean.
 */
import './auto.js';

export * from './index.js';
