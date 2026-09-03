// The hash, the distance, and the duplicate rule, on synthetic pixels and hashes.
// Run:  node --test tests/dupes.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "_shared", "dupes.js"), "utf8");

function load() {
  const win = {};
  const ctx = vm.createContext({ window: win, Math, Array, parseInt, Promise, Error });
  vm.runInContext(src, ctx);
  return win.ApprovalDupes;
}

// a 16x16 RGBA image: left half dark, right half bright
function halfImage(flipBits = 0) {
  const px = new Uint8ClampedArray(16 * 16 * 4);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const i = (y * 16 + x) * 4, v = x < 8 ? 30 : 220;
    px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
  }
  for (let k = 0; k < flipBits; k++) { const i = (k * 16 + 7) * 4; px[i] = px[i + 1] = px[i + 2] = 220; } // flip cells on column 7
  return px;
}

test("hash is 64 hex chars and deterministic", () => {
  const d = load();
  const h = d.hashFromPixels(halfImage());
  assert.equal(h.length, 64);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, d.hashFromPixels(halfImage()));
  // left half dark, right half bright: each row is 00000000 11111111 = 0x00ff
  assert.equal(h, "00ff".repeat(16));
});

test("hamming counts differing bits; small edits stay under NEAR, different art does not", () => {
  const d = load();
  const a = d.hashFromPixels(halfImage());
  const b = d.hashFromPixels(halfImage(4));
  assert.equal(d.hamming(a, a), 0);
  assert.equal(d.hamming(a, b), 4);
  assert.ok(d.hamming(a, b) <= d.NEAR);
  const inverted = "ff00".repeat(16);
  assert.equal(d.hamming(a, inverted), 256);
  assert.equal(d.hamming(a, "zz"), 256, "malformed compares as far");
});

test("findDuplicates: cover match flags, half-set match flags, otherwise null", () => {
  const d = load();
  const H = (s) => s.repeat(16);
  const A = H("00ff"), B = H("0f0f"), C = H("ff00"), D = H("f0f0"), E = H("aaaa"), F = H("5555");
  const existing = [
    { title: "Old post", when: "Sep 3", hashes: [A, B, C, D] },
    { title: "Other", when: "Sep 1", hashes: [E, F, E, F] },
  ];
  // same cover, everything else different -> flagged on the cover
  let r = d.findDuplicates([A, H("1111"), H("2222"), H("3333")], existing);
  assert.equal(r.title, "Old post"); assert.equal(r.cover, true); assert.equal(r.matched, 1);
  // different cover, 2 of 4 slides shared -> flagged on the half rule
  r = d.findDuplicates([H("1111"), B, C, H("3333")], existing);
  assert.equal(r.title, "Old post"); assert.equal(r.cover, false); assert.equal(r.matched, 2); assert.equal(r.of, 4);
  // one shared slide out of 4, different cover -> not a duplicate
  r = d.findDuplicates([H("1111"), B, H("2222"), H("3333")], existing);
  assert.equal(r, null);
  // nothing in common
  assert.equal(d.findDuplicates([H("1111"), H("2222")], existing), null);
  // the closer of two candidates wins
  r = d.findDuplicates([E, F, E, F], existing);
  assert.equal(r.title, "Other"); assert.equal(r.matched, 4);
});
