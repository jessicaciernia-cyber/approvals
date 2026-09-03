// Exercises _shared/uploads-api.js against a stubbed fetch, so every network path is
// asserted without a login or a live project. Run:  node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, "..", "_shared", "uploads-api.js"), "utf8");
const URL_ = "https://proj.supabase.co";
const KEY = "anon-key";
const TOKEN = "user-token";

function load({ session = null, routes = {} } = {}) {
  const calls = [];
  const store = new Map();
  if (session) store.set("approval-uploads-session", JSON.stringify(session));
  const fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || "GET", headers: opts.headers || {}, body: opts.body });
    for (const [pat, handler] of Object.entries(routes)) {
      if (url.includes(pat)) {
        const r = typeof handler === "function" ? handler({ url, opts, calls }) : handler;
        return mkRes(r);
      }
    }
    return mkRes({ status: 200, body: [] });
  };
  const win = {
    APPROVAL_COMMENTS: { url: URL_, key: KEY, site: "welliemd" },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k)
    },
    crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" },
    fetch
  };
  const ctx = vm.createContext({ window: win, localStorage: win.localStorage, crypto: win.crypto, fetch, JSON, Date, Number, String, Error, Promise, Object, Array, Math, encodeURIComponent });
  vm.runInContext(src, ctx);
  return { api: win.ApprovalUploads, calls, store };
}

function mkRes({ status = 200, body = "" }) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}

const live = { access_token: TOKEN, refresh_token: "r", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u" } };
const png = (n = 10) => ({ type: "image/png", size: n });
const jpg = (n = 10) => ({ type: "image/jpeg", size: n });

test("validation runs before any fetch", async () => {
  const { api, calls } = load({ session: live });
  await assert.rejects(api.createUpload({ site: "nope", title: "t", files: [png()] }), /welliemd or zenjessica/);
  await assert.rejects(api.createUpload({ site: "welliemd", title: "   ", files: [png()] }), /Title/);
  await assert.rejects(api.createUpload({ site: "welliemd", title: "t", caption: "x".repeat(2201), files: [png()] }), /Caption/);
  await assert.rejects(api.createUpload({ site: "welliemd", title: "t", files: [] }), /1 to 10/);
  await assert.rejects(api.createUpload({ site: "welliemd", title: "t", files: Array(11).fill(png()) }), /1 to 10/);
  await assert.rejects(api.createUpload({ site: "welliemd", title: "t", files: [{ type: "image/gif", size: 1 }] }), /PNG or JPEG/);
  await assert.rejects(api.createUpload({ site: "welliemd", title: "t", files: [png(8388609)] }), /8 MB/);
  assert.equal(calls.length, 0);
});

test("signed out: createUpload rejects Not signed in with no network", async () => {
  const { api, calls } = load();
  await assert.rejects(api.createUpload({ site: "welliemd", title: "t", files: [png()] }), /Not signed in/);
  assert.equal(calls.length, 0);
});

test("createUpload: paths, bearer, order, row insert, progress", async () => {
  const seen = [];
  const { api, calls } = load({
    session: live,
    routes: {
      "/storage/v1/object/approvals-uploads/": { status: 200, body: { Key: "ok" } },
      "/rest/v1/approval_uploads": ({ opts }) => ({ status: 201, body: [JSON.parse(opts.body)] })
    }
  });
  const row = await api.createUpload({
    site: "zenjessica", title: "  Hello  ", caption: "cap",
    files: [png(), jpg(), png()],
    onProgress: (i, n) => seen.push([i, n])
  });
  const id = "11111111-1111-4111-8111-111111111111";
  assert.deepEqual(row.slides, [`zenjessica/${id}/01.png`, `zenjessica/${id}/02.jpg`, `zenjessica/${id}/03.png`]);
  assert.equal(row.title, "Hello");
  assert.deepEqual(seen, [[1, 3], [2, 3], [3, 3]]);
  const writes = calls.filter((c) => c.method !== "GET");
  assert.equal(writes.length, 4);
  for (const c of writes) assert.equal(c.headers.Authorization, "Bearer " + TOKEN, c.url);
  assert.ok(writes.slice(0, 3).every((c) => c.headers["x-upsert"] === "false"));
  assert.equal(writes[3].headers.Prefer, "return=representation");
});

test("createUpload: a failed file removes what was already uploaded, original error surfaces", async () => {
  let n = 0;
  const { api, calls } = load({
    session: live,
    routes: {
      "/storage/v1/object/approvals-uploads/": () => (++n === 2 ? { status: 413, body: { message: "too big" } } : { status: 200, body: {} }),
      "/storage/v1/object/approvals-uploads": { status: 200, body: [] }
    }
  });
  await assert.rejects(api.createUpload({ site: "welliemd", title: "t", files: [png(), png(), png()] }), /too big/);
  const del = calls.find((c) => c.method === "DELETE");
  assert.ok(del, "cleanup DELETE issued");
  assert.deepEqual(JSON.parse(del.body).prefixes, ["welliemd/11111111-1111-4111-8111-111111111111/01.png"]);
  assert.ok(!calls.some((c) => c.url.includes("/rest/v1/")), "row insert never attempted");
});

test("createUpload: a failed row insert removes every uploaded object", async () => {
  const { api, calls } = load({
    session: live,
    routes: {
      "/storage/v1/object/approvals-uploads/": { status: 200, body: {} },
      "/rest/v1/approval_uploads": { status: 401, body: { message: "new row violates row-level security policy" } },
      "/storage/v1/object/approvals-uploads": { status: 200, body: [] }
    }
  });
  await assert.rejects(api.createUpload({ site: "welliemd", title: "t", files: [png(), png()] }), /row-level security/);
  const del = calls.find((c) => c.method === "DELETE");
  assert.equal(JSON.parse(del.body).prefixes.length, 2);
});

test("deleteUpload: empty array from PostgREST is a refusal", async () => {
  const { api } = load({
    session: live,
    routes: { "/storage/v1/object/approvals-uploads": { status: 200, body: [] }, "/rest/v1/approval_uploads?id=eq.": { status: 200, body: [] } }
  });
  await assert.rejects(api.deleteUpload({ id: "abc", slides: ["welliemd/abc/01.png"] }), /Delete was refused/);
});

test("deleteUpload: objects first, then row, bearer is the user token", async () => {
  const { api, calls } = load({
    session: live,
    routes: { "/storage/v1/object/approvals-uploads": { status: 200, body: [] }, "/rest/v1/approval_uploads?id=eq.": { status: 200, body: [{ id: "abc" }] } }
  });
  const out = await api.deleteUpload({ id: "abc", slides: ["welliemd/abc/01.png", "welliemd/abc/02.png"] });
  assert.equal(out.id, "abc");
  assert.equal(calls[0].method, "DELETE"); assert.ok(calls[0].url.endsWith("/storage/v1/object/approvals-uploads"));
  assert.equal(calls[1].method, "DELETE"); assert.ok(calls[1].url.includes("/rest/v1/approval_uploads?id=eq.abc"));
  for (const c of calls) assert.equal(c.headers.Authorization, "Bearer " + TOKEN);
});

test("listUploads: anon bearer signed out, user token signed in, correct query", async () => {
  const a = load();
  await a.api.listUploads("welliemd");
  assert.equal(a.calls[0].headers.Authorization, "Bearer " + KEY);
  assert.ok(a.calls[0].url.includes("site=eq.welliemd") && a.calls[0].url.includes("order=created_at.desc"));
  const b = load({ session: live });
  await b.api.listUploads("zenjessica");
  assert.equal(b.calls[0].headers.Authorization, "Bearer " + TOKEN);
});

test("publicUrl encodes each segment and keeps slashes", () => {
  const { api } = load();
  assert.equal(api.publicUrl("welliemd/a b/01.png"), URL_ + "/storage/v1/object/public/approvals-uploads/welliemd/a%20b/01.png");
});

test("session and ensureSession: expiry margin and refresh", async () => {
  const soon = { ...live, expires_at: Math.floor(Date.now() / 1000) + 30 };
  const { api, calls, store } = load({
    session: soon,
    routes: { "grant_type=refresh_token": { status: 200, body: { access_token: "new", refresh_token: "r2", expires_in: 3600 } } }
  });
  assert.equal(api.session(), null, "30s left counts as expired");
  const s = await api.ensureSession();
  assert.equal(s.access_token, "new");
  assert.ok(calls[0].url.includes("grant_type=refresh_token"));
  assert.equal(JSON.parse(store.get("approval-uploads-session")).refresh_token, "r2");
});

test("ensureSession: failed refresh clears the store and rejects", async () => {
  const stale = { ...live, expires_at: 1 };
  const { api, store } = load({ session: stale, routes: { "grant_type=refresh_token": { status: 400, body: { error_description: "invalid" } } } });
  await assert.rejects(api.ensureSession(), /Not signed in/);
  assert.equal(store.has("approval-uploads-session"), false);
});

test("signIn stores the session and returns the user", async () => {
  const { api, calls, store } = load({
    routes: { "grant_type=password": { status: 200, body: { access_token: "t", refresh_token: "r", expires_in: 3600, user: { id: "u1" } } } }
  });
  const u = await api.signIn("a@b.c", "pw");
  assert.equal(u.id, "u1");
  assert.equal(calls[0].headers.apikey, KEY);
  assert.equal(calls[0].headers.Authorization, undefined, "no bearer on sign-in");
  assert.ok(store.has("approval-uploads-session"));
});

test("draftCaption: validates, requires a session, posts to the function with the user token", async () => {
  const off = load();
  await assert.rejects(off.api.draftCaption({ site: "welliemd", images: [{ media_type: "image/jpeg", data: "x" }] }), /Not signed in/);
  assert.equal(off.calls.length, 0);
  const { api, calls } = load({
    session: live,
    routes: { "/functions/v1/caption": ({ opts }) => ({ status: 200, body: { caption: "C", hashtags: "#a", flags: [], echo: JSON.parse(opts.body) } }) }
  });
  await assert.rejects(api.draftCaption({ site: "nope", images: [{ media_type: "image/jpeg", data: "x" }] }), /welliemd or zenjessica/);
  await assert.rejects(api.draftCaption({ site: "welliemd", images: [] }), /1 to 10/);
  await assert.rejects(api.draftCaption({ site: "welliemd", images: Array(11).fill({ media_type: "image/jpeg", data: "x" }) }), /1 to 10/);
  await assert.rejects(api.draftCaption({ site: "welliemd", images: [{ media_type: "image/gif", data: "x" }] }), /not a JPEG or PNG/);
  assert.equal(calls.length, 0, "validation before any fetch");
  const d = await api.draftCaption({ site: "zenjessica", title: "T".repeat(200), images: [{ media_type: "image/jpeg", data: "abc" }] });
  assert.equal(d.caption, "C");
  assert.equal(calls[0].method, "POST");
  assert.ok(calls[0].url.endsWith("/functions/v1/caption"));
  assert.equal(calls[0].headers.Authorization, "Bearer " + TOKEN);
  assert.equal(d.echo.site, "zenjessica");
  assert.equal(d.echo.title.length, 120, "title capped at 120");
  assert.deepEqual(d.echo.images, [{ media_type: "image/jpeg", data: "abc" }]);
});

test("createUpload: hashes ride along when given, are validated, and are omitted when empty", async () => {
  const H = "0".repeat(64);
  const { api, calls } = load({
    session: live,
    routes: {
      "/storage/v1/object/approvals-uploads/": { status: 200, body: {} },
      "/rest/v1/approval_uploads": ({ opts }) => ({ status: 201, body: [JSON.parse(opts.body)] })
    }
  });
  await assert.rejects(api.createUpload({ site: "welliemd", title: "t", files: [png(), png()], hashes: [H] }), /hashes do not match/);
  await assert.rejects(api.createUpload({ site: "welliemd", title: "t", files: [png()], hashes: ["nothex"] }), /hashes do not match/);
  assert.equal(calls.length, 0);
  const row = await api.createUpload({ site: "welliemd", title: "t", files: [png(), png()], hashes: [H, H] });
  assert.deepEqual(row.hashes, [H, H]);
  const plain = await api.createUpload({ site: "welliemd", title: "t", files: [png()] });
  assert.equal("hashes" in plain, false, "no hashes key when none were computed");
});

test("listUploads asks for the hashes column", async () => {
  const a = load();
  await a.api.listUploads("welliemd");
  assert.ok(a.calls[0].url.includes("hashes"));
});
