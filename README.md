# Approval pages

Three review pages for Kickstart Social clients, served as one GitHub Pages site.

| Path | What it is |
|---|---|
| `/welliemd/` | WellieMD carousels, September 2026 |
| `/welliemd-statics/` | WellieMD post library, 40 single statics |
| `/zenjessica/` | Zen Jessica story carousels, September and October |

Reachable by link only: every page carries `noindex,nofollow,noarchive` and `robots.txt`
disallows crawling. It is a review surface, not a publication.

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
