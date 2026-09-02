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
