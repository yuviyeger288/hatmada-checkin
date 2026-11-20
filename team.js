/* בונים התמדה — מסך הצוות
   מלווה רואה את הלקוחות שלו. מנהל רואה את כל המלווים ואת הלקוחות שלהם.
   ההפרדה נאכפת במסד עצמו, לא כאן. */

(function () {
  "use strict";

  // נקרא לפני שהספרייה מנקה את הכתובת
  var INVITE = /type=(invite|recovery|signup)/.test(location.hash || "");

  var el = function (id) { return document.getElementById(id); };
  var cfg = window.CONFIG || {};
  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  function show(which) {
    el("login").hidden   = which !== "login";
    el("setpw").hidden   = which !== "setpw";
    el("board").hidden   = which !== "board";
    el("loading").hidden = which !== "loading";
  }

  function setpwNote(text) {
    var m = el("setpw-msg");
    if (text) { m.textContent = text; m.hidden = false; } else { m.hidden = true; }
  }

  el("setpw-go").addEventListener("click", function () {
    var a = el("pw1").value, b = el("pw2").value;
    if (a.length < 8) { setpwNote("לפחות 8 תווים."); return; }
    if (a !== b)      { setpwNote("שתי הסיסמאות לא זהות."); return; }
    setpwNote(null);
    show("loading");
    sb.auth.updateUser({ password: a }).then(function (res) {
      el("pw1").value = ""; el("pw2").value = "";
      if (res.error) { setpwNote("לא הצלחתי לשמור. נסה שוב."); show("setpw"); return; }
      try { history.replaceState(null, "", location.pathname); } catch (e) {}
      load();
    });
  });

  el("pw2").addEventListener("keydown", function (e) {
    if (e.key === "Enter") el("setpw-go").click();
  });

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

  // באיזו שעה הוא דיווח בפועל. זה מה שקובע באיזו שעה תזכורת הגיונית.
  function timeLabel(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
    } catch (e) { return ""; }
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
      var at = timeLabel(r.created_at);
      day.textContent = dayLabel(r.day) + (at ? " · " + at : "");
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

  function renderBoardLog(box, row) {
    box.innerHTML = "";

    var items = (row && row.items) || [];
    if (!items.length) {
      var p = document.createElement("p");
      p.className = "empty";
      p.textContent = "עוד לא התחיל את הלוח.";
      box.appendChild(p);
      return;
    }

    var count = function (sym) {
      return items.filter(function (i) { return i.m === sym; }).length;
    };

    var head = document.createElement("p");
    head.className = "empty";
    head.textContent = items.length + " שורות · " + count("+") + " פלוס · " +
      count("=") + " ניטרלי · " + count("−") + " מינוס · " +
      (row.phase === "done" ? "הושלם" : "באמצע");
    box.appendChild(head);

    items.forEach(function (it) {
      var r = document.createElement("div");
      r.className = "row";

      var top = document.createElement("div");
      top.className = "row-top";

      var t = document.createElement("span");
      t.className = "said";
      t.textContent = it.t;

      var m = document.createElement("span");
      m.className = "tag " + (it.m === "+" ? "yes" : it.m === "−" ? "no" : "none");
      m.textContent = it.m || "—";

      top.appendChild(t);
      top.appendChild(m);
      r.appendChild(top);
      box.appendChild(r);
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
        .select("day,attended,blockers,decided,created_at")
        .eq("client_id", c.id)
        .order("day", { ascending: false })
        .limit(21)
        .then(function (res) {
          if (res.error) { log.innerHTML = '<p class="empty">לא הצלחתי לטעון.</p>'; return; }
          renderLog(log, res.data || []);
        });
    });
    card.insertBefore(btn, log);

    // לוח ההרגלים — נטען רק כשפותחים אותו
    var bbox = document.createElement("div");
    bbox.className = "log";
    bbox.hidden = true;

    var bbtn = document.createElement("button");
    bbtn.className = "toggle";
    bbtn.type = "button";
    bbtn.textContent = "לוח ההרגלים ↓";
    var bloaded = false;
    bbtn.addEventListener("click", function () {
      if (!bbox.hidden) { bbox.hidden = true; bbtn.textContent = "לוח ההרגלים ↓"; return; }
      bbox.hidden = false;
      bbtn.textContent = "סגור ↑";
      if (bloaded) return;
      bloaded = true;
      bbox.innerHTML = '<p class="empty">טוען…</p>';
      sb.from("boards")
        .select("items,phase,updated_at")
        .eq("client_id", c.id)
        .maybeSingle()
        .then(function (res) {
          if (res.error) { bbox.innerHTML = '<p class="empty">לא הצלחתי לטעון.</p>'; return; }
          renderBoardLog(bbox, res.data);
        });
    });

    card.appendChild(bbtn);
    card.appendChild(bbox);

    // מתג פתיחה — הלקוח רואה את המשימה רק אחרי שלוחצים כאן
    var lock = document.createElement("button");
    lock.className = "toggle lock";
    lock.type = "button";

    var isOpen = (c.open_tasks || []).indexOf("board") !== -1;

    function paintLock() {
      lock.textContent = isOpen
        ? "לוח ההרגלים פתוח ללקוח · ללחוץ כדי לנעול"
        : "לוח ההרגלים נעול · ללחוץ כדי לפתוח";
      if (isOpen) lock.classList.add("on");
      else lock.classList.remove("on");
    }
    paintLock();

    lock.addEventListener("click", function () {
      var current = c.open_tasks || [];
      var next = isOpen
        ? current.filter(function (k) { return k !== "board"; })
        : current.concat(["board"]);
      lock.disabled = true;
      lock.textContent = "רגע…";
      sb.from("clients").update({ open_tasks: next }).eq("id", c.id).then(function (res) {
        lock.disabled = false;
        if (res.error) {
          lock.textContent = "לא הצלחתי לשנות. נסה שוב.";
          return;
        }
        c.open_tasks = next;
        isOpen = !isOpen;
        paintLock();
      });
    });

    card.appendChild(lock);

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
    var signedIn = !!(res.data && res.data.session);
    if (signedIn && INVITE) { show("setpw"); el("pw1").focus(); }
    else if (signedIn) load();
    else show("login");
  });
})();
