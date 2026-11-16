/* דף המלווה — מה שהלקוחות מילאו, מוכן לשיחה השבועית */

(function () {
  "use strict";

  var KEY = "bh.coach.key";
  var el = function (id) { return document.getElementById(id); };

  var initialParams = (function () {
    try { return new URLSearchParams(location.search); }
    catch (e) { return { get: function () { return null; } }; }
  })();

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function show(which) {
    el("k-gate").hidden    = which !== "gate";
    el("board").hidden     = which !== "board";
    el("k-loading").hidden = which !== "loading";
  }

  function rpc(fn, args) {
    var cfg = window.CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return Promise.reject(new Error("no-config"));
    return fetch(cfg.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg.SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + cfg.SUPABASE_ANON_KEY
      },
      body: JSON.stringify(args)
    }).then(function (r) {
      if (!r.ok) throw new Error("http-" + r.status);
      return r.status === 204 ? null : r.json();
    });
  }

  /* ---------- תאריכים ---------- */

  function todayISO() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function dayLabel(iso) {
    var parts = String(iso).split("-");
    var d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    var label = d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
    if (iso === todayISO()) return "היום · " + label;
    return label;
  }

  function daysSince(iso) {
    if (!iso) return null;
    var parts = String(iso).split("-");
    var then = new Date(+parts[0], +parts[1] - 1, +parts[2]);
    var now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.round((now - then) / 86400000);
  }

  /* ---------- בנייה ---------- */

  var ATTENDED = {
    yes:  { cls: "yes",  text: "הגיע" },
    no:   { cls: "no",   text: "לא הגיע" },
    none: { cls: "none", text: "אין אימון" }
  };

  function statBox(k, v, warn) {
    var box = document.createElement("div");
    box.className = "stat" + (warn ? " warn" : "");
    var kk = document.createElement("span"); kk.className = "k"; kk.textContent = k;
    var vv = document.createElement("span"); vv.className = "v"; vv.textContent = v;
    box.appendChild(kk); box.appendChild(vv);
    return box;
  }

  function clientCard(c) {
    var card = document.createElement("div");
    card.className = "client";

    var top = document.createElement("div");
    top.className = "client-top";
    var name = document.createElement("h2");
    name.className = "client-name";
    name.textContent = c.first_name;
    var dest = document.createElement("p");
    dest.className = "client-dest";
    dest.textContent = c.destination || "";
    top.appendChild(name); top.appendChild(dest);
    card.appendChild(top);

    var total = (c.weekly_target || 5) * (c.program_weeks || 8);
    var gap = daysSince(c.last_day);

    var stats = document.createElement("div");
    stats.className = "stats";
    stats.appendChild(statBox("השבוע", c.attended_week + " / " + (c.weekly_target || 5)));
    stats.appendChild(statBox("בסך הכול", c.attended_total + " / " + total));
    stats.appendChild(statBox("דיווחים השבוע", String(c.reported_week)));
    stats.appendChild(statBox(
      "דיווח אחרון",
      gap === null ? "—" : gap === 0 ? "היום" : gap === 1 ? "אתמול" : "לפני " + gap + " ימים",
      gap !== null && gap >= 2
    ));
    card.appendChild(stats);

    var log = document.createElement("div");
    log.className = "log";
    log.innerHTML = '<p class="empty">טוען…</p>';
    card.appendChild(log);

    rpc("app_coach_log", { p_key: state.key, p_code: c.code, p_days: 14 })
      .then(function (rows) { renderLog(log, rows || []); })
      .catch(function () { log.innerHTML = '<p class="empty">לא הצלחתי לטעון את היומן.</p>'; });

    return card;
  }

  function renderLog(box, rows) {
    box.innerHTML = "";
    if (!rows.length) {
      var p = document.createElement("p");
      p.className = "empty";
      p.textContent = "עוד אין דיווחים.";
      box.appendChild(p);
      return;
    }

    rows.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "row";

      var top = document.createElement("div");
      top.className = "row-top";
      var day = document.createElement("span");
      day.className = "row-day";
      day.textContent = dayLabel(r.day);
      var a = ATTENDED[r.attended] || ATTENDED.none;
      var tag = document.createElement("span");
      tag.className = "tag " + a.cls;
      tag.textContent = a.text;
      top.appendChild(day); top.appendChild(tag);
      row.appendChild(top);

      var hard = (r.blockers || []).join(", ");
      if (hard) row.appendChild(said("מה היה קשה", hard));
      if (r.decided) row.appendChild(said("מה הכריע", r.decided));

      box.appendChild(row);
    });
  }

  function said(label, text) {
    var p = document.createElement("p");
    p.className = "said";
    var b = document.createElement("b");
    b.textContent = label + ": ";
    p.appendChild(b);
    p.appendChild(document.createTextNode(text));
    return p;
  }

  /* ---------- הפעלה ---------- */

  var state = { key: null };

  function openGate(message) {
    var msg = el("k-msg");
    if (message) { msg.textContent = message; msg.hidden = false; } else { msg.hidden = true; }
    show("gate");
    el("k-input").focus();
  }

  el("k-go").addEventListener("click", function () {
    var v = el("k-input").value.trim();
    if (v) tryKey(v);
  });
  el("k-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter") el("k-go").click();
  });

  function tryKey(key) {
    show("loading");
    rpc("app_coach_clients", { p_key: key })
      .then(function (rows) {
        if (!rows) { openGate("לא הצלחתי לקרוא. נסה שוב."); return; }
        if (!rows.length) { openGate("המפתח הזה לא מוכר, או שאין לו לקוחות."); return; }

        state.key = key;
        lsSet(KEY, key);
        try { history.replaceState(null, "", location.pathname); } catch (e) {}

        el("today-line").textContent =
          new Date().toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });

        var list = el("clients");
        list.innerHTML = "";
        rows.forEach(function (c) { list.appendChild(clientCard(c)); });
        show("board");
      })
      .catch(function (err) {
        openGate(err && err.message === "no-config"
          ? "הדף עוד לא חובר לנתונים."
          : "אין חיבור כרגע. נסה שוב בעוד רגע.");
      });
  }

  var key = (initialParams.get("k") || lsGet(KEY) || "").trim();
  if (key) tryKey(key); else openGate();
})();
