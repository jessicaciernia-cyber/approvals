// Builds real zip bytes by hand (stored and deflated entries, a folder, a __MACOSX
// shadow, a text file) and checks unzip.js returns only the images, in natural order,
// with the right bytes. Run:  node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "_shared", "unzip.js"), "utf8");

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const locals = [], centrals = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const data = Buffer.from(f.data || "");
    const deflate = f.method === 8;
    const comp = deflate ? zlib.deflateRawSync(data) : data;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(deflate ? 8 : 0, 8); lh.writeUInt32LE(0, 10);
    lh.writeUInt32LE(crc32(data), 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(deflate ? 8 : 0, 10); ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc32(data), 16);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28);
    ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32); ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38); ch.writeUInt32LE(off, 42);
    locals.push(lh, name, comp); centrals.push(ch, name);
    off += lh.length + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(off, 16); eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

function load() {
  const win = {};
  const ctx = vm.createContext({ window: win, DecompressionStream, Response, File, TextDecoder, DataView, Uint8Array, Promise, Number, Math, Error, RegExp });
  vm.runInContext(src, ctx);
  return win.ApprovalUnzip;
}

const asFile = (buf, name) => new File([buf], name, { type: "application/zip" });

test("images only, natural order, stored and deflated bytes intact", async () => {
  const png = (s) => "\x89PNG-" + s;
  const bytes = zip([
    { name: "carousel/", data: "" },
    { name: "carousel/10.png", data: png("ten"), method: 8 },
    { name: "carousel/2.png", data: png("two"), method: 0 },
    { name: "__MACOSX/carousel/._1.png", data: "junk" },
    { name: "carousel/notes.txt", data: "not an image" },
    { name: "carousel/1.png", data: png("one"), method: 8 },
    { name: "carousel/cover.jpg", data: "\xff\xd8jpeg", method: 8 },
    { name: "carousel/.DS_Store", data: "x" }
  ]);
  const out = await load().unzip(asFile(bytes, "carousel.zip"));
  assert.deepEqual(out.map((f) => f.name), ["1.png", "2.png", "10.png", "cover.jpg"]);
  assert.deepEqual(out.map((f) => f.type), ["image/png", "image/png", "image/png", "image/jpeg"]);
  const texts = await Promise.all(out.map((f) => f.text()));
  assert.deepEqual(texts, [png("one"), png("two"), png("ten"), "\xff\xd8jpeg"]);
});

test("natural sort handles Canva-style names", () => {
  const { natural } = load();
  const names = ["Slide 10.png", "Slide 2.png", "Slide 1.png", "slide 3.PNG"];
  assert.deepEqual(names.slice().sort(natural), ["Slide 1.png", "Slide 2.png", "slide 3.PNG", "Slide 10.png"]);
});

test("keep() drops folders, dotfiles, __MACOSX, and non-images", () => {
  const { keep } = load();
  assert.equal(keep("a/"), false);
  assert.equal(keep(".hidden.png"), false);
  assert.equal(keep("__MACOSX/x.png"), false);
  assert.equal(keep("x/notes.txt"), false);
  assert.equal(keep("x/y.PNG"), true);
  assert.equal(keep("y.jpeg"), true);
});

test("not a zip is a clear error", async () => {
  await assert.rejects(load().unzip(asFile(Buffer.from("hello"), "x.zip")), /Not a zip/);
});
