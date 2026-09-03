/* A live approval page: fetches Jess's uploads for one client and draws a card each.
 *
 * Reads work with the public key, so Jessica sees every card without signing in. The
 * Delete control only appears when a signed-in session is present, and even then the
 * server decides: a delete the policies do not allow comes back as a refusal.
 *
 * The notes and status scripts attach to cards on DOMContentLoaded and stop if they
 * find none. Cards here arrive after a fetch, so those two scripts are loaded by this
 * one, after the cards exist. Their URLs are stamped in by build.py. Neither file is
 * changed for this.
 */
(function () {
  "use strict";
  var LIVE = window.APPROVAL_LIVE || {};
  var API = window.ApprovalUploads;
  var grid = document.getElementById("grid");
  var empty = document.getElementById("empty");
  var count = document.getElementById("count");
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

  function when(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

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
    var root = el("div", "lb");
    root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true");
    var img = el("img"); img.alt = "Slide";
    var prev = el("button", null, "Prev"); prev.id = "lbp";
    var next = el("button", null, "Next"); next.id = "lbn";
    var close = el("button", null, "Close"); close.id = "lbx";
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

  function card(row) {
    var a = el("article", "post");
    a.dataset.cid = slug(row.title);
    a.dataset.id = row.id;
    a.setAttribute("data-text", (row.title + " " + row.caption).toLowerCase());

    var shot = el("button", "shot");
    shot.setAttribute("aria-label", "Open " + row.title + " full size");
    var cover = el("img", "cover");
    cover.src = API.publicUrl(row.slides[0]); cover.alt = "Cover: " + row.title; cover.loading = "lazy";
    shot.appendChild(cover);
    shot.addEventListener("click", function () { openLb(row.slides, 0); });
    a.appendChild(shot);

    var meat = el("div", "meat");
    var top = el("div", "topline");
    top.appendChild(el("h3", null, row.title));
    top.appendChild(el("span", "chip", row.slides.length === 1 ? "Static" : row.slides.length + " slides"));
    top.appendChild(el("span", "when", when(row.created_at)));
    meat.appendChild(top);

    if (row.slides.length > 1) {
      var strip = el("div", "strip");
      row.slides.forEach(function (p, i) {
        var b = el("button"); b.setAttribute("aria-label", "Slide " + (i + 1));
        var im = el("img"); im.src = API.publicUrl(p); im.alt = ""; im.loading = "lazy";
        b.appendChild(im);
        b.addEventListener("click", function () { openLb(row.slides, i); });
        strip.appendChild(b);
      });
      meat.appendChild(strip);
    }

    meat.appendChild(el("p", "caption", row.caption || ""));

    /* Owner controls. Hidden unless a session exists; the server still has the last word. */
    var acts = el("div", "acts"); acts.hidden = !API.session();
    var del = el("button", "btn danger", "Delete this post");
    var say = el("span", "say");
    acts.appendChild(del); acts.appendChild(say);
    del.addEventListener("click", function () {
      if (!window.confirm("Delete “" + row.title + "” for good? The images and the card go away. Notes and approval history on it stay in the database but stop being shown.")) return;
      del.disabled = true; say.className = "say"; say.textContent = "Deleting…";
      API.deleteUpload(row).then(function () {
        a.parentNode.removeChild(a);
        rows = rows.filter(function (r) { return r.id !== row.id; });
        paintCount();
      }).catch(function (e) {
        say.className = "say bad"; say.textContent = "Did not delete. " + e.message;
        del.disabled = false;
      });
    });
    meat.appendChild(acts);

    /* comments.js appends the notes box into .cap when present. */
    meat.appendChild(el("div", "cap"));
    a.appendChild(meat);
    return a;
  }

  function paintCount() {
    var n = rows.length;
    count.textContent = n ? (n + (n === 1 ? " post" : " posts")) : "";
    empty.hidden = n > 0;
  }

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = rej;
      document.body.appendChild(s);
    });
  }

  function start() {
    if (!API) { empty.textContent = "Uploads are not connected."; empty.hidden = false; return; }
    buildLb();
    API.listUploads(LIVE.site).then(function (data) {
      rows = data || [];
      rows.forEach(function (r) { grid.appendChild(card(r)); });
      paintCount();
      /* Cards exist now, so the shared notes and status scripts find them. */
      var after = (LIVE.after || []).map(loadScript);
      return Promise.all(after);
    }).catch(function (e) {
      empty.textContent = "Could not load uploads. " + e.message;
      empty.hidden = false;
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
