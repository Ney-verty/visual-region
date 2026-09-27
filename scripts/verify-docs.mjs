/*
 * Documentation check.
 *
 * What it proves: the README describes exactly the public API that exists and
 * exactly the default values the library really uses. Not "the README looks
 * reasonable" but "every name and every number in it is confirmed by a source".
 *
 * Two sources, deliberately different:
 *   A. dist/*.d.ts — names, signatures, option keys, types and union values. This
 *      is the published contract: if a name is not in the declarations, it does not
 *      exist for the consumer.
 *   B. the runtime source (src/core/spec.ts, src/index.ts) — the ACTUAL defaults.
 *      They cannot be taken from the types: `threshold?: number` does not say the
 *      value is 3.
 * There is no hand-written list of defaults in this file, and there must not be:
 * the values are derived from the source by rules (see sourceDefault), so the list
 * cannot drift from the code — on a mismatch the check fails, not the document.
 *
 * The scope differs, and that is not pedantry. The README must be unambiguous
 * where it describes the current API and must be free to talk about the future —
 * otherwise the roadmap would become a forbidden topic. So zones are checked
 * differently:
 *   - "current" zones (Quick start, API, Options, Events, Activation, Mounting,
 *     Declarative markup, Validation, Available in v0.1, …) — the real API only;
 *   - the Roadmap zone — future names are allowed, but the section must exist, and
 *     forbidden old names may appear only inside a paragraph that says outright
 *     that they do not exist.
 *
 * What is NOT checked or rewritten: the recorded smoke numbers —
 * `tests/smoke/BASELINE.md`. They describe the state at the time of writing, and
 * they cannot be required to stay current.
 *
 * Run: npm run verify:docs   (requires a prior npm run build — dist/*.d.ts is read)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

let failures = 0;
const ok = (name, detail = '') => console.log(`  PASS  ${name}${detail ? ' — ' + detail : ''}`);
const fail = (name, detail = '') => {
  failures += 1;
  console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
};
const check = (cond, name, detail = '') => (cond ? ok(name, detail) : fail(name, detail));
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* External names that the README is allowed to mention in call form. The list is
   hand-written and deliberately narrow: every addition is a conscious choice that
   "this is not our API, this is the platform". The check below catches ANY other
   name in call form, so a forgotten external name gives a FAIL asking to add it
   here rather than passing silently. */
const EXTERNAL = new Set([
  'getBoundingClientRect',
  'querySelector',
  'querySelectorAll',
  'addEventListener',
  'removeEventListener',
  'setProperty',
  'removeProperty',
  'checkVisibility',
  'preventDefault',
  'requestAnimationFrame',
  'setTimeout',
  'log',
  'includes',
  'test',
  'split',
  'trim',
  'filter',
  'map',
  'join',
  'Number',
  'String',
]);

/* Forbidden old public names. `mode:` and `data-mode` are from the former "mode"
   model; `createRegion`/`removeRegion` are from the former multiple-region API. */
const FORBIDDEN = ['createRegion', 'removeRegion', 'mode:', 'data-mode'];

const NEGATION = /do(es)? not exist|never existed|not implemented|not part of|rejected/i;
const CURRENT_VERSION_ZONE = /v0\.1/;

/* Prettier pads table cells with spaces, so the parsing tolerates padding: "the
   same but with one more space" is a formatting check, not a documentation check. */
const rowsOf = (text, cols) => [
  ...text.matchAll(new RegExp(`^\\|\\s*${cols.join('\\s*\\|\\s*')}\\s*\\|`, 'gm')),
];
const OPTION_ROW = ['`([A-Za-z_$][\\w$]*)`', '`([^`]+)`', '`([^`]+)`'];
const EVENT_ROW = ['`([\\w-]+)`'];

/* ------------------------------------------------ A. sources --------------- */

const TYPES = fs
  .readdirSync(path.join(ROOT, 'dist'), { recursive: true })
  .filter((f) => String(f).endsWith('.d.ts'))
  .map((f) => readText(path.join('dist', String(f))))
  .join('\n');

const INDEX_DTS = readText('dist/index.d.ts');

/** The contents of an `interface X {` / `declare class X {` block — up to the closing brace. */
function block(text, header) {
  const start = text.indexOf(header);
  if (start === -1) return null;
  const open = text.indexOf('{', start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

/* Public names: declarations plus re-exported types. We take them from index.d.ts
   rather than the whole dist: internal modules (controller, core/spec) are
   published as files but are not in `exports` and are unavailable to the consumer. */
const PUBLIC = new Set();
for (const m of INDEX_DTS.matchAll(/export declare (?:const|function|class)\s+([A-Za-z_$][\w$]*)/g)) {
  PUBLIC.add(m[1]);
}
for (const m of INDEX_DTS.matchAll(/export type \{([^}]+)\}/g)) {
  for (const part of m[1].split(',')) {
    const name = part
      .trim()
      .split(/\s+as\s+/)
      .pop()
      ?.trim();
    if (name !== undefined && /^[A-Za-z_$][\w$]*$/.test(name)) PUBLIC.add(name);
  }
}
check(
  PUBLIC.size > 0,
  'public names found in dist/index.d.ts',
  [...PUBLIC].sort().join(', ') || 'none — the parsing is broken',
);

const CLASS_BODY = block(INDEX_DTS, 'export declare class VisualRegion') ?? '';
const MEMBERS = new Set(
  [...CLASS_BODY.matchAll(/(?:get\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*[(<])/g)]
    .map((m) => m[1] ?? m[2])
    .filter((name) => name !== undefined && !name.startsWith('static')),
);
MEMBERS.add('supported'); // the class's static getter

/** Comments are stripped from the body: they contain `activation:'element'` and
    the like, which is a documentation example, not a key declaration. */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Top-level keys in an interface or class body — nested ones are not counted. */
function topLevelKeys(body) {
  const keys = [];
  let depth = 0;
  let token = '';
  for (const ch of stripComments(body)) {
    if (ch === '{') {
      depth += 1;
      token = '';
      continue;
    }
    if (ch === '}') {
      depth -= 1;
      token = '';
      continue;
    }
    if (depth > 0) continue;
    if (ch === "'" || /[A-Za-z0-9_$-]/.test(ch)) {
      token += ch;
      continue;
    }
    if (ch === ':' && token !== '') {
      keys.push(token.replace(/^'|'$/g, ''));
      token = '';
      continue;
    }
    if (ch === '?' || /\s/.test(ch)) continue; // `key?:` — the question mark does not reset the name
    token = '';
  }
  return keys;
}

/* Option keys and their types come from the interface declaration, then union
   values are resolved through aliases (ActivationKind, TouchMode, MountKind,
   ModifierSpec). */
const OPTIONS_BODY = block(TYPES, 'export interface VisualRegionOptions');
check(OPTIONS_BODY !== null, 'the VisualRegionOptions interface is found in dist/*.d.ts');
const OPTION_KEYS = topLevelKeys(OPTIONS_BODY ?? '');
const OPTION_TYPES = new Map();
for (const m of (OPTIONS_BODY ?? '').matchAll(/^\s*([A-Za-z_$][\w$]*)\?\s*:\s*([^;]+);/gm)) {
  OPTION_TYPES.set(m[1], m[2].trim());
}
check(OPTION_KEYS.length > 0, 'option keys derived from the declaration', `${OPTION_KEYS.length} keys`);

/** Union values of a type: literals plus dereferencing of simple aliases. */
function unionOf(typeText, seen = new Set()) {
  const literals = new Set([...typeText.matchAll(/'([^']+)'/g)].map((m) => m[1]));
  for (const alias of typeText.matchAll(/\b([A-Z][A-Za-z]*)\b/g)) {
    const name = alias[1];
    if (seen.has(name)) continue;
    seen.add(name);
    const decl = new RegExp(`export type ${name} = ([^;]+);`).exec(TYPES);
    if (decl !== null) for (const v of unionOf(decl[1], seen)) literals.add(v);
  }
  return literals;
}

/* ------------------------------------- B. defaults from the runtime source -- */

const SPEC_SRC = readText('src/core/spec.ts');
const INDEX_SRC = readText('src/index.ts');

/* The default value is derived from the normalization, not from a second list.
   The order of the rules follows how spec.ts is written:
     1) `o.key ?? LITERAL`                  — a direct default value;
     2) `o.key === undefined ? LITERAL : …` — the ternary form;
     3) `o.key === true`                    — a boolean flag: "on only if true";
     4) individual expressions that need translating into human form.
   `evidence` is returned so that a failure quotes the source rather than a guess. */
function sourceDefault(key) {
  /* A literal in full: a string literal (with a hyphen inside, like 'top-layer'),
     a number, `null`, or a call such as `documentRoot()`. A greedy `[\w().'-]+` is
     not acceptable here — it swallows the closing parenthesis and the tail of the
     expression. */
  const LITERAL = String.raw`'[^']*'|"[^"]*"|\d+(?:\.\d+)?|null|true|false|[A-Za-z_$][\w$]*\(\)|[A-Za-z_$][\w$]*`;
  const clean = (raw) => raw.replace(/^['"]|['"]$/g, '');
  const nullish = new RegExp(`o\\.${key}\\s*\\?\\?\\s*(${LITERAL})`).exec(SPEC_SRC);
  if (nullish !== null) {
    const value = clean(nullish[1]);
    // `documentRoot()` is `<body>`, or `<html>` if there is no body yet (src/util/env.ts).
    if (value === 'documentRoot()') return { value: 'document.body', evidence: nullish[0] };
    return { value, evidence: nullish[0] };
  }
  const ternary = new RegExp(`o\\.${key}\\s*===\\s*undefined\\s*\\?\\s*(${LITERAL})`).exec(SPEC_SRC);
  if (ternary !== null) return { value: clean(ternary[1]), evidence: ternary[0] };

  if (new RegExp(`o\\.${key}\\s*===\\s*true`).test(SPEC_SRC)) {
    return { value: 'false', evidence: `o.${key} === true` };
  }
  // `disabled` is read in the constructor, not in spec.ts: the instance is
  // enabled unless the user said exactly `true`.
  if (new RegExp(`options\\.${key}\\s*!==\\s*true`).test(INDEX_SRC)) {
    return { value: 'false', evidence: `options.${key} !== true` };
  }
  return null;
}

/* ----------------------------------------------- README and its zones ------ */

const README = readText('README.md');
const ZONES = new Map(); // title → section text (up to the next `## `)
{
  const parts = README.split(/^## /m);
  for (const part of parts.slice(1)) {
    const nl = part.indexOf('\n');
    ZONES.set(part.slice(0, nl).trim(), part.slice(nl + 1));
  }
}
const ROADMAP_TITLE = [...ZONES.keys()].find((t) => /Roadmap/i.test(t)) ?? null;
check(ROADMAP_TITLE !== null, 'the README has a Roadmap section');
check(
  [...ZONES.keys()].some((t) => CURRENT_VERSION_ZONE.test(t)),
  'the README has a section about the current version',
);

const currentText = [...ZONES.entries()]
  .filter(([title]) => title !== ROADMAP_TITLE)
  .map(([, body]) => body)
  .join('\n');
const roadmapText = ROADMAP_TITLE === null ? '' : ZONES.get(ROADMAP_TITLE);

/* --------------------------------------------- C. non-existent API -------- */

console.log('\nA. the README does not describe non-existent API');

{
  const called = new Set([...currentText.matchAll(/`([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]));
  const known = (name) => PUBLIC.has(name) || MEMBERS.has(name) || EXTERNAL.has(name);
  const unknown = [...called].filter((name) => !known(name)).sort();
  check(
    unknown.length === 0,
    'every name in call form in the current sections exists',
    unknown.length === 0
      ? `${called.size} names, all confirmed`
      : `unconfirmed: ${unknown.join(', ')} — either a typo in the README or the name must be added to PUBLIC/MEMBERS/EXTERNAL`,
  );
  const undocumented = [...PUBLIC].filter((name) => !README.includes(name)).sort();
  check(
    undocumented.length === 0,
    'every public name is mentioned in the README',
    undocumented.length === 0
      ? `${PUBLIC.size} names`
      : `missing from the README: ${undocumented.join(', ')}`,
  );
}

/* -------------------------------------------------- D. keys and unions ---- */

console.log('\nB. Option keys and union values');

{
  const tableRows = rowsOf(README, OPTION_ROW).map((m) => ({ key: m[1], type: m[2], def: m[3] }));
  check(tableRows.length > 0, 'the options table is parsed', `${tableRows.length} rows`);

  const documentedKeys = tableRows.map((r) => r.key);
  const phantomKeys = documentedKeys.filter((k) => !OPTION_KEYS.includes(k));
  check(
    phantomKeys.length === 0,
    'the options table has no non-existent keys',
    phantomKeys.length === 0 ? OPTION_KEYS.length + ' keys' : phantomKeys.join(', '),
  );
  const missingKeys = OPTION_KEYS.filter((k) => !documentedKeys.includes(k));
  check(
    missingKeys.length === 0,
    'all option keys are documented',
    missingKeys.length === 0 ? '' : `missing from the table: ${missingKeys.join(', ')}`,
  );

  /* Unions: literals from the type column must belong to the declared type. The
     type name comes from the .d.ts, so the table cannot "invent" a new value. */
  const badLiterals = [];
  for (const row of tableRows) {
    const declared = OPTION_TYPES.get(row.key);
    if (declared === undefined) continue;
    const allowed = unionOf(declared);
    if (allowed.size === 0) continue; // boolean/number/HTMLElement — no literals
    for (const literal of row.type.match(/'([^']+)'/g) ?? []) {
      const value = literal.replace(/'/g, '');
      if (!allowed.has(value)) badLiterals.push(`${row.key}: '${value}' (declared: ${declared})`);
    }
  }
  check(
    badLiterals.length === 0,
    'union values in the options table are declared in the types',
    badLiterals.length === 0 ? '' : badLiterals.join('; '),
  );

  /* data attributes: the list is derived from the markup parser (`data['x']` in
     src/index.ts) rather than from memory. There is no separate hand-written list
     of attributes here. */
  const markup = ZONES.get('Declarative markup') ?? '';
  const parsedAttrs = [...INDEX_SRC.matchAll(/data\['([A-Za-z]+)'\]/g)].map((m) => m[1]);
  const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  const missingAttrs = parsedAttrs.filter((a) => !markup.includes(`data-${kebab(a)}`));
  check(
    parsedAttrs.length > 0 && missingAttrs.length === 0,
    'every data attribute the parser reads is described in the markup section',
    missingAttrs.length === 0
      ? parsedAttrs.map((a) => `data-${kebab(a)}`).join(', ')
      : `missing: ${missingAttrs.map((a) => `data-${kebab(a)}`).join(', ')}`,
  );
  const declaredAttrs = [...markup.matchAll(/^\|\s*`(data-[a-z-]+)`\s*\|/gm)].map((m) => m[1]);
  const phantomAttrs = declaredAttrs.filter((a) => !parsedAttrs.some((k) => `data-${kebab(k)}` === a));
  check(
    phantomAttrs.length === 0,
    'the markup table has no attributes the parser does not read',
    phantomAttrs.length === 0 ? `${declaredAttrs.length} attributes` : phantomAttrs.join(', '),
  );
}

/* --------------------------------------------------------- E. defaults ---- */

console.log('\nC. Defaults: the README against the runtime source');

{
  const rows = rowsOf(README, OPTION_ROW).map((m) => ({
    key: m[1],
    documented: m[3].replace(/^'|'$/g, ''),
  }));
  const mismatched = [];
  const unparsed = [];
  for (const row of rows) {
    if (!OPTION_KEYS.includes(row.key)) continue;
    const source = sourceDefault(row.key);
    if (source === null) {
      unparsed.push(row.key);
      continue;
    }
    if (source.value !== row.documented) {
      mismatched.push(
        `${row.key}: README "${row.documented}", source "${source.value}" (${source.evidence})`,
      );
    }
  }
  check(
    mismatched.length === 0,
    'the defaults in the README match the normalization in src',
    mismatched.length === 0 ? `${rows.length} rows compared` : mismatched.join('; '),
  );
  check(
    unparsed.length === 0,
    "every key's default is derived from the source (no hand-written list)",
    unparsed.length === 0 ? '' : `not derived: ${unparsed.join(', ')} — the rule in sourceDefault is stale`,
  );
}

/* ---------------------------------------------------------- F. events ----- */

console.log('\nD. Events');

{
  const events = topLevelKeys(block(TYPES, 'export interface EventPayloads') ?? '');
  const documented = rowsOf(README, EVENT_ROW).map((m) => m[1]);
  const undocumented = events.filter((e) => !documented.includes(e));
  check(
    events.length > 0 && undocumented.length === 0,
    'every event from EventPayloads is in the README table',
    undocumented.length === 0 ? events.join(', ') : `missing: ${undocumented.join(', ')}`,
  );
}

/* ----------------------------------------------- G. zones and prohibitions - */

console.log('\nE. README zones and forbidden names');

{
  for (const name of FORBIDDEN) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const inCurrent = new RegExp(escaped, 'i').test(currentText);
    check(
      !inCurrent,
      `the forbidden name "${name}" does not appear in the current sections`,
      inCurrent ? 'found — the old API must not look current' : '',
    );
  }

  /* In the roadmap these same names are allowed — but only inside a paragraph
     that says outright that they do not exist. Otherwise the roadmap reads as a
     list of the current API. */
  const paragraphs = (roadmapText ?? '').split(/\n\s*\n/);
  const unmarked = [];
  for (const name of FORBIDDEN) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const p of paragraphs) {
      if (new RegExp(escaped, 'i').test(p) && !NEGATION.test(p)) {
        unmarked.push(`${name} in paragraph: "${p.trim().slice(0, 60)}…"`);
      }
    }
  }
  check(
    unmarked.length === 0,
    'in the roadmap, future and forbidden names are marked as non-existent',
    unmarked.length === 0 ? '' : unmarked.join('; '),
  );
}

/* ------------------------------------------------------- H. examples ------ */

console.log('\nF. Examples: public API only');

{
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.next', 'dist', 'out'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(m?[jt]sx?|html)$/.test(entry.name)) files.push(full);
    }
  };
  walk(path.join(ROOT, 'examples'));

  const hits = [];
  const badImports = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    for (const name of FORBIDDEN) {
      if (text.includes(name)) hits.push(`${rel}: ${name}`);
    }
    /* The link to the library is by package name only. A relative path into dist/
       is allowed in exactly one place: the import map in HTML, where there is no
       bundler at all. */
    if (!file.endsWith('.html')) {
      for (const m of text.matchAll(/from\s+'([^']+)'|require\('([^']+)'\)/g)) {
        const spec = m[1] ?? m[2];
        if (spec.startsWith('.') && /(^|\/)dist\//.test(spec)) badImports.push(`${rel} → ${spec}`);
      }
    }
  }
  check(files.length > 0, 'example files found', `${files.length} files`);
  check(hits.length === 0, 'the examples contain no forbidden old names', hits.join('; '));
  check(
    badImports.length === 0,
    'the examples link the library by package name, not by a relative path into dist',
    badImports.join('; '),
  );
}

console.log(
  failures === 0 ? '\nRESULT: the documentation matches the API' : `\nRESULT: ${failures} failures`,
);
process.exit(failures === 0 ? 0 : 1);
