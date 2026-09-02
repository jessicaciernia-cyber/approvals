# Approval pages

Three review pages for Kickstart Social clients, served as one GitHub Pages site.

| Path | What it is |
|---|---|
| `/welliemd/` | WellieMD carousels, September 2026 |
| `/zenjessica/` | Zen Jessica story carousels, September and October |

Reachable by link only: every page carries `noindex,nofollow,noarchive` and `robots.txt`
disallows crawling. It is a review surface, not a publication.

## Adding a batch

See [ADD-A-BATCH.md](ADD-A-BATCH.md). Read it before touching anything here.

## Rebuilding

Everything here is generated. Do not hand-edit `index.html` or the per-site folders.

```bash
python build.py
git add -A && git commit -m "..." && git push
```

`build.py` reads each hub's single-file build from its own project folder, pulls the inlined
base64 images out to `img/`, adds a back-link to the index, and writes the landing page. The
source hubs live at:

- `../welliemd-carousels/hub.html`
- `../welliemd-hub/hub.html`
- `../zenjessica-hub/hub.html`

Rebuild those first if the content changed, then run this.

## Edit notes

Every card carries a "Notes and edits" thread. Anyone on the page can leave a note and
read the ones already there; a note left on another device shows up within about twenty
seconds without a reload.

Notes live in Supabase, reached from the browser with the anon key. That key is public by
design - what protects the table is its policy set, not secrecy. anon may read and insert,
never update or delete, so a note cannot be quietly changed or erased from the page.
`_shared/comments-schema.sql` is the table and its policies; run it once in the Supabase
SQL editor.

Point the pages at the project by putting these in `../claude/.env`:

```
APPROVALS_SUPABASE_URL=https://<ref>.supabase.co
APPROVALS_SUPABASE_ANON_KEY=<the anon / publishable key>
```

`build.py` reads them and stamps them into each page. Without them the notes box renders
disabled rather than breaking, and the build prints `notes backend: NOT CONFIGURED`.

A card's note thread is keyed on a slug made from its title, not its position, so
re-ordering or re-numbering the month does not move notes onto the wrong post. Renaming a
post's title does orphan its notes.
