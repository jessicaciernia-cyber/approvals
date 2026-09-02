/* Edit notes on every approval card, shared across all hubs.
 *
 * Storage is Supabase over its REST endpoint with the anon key, which is meant to be
 * public. The table grants anon SELECT and INSERT only, so a note can be added and read
 * from the page but never edited or deleted there. See comments-schema.sql.
 *
 * All notes for the page load in one request and are bucketed by card, rather than one
 * request per card. A poll while the tab is visible is what makes a note that someone
 * else just left appear without a reload.
 */
(function () {
  "use strict";
  var CFG = window.APPROVAL_COMMENTS || {};
  var MAXBODY = 2000, MAXNAME = 60, POLL = 20000;
  var cards = [], byId = {}, lastFetch = 0;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;   // textContent, never innerHTML: notes are user input
    return n;
  }

  /* A card's id must survive re-ordering and re-numbering, so it comes from the title
     rather than the card's position. A standalone thread names its own id, which is how
     the open questions at the top of a page keep a stable thread of their own. */
  function idFor(card) {
    if (card.dataset.thread) return card.dataset.thread;
    if (card.dataset.cid) return card.dataset.cid;
    var h = card.querySelector("h2, h3");
    var t = (h ? h.textContent : "").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
    return t || "card-" + cards.indexOf(card);
  }

  function when(iso) {
    var d = new Date(iso), s = (Date.now() - d) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function render(card) {
    var list = card._cmtList, rows = byId[card._cid] || [];
    list.textContent = "";
    rows.forEach(function (r) {
      var i = el("div", "cmt-i"), who = el("div", "who", r.author);
      who.appendChild(el("span", null, when(r.created_at)));
      i.appendChild(who);
      i.appendChild(el("p", null, r.body));
      list.appendChild(i);
    });
    card._cmtCount.textContent = rows.length;
    card._cmtCount.hidden = rows.length === 0;
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({
      apikey: CFG.key, Authorization: "Bearer " + CFG.key,
      "Content-Type": "application/json"
    }, opts.headers || {});
    return fetch(CFG.url.replace(/\/$/, "") + "/rest/v1/" + path, opts);
  }

  function load() {
    if (!CFG.url || !CFG.key) return Promise.resolve();
    lastFetch = Date.now();
    return api("approval_comments?site=eq." + encodeURIComponent(CFG.site) +
      "&select=cid,author,body,created_at&order=created_at.asc")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (rows) {
        byId = {};
        rows.forEach(function (r) { (byId[r.cid] = byId[r.cid] || []).push(r); });
        cards.forEach(render);
      })
      .catch(function (e) { console.warn("notes: could not load", e.message); });
  }

  function attach(card) {
    card._cid = idFor(card);
    var box = el("div", "cmt");
    var head = el("div", "cmt-h");
    head.appendChild(el("b", null, "Notes and edits"));
    var count = el("span", "cmt-n"); count.hidden = true;
    head.appendChild(count);
    box.appendChild(head);

    var list = el("div", "cmt-list");
    box.appendChild(list);

    var form = el("form", "cmt-f");
    var ta = el("textarea");
    ta.placeholder = "What needs to change on this one?";
    ta.maxLength = MAXBODY; ta.required = true;
    ta.setAttribute("aria-label", "Note for this post");
    var row = el("div", "cmt-row");
    var name = el("input");
    name.placeholder = "Your name"; name.maxLength = MAXNAME; name.required = true;
    name.setAttribute("aria-label", "Your name");
    try { name.value = localStorage.getItem("approval-name") || ""; } catch (e) {}
    var post = el("button", "cmt-post", "Post note"); post.type = "submit";
    row.appendChild(name); row.appendChild(post);
    var say = el("div", "cmt-say");
    form.appendChild(ta); form.appendChild(row); form.appendChild(say);
    box.appendChild(form);

    if (!CFG.url || !CFG.key) {
      ta.disabled = name.disabled = post.disabled = true;
      say.textContent = "Notes are not connected yet.";
    }

    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var body = ta.value.trim(), who = name.value.trim();
      if (!body || !who) return;
      post.disabled = true; say.className = "cmt-say"; say.textContent = "Saving...";
      try { localStorage.setItem("approval-name", who); } catch (e) {}
      api("approval_comments", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify({ site: CFG.site, cid: card._cid, author: who, body: body })
      }).then(function (r) {
        if (!r.ok) return r.text().then(function (t) { throw new Error(t || "HTTP " + r.status); });
        return r.json();
      }).then(function (rows) {
        (byId[card._cid] = byId[card._cid] || []).push(rows[0]);
        ta.value = ""; say.textContent = "Saved."; render(card);
        setTimeout(function () { say.textContent = ""; }, 2500);
      }).catch(function (e) {
        say.className = "cmt-say bad";
        say.textContent = "Did not save. " + e.message.slice(0, 120);
      }).then(function () { post.disabled = false; });
    });

    /* Enter posts, Shift+Enter is a new line. */
    ta.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); form.requestSubmit(); }
    });

    (card.querySelector(".cap") || card).appendChild(box);
    card._cmtList = list; card._cmtCount = count;
  }

  function start() {
    cards = [].slice.call(
      document.querySelectorAll("article.deck, article.post, [data-thread]"));
    if (!cards.length) return;
    cards.forEach(attach);
    load();
    setInterval(function () {
      if (!document.hidden && Date.now() - lastFetch > POLL - 1000) load();
    }, POLL);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && Date.now() - lastFetch > 5000) load();
    });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
})();
