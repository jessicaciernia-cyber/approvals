/* Expand a zip of slides, in the browser, with no library.
 *
 * Canva exports a carousel as a zip of numbered PNGs. This reads the zip's central
 * directory, pulls out the image entries, inflates the deflated ones with the browser's
 * own DecompressionStream, and hands back File objects in natural filename order, so
 * "10.png" follows "9.png" rather than "1.png". Folders, dotfiles, and the __MACOSX
 * shadow entries are skipped. Only stored and deflated entries are understood, which is
 * every zip Canva, Finder, and Explorer produce.
 */
(function () {
  "use strict";
  var TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" };

  function u16(v, o) { return v.getUint16(o, true); }
  function u32(v, o) { return v.getUint32(o, true); }

  function extOf(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name);
    return m ? m[1].toLowerCase() : "";
  }

  function keep(name) {
    if (name.slice(-1) === "/") return false;
    var parts = name.split("/");
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "__MACOSX" || parts[i].charAt(0) === ".") return false;
    }
    return !!TYPES[extOf(name)];
  }

  /* "2.png" before "10.png": compare digit runs as numbers, everything else as text. */
  function natural(a, b) {
    var ra = a.toLowerCase().split(/(\d+)/), rb = b.toLowerCase().split(/(\d+)/);
    for (var i = 0; i < Math.max(ra.length, rb.length); i++) {
      var x = ra[i] || "", y = rb[i] || "";
      if (x === y) continue;
      var nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
      if (nx && ny) return Number(x) - Number(y);
      return x < y ? -1 : 1;
    }
    return 0;
  }

  function inflate(bytes) {
    var ds = new DecompressionStream("deflate-raw");
    var w = ds.writable.getWriter();
    w.write(bytes); w.close();
    return new Response(ds.readable).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  function decodeName(bytes) {
    try { return new TextDecoder("utf-8").decode(bytes); } catch (e) { return ""; }
  }

  function entries(buf) {
    var v = new DataView(buf), n = buf.byteLength;
    var eocd = -1;
    for (var i = n - 22; i >= Math.max(0, n - 22 - 65535); i--) {
      if (u32(v, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("Not a zip file");
    var count = u16(v, eocd + 10), off = u32(v, eocd + 16);
    var out = [];
    for (var k = 0; k < count; k++) {
      if (u32(v, off) !== 0x02014b50) throw new Error("Zip directory is damaged");
      var method = u16(v, off + 10);
      var csize = u32(v, off + 20), usize = u32(v, off + 24);
      var nlen = u16(v, off + 28), xlen = u16(v, off + 30), clen = u16(v, off + 32);
      var local = u32(v, off + 42);
      var name = decodeName(new Uint8Array(buf, off + 46, nlen));
      out.push({ name: name, method: method, csize: csize, usize: usize, local: local });
      off += 46 + nlen + xlen + clen;
    }
    return out;
  }

  function extract(buf, e) {
    var v = new DataView(buf);
    if (u32(v, e.local) !== 0x04034b50) return Promise.reject(new Error("Zip entry is damaged: " + e.name));
    var start = e.local + 30 + u16(v, e.local + 26) + u16(v, e.local + 28);
    var bytes = new Uint8Array(buf, start, e.csize);
    if (e.method === 0) return Promise.resolve(bytes);
    if (e.method === 8) return inflate(bytes);
    return Promise.reject(new Error("Unsupported compression in " + e.name));
  }

  /* Resolves with File objects for every image in the zip, in natural order. */
  function unzip(file) {
    return file.arrayBuffer().then(function (buf) {
      var list = entries(buf).filter(function (e) { return keep(e.name); });
      list.sort(function (a, b) { return natural(a.name, b.name); });
      return Promise.all(list.map(function (e) {
        return extract(buf, e).then(function (bytes) {
          var base = e.name.split("/").pop();
          return new File([bytes], base, { type: TYPES[extOf(base)] });
        });
      }));
    });
  }

  window.ApprovalUnzip = { unzip: unzip, natural: natural, keep: keep };
})();
