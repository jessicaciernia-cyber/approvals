/* The upload form. Sign in, pick a client, drop slides in order, paste the caption, go.
 *
 * Nothing here decides what is allowed. The API helper validates before it sends, and
 * the database policies decide after. This file only shows state and moves files
 * around in a list before they leave the browser.
 */
(function () {
  "use strict";
  var API = window.ApprovalUploads;
  var $ = function (id) { return document.getElementById(id); };
  var login = $("login"), form = $("up"), who = $("who");
  var email = $("email"), pass = $("pass"), loginSay = $("login-say"), loginBtn = $("login-btn");
  var site = $("site"), title = $("title"), caption = $("caption"), capCount = $("cap-count");
  var pick = $("pick"), files = $("files"), go = $("go"), say = $("say"), out = $("out");
  var draft = $("draft"), draftSay = $("draft-say"), flagsBox = $("flags");
  var list = [];   // File objects, in slide order
  var MAX = 10, MAX_CAPTION = 2200;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function paintAuth() {
    var s = API.session();
    login.hidden = !!s;
    form.hidden = !s;
    who.hidden = !s;
    $("logout").hidden = !s;
    if (s) who.textContent = "Signed in as " + ((s.user && s.user.email) || "you");
  }

  function paintFiles() {
    files.textContent = "";
    list.forEach(function (f, i) {
      var box = el("div", "file");
      var img = el("img"); img.alt = ""; img.src = URL.createObjectURL(f);
      img.onload = function () { URL.revokeObjectURL(img.src); };
      box.appendChild(img);
      box.appendChild(el("div", "n", (i + 1 < 10 ? "0" : "") + (i + 1) + "  " + Math.round(f.size / 1024) + " KB"));
      var ctl = el("div", "ctl");
      var up = el("button", null, "↑"); up.type = "button"; up.disabled = i === 0;
      up.setAttribute("aria-label", "Move slide " + (i + 1) + " earlier");
      var dn = el("button", null, "↓"); dn.type = "button"; dn.disabled = i === list.length - 1;
      dn.setAttribute("aria-label", "Move slide " + (i + 1) + " later");
      var x = el("button", "x", "✕"); x.type = "button";
      x.setAttribute("aria-label", "Remove slide " + (i + 1));
      up.addEventListener("click", function () { list.splice(i - 1, 0, list.splice(i, 1)[0]); paintFiles(); });
      dn.addEventListener("click", function () { list.splice(i + 1, 0, list.splice(i, 1)[0]); paintFiles(); });
      x.addEventListener("click", function () { list.splice(i, 1); paintFiles(); });
      ctl.appendChild(up); ctl.appendChild(dn); ctl.appendChild(x);
      box.appendChild(ctl);
      files.appendChild(box);
    });
    go.disabled = list.length === 0;
    draft.disabled = list.length === 0;
    tell(list.length ? list.length + " of " + MAX + " slides. First one is the cover." : "", "");
  }

  /* A slide at 1024px on its long side is plenty for reading the words on it, and it
     keeps ten slides under a few megabytes for the trip to the caption function. */
  function shrink(file) {
    return new Promise(function (res, rej) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var s = Math.min(1, 1024 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        var dataUrl = c.toDataURL("image/jpeg", 0.85);
        res({ media_type: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1) });
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("Could not read " + file.name)); };
      img.src = url;
    });
  }

  function showFlags(flags) {
    flagsBox.textContent = "";
    if (!flags || !flags.length) {
      flagsBox.appendChild(el("p", "flag ok", "Nothing on the slides needs a source or a legal look."));
      return;
    }
    flags.forEach(function (f) {
      var row = el("p", "flag " + (f.level === "stop" ? "stop" : "check"));
      row.appendChild(el("b", null, (f.level === "stop" ? "Cannot ship" : "Check a claim") + " · slide " + f.slide));
      row.appendChild(document.createTextNode(" " + f.note));
      flagsBox.appendChild(row);
    });
  }

  draft.addEventListener("click", function () {
    draft.disabled = true; flagsBox.textContent = "";
    draftSay.className = "say"; draftSay.textContent = "Reading " + list.length + " slide" + (list.length === 1 ? "" : "s") + "…";
    Promise.all(list.map(shrink)).then(function (images) {
      draftSay.textContent = "Drafting… about 10 to 20 seconds.";
      return API.draftCaption({ site: site.value, title: title.value, images: images });
    }).then(function (d) {
      caption.value = (d.caption || "").trim() + (d.hashtags ? "\n\n" + d.hashtags.trim() : "");
      paintCaption();
      showFlags(d.flags);
      draftSay.className = "say ok"; draftSay.textContent = "Drafted. Edit anything before you add it.";
    }).catch(function (e) {
      draftSay.className = "say bad"; draftSay.textContent = "No draft. " + e.message;
    }).then(function () { draft.disabled = list.length === 0; });
  });

  function tell(msg, cls) { say.className = "say " + (cls || ""); say.textContent = msg; }

  function paintCaption() {
    var n = caption.value.length;
    capCount.textContent = n + " / " + MAX_CAPTION;
    capCount.className = "count" + (n > MAX_CAPTION ? " bad" : "");
  }

  $("login-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    loginBtn.disabled = true; loginSay.className = "say"; loginSay.textContent = "Signing in…";
    API.signIn(email.value.trim(), pass.value).then(function () {
      pass.value = ""; loginSay.textContent = "";
      paintAuth();
    }).catch(function (e) {
      loginSay.className = "say bad"; loginSay.textContent = "Could not sign in. " + e.message;
    }).then(function () { loginBtn.disabled = false; });
  });

  $("logout").addEventListener("click", function () {
    API.signOut().then(paintAuth);
  });

  function isZip(f) {
    return /\.zip$/i.test(f.name) || f.type === "application/zip" || f.type === "application/x-zip-compressed";
  }

  /* A zip (Canva's carousel export) expands into its images, in natural order, and
     lands in the list exactly as if each image had been picked by hand. */
  pick.addEventListener("change", function () {
    var picked = [].slice.call(pick.files || []);
    pick.value = "";
    tell("Reading…", "");
    var expand = picked.map(function (f) {
      if (!isZip(f)) return Promise.resolve([f]);
      if (!window.ApprovalUnzip) return Promise.reject(new Error("Zip support did not load"));
      return window.ApprovalUnzip.unzip(f).then(function (imgs) {
        if (!imgs.length) throw new Error(f.name + " has no PNG or JPEG inside");
        return imgs;
      });
    });
    Promise.all(expand).then(function (groups) {
      var added = [].concat.apply([], groups), dropped = 0;
      added.forEach(function (f) {
        if (list.length >= MAX) { dropped++; return; }
        list.push(f);
      });
      paintFiles();
      if (dropped) tell("Only the first " + MAX + " were kept, " + dropped + " left out.", "bad");
    }).catch(function (e) {
      paintFiles();
      tell("Could not read that. " + e.message, "bad");
    });
  });

  caption.addEventListener("input", paintCaption);

  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    out.textContent = "";
    go.disabled = true; tell("Uploading…", "");
    var chosen = site.value;
    API.createUpload({
      site: chosen, title: title.value, caption: caption.value, files: list,
      onProgress: function (i, n) { tell("Uploaded " + i + " of " + n + "…", ""); }
    }).then(function (row) {
      list = []; paintFiles(); title.value = ""; caption.value = ""; paintCaption();
      tell("Added to the approval page.", "ok");
      var a = el("a", "btn", "Open the " + site.options[site.selectedIndex].text + " page →");
      a.href = chosen + "/#" + encodeURIComponent(row.id);
      out.appendChild(a);
    }).catch(function (e) {
      tell("Did not add it. " + e.message, "bad");
      go.disabled = list.length === 0;
    });
  });

  if (!API) {
    login.hidden = true; form.hidden = true;
    loginSay.textContent = "Uploads are not configured.";
    return;
  }
  paintAuth(); paintFiles(); paintCaption();
})();
