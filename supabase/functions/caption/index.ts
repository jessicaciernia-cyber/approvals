// Draft a caption for a set of slides, in one client's voice, and flag anything on the
// slides that needs a source or a legal look before Jessica sees it.
//
// The model key lives here as a secret, never in the page. The page sends the slides
// with the signed-in user's token; this function asks Supabase Auth who that is and
// refuses everyone except the one uploader id. So the public anon key on its own buys
// nothing here, the same way it buys nothing on the upload table.
//
// Deploy:  supabase functions deploy caption --project-ref <ref>
// Secrets: ANTHROPIC_API_KEY, UPLOADER_ID (her auth user id), optional CAPTION_MODEL.
import { VOICE } from "./voice.ts";

/* No SDK: one POST to the Messages API over fetch. The edge bundler has nothing to
   resolve, and the tests, which stub the model, run offline. */
type Block = Record<string, unknown>;
const API = "https://api.anthropic.com/v1/messages";

const ORIGINS = new Set([
  "https://jessicaciernia-cyber.github.io",
  "http://localhost:8220",
]);
const SITES = new Set(["welliemd", "zenjessica"]);
const MAX_IMAGES = 10;
const MAX_B64 = 2_000_000; // ~1.5 MB decoded; the page downsizes to 1024px first
const MODEL = Deno.env.get("CAPTION_MODEL") || "claude-opus-5";

export interface Deps {
  whoAmI: (jwt: string) => Promise<string | null>;
  draft: (site: string, title: string, images: Img[]) => Promise<Draft>;
  uploaderId: string;
}
export interface Img { media_type: "image/jpeg" | "image/png"; data: string }
export interface Draft { caption: string; hashtags: string; flags: { slide: number; level: "check" | "stop"; note: string }[] }

function cors(origin: string | null) {
  const allow = origin && ORIGINS.has(origin) ? origin : "https://jessicaciernia-cyber.github.io";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function reply(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

/* Ask Supabase Auth who holds this token. Anything but a user id is "nobody". */
async function supabaseWhoAmI(jwt: string): Promise<string | null> {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_ANON_KEY")!;
  const r = await fetch(url + "/auth/v1/user", { headers: { apikey: key, Authorization: "Bearer " + jwt } });
  if (!r.ok) return null;
  const u = await r.json();
  return typeof u?.id === "string" ? u.id : null;
}

const INSTRUCTION = `You are drafting the Instagram caption for the carousel in these slides, in the voice defined above, for the owner to edit before a client reviews it.

Return ONLY a JSON object, no prose and no code fence, with exactly these keys:
{"caption": string, "hashtags": string, "flags": [{"slide": number, "level": "check" | "stop", "note": string}]}

caption: the full caption in the client's voice, paragraphs separated by a blank line, no hashtags inside it, no emoji unless the real captions use them.
hashtags: one line of three to five hashtags starting with #, space separated. For Zen Jessica use exactly "#welliemd #therealzenjessica #growpro".
flags: every claim, number, quote, timeframe, or promise on the slides that the rules bar or that needs a source, one entry each, quoting the words on the slide. Slide numbers are 1-based in the order given. Empty array if nothing needs a look. Do not flag the caption you wrote; flag the slides.`;

async function anthropicDraft(site: string, title: string, images: Img[]): Promise<Draft> {
  const content: Block[] = images.map((im, i) => ([
    { type: "text", text: `Slide ${i + 1}:` },
    { type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } },
  ])).flat();
  content.push({ type: "text", text: `Working title from the owner: "${title}".\n\n${INSTRUCTION}` });
  const r = await fetch(API, {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") || "",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system: [{ type: "text", text: VOICE[site], cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      output_config: { effort: "medium" },
    }),
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Model API ${r.status}: ${err.slice(0, 160)}`);
  }
  const res = await r.json();
  if (res.stop_reason === "refusal") throw new Error("The model declined this request");
  const text = (res.content as Block[]).filter((b) => b.type === "text").map((b) => String(b.text)).join("\n").trim();
  const json = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const out = JSON.parse(json);
  if (typeof out.caption !== "string" || !Array.isArray(out.flags)) throw new Error("Model reply was not the expected shape");
  return {
    caption: out.caption,
    hashtags: typeof out.hashtags === "string" ? out.hashtags : "",
    flags: out.flags.filter((f: Draft["flags"][number]) => f && typeof f.note === "string")
      .map((f: Draft["flags"][number]) => ({ slide: Number(f.slide) || 0, level: f.level === "stop" ? "stop" : "check", note: String(f.note).slice(0, 400) })),
  };
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  const origin = req.headers.get("origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return reply(405, { error: "POST only" }, origin);

  const auth = req.headers.get("authorization") || "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!jwt) return reply(401, { error: "Sign in first" }, origin);
  const who = await deps.whoAmI(jwt);
  if (!who) return reply(401, { error: "Sign in first" }, origin);
  if (who !== deps.uploaderId) return reply(403, { error: "Not the owner" }, origin);

  let body: { site?: string; title?: string; images?: Img[] };
  try { body = await req.json(); } catch { return reply(400, { error: "Body must be JSON" }, origin); }
  const site = String(body.site || "");
  const title = String(body.title || "").slice(0, 120);
  const images = Array.isArray(body.images) ? body.images : [];
  if (!SITES.has(site)) return reply(400, { error: "Site must be welliemd or zenjessica" }, origin);
  if (images.length < 1 || images.length > MAX_IMAGES) return reply(400, { error: `Send 1 to ${MAX_IMAGES} images` }, origin);
  for (const [i, im] of images.entries()) {
    if (!im || (im.media_type !== "image/jpeg" && im.media_type !== "image/png") || typeof im.data !== "string") {
      return reply(400, { error: `Image ${i + 1} must be a JPEG or PNG` }, origin);
    }
    if (im.data.length > MAX_B64) return reply(413, { error: `Image ${i + 1} is too large` }, origin);
  }

  try {
    const draft = await deps.draft(site, title, images);
    return reply(200, draft, origin);
  } catch (e) {
    return reply(502, { error: (e as Error).message.slice(0, 200) }, origin);
  }
}

if (import.meta.main) {
  Deno.serve((req) => handle(req, {
    whoAmI: supabaseWhoAmI,
    draft: anthropicDraft,
    uploaderId: Deno.env.get("UPLOADER_ID") || "",
  }));
}
