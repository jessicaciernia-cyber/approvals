/* Self-serve uploads for the approval pages: sign-in, list, create, delete.
 *
 * The page holds the anon key, which is public by design, and uses it alone only to
 * READ. Every write carries the signed-in user's access token as the bearer, and the
 * row-level policies in uploads-schema.sql check that token against one user id. So
 * a copy of this file, the key, and the URL gives a stranger exactly what the public
 * page already gives them: the ability to look.
 *
 * No UI here. upload.html and the live render pages call window.ApprovalUploads.
 */
(function () {
  "use strict";
  var BASE = window.APPROVAL_COMMENTS || {};
  var OVER = window.APPROVAL_UPLOADS_CFG || {};
  var CFG = {
    url: String(OVER.url || BASE.url || "").replace(/\/$/, ""),
    key: OVER.key || BASE.key || "",
    site: OVER.site || BASE.site || ""
  };
  var BUCKET = "approvals-uploads";
  var SITES = ["welliemd", "zenjessica"];
  var STORE = "approval-uploads-session";
  var MAX_FILES = 10, MAX_BYTES = 8388608, MAX_TITLE = 120, MAX_CAPTION = 2200;
  var TYPES = { "image/png": "png", "image/jpeg": "jpg" };

  function fail(msg) { return new Error(String(msg || "Request failed").slice(0, 200)); }

  /* Pull the server's own words out of an error body when it has any. */
  function errorOf(r) {
    return r.text().then(function (t) {
      var d = null;
      try { d = JSON.parse(t); } catch (e) {}
      var m = d && (d.error_description || d.msg || d.message || d.error);
      throw fail(m || t || ("HTTP " + r.status));
    });
  }

  function json(r) { return r.ok ? r.json() : errorOf(r); }

  function readStore() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE) || "null");
      return s && s.access_token && s.refresh_token ? s : null;
    } catch (e) { return null; }
  }

  function writeStore(data, prev) {
    var exp = Number(data.expires_at) ||
      (data.expires_in ? Math.floor(Date.now() / 1000) + Number(data.expires_in) : 0);
    var s = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || (prev && prev.refresh_token),
      expires_at: exp,
      user: data.user || (prev && prev.user) || null
    };
    if (!s.access_token || !s.refresh_token || !s.expires_at) throw fail("Sign-in response was incomplete");
    try { localStorage.setItem(STORE, JSON.stringify(s)); } catch (e) { throw fail("Could not keep the session"); }
    return s;
  }

  function clearStore() { try { localStorage.removeItem(STORE); } catch (e) {} }

  /* A session counts as live only with a minute to spare, so a call that starts now
     does not expire halfway through a ten-file upload. */
  function session() {
    var s = readStore();
    return s && s.expires_at > Date.now() / 1000 + 60 ? s : null;
  }

  function need() {
    if (!CFG.url || !CFG.key) return Promise.reject(fail("Uploads are not configured"));
    return null;
  }

  function authHeaders(token, extra) {
    var h = { apikey: CFG.key, Authorization: "Bearer " + token };
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) h[k] = extra[k];
    return h;
  }

  function signIn(email, password) {
    var m = need(); if (m) return m;
    return fetch(CFG.url + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: CFG.key, "Content-Type": "application/json" },
      body: JSON.stringify({ email: email, password: password })
    }).then(json).then(function (d) { return writeStore(d, null).user; });
  }

  function ensureSession() {
    var live = session();
    if (live) return Promise.resolve(live);
    var stale = readStore();
    if (!stale) return Promise.reject(fail("Not signed in"));
    var m = need(); if (m) return m;
    return fetch(CFG.url + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: CFG.key, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: stale.refresh_token })
    }).then(json).then(function (d) { return writeStore(d, stale); })
      .catch(function (e) { clearStore(); throw fail("Not signed in. " + e.message); });
  }

  function signOut() {
    var s = readStore();
    if (!s || !CFG.url) { clearStore(); return Promise.resolve(); }
    return fetch(CFG.url + "/auth/v1/logout", { method: "POST", headers: authHeaders(s.access_token) })
      .then(clearStore, clearStore);
  }

  /* Reads work signed out. The anon key is the bearer only here. */
  function listUploads(site) {
    var m = need(); if (m) return m;
    var s = session();
    return fetch(CFG.url + "/rest/v1/approval_uploads?site=eq." + encodeURIComponent(site) +
      "&select=id,site,title,caption,slides,created_at&order=created_at.desc",
      { headers: authHeaders(s ? s.access_token : CFG.key) }).then(json);
  }

  function encodePath(p) {
    return String(p).split("/").map(encodeURIComponent).join("/");
  }

  function publicUrl(path) {
    return CFG.url + "/storage/v1/object/public/" + BUCKET + "/" + encodePath(path);
  }

  /* Everything the schema checks, checked here first, so a bad upload never leaves
     stray objects in the bucket behind a rejected row. */
  function validate(input) {
    var o = input || {};
    if (SITES.indexOf(o.site) < 0) throw fail("Site must be welliemd or zenjessica");
    var title = String(o.title == null ? "" : o.title).trim();
    if (title.length < 1 || title.length > MAX_TITLE) throw fail("Title must be 1 to " + MAX_TITLE + " characters");
    var caption = o.caption == null ? "" : String(o.caption);
    if (caption.length > MAX_CAPTION) throw fail("Caption must be " + MAX_CAPTION + " characters or fewer");
    var files = o.files ? [].slice.call(o.files) : [];
    if (files.length < 1 || files.length > MAX_FILES) throw fail("Choose 1 to " + MAX_FILES + " images");
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!f || !TYPES[f.type]) throw fail("Image " + (i + 1) + " must be a PNG or JPEG");
      if (typeof f.size !== "number" || f.size > MAX_BYTES) throw fail("Image " + (i + 1) + " must be 8 MB or smaller");
    }
    return { site: o.site, title: title, caption: caption, files: files };
  }

  function removeObjects(paths, token) {
    if (!paths.length) return Promise.resolve();
    return fetch(CFG.url + "/storage/v1/object/" + BUCKET, {
      method: "DELETE",
      headers: authHeaders(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ prefixes: paths })
    }).then(function (r) { return r.ok ? r : errorOf(r); });
  }

  /* Clean up, then surface the ORIGINAL error whether or not the cleanup worked. */
  function undoThenThrow(paths, token, err) {
    return removeObjects(paths, token).then(function () { throw err; }, function () { throw err; });
  }

  function createUpload(input) {
    var v;
    try { v = validate(input); } catch (e) { return Promise.reject(e); }
    var m = need(); if (m) return m;
    var onProgress = input && typeof input.onProgress === "function" ? input.onProgress : null;

    return ensureSession().then(function (s) {
      var token = s.access_token;
      var id = crypto.randomUUID();
      var prefix = v.site + "/";
      var done = [];

      function putOne(i) {
        if (i >= v.files.length) return Promise.resolve();
        var f = v.files[i];
        var n = i + 1;
        var path = prefix + id + "/" + (n < 10 ? "0" + n : String(n)) + "." + TYPES[f.type];
        return fetch(CFG.url + "/storage/v1/object/" + BUCKET + "/" + encodePath(path), {
          method: "POST",
          headers: authHeaders(token, { "Content-Type": f.type, "x-upsert": "false" }),
          body: f
        }).then(function (r) {
          if (!r.ok) return errorOf(r);
          done.push(path);
          if (onProgress) onProgress(n, v.files.length);
          return putOne(i + 1);
        });
      }

      return putOne(0)
        .catch(function (e) { return undoThenThrow(done, token, e); })
        .then(function () {
          for (var i = 0; i < done.length; i++) {
            if (done[i].indexOf(prefix) !== 0) {
              return undoThenThrow(done, token, fail("Every slide path must start with " + prefix));
            }
          }
          return fetch(CFG.url + "/rest/v1/approval_uploads", {
            method: "POST",
            headers: authHeaders(token, { "Content-Type": "application/json", Prefer: "return=representation" }),
            body: JSON.stringify({ id: id, site: v.site, title: v.title, caption: v.caption, slides: done })
          }).then(json).then(function (rows) {
            if (!rows || rows.length !== 1) throw fail("Upload row was not returned");
            return rows[0];
          }).catch(function (e) { return undoThenThrow(done, token, e); });
        });
    });
  }

  /* PostgREST answers a DELETE that RLS filtered to nothing with 200 and an empty
     array. That is a refusal wearing a success code, and it is treated as one. */
  function deleteUpload(row) {
    if (!row || !row.id) return Promise.reject(fail("Nothing to delete"));
    var m = need(); if (m) return m;
    return ensureSession().then(function (s) {
      var token = s.access_token;
      return removeObjects(row.slides || [], token).then(function () {
        return fetch(CFG.url + "/rest/v1/approval_uploads?id=eq." + encodeURIComponent(row.id), {
          method: "DELETE",
          headers: authHeaders(token, { Prefer: "return=representation" })
        });
      }).then(json).then(function (rows) {
        if (!rows || rows.length !== 1) throw fail("Delete was refused");
        return rows[0];
      });
    });
  }

  /* Ask the caption function for a draft. images are already downsized by the page:
     [{media_type, data}] with data base64 and no prefix. Owner only, the function checks. */
  function draftCaption(input) {
    var o = input || {};
    if (SITES.indexOf(o.site) < 0) return Promise.reject(fail("Site must be welliemd or zenjessica"));
    var images = o.images ? [].slice.call(o.images) : [];
    if (images.length < 1 || images.length > MAX_FILES) return Promise.reject(fail("Send 1 to " + MAX_FILES + " images"));
    for (var i = 0; i < images.length; i++) {
      if (!images[i] || !TYPES[images[i].media_type] || typeof images[i].data !== "string") {
        return Promise.reject(fail("Image " + (i + 1) + " is not a JPEG or PNG"));
      }
    }
    var m = need(); if (m) return m;
    return ensureSession().then(function (s) {
      return fetch(CFG.url + "/functions/v1/caption", {
        method: "POST",
        headers: authHeaders(s.access_token, { "Content-Type": "application/json" }),
        body: JSON.stringify({ site: o.site, title: String(o.title || "").slice(0, 120), images: images })
      }).then(json);
    });
  }

  window.ApprovalUploads = {
    draftCaption: draftCaption,
    signIn: signIn,
    session: session,
    ensureSession: ensureSession,
    signOut: signOut,
    listUploads: listUploads,
    publicUrl: publicUrl,
    createUpload: createUpload,
    deleteUpload: deleteUpload
  };
})();
