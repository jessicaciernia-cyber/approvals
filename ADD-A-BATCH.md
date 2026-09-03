# Adding a batch of carousels

Read this first in any new session. It is written so a fresh Claude, with no memory of how
this was built, can add a batch without guessing.

The live site is <https://jessicaciernia-cyber.github.io/approvals/>. The link never
changes, so whatever ends up here is what Jessica sees the next time she opens it.

---

## The shape of the thing

Three layers, and it matters which one you are touching.

1. **A batch project folder** — `../welliemd-carousels`, `../zenjessica-hub`, and so on.
   This is where the carousel PNGs and the hub builder live. The real work happens here.
2. **`hub.html`** — one self-contained page per batch, slides inlined as base64. Built by
   that project's own script.
3. **This folder** — reads each `hub.html`, pulls the images out to real files, and writes
   the index over the top. It never authors content. If a caption is wrong, fix it in
   layer 1 and rebuild; do not hand-edit anything in `welliemd/` or `zenjessica/`, because
   the next build overwrites it.

---

## More carousels in a batch that already exists

Most common case. September gets three more posts, say.

1. Build the new slides in the batch's project folder, the same way the existing ones were
   built. Each batch has its own generator; read it before adding to it.
2. Rebuild that batch's `hub.html`. For WellieMD that is:

   ```bash
   cd /c/Users/jessi/Downloads/welliemd-carousels && python write_hub.py
   ```

   It writes both `hub.html` and `welliemd-september.html` from one pass. Both names exist
   because an artifact was once published against the second one; keep writing both.
3. Rebuild and publish:

   ```bash
   cd /c/Users/jessi/Downloads/approvals-site && python build.py
   git add -A && git commit -m "..." && git push
   ```
4. Wait about a minute, then check the live URL actually changed. Do not report it as done
   off a successful push — Pages builds after the push and can fail on its own.

---

## A new batch, or a new client

Add a `dict` to `SITES` in `build.py`:

```python
dict(slug="october", title="WellieMD October",
     src=os.path.join(DL, "welliemd-october", "hub.html"),
     blurb="One sentence saying what this batch is."),
```

`slug` becomes the URL and the card on the index. It is also the `site` value on every note
in the database, so **changing a slug orphans that batch's notes.** Pick it once.

---

## Notes and edits

Every card carries a comment thread. Jessica types, and it appears for everyone else within
about twenty seconds without a reload.

- Storage is Supabase, project `approvals` under the Kickstart org, ref
  `bsgygerfgyztkrrjdqlg`. Kept separate from Kin Meds on purpose: no client system should
  ride on a review page.
- The page holds a **publishable** key. That is what publishable keys are for. What guards
  the table is the policy set in `_shared/comments-schema.sql`: anon may read and insert,
  never update or delete. So a note cannot be quietly altered or erased from the page.
- Credentials come from `../claude/.env` as `APPROVALS_SUPABASE_URL` and
  `APPROVALS_SUPABASE_ANON_KEY`. That file is gitignored. If they are missing the notes box
  renders disabled instead of breaking, and the build prints `notes backend: NOT CONFIGURED`
  — watch for that line.
- A thread is keyed on a slug made from the card's **title**, not its position. Reordering
  or renumbering a month is safe. **Renaming a post's title orphans its notes.** If you have
  to rename one and the notes matter, move them first:

  ```sql
  update public.approval_comments set cid = 'the-new-title-slug'
   where site = 'welliemd' and cid = 'the-old-title-slug';
  ```

  Run that in the Supabase SQL editor, not from the page — anon cannot update.

### Reading the notes without opening the site

```bash
python -c "
import json,urllib.request,io,re
env=dict(re.findall(r'^([A-Z_]+)=(.*)$', io.open(r'C:/Users/jessi/Downloads/claude/.env',encoding='utf-8',errors='ignore').read(), re.M))
u,k=env['APPROVALS_SUPABASE_URL'].strip(),env['APPROVALS_SUPABASE_ANON_KEY'].strip()
r=urllib.request.urlopen(urllib.request.Request(u+'/rest/v1/approval_comments?select=*&order=created_at.desc',headers={'apikey':k,'Authorization':'Bearer '+k}),timeout=25)
for c in json.load(r): print(f\"[{c['site']}] {c['cid']}\n  {c['author']}: {c['body']}\n\")"
```

---

## Uploads Jess posts herself

Jess adds carousels and statics from
<https://jessicaciernia-cyber.github.io/approvals/upload.html>, and they appear at the top of
that client's own page, `/welliemd/` or `/zenjessica/`, the one Jessica already opens. No
rebuild, no push. The page fetches them from Supabase when it opens and prepends one card
per upload in that page's own markup, so an uploaded card and a built card look the same.

- **One login, hers.** Email and password on the Supabase project, signup closed. The
  policies in `_shared/uploads-schema.sql` name her user id, not the generic signed-in
  role, so reopening signup would still not let anyone else write. Password reset is in
  the Supabase dashboard: Authentication > Users > her row > Reset password.
- **The page still holds only the anon key.** Reads use it. Writes and deletes carry her
  access token, and row-level security decides. A copy of the page gives a stranger what
  the public page already gives them: the ability to look.
- **Delete is real.** Images leave the bucket, the row goes, and that card's rows in
  `approval_comments` and `approval_status` stay behind as orphans. She chose that.
- **Notes and status attach the usual way.** Uploaded cards are keyed by the title slug,
  the same id `comments.js` and `status.js` derive. Those two scripts stop if they find no
  cards at `DOMContentLoaded`, and uploaded cards arrive after a fetch, so on the two upload
  pages `build.py` no longer links them directly: `uploads-render.js` prepends the cards and
  then loads both scripts, and it loads them even if the fetch fails so the built cards
  never lose their threads. Neither file was changed. `welliemd-posts` keeps the plain pair.
  A card uploaded while the page is open gets its thread on the next reload.
- **Which hubs.** The `UPLOADS` map in `build.py`: `welliemd` uses the deck card markup,
  `zenjessica` the post card markup. Adding a hub means adding an entry and, if its card
  markup is new, a builder in `uploads-render.js`.
- **Storage.** Bucket `approvals-uploads`, public read, 8 MB per file, PNG and JPEG only,
  paths `<site>/<uuid>/01.png`. Free tier is 1 GB, which is a few hundred carousels.
- **Zips.** The form takes the zip Canva exports. `_shared/unzip.js` reads it in the browser
  with no library, keeps only PNG and JPEG, drops `__MACOSX` and dotfiles, and orders the
  images naturally so `10.png` follows `9.png`. Stored and deflated entries only.
- **Files.** `_shared/uploads-schema.sql` (run once, already run), `uploads-api.js` (all
  the network calls), `uploads-render.js` (a live page), `upload-form.js` (the form),
  `unzip.js` (zip expansion), `upload-page.html` (the form template `build.py` fills),
  `uploads.css`.
  `tests/uploads-api.test.mjs` exercises the API helper against a stubbed fetch:

  ```bash
  node --test tests/uploads-api.test.mjs
  ```

Adding a client to the picker is four edits: the `site` check in the schema (a new
policy, not an `alter`), the `SITES` list in `uploads-api.js`, an `UPLOADS` entry in
`build.py`, and the `<option>` in `upload-page.html`.

## The duplicate check

When Jess picks slides on `upload.html`, each one becomes a 16x16 average hash in the
browser (`_shared/dupes.js`) and is compared against every post already on that client's
page: the uploads, whose hashes live in the `hashes` column, and the built decks, whose
hashes `build.py` writes to `_shared/built-hashes.json` from each hub's `_data.json`. A
match on the cover or on half the slides shows "Looks like a duplicate of ..." and the
button reads **Add anyway**. It flags; it does not block.

- Threshold: 14 differing bits of 256. The same recipe runs in Python at build time and
  in the browser; measured on the same slide the two land about 5 bits apart, and
  different artwork lands 60 or more apart.
- The column came after the first uploads. `_shared/uploads-hashes.sql` adds it and
  backfills the rows that predate it; run once in the SQL editor. Rows added since carry
  their hashes from the page.
- Tests: `node --test tests/dupes.test.mjs`.

## The caption button

On `upload.html`, once slides are picked, **Draft a caption from the slides** reads them and
fills the caption box in that client's voice, then lists anything on the slides that needs a
source or a legal look, in the two levels the built pages use (`check`, `stop`). Jess edits
before she adds. Nothing is stored until she adds the post.

- **Where the model key lives.** In the Supabase project's secrets, used only by the edge
  function `supabase/functions/caption`. The page never sees it. The function asks Supabase
  Auth who holds the token and refuses everyone but `UPLOADER_ID`, so the public anon key
  buys nothing here either.
- **Voice.** `_shared/caption-voice/welliemd.md` and `zenjessica.md`, built by extraction
  from the WellieMD brief as applied on the hub, the nine real captions and flag notes, the
  story lane's rules, and real Zen Jessica captions. Edit a pack, then run
  `python _shared/caption-voice/build-voice.py` to regenerate the function's `voice.ts`,
  and redeploy.
- **Model and cost.** `claude-opus-5` by default, roughly ten cents per ten-slide draft.
  Set the secret `CAPTION_MODEL=claude-sonnet-5` for about four cents. The slides are
  downsized to 1024px JPEG in the browser before they leave it.
- **Deploy.** Once: `supabase login` in a terminal (opens a browser). Then from the repo:

  ```bash
  supabase link --project-ref bsgygerfgyztkrrjdqlg
  supabase secrets set ANTHROPIC_API_KEY=... UPLOADER_ID=92e12e4e-2792-44b4-a6e5-ecfd582d97f9
  supabase functions deploy caption
  ```

  Proof it is up: a call with only the anon key answers 401.
- **Tests.** `deno test --allow-env --allow-net=jsr.io supabase/functions/caption/` covers the
  refusal branches with the model stubbed. `node --test tests/uploads-api.test.mjs` covers the
  page side.

## Things that have already gone wrong here

- **The site is public.** GitHub Pages needs a public repo on a free account. Every page
  carries `noindex,nofollow,noarchive` and `robots.txt` disallows crawling, so it stays out
  of search, but anyone holding the link can read it and post a note. That was a deliberate
  trade. Do not put anything here that could not survive being forwarded.
- **Never `rmtree` a site folder.** An earlier version deleted a `.git` directory that way.
  `build.py` clears only the files it generates.
- **These hubs declare their own charset.** They were authored as artifacts, where the
  wrapper supplied one. `build.py` injects `<meta charset="utf-8">`; without it every
  middot and em dash in the captions mojibakes.
- **Supabase's SQL editor flags any statement containing `DROP` as destructive.** Write the
  schema without `drop ... if exists` rather than clicking through the warning.
- **Verify on the live URL, not the local file.** Pages serves a build, not your working
  directory, and it lags the push.
