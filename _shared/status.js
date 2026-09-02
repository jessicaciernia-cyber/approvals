/* Approval status on every card, shared between everyone looking at the page.
 *
 * Four states: pending approval, edits sent, pending edits, approved. The Approved tick
 * and the dropdown are two views of one value rather than two things to keep in sync -
 * ticking sets 'approved', unticking returns it to 'pending'.
 *
 * The table is append-only, the same shape as the notes table and for the same reason:
 * anon may read and insert, never update or delete. A change is a new row, the newest row
 * for a card wins, and what is left behind is a record of who moved it and when. An
 * approval cannot be quietly rewritten later.
 */
(function () {
  "use strict";
  var CFG = window.APPROVAL_COMMENTS || {};
  var POLL = 20000;
  var ORDER = ["pending", "edits-sent", "pending-edits", "approved"];
  var LABEL = {
    "pending": "Pending approval",
    "edits-sent": "Edits sent",
    "pending-edits": "Pending edits",
    "approved": "Approved"
  };
  var cards = [], state = {}, lastFetch = 0;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* The same id the notes use, so a card's status and its thread stay together. */
  function idFor(card) {
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
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({
      apikey: CFG.key, Authorization: "Bearer " + CFG.key,
      "Content-Type": "application/json"
    }, opts.headers || {});
    return fetch(CFG.url.replace(/\/$/, "") + "/rest/v1/" + path, opts);
  }

  function paint(card) {
    var row = state[card._cid];
    var status = (row && row.status) || "pending";
    card.dataset.approval = status;
    card._sel.value = status;
    card._tick.checked = status === "approved";
    card._who.textContent = row ? (row.who + " · " + when(row.created_at)) : "";
    card._sel.className = "st-sel st-" + status;
  }

  function load() {
    if (!CFG.url || !CFG.key) return Promise.resolve();
    lastFetch = Date.now();
    return api("approval_status?site=eq." + encodeURIComponent(CFG.site) +
      "&select=cid,status,who,created_at&order=created_at.asc")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (rows) {
        state = {};
        rows.forEach(function (r) { state[r.cid] = r; });   // ascending, so the last wins
        cards.forEach(paint);
      })
      .catch(function (e) { console.warn("status: could not load", e.message); });
  }

  function set(card, status) {
    var who = "";
    try { who = localStorage.getItem("approval-name") || ""; } catch (e) {}
    if (!who) {
      who = (window.prompt("Your name, so the change is attributed:") || "").trim();
      if (!who) { paint(card); return; }
      try { localStorage.setItem("approval-name", who); } catch (e) {}
    }
    card._say.textContent = "Saving…";
    api("approval_status", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ site: CFG.site, cid: card._cid, status: status, who: who })
    }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error(t || "HTTP " + r.status); });
      return r.json();
    }).then(function (rows) {
      state[card._cid] = rows[0];
      paint(card);
      card._say.textContent = "";
      document.dispatchEvent(new CustomEvent("approval:changed"));
    }).catch(function (e) {
      card._say.textContent = "Did not save. " + e.message.slice(0, 90);
      paint(card);
    });
  }

  function attach(card) {
    card._cid = idFor(card);
    var bar = el("div", "st");

    var sel = el("select", "st-sel");
    sel.setAttribute("aria-label", "Approval status");
    ORDER.forEach(function (s) {
      var o = el("option", null, LABEL[s]);
      o.value = s;
      sel.appendChild(o);
    });
    sel.addEventListener("change", function () { set(card, sel.value); });

    var lab = el("label", "st-tick");
    var tick = el("input");
    tick.type = "checkbox";
    tick.addEventListener("change", function () {
      set(card, tick.checked ? "approved" : "pending");
    });
    lab.appendChild(tick);
    lab.appendChild(el("span", null, "Approved"));

    var who = el("span", "st-who");
    var say = el("span", "st-say");

    bar.appendChild(sel);
    bar.appendChild(lab);
    bar.appendChild(who);
    bar.appendChild(say);

    if (!CFG.url || !CFG.key) {
      sel.disabled = tick.disabled = true;
      say.textContent = "Not connected.";
    }

    var head = card.querySelector(".tags") || card.querySelector(".topline");
    (head ? head.parentNode : card).insertBefore(bar, head ? head.nextSibling : null);
    card._sel = sel; card._tick = tick; card._who = who; card._say = say;
    paint(card);
  }

  function start() {
    cards = [].slice.call(document.querySelectorAll("article.deck, article.post"));
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
