/* Puts Jess's uploads onto the client's own approval page, the one Jessica already opens.
 *
 * At view time this fetches the uploads for the page's site and prepends one card per
 * upload to the list the built cards live in, in that page's own markup, so an uploaded
 * card and a built card look the same and get the same notes thread and approval status.
 * Reads use the public key, so Jessica needs nothing. Delete shows only with a signed-in
 * session, and the server still decides.
 *
 * comments.js and status.js attach to cards on DOMContentLoaded and stop if they find
 * none, and they must not miss the built cards either. So build.py no longer links them
 * directly; this script loads them once the uploaded cards are in place, and it loads
 * them even when the fetch fails, so the built cards never lose their threads. Neither
 * file is changed.
 */
(function () {
  "use strict";
  var LIVE = window.APPROVAL_LIVE || {};
  var API = window.ApprovalUploads;
  var rows = [], lb = null, lbSet = [], lbAt = 0;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* The same id comments.js and status.js derive, written onto the card explicitly so
     all three agree even if that derivation ever changes. */
  function slug(title) {
    return String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "").slice(0, 80) || "untitled";
  }

  function shortDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  }

  /* --- lightbox, with its own ids so it never collides with a host page's --- */
  function openLb(paths, i) {
    lbSet = paths; lbAt = i;
    lb.img.src = API.publicUrl(paths[i]);
    lb.cap.textContent = (i + 1) + " / " + paths.length;
    lb.prev.disabled = i === 0; lb.next.disabled = i === paths.length - 1;
    lb.root.classList.add("open");
    lb.close.focus();
  }
  function stepLb(d) {
    var i = lbAt + d;
    if (i >= 0 && i < lbSet.length) openLb(lbSet, i);
  }
  function buildLb() {
    var root = el("div", "lb ulb");
    root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true");
    var img = el("img"); img.alt = "Slide";
    var prev = el("button", null, "Prev"); prev.id = "ulbp";
    var next = el("button", null, "Next"); next.id = "ulbn";
    var close = el("button", null, "Close"); close.id = "ulbx";
    var cap = el("div", "cap2");
    root.appendChild(img); root.appendChild(prev); root.appendChild(next);
    root.appendChild(close); root.appendChild(cap);
    prev.addEventListener("click", function () { stepLb(-1); });
    next.addEventListener("click", function () { stepLb(1); });
    close.addEventListener("click", function () { root.classList.remove("open"); });
    root.addEventListener("click", function (ev) { if (ev.target === root) root.classList.remove("open"); });
    document.addEventListener("keydown", function (ev) {
      if (!root.classList.contains("open")) return;
      if (ev.key === "Escape") root.classList.remove("open");
      if (ev.key === "ArrowLeft") stepLb(-1);
      if (ev.key === "ArrowRight") stepLb(1);
    });
    document.body.appendChild(root);
    lb = { root: root, img: img, prev: prev, next: next, close: close, cap: cap };
  }

  /* Owner controls. Hidden unless a session exists; the server still has the last word.
     The confirm step is in the page, not a native dialog: embedded browsers and some
     phones swallow window.confirm and the click just dies. */
  function ownerControls(row, card) {
    var acts = el("div", "acts up-acts"); acts.hidden = !API.session();
    var del = el("button", "btn danger", "Delete this post");
    var yes = el("button", "btn danger", "Yes, delete it for good");
    var keep = el("button", "btn ghost", "Keep it");
    var say = el("span", "say");
    yes.hidden = keep.hidden = true;
    acts.appendChild(del); acts.appendChild(yes); acts.appendChild(keep); acts.appendChild(say);
    del.addEventListener("click", function () {
      del.hidden = true; yes.hidden = keep.hidden = false;
      say.className = "say";
      say.textContent = "The images and the card go away. Notes and approval history on it stay in the database but stop being shown.";
      yes.focus();
    });
    keep.addEventListener("click", function () {
      yes.hidden = keep.hidden = true; del.hidden = false; say.textContent = "";
    });
    yes.addEventListener("click", function () {
      yes.disabled = keep.disabled = true; say.className = "say"; say.textContent = "Deleting…";
      API.deleteUpload(row).then(function () {
        card.parentNode.removeChild(card);
      }).catch(function (e) {
        say.className = "say bad"; say.textContent = "Did not delete. " + e.message;
        yes.disabled = keep.disabled = false;
      });
    });
    return acts;
  }

  function stripOf(row) {
    var strip = el("div", "strip");
    row.slides.forEach(function (p, i) {
      var b = el("button", "fr"); b.setAttribute("aria-label", "Slide " + (i + 1));
      var im = el("img"); im.src = API.publicUrl(p); im.alt = "Slide " + (i + 1); im.loading = "lazy";
      b.appendChild(im); b.appendChild(el("span", null, String(i + 1)));
      b.addEventListener("click", function () { openLb(row.slides, i); });
      strip.appendChild(b);
    });
    return strip;
  }

  function captionParas(text) {
    var box = el("div", "capbody");
    var parts = String(text || "").split(/\n{2,}/);
    if (!parts[0]) return box;
    parts.forEach(function (t) { box.appendChild(el("p", null, t)); });
    return box;
  }

  /* WellieMD hub: article.deck with .head/.num/.hgroup/.tags, a .strip of .fr, and .cap. */
  function deckCard(row) {
    var a = el("article", "deck up-card");
    a.dataset.cid = slug(row.title); a.dataset.id = row.id;
    a.setAttribute("data-status", "ready");
    a.setAttribute("data-text", (row.title + " " + row.caption).toLowerCase());
    var head = el("div", "head");
    var num = el("div", "num", "UP");
    num.appendChild(el("span", "dt", shortDate(row.created_at)));
    num.appendChild(el("span", "dt", row.slides.length === 1 ? "static" : row.slides.length + " slides"));
    var hg = el("div", "hgroup");
    hg.appendChild(el("h2", null, row.title));
    var tags = el("div", "tags"); tags.appendChild(el("span", "tag g", "Uploaded by Jess"));
    hg.appendChild(tags);
    head.appendChild(num); head.appendChild(hg);
    a.appendChild(head);
    a.appendChild(stripOf(row));
    var cap = el("div", "cap");
    cap.appendChild(captionParas(row.caption));
    cap.appendChild(ownerControls(row, a));
    a.appendChild(cap);
    return a;
  }

  /* Zen Jessica hub: article.post with .when, img.cover, .meat/.topline/h3, .caption. */
  function postCard(row) {
    var a = el("article", "post up-card");
    a.dataset.cid = slug(row.title); a.dataset.id = row.id;
    a.setAttribute("data-status", "ready");
    a.setAttribute("data-text", (row.title + " " + row.caption).toLowerCase());
    var when = el("div", "when");
    when.appendChild(el("span", "date", shortDate(row.created_at)));
    when.appendChild(el("span", "ch", row.slides.length === 1 ? "Static" : row.slides.length + " slides"));
    a.appendChild(when);
    var cover = el("img", "cover");
    cover.src = API.publicUrl(row.slides[0]); cover.alt = "Cover slide: " + row.title; cover.loading = "lazy";
    cover.style.cursor = "zoom-in";
    cover.addEventListener("click", function () { openLb(row.slides, 0); });
    a.appendChild(cover);
    var meat = el("div", "meat");
    var top = el("div", "topline");
    top.appendChild(el("h3", null, row.title));
    top.appendChild(el("span", "chip ok", "Uploaded by Jess"));
    meat.appendChild(top);
    if (row.slides.length > 1) meat.appendChild(stripOf(row));
    var cap = el("div", "caption");
    var paras = captionParas(row.caption);
    while (paras.firstChild) cap.appendChild(paras.firstChild);
    meat.appendChild(cap);
    meat.appendChild(ownerControls(row, a));
    a.appendChild(meat);
    return a;
  }

  /* Mount where the built cards already are: the parent of the first one. */
  function mountPoint() {
    var first = document.querySelector("article.deck, article.post");
    return first ? first.parentNode : (document.querySelector("main") || document.body);
  }

  function loadScript(src) {
    return new Promise(function (res) {
      var s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = res;   // a missing script must not block the other
      document.body.appendChild(s);
    });
  }

  function loadAfter() {
    return Promise.all((LIVE.after || []).map(loadScript));
  }

  function inject() {
    var mount = mountPoint();
    var make = LIVE.kind === "post" ? postCard : deckCard;
    var anchor = mount.firstChild;
    // newest first, above everything that was built
    rows.slice().reverse().forEach(function (r) {
      var c = make(r);
      mount.insertBefore(c, mount.firstChild);
    });
    if (rows.length) {
      var note = el("div", "up-note");
      note.textContent = rows.length + (rows.length === 1 ? " post" : " posts") + " added directly by Jess, newest first.";
      mount.insertBefore(note, mount.firstChild);
    }
    void anchor;
  }

  function start() {
    if (!API || !LIVE.site) { loadAfter(); return; }
    buildLb();
    API.listUploads(LIVE.site).then(function (data) {
      rows = data || [];
      inject();
    }).catch(function (e) {
      console.warn("uploads: could not load", e.message);
    }).then(loadAfter);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
