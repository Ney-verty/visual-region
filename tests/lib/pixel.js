/*
 * Pixel comparator executed INSIDE THE PAGE itself.
 *
 * Why: the environment has no PNG decoder (no PIL, no ImageMagick), so
 * Playwright screenshots are decoded by the browser: blob → createImageBitmap →
 * canvas → getImageData. Only aggregates leave the page, not megabytes of pixels.
 *
 * Difference criterion: after[i] ≈ |before[i] - operand[i]| per channel, where the operand is
 * the effect colour. Inversion is the private case operand = [255, 255, 255].
 * Comparing "before" and "after" at the SAME pixel is robust to font
 * antialiasing, gradient dithering and video codec artifacts.
 */
(function () {
  'use strict';

  function canvasOf(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var n = bin.length;
    var a = new Uint8Array(n);
    for (var i = 0; i < n; i++) a[i] = bin.charCodeAt(i);
    return a;
  }

  function decode(b64) {
    var bytes = b64ToBytes(b64);
    var blob = new Blob([bytes], { type: 'image/png' });
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(blob)
        .then(function (bmp) {
          var c = canvasOf(bmp.width, bmp.height);
          var x = c.getContext('2d', { willReadFrequently: true });
          x.drawImage(bmp, 0, 0);
          if (bmp.close) bmp.close();
          return { w: bmp.width, h: bmp.height, data: x.getImageData(0, 0, bmp.width, bmp.height).data };
        })
        .catch(function () {
          return decodeViaImg(b64);
        });
    }
    return decodeViaImg(b64);
  }

  function decodeViaImg(b64) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () {
        var c = canvasOf(img.naturalWidth, img.naturalHeight);
        var x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(img, 0, 0);
        resolve({
          w: img.naturalWidth,
          h: img.naturalHeight,
          data: x.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data,
        });
      };
      img.onerror = function () {
        reject(new Error('png decode failed'));
      };
      img.src = 'data:image/png;base64,' + b64;
    });
  }

  /*
   * Optional `transform(value, channel)` is applied per pixel BEFORE averaging. The effect is
   * not affine: abs(avg(before) - operand) is not avg(abs(before - operand)), so the expected
   * colour must be built from the transformed pixels, not from the average.
   */
  function avgBox(im, box, transform) {
    var x0 = Math.max(0, Math.round(box.x)),
      y0 = Math.max(0, Math.round(box.y));
    var x1 = Math.min(im.w, x0 + Math.round(box.w)),
      y1 = Math.min(im.h, y0 + Math.round(box.h));
    var acc = [0, 0, 0],
      n = 0;
    for (var y = y0; y < y1; y++) {
      var row = y * im.w * 4;
      for (var x = x0; x < x1; x++) {
        var i = row + x * 4;
        for (var k = 0; k < 3; k++) {
          var v = im.data[i + k];
          acc[k] += transform ? transform(v, k) : v;
        }
        n++;
      }
    }
    if (!n) return null;
    return [Math.round(acc[0] / n), Math.round(acc[1] / n), Math.round(acc[2] / n)];
  }

  /* Spread inside the box: if it is large, the "average color" is a poor metric. */
  function spreadBox(im, box) {
    var x0 = Math.max(0, Math.round(box.x)),
      y0 = Math.max(0, Math.round(box.y));
    var x1 = Math.min(im.w, x0 + Math.round(box.w)),
      y1 = Math.min(im.h, y0 + Math.round(box.h));
    var mn = [255, 255, 255],
      mx = [0, 0, 0];
    for (var y = y0; y < y1; y++) {
      var row = y * im.w * 4;
      for (var x = x0; x < x1; x++) {
        var i = row + x * 4;
        for (var k = 0; k < 3; k++) {
          var v = im.data[i + k];
          if (v < mn[k]) mn[k] = v;
          if (v > mx[k]) mx[k] = v;
        }
      }
    }
    return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
  }

  /*
   * opts:
   *   boxes: [{ label, x, y, w, h, mode: 'complement'|'unchanged' }]
   *     'complement' — expect after ≈ |before - operand| (the effect applied; for the default
   *                    white operand that is exactly the inversion 255 - before)
   *     'unchanged'  — expect after ≈ before      (no effect expected)
   *   operand: [r,g,b] of the effect colour (default [255,255,255])
   *   tol: per-channel tolerance (default 3)
   *   region: {x,y,w,h} — area for the per-pixel check |after - |before - operand||
   */
  function compare(beforeB64, afterB64, opts) {
    opts = opts || {};
    var tol = opts.tol == null ? 3 : opts.tol;
    var operand = opts.operand || [255, 255, 255];
    return Promise.all([decode(beforeB64), decode(afterB64)]).then(function (pair) {
      var A = pair[0],
        B = pair[1];
      var out = { size: { w: A.w, h: A.h }, boxes: [], tol: tol };

      (opts.boxes || []).forEach(function (box) {
        var b = avgBox(A, box),
          a = avgBox(B, box);
        if (!b || !a) {
          out.boxes.push({ label: box.label, error: 'empty box' });
          return;
        }
        var want =
          box.mode === 'unchanged'
            ? b
            : avgBox(A, box, function (v, k) {
                return Math.abs(v - operand[k]);
              });
        var err = [Math.abs(a[0] - want[0]), Math.abs(a[1] - want[1]), Math.abs(a[2] - want[2])];
        out.boxes.push({
          label: box.label,
          mode: box.mode || 'complement',
          before: b,
          after: a,
          expected: want,
          err: err,
          errMax: Math.max(err[0], err[1], err[2]),
          ok: err[0] <= tol && err[1] <= tol && err[2] <= tol,
          spreadBefore: spreadBox(A, box),
        });
      });

      var reg = opts.region;
      if (reg) {
        var x0 = Math.max(0, Math.round(reg.x)),
          y0 = Math.max(0, Math.round(reg.y));
        var x1 = Math.min(A.w, x0 + Math.round(reg.w)),
          y1 = Math.min(A.h, y0 + Math.round(reg.h));
        var n = 0,
          match = 0,
          strict = 0,
          sum = 0,
          max = 0;
        var buckets = { 0: 0, '<=3': 0, '<=10': 0, '<=40': 0, '>40': 0 };
        var bNonWhite = 0;
        for (var y = y0; y < y1; y++) {
          var row = y * A.w * 4;
          for (var x = x0; x < x1; x++) {
            var i = row + x * 4;
            var e = 0;
            for (var k = 0; k < 3; k++) {
              var br = A.data[i + k],
                ar = B.data[i + k];
              e += Math.abs(ar - Math.abs(br - operand[k]));
            }
            e = e / 3;
            n++;
            sum += e;
            if (e > max) max = e;
            if (e <= tol) match++;
            if (e <= 1) strict++;
            if (e <= 3) buckets['<=3']++;
            else if (e <= 10) buckets['<=10']++;
            else if (e <= 40) buckets['<=40']++;
            else buckets['>40']++;
            if (A.data[i] < 250 || A.data[i + 1] < 250 || A.data[i + 2] < 250) bNonWhite++;
          }
        }
        out.region = {
          n: n,
          match: match,
          ratio: n ? +(match / n).toFixed(4) : 0,
          strictRatio: n ? +(strict / n).toFixed(4) : 0,
          mae: n ? +(sum / n).toFixed(3) : 0,
          maxErr: +max.toFixed(1),
          nonWhiteBefore: bNonWhite,
          buckets: buckets,
        };
      }
      return out;
    });
  }

  window.__px = { decode: decode, compare: compare, avgBox: avgBox };
})();
