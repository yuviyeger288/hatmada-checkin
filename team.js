/* בונים התמדה — מסך הצוות
   מלווה רואה את הלקוחות שלו. מנהל רואה את כל המלווים ואת הלקוחות שלהם.
   ההפרדה נאכפת במסד עצמו, לא כאן. */

(function () {
  "use strict";

  var el = function (id) { return document.getElementById(id); };
  var cfg = window.CONFIG || {};
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  function show(which) {
    el("login").hidden   = which !== "login";
    el("board").hidden   = which !== "board";
    el("loading").hidden = which !== "loading";
  }

  function note(text) {
    var m = el("login-msg");
    if (text) { m.textContent = text; m.hidden = false; } else { m.hidden = true; }
  }

  /* ---------- תאריכים ---------- */

  function todayISO() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function dayLabel(iso) {
    var a = String(iso).split("-");
    var d = new Date(+a[0], +a[1] - 1, +a[2]);
    var label = d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
    return iso === todayISO() ? "היום · " + label : label;
  }

  function daysSince(iso) {
    if (!iso) return null;
    var a = String(iso).split("-");
    var then = new Date(+a[0], +a[1] - 1, +a[2]);
    var now = new Date(); now.setHours(0, 0, 0, 0);
    return Math.round((now - then) / 86400000);
  }

  function gapText(gap) {
    if (gap === null) return "—";
    if (gap === 0) return "היום";
    if (gap === 1) return "אתמול";
    return "לפני " + gap + " ימים";
  }

  /* ---------- רכיבים ---------- */

  var ATTENDED = {
    yes:  { cls: "yes",  text: "הגיע" },
    no:   { cls: "no",   text: "לא הגיע" },
    none: { cls: "none", text: "אין אימון" }
  };

  function stat(k, v, warn) {
    var box = document.createElement("div");
    box.className = "stat" + (warn ? " warn" : "");
    var a = document.createElement("span"); a.className = "k"; a.textContent = k;
    var b = document.createElement("span"); b.className = "v"; b.textContent = v;
    box.appendChild(a); box.appendChild(b);
    return box;
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

  function clientCard(c) {
    var card = document.createElement("div");
    card.className = "client";

    var top = document.createElement("div");
    top.className = "client-top";
    var name = document.createElement("h3");
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
    stats.appendChild(stat("השבוע", c.attended_week + " / " + (c.weekly_target || 5)));
    stats.appendChild(stat("בסך הכול", c.attended_total + " / " + total));
    stats.appendChild(stat("דיווחים השבוע", String(c.reported_week)));
    stats.appendChild(stat("דיווח אחרון", gapText(gap), gap !== null && gap >= 2));
    card.appendChild(stats);

    var log = document.createElement("div");
    log.className = "log";
    log.hidden = true;
    card.appendChild(log);

    var btn = document.createElement("button");
    btn.className = "toggle";
    btn.type = "button";
    btn.textContent = "מה הוא כתב ↓";
    var loaded = false;
    btn.addEventListener("click", function () {
      if (!log.hidden) { log.hidden = true; btn.textContent = "מה הוא כתב ↓"; return; }
      log.hidden = false;
      btn.textContent = "סגור ↑";
      if (loaded) return;
      loaded = true;
      log.innerHTML = '<p class="empty">טוען…</p>';
      sb.from("checkins")
        .select("day,attended,blockers,decided")
        .eq("client_id", c.id)
        .order("day", { ascending: false })
        .limit(21)
        .then(function (res) {
          if (res.error) { log.innerHTML = '<p class="empty">לא הצלחתי לטעון.</p>'; return; }
          renderLog(log, res.data || []);
        });
    });
    card.insertBefore(btn, log);

    return card;
  }

  function coachBlock(title, meta, clients) {
    var block = document.createElement("section");
    block.className = "coach-block";

    var head = document.createElement("div");
    head.className = "coach-title";
    var h = document.createElement("h2");
    h.textContent = title;
    var m = document.createElement("span");
    m.className = "meta";
    m.textContent = meta;
    head.appendChild(h); head.appendChild(m);
    block.appendChild(head);

    var list = document.createElement("div");
    list.className = "clients";
    if (!clients.length) {
      var p = document.createElement("p");
      p.className = "empty";
      p.textContent = "אין לקוחות עדיין.";
      list.appendChild(p);
    } else {
      clients.forEach(function (c) { list.appendChild(clientCard(c)); });
    }
    block.appendChild(list);
    return block;
  }

  /* ---------- טעינת המסך ---------- */

  function load() {
    show("loading");

    Promise.all([
      sb.auth.getUser(),
      sb.rpc("me_is_admin"),
      sb.from("coaches").select("id,name,email,is_admin,user_id"),
      sb.from("client_summary").select("*")
    ]).then(function (res) {
      var uid      = res[0].data && res[0].data.user ? res[0].data.user.id : null;
      var isAdmin  = res[1].data === true;
      var coaches  = res[2].data || [];
      var clients  = res[3].data || [];

      var me = coaches.filter(function (c) { return c.user_id === uid; })[0];
      el("who-name").textContent = (me && me.name) || "";
      el("who-role").textContent = isAdmin ? "מנהל" : "מלווה";

      var content = el("content");
      content.innerHTML = "";

      if (!isAdmin) {
        var list = document.createElement("div");
        list.className = "clients";
        if (!clients.length) {
          list.innerHTML = '<p class="empty">אין לך לקוחות עדיין.</p>';
        } else {
          clients.forEach(function (c) { list.appendChild(clientCard(c)); });
        }
        content.appendChild(list);
        show("board");
        return;
      }

      // מנהל: כל מלווה והלקוחות שלו
      coaches.sort(function (a, b) { return (a.name || "").localeCompare(b.name || "", "he"); });
      coaches.forEach(function (co) {
        var theirs = clients.filter(function (c) { return c.coach_id === co.id; });
        var meta = theirs.length + " לקוחות" + (co.is_admin ? " · מנהל" : "");
        content.appendChild(coachBlock(co.name, meta, theirs));
      });

      var orphans = clients.filter(function (c) {
        return !coaches.some(function (co) { return co.id === c.coach_id; });
      });
      if (orphans.length) {
        content.appendChild(coachBlock("בלי מלווה", orphans.length + " לקוחות", orphans));
      }

      show("board");
    }).catch(function () {
      note("לא הצלחתי לטעון. נסה שוב.");
      show("login");
    });
  }

  /* ---------- כניסה ויציאה ---------- */

  el("login-go").addEventListener("click", function () {
    var email = el("email").value.trim();
    var password = el("password").value;
    if (!email || !password) { note("צריך מייל וסיסמה."); return; }
    note(null);
    show("loading");
    sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
      if (res.error) {
        note("המייל או הסיסמה לא נכונים.");
        show("login");
        return;
      }
      el("password").value = "";
      load();
    });
  });

  el("password").addEventListener("keydown", function (e) {
    if (e.key === "Enter") el("login-go").click();
  });

  el("forgot").addEventListener("click", function () {
    var email = el("email").value.trim();
    if (!email) { note("תכניס קודם את המייל, ואז לחץ שוב."); return; }
    sb.auth.resetPasswordForEmail(email, { redirectTo: location.href }).then(function () {
      note("אם המייל רשום אצלנו, נשלח אליו קישור לאיפוס.");
    });
  });

  el("logout").addEventListener("click", function () {
    sb.auth.signOut().then(function () {
      el("content").innerHTML = "";
      show("login");
    });
  });

  sb.auth.getSession().then(function (res) {
    if (res.data && res.data.session) load();
    else show("login");
  });
})();
