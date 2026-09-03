// The refusal branches and the happy path, with Auth and the model stubbed.
// Run:  deno test --allow-env supabase/functions/caption/
import { handle, type Deps, type Img } from "./index.ts";
import { assertEquals } from "jsr:@std/assert@1";

const OWNER = "92e12e4e-2792-44b4-a6e5-ecfd582d97f9";
const good: Img = { media_type: "image/jpeg", data: "abc" };

function deps(over: Partial<Deps> = {}): Deps {
  return {
    whoAmI: async (jwt) => (jwt === "owner" ? OWNER : jwt === "other" ? "someone-else" : null),
    draft: async () => ({ caption: "Hello.", hashtags: "#a #b #c", flags: [{ slide: 2, level: "check", note: "n" }] }),
    uploaderId: OWNER,
    ...over,
  };
}

function post(body: unknown, token?: string, origin = "https://jessicaciernia-cyber.github.io") {
  return new Request("https://x/functions/v1/caption", {
    method: "POST",
    headers: { "content-type": "application/json", origin, ...(token ? { authorization: "Bearer " + token } : {}) },
    body: JSON.stringify(body),
  });
}

Deno.test("no token is 401 and the model is never called", async () => {
  let called = false;
  const r = await handle(post({ site: "welliemd", images: [good] }), deps({ draft: async () => { called = true; throw new Error(); } }));
  assertEquals(r.status, 401);
  assertEquals(called, false);
});

Deno.test("a token for a different user is 403", async () => {
  const r = await handle(post({ site: "welliemd", images: [good] }, "other"), deps());
  assertEquals(r.status, 403);
});

Deno.test("the anon key as bearer is 401 (Auth says nobody)", async () => {
  const r = await handle(post({ site: "welliemd", images: [good] }, "anon-key"), deps());
  assertEquals(r.status, 401);
});

Deno.test("bad site, zero images, eleven images, wrong type, oversized", async () => {
  assertEquals((await handle(post({ site: "nope", images: [good] }, "owner"), deps())).status, 400);
  assertEquals((await handle(post({ site: "welliemd", images: [] }, "owner"), deps())).status, 400);
  assertEquals((await handle(post({ site: "welliemd", images: Array(11).fill(good) }, "owner"), deps())).status, 400);
  assertEquals((await handle(post({ site: "welliemd", images: [{ media_type: "image/gif", data: "x" }] }, "owner"), deps())).status, 400);
  assertEquals((await handle(post({ site: "welliemd", images: [{ media_type: "image/png", data: "x".repeat(2_000_001) }] }, "owner"), deps())).status, 413);
});

Deno.test("happy path returns the draft shape with CORS for the site origin", async () => {
  const r = await handle(post({ site: "zenjessica", title: "T", images: [good, good] }, "owner"), deps());
  assertEquals(r.status, 200);
  assertEquals(r.headers.get("access-control-allow-origin"), "https://jessicaciernia-cyber.github.io");
  const j = await r.json();
  assertEquals(j.caption, "Hello.");
  assertEquals(j.hashtags, "#a #b #c");
  assertEquals(j.flags[0].slide, 2);
});

Deno.test("an unknown origin gets the site origin back, not itself", async () => {
  const r = await handle(post({ site: "welliemd", images: [good] }, "owner", "https://evil.example"), deps());
  assertEquals(r.headers.get("access-control-allow-origin"), "https://jessicaciernia-cyber.github.io");
});

Deno.test("model failure is a 502 with the message, not a crash", async () => {
  const r = await handle(post({ site: "welliemd", images: [good] }, "owner"), deps({ draft: async () => { throw new Error("boom"); } }));
  assertEquals(r.status, 502);
  assertEquals((await r.json()).error, "boom");
});

Deno.test("preflight is 204", async () => {
  const r = await handle(new Request("https://x/", { method: "OPTIONS", headers: { origin: "http://localhost:8220" } }), deps());
  assertEquals(r.status, 204);
  assertEquals(r.headers.get("access-control-allow-origin"), "http://localhost:8220");
});
