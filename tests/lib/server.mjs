/*
 * Test static server. Needed not only to serve files (modules do not load over
 * file:// because of CORS), but also to be able to serve a page WITH A CSP
 * HEADER: the check "does the library work under strict CSP" is otherwise
 * unreproducible.
 *
 * No dependencies: node:http + node:fs.
 *
 * Prefixed routes serve the same file but with a policy:
 *   /csp/…      → default-src 'self'; style-src 'self'
 *   /csp-attr/… → the same + style-src-attr 'none'   (the strictest case for us)
 *   /csp-dist/… → the same, but the built package's page (`dist/`, not `.tmp-build`)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  /* The demo serves a short mp4 to this same machine (scripts/serve-demo.mjs).
     Without the right type the browser refuses to play it, and "the video does
     not play" looks like a demo defect rather than a missing MIME line. */
  '.mp4': 'video/mp4',
};

/* Routes for the SOURCE page (`tests/smoke/page.html`, loads `.tmp-build`). */
export const CSP_VARIANTS = {
  '/csp/': "default-src 'self'; style-src 'self'",
  '/csp-attr/': "default-src 'self'; style-src 'self'; style-src-attr 'none'",
};

/* The same strict set, but this prefix serves the built package's scenario page
   (`tests/smoke/dist.html`) — that is, under the policy the production artifact
   from `dist/` is checked, not the `tsc` build of `src` (`.tmp-build`).
   A separate export rather than a string in `CSP_VARIANTS`: these routes use a
   different page and different checks, and the runner walks them in its own
   loop. */
export const CSP_DIST_VARIANTS = {
  '/csp-dist/': "default-src 'self'; style-src 'self'; style-src-attr 'none'",
};

const CSP_ROUTES = { ...CSP_VARIANTS, ...CSP_DIST_VARIANTS };

export function startServer(root, port) {
  const rootAbs = path.resolve(root);
  const server = http.createServer((req, res) => {
    let urlPath;
    try {
      urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      res.writeHead(400);
      res.end('bad url');
      return;
    }

    let csp = null;
    for (const [prefix, policy] of Object.entries(CSP_ROUTES)) {
      if (urlPath.startsWith(prefix)) {
        csp = policy;
        urlPath = '/' + urlPath.slice(prefix.length);
        break;
      }
    }

    if (urlPath.endsWith('/')) urlPath += 'index.html';
    const file = path.join(rootAbs, urlPath);
    if (!file.startsWith(rootAbs)) {
      res.writeHead(403);
      res.end('forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found: ' + urlPath);
        return;
      }
      const headers = {
        'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      };
      if (csp !== null) {
        headers['content-security-policy'] = csp;
        headers['x-content-type-options'] = 'nosniff';
      }
      res.writeHead(200, headers);
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () =>
      resolve({
        port,
        origin: `http://127.0.0.1:${port}`,
        close: () => new Promise((r) => server.close(r)),
      }),
    );
  });
}
