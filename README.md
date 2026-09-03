# Approval pages

Three review pages for Kickstart Social clients, served as one GitHub Pages site.

| Path | What it is |
|---|---|
| `/welliemd/` | WellieMD carousels, September 2026 |
| `/zenjessica/` | Zen Jessica story carousels, September and October |
| `/welliemd-uploads/`, `/zenjessica-uploads/` | Posts Jess uploads herself, read live from Supabase |
| `/upload.html` | The upload form. One login, hers |

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

## Approval status

Every card carries a status and an Approved tick. The tick and the dropdown are two views
of one value, not two things to keep in sync: ticking sets `approved`, unticking returns it
to `pending`. Four states, `pending`, `edits-sent`, `pending-edits`, `approved`.

`_shared/status-schema.sql` is the table. It is append-only for the same reason the notes
table is: anon may read and insert, never update or delete. A change is a new row and the
newest row for a card wins, so what is left behind is a record of who moved it and when,
and an approval cannot be quietly rewritten. The allowed values are enforced in the policy,
not only in the page, so a hand-made request cannot invent a state the page cannot display.

## Uploads

Jess posts carousels and statics directly from `upload.html`. They land on the two
`-uploads` pages, which fetch from Supabase at view time, so nothing here needs a rebuild
for them. Same notes thread and approval status as every other card. Only her login can
write or delete; the page holds only the public key, and the policies name her user id.
See ADD-A-BATCH.md for the shape and the traps.

## Open questions

Both content pages open with the things that need a decision, and each one carries its own
thread. WellieMD uses `q-timeline`, `q-legitscript`, `q-peptides`, `q-numbers`, `q-general`;
Zen Jessica uses `z-waiting`, `z-keywords`, `z-november`, `z-general`. They are keyed rather
than titled, so rewording a panel does not orphan its answers.

Any element with a `data-thread` attribute gets a thread, on any page.

## Cache busting

Every shared stylesheet and script is linked with a content hash, `?v=` plus the first eight
characters of its sha1. Without it a browser keeps the copy it already has, which is how a
phone sits on an old layout after a fix has shipped. It also cost a debugging round here: a
CSS change read as "not applied" until the URL changed.

## Phone layout

`_shared/mobile.css` holds everything under 600px, for every page. It is linked from the
body rather than the head, because each page carries its own `<style>` and a stylesheet in
the head would lose to it on equal specificity.

What it fixes, all measured at 375px rather than guessed:

- the sticky filter bar wrapped to five rows and held 27% of the screen; it is now one
  horizontally scrolling row at 9%
- the header ran 61% of the viewport before the first carousel, now 44%
- the lightbox arrows sat over the middle of the artwork; they are a bottom bar now
- every text input was under 16px, which makes iOS Safari zoom the page on focus and never
  zoom back
- controls ran 32 to 39px against a 44px tap target

When changing it, re-measure rather than eyeballing: horizontal overflow, the sticky bar as
a percentage of the viewport, the smallest control height, and the smallest input font.
