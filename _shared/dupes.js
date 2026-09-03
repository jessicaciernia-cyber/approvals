/* Duplicate detection for uploads, done in the browser before anything is sent.
 *
 * Each slide becomes a 256-bit average hash: shrink to 16x16, grey it the ITU-R 601 way,
 * and mark each cell brighter or darker than the mean. Two slides are "the same" when
 * their hashes differ in at most 14 bits, which survives re-exports, JPEG, small crops,
 * and the 5 or so bits of drift between a browser's resampler and Python's, but not
 * different artwork, which lands 60 bits or more apart. A post is a duplicate of
 * another when the covers match or at least half of its slides match.
 *
 * The same recipe runs in Python at build time for the built decks and for backfills,
 * so a hash made here compares against one made there.
 */
(function () {
  "use strict";
  var SIZE = 16, NEAR = 14;

  /* pixels: RGBA Uint8ClampedArray of a SIZE x SIZE image. Returns 64 hex chars. */
  function hashFromPixels(pixels) {
    var n = SIZE * SIZE, grey = new Array(n), sum = 0, i;
    for (i = 0; i < n; i++) {
      var r = pixels[i * 4], g = pixels[i * 4 + 1], b = pixels[i * 4 + 2];
      grey[i] = 0.299 * r + 0.587 * g + 0.114 * b;
      sum += grey[i];
    }
    var mean = sum / n, hex = "", nib = 0;
    for (i = 0; i < n; i++) {
      nib = (nib << 1) | (grey[i] > mean ? 1 : 0);
      if ((i & 3) === 3) { hex += nib.toString(16); nib = 0; }
    }
    return hex;
  }

  /* Draw a File onto a 16x16 canvas and hash it. Resolves with the hex string. */
  function hashFile(file) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var c = document.createElement("canvas");
        c.width = SIZE; c.height = SIZE;
        var ctx = c.getContext("2d");
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, SIZE, SIZE);
        res(hashFromPixels(ctx.getImageData(0, 0, SIZE, SIZE).data));
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("Could not read " + file.name)); };
      img.src = url;
    });
  }

  var POP = [];
  for (var v = 0; v < 16; v++) POP[v] = (v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1) + ((v >> 3) & 1);

  function hamming(a, b) {
    if (!a || !b || a.length !== b.length) return 256;
    var d = 0;
    for (var i = 0; i < a.length; i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
    return d;
  }

  /* newHashes: the picked slides. existing: [{title, hashes, when}]. Returns the best
     match as {title, when, matched, of, cover} or null. */
  function findDuplicates(newHashes, existing) {
    var best = null;
    (existing || []).forEach(function (e) {
      var hs = e.hashes || [];
      if (!hs.length || !newHashes.length) return;
      var cover = hamming(newHashes[0], hs[0]) <= NEAR;
      var matched = 0;
      newHashes.forEach(function (h) {
        for (var i = 0; i < hs.length; i++) if (hamming(h, hs[i]) <= NEAR) { matched++; break; }
      });
      var half = Math.ceil(Math.min(newHashes.length, hs.length) / 2);
      if (cover || matched >= half) {
        var score = matched + (cover ? 100 : 0);
        if (!best || score > best.score) best = { title: e.title, when: e.when || "", matched: matched, of: newHashes.length, cover: cover, score: score };
      }
    });
    if (best) delete best.score;
    return best;
  }

  window.ApprovalDupes = { hashFromPixels: hashFromPixels, hashFile: hashFile, hamming: hamming, findDuplicates: findDuplicates, NEAR: NEAR };
})();
