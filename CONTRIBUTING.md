# Contributing

Thanks for considering a change. This document covers what a contribution is expected to pass, and
the few rules that are not negotiable in this project.

## Before you start

Read [README.md](README.md) — it is the contract for the public API, and it is written to be the
source of truth rather than a summary of one. Two boundaries matter most:

- **The v0.2 public API is frozen.** Names, signatures and semantics do not change within `0.2.x`.
  Adding a public name is a decision, not a detail — open an issue first.
- **A nontrivial change starts with a plan.** Say what you intend to change and why before writing
  the code — an issue is enough — and afterwards say what you measured and what surprised you. That
  is what keeps the claims in this repository checkable instead of merely confident.

## Setup

```sh
npm ci
npx playwright install --with-deps chromium firefox webkit
```

Node 18 or newer is required (`engines.node`); CI uses Node 20 on Ubuntu 22.04, and that is the
environment the recorded measurements come from.

## The checks that must pass

Run these before opening a pull request. Each one proves something different, and a green run of one
says nothing about the others.

| Command                  | What it proves                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`      | the source and the tests type-check under `strict`                                                                            |
| `npm run lint`           | ESLint is clean for `src`, `tests`, `scripts`, `demo`                                                                         |
| `npm run format:check`   | Prettier is clean for everything (run `npm run format` to fix)                                                                |
| `npm run test:unit`      | the unit suite (Vitest) passes                                                                                                |
| `npm run build`          | the package builds: `dist/` plus the `.d.ts` files                                                                            |
| `npm run verify:dist`    | **the artifact contract**: size budgets, sourcemaps, published types, tarball contents, SSR safety, zero runtime dependencies |
| `npm run verify:docs`    | the README documents the real API and the real defaults, and nothing else                                                     |
| `npm run smoke`          | the browser battery on Chromium, Firefox and WebKit — 125 checks per engine                                                   |
| `npm run check:examples` | the four framework examples work in a real browser (needs `npm run build` first)                                              |

Two of these are deliberately slower and heavier: `check:examples` installs React, Vue and Next into
their own packages, and `smoke` runs three browsers. Both run as their own jobs in CI, so a red
library check never has to wait behind a Next.js install.

`SMOKE_DPR=2 npm run smoke` runs the HiDPI subset of the battery. What the recorded reference runs
contain, and what each profile does and does not cover, is in `tests/smoke/BASELINE.md`; nothing
compares a run against those files automatically, so if your change moves the numbers, say so
explicitly in the pull request, with the before and after.

One command is deliberately manual and is not part of CI: `npm run shot:readme` regenerates
`assets/demo-invert.png`, the screenshot in the README. It drags with a real pointer on the built
demo and fails unless the frame still shows what it exists to show — an inverted region, no inversion
outside it, and a region that crosses both text and the chart. Run it after a change that moves the
demo's layout, and include the regenerated image in the pull request.

## Rules that are not negotiable

1. **Zero runtime dependencies.** `dependencies` stays empty — `verify:dist` fails if it is not. If
   your change seems to need a runtime dependency, it needs a discussion first.
2. **The size budgets are hard gates, not warnings.** The full ESM consumer must stay within 6 KB gzip
   and the IIFE build within 7 KB. If your change exceeds a budget, stop and report it; do not reach
   the number by removing validation, warnings or a check. Official numbers and the current values are
   in the [Bundle size](README.md#bundle-size) section of the README.
3. **No framework wrappers in the library.** The library is framework-agnostic and depends on nothing.
   The examples show how to integrate it with React, Vue and Next.js using the public API alone, and
   that is the intended way — a wrapper package would be a separate project.
4. **Documentation must not invent API.** Every name, signature, option key, type and default in the
   README has to exist in the built types or in the runtime source. `npm run verify:docs` enforces
   this, and the roadmap is the one place where future names are allowed — explicitly marked as not
   implemented.
5. **The page belongs to the consumer.** The library writes styles only through CSSOM on its own
   layer; the single exception is the `touch-action` it sets on a surface you opted into touch on, and
   it restores it. Never add inline styles to, or restructure, the page's own elements.
6. **`dist/` is generated.** Do not commit it, and do not edit it by hand; `npm run build` produces it
   and `.gitignore` already ignores it.

## Examples

Each example under `examples/` is an independent package with its own `package.json` and its own
`node_modules`, and it connects the library by package name through `"visual-region": "file:../.."` —
never by a relative path into `dist/`. That is what makes the examples a real test of the published
entry points: the bare specifier goes through the real `exports` map, and the types are resolved the
way a consumer's would be.

Framework dependencies stay inside their example. Do not add React, Vue or Next to the root
`devDependencies`.

## Language

Everything in this repository is written in English: the documents, the code comments, the test
output, the configuration comments, the workflow comments and the demo page text. The library is
published for an international audience, and a reader should never have to skip a line they cannot
read.

The strings the library emits at runtime — its `TypeError` messages, its once-per-reason console
warnings, and the `reason` those same texts carry in the `unsupported` and `lost-top-layer` payloads
— are English as well, and they are part of the public surface: a consumer sees them. Write a new
diagnostic in the same voice as its neighbours, and treat a reworded message as a visible change,
not as an internal detail.

## Pull requests

- Keep the change focused; a refactor and a behaviour change in one pull request are two pull requests.
- Say what you measured, not only what you changed. Claims about behaviour should come with the check
  or the numbers behind them.
- Note explicitly if a check could not be run locally, and why.
- The commit message should say _why_ the change is needed; the diff already says _what_ changed.
