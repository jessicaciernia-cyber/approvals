"""Build one static site holding every approval page, for GitHub Pages.

Each hub is authored as a single self-contained HTML with its slides inlined as base64.
That is right for an artifact and wrong for a website: one 6MB file the browser cannot
cache. This pulls the images out to per-site folders and writes a small index over the top,
so the whole thing is one repo, one Pages toggle, one page per batch.

Run from anywhere:  python build.py
"""
import base64, hashlib, io, json, os, re, shutil, sys

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
DL = os.path.dirname(HERE)

SITES = [
    dict(slug="welliemd", title="WellieMD carousels",
         src=os.path.join(DL, "welliemd-carousels-new", "hub.html"),
         blurb="Four carousels, seven slides each, checked against the content rules. "
               "One slide carries a blocker."),
    dict(slug="welliemd-posts", title="WellieMD single posts",
         src=os.path.join(DL, "welliemd-posts", "hub.html"),
         blurb="Forty single statics, thirty topical and ten founder. Each one marked "
               "against the content rules, with four that cannot ship as they are."),
    dict(slug="zenjessica", title="Zen Jessica carousels",
         src=os.path.join(DL, "zenjessica-hub", "hub.html"),
         blurb="September and October 2026. Twenty-four story carousels with captions "
               "and hashtags, in posting order."),
]

# The anon key is public by design; what guards the table is its RLS policy set, not
# secrecy. It still comes from .env rather than being pasted in here, so there is one
# place to change it and it never lands in a commit by hand.
def _env(name):
    for path in (os.path.join(DL, "claude", ".env"), os.path.join(DL, ".env")):
        if not os.path.exists(path):
            continue
        for line in io.open(path, encoding="utf-8", errors="ignore"):
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip()
    return ""


SUPA_URL = _env("APPROVALS_SUPABASE_URL")
SUPA_KEY = _env("APPROVALS_SUPABASE_ANON_KEY")


def extract(src, outdir, slug):
    """Pull every base64 data URI out to a file and rewrite the reference."""
    html = io.open(src, encoding="utf-8").read()
    imgdir = os.path.join(outdir, "img")
    os.makedirs(imgdir, exist_ok=True)
    for f in os.listdir(imgdir):
        os.remove(os.path.join(imgdir, f))
    seen = {}

    def swap(m):
        payload = m.group(2)
        key = hashlib.sha1(payload.encode()).hexdigest()[:16]
        if key not in seen:
            ext = "jpg" if "jpeg" in m.group(1) else "png"
            name = f"{key}.{ext}"
            io.open(os.path.join(imgdir, name), "wb").write(base64.b64decode(payload))
            seen[key] = name
        return f"img/{seen[key]}"

    html = re.sub(r"data:(image/[a-z]+);base64,([A-Za-z0-9+/=]+)", swap, html)
    # These pages carry unapproved client creative: reachable by link, not by search.
    # These files were authored as artifacts, where the harness supplies the charset.
    # Standalone they must declare it themselves, or a server that omits it mojibakes
    # every em dash and middot in the captions.
    html = html.replace("<title>",
        '<meta charset="utf-8">\n'
        '<meta name="robots" content="noindex,nofollow,noarchive">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1">\n'
        '<link rel="stylesheet" href="../_shared/backlink.css">\n'
        '<link rel="stylesheet" href="../_shared/comments.css">\n<title>', 1)
    html += ('\n<a class="backlink" href="../">&larr; All approval pages</a>\n'
             '<script>window.APPROVAL_COMMENTS=' + json.dumps(
                 dict(url=SUPA_URL, key=SUPA_KEY, site=slug)) + ';</script>\n'
             '<script src="../_shared/comments.js"></script>\n')
    io.open(os.path.join(outdir, "index.html"), "w", encoding="utf-8").write(html)
    mb = sum(os.path.getsize(os.path.join(imgdir, f))
             for f in os.listdir(imgdir)) / 1024 / 1024
    return len(seen), os.path.getsize(os.path.join(outdir, "index.html")) / 1024, mb

built = []
for s in SITES:
    if not os.path.exists(s["src"]):
        print(f"!! missing {s['src']}, skipping {s['slug']}")
        continue
    out = os.path.join(HERE, s["slug"])
    os.makedirs(out, exist_ok=True)
    n, kb, mb = extract(s["src"], out, s["slug"])
    built.append(s)
    print(f"{s['slug']:<18} {kb:>6.0f} KB html   {n:>3} images  {mb:>5.1f} MB")

os.makedirs(os.path.join(HERE, "_shared"), exist_ok=True)
io.open(os.path.join(HERE, "_shared", "backlink.css"), "w", encoding="utf-8").write(
"""/* a way back to the index from any approval page */
.backlink{position:fixed;left:14px;bottom:14px;z-index:99;font:500 12px/1
  ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;
  padding:10px 14px;border-radius:999px;text-decoration:none;
  background:#12141C;color:#fff;box-shadow:0 2px 14px rgba(0,0,0,.28)}
.backlink:hover{background:#000}
@media print{.backlink{display:none}}
""")

cards = "".join(f"""
    <a class="card" href="{s['slug']}/">
      <h2>{s['title']}</h2>
      <p>{s['blurb']}</p>
      <span class="go">Open &rarr;</span>
    </a>""" for s in built)

index = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Approval pages</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Archivo+Black&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{{--ground:#F3F3F0;--surface:#fff;--ink:#0A0A0A;--body:#3E3E3C;--muted:#77776F;
  --line:#DEDEDA;--accent:#EC0F7E}}
@media (prefers-color-scheme:dark){{:root:not([data-theme=light]){{
  --ground:#0B0B0B;--surface:#151515;--ink:#F3F3F0;--body:#C2C2BC;--muted:#8B8B84;
  --line:#2A2A28}}}}
*{{box-sizing:border-box}}
body{{margin:0;background:var(--ground);color:var(--ink);
  font-family:Archivo,system-ui,sans-serif;font-size:16px;line-height:1.55}}
.wrap{{max-width:900px;margin:0 auto;padding:0 26px}}
header{{background:#0A0A0A;color:#F3F3F0;padding:56px 0 44px}}
.kick{{font-family:"IBM Plex Mono",monospace;font-size:12px;letter-spacing:.16em;
  text-transform:uppercase;color:var(--accent)}}
h1{{font-family:"Archivo Black",Impact,sans-serif;font-size:clamp(32px,6vw,56px);
  line-height:.98;margin:14px 0 12px;text-transform:uppercase;letter-spacing:-.02em}}
header p{{max-width:58ch;margin:0;color:#C9C9C2}}
.grid{{display:grid;gap:18px;padding:38px 0 60px}}
.card{{display:block;background:var(--surface);border:2px solid var(--ink);
  padding:24px 26px;text-decoration:none;color:inherit}}
.card:hover{{border-color:var(--accent)}}
.card h2{{font-family:"Archivo Black",Impact,sans-serif;font-size:22px;margin:0 0 8px;
  letter-spacing:-.01em}}
.card p{{margin:0 0 14px;color:var(--body);font-size:14.5px;max-width:62ch}}
.go{{font-family:"IBM Plex Mono",monospace;font-size:11px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--accent)}}
footer{{border-top:2px solid var(--ink);padding:22px 0 60px;color:var(--muted);
  font-size:13px}}
footer p{{max-width:70ch;margin:0}}
</style></head><body>
<header><div class="wrap">
  <div class="kick">Kickstart Social &nbsp;·&nbsp; for review</div>
  <h1>Approval pages</h1>
  <p>Each page holds the artwork, the caption and the posting date for one batch of content.
  Nothing here is approved or scheduled until you say so.</p>
</div></header>
<main class="wrap"><div class="grid">{cards}</div></main>
<footer class="wrap"><p>These pages are reachable by link only and are excluded from search
engines. They are a review surface, not a publication.</p></footer>
</body></html>"""
io.open(os.path.join(HERE, "index.html"), "w", encoding="utf-8").write(index)
io.open(os.path.join(HERE, "robots.txt"), "w", encoding="utf-8").write(
    "User-agent: *\nDisallow: /\n")
io.open(os.path.join(HERE, ".nojekyll"), "w", encoding="utf-8").write("")

total = 0
for root, _, files in os.walk(HERE):
    if ".git" in root:
        continue
    total += sum(os.path.getsize(os.path.join(root, f)) for f in files)
print(f"\nindex.html + {len(built)} pages, {total/1024/1024:.1f} MB total")
print("notes backend: " + (SUPA_URL if SUPA_URL and SUPA_KEY
      else "NOT CONFIGURED - set APPROVALS_SUPABASE_URL and "
           "APPROVALS_SUPABASE_ANON_KEY in .env"))
