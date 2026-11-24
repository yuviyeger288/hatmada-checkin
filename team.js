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

  /* ---------- הקלטות ---------- */

  var SLOT_LABEL = { hard: "מה היה קשה", decided: "מה הכריע" };
  var SLOTS = ["hard", "decided"];

  function secsLabel(s) {
    s = Math.max(0, Math.round(s || 0));
    var r = s % 60;
    return Math.floor(s / 60) + ":" + (r < 10 ? "0" : "") + r;
  }

  function b64ToBlob(b64, mime) {
    var bin = atob(b64);
    var n = bin.length, a = new Uint8Array(n);
    for (var i = 0; i < n; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: mime || "audio/mp4" });
  }

  /* האודיו עצמו נשלף רק בלחיצה. היומן טוען את הרשימה בלבד, אחרת כל
     פתיחה של כרטיס לקוח היתה מורידה את כל ההקלטות שלו. */
  function voiceBlock(clientId, day, slot, secs) {
    var wrap = document.createElement("div");

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toggle";
    btn.textContent = "▶ " + (SLOT_LABEL[slot] || slot) + " · הקלטה " + secsLabel(secs);

    btn.addEventListener("click", function () {
      btn.disabled = true;
      btn.textContent = "טוען…";
      sb.from("checkin_voice")
        .select("b64,mime,secs")
        .eq("client_id", clientId)
        .eq("day", day)
        .eq("slot", slot)
        .maybeSingle()
        .then(function (res) {
          if (res.error || !res.data || !res.data.b64) {
            btn.disabled = false;
            btn.textContent = "לא הצלחתי לטעון. ללחוץ שוב";
            return;
          }
          var lab = document.createElement("p");
          lab.className = "said";
          var b = document.createElement("b");
          b.textContent = (SLOT_LABEL[slot] || slot) + " · הקלטה:";
          lab.appendChild(b);

          var a = document.createElement("audio");
          a.className = "said-audio";
          a.controls = true;
          a.preload = "metadata";
          a.src = URL.createObjectURL(b64ToBlob(res.data.b64, res.data.mime));

          wrap.innerHTML = "";
          wrap.appendChild(lab);
          wrap.appendChild(a);
        });
    });

    wrap.appendChild(btn);
    return wrap;
  }

  function renderLog(box, rows, voice, clientId) {
    box.innerHTML = "";
    voice = voice || [];

    /* יום שיש בו הקלטה אבל הדיווח לא נשלח מופיע בכל זאת. בלי זה
       ההקלטה יושבת במסד ואף אחד לא יודע שהיא שם. */
    var seen = {};
    rows.forEach(function (r) { seen[String(r.day)] = true; });

    var all = rows.slice();
    voice.forEach(function (v) {
      var d = String(v.day);
      if (seen[d]) return;
      seen[d] = true;
      all.push({ day: d, attended: null, blockers: [], decided: "", created_at: null, partial: true });
    });
    all.sort(function (x, y) {
      return String(x.day) < String(y.day) ? 1 : String(x.day) > String(y.day) ? -1 : 0;
    });

    if (!all.length) {
      var p = document.createElement("p");
      p.className = "empty";
      p.textContent = "עוד אין דיווחים.";
      box.appendChild(p);
      return;
    }

    all.forEach(function (r) {
      var row = document.createElement("div");
      row.className = "row";

      var top = document.createElement("div");
      top.className = "row-top";
      var day = document.createElement("span");
      day.className = "row-day";
      var at = timeLabel(r.created_at);
      day.textContent = dayLabel(r.day) + (at ? " · " + at : "");

      var tag = document.createElement("span");
      if (r.partial) {
        tag.className = "tag none";
        tag.textContent = "לא נשלח";
      } else {
        var a = ATTENDED[r.attended] || ATTENDED.none;
        tag.className = "tag " + a.cls;
        tag.textContent = a.text;
      }
      top.appendChild(day); top.appendChild(tag);
      row.appendChild(top);

      var hard = (r.blockers || []).join(", ");
      if (hard) row.appendChild(said("מה היה קשה", hard));
      if (r.decided) row.appendChild(said("מה הכריע", r.decided));

      SLOTS.forEach(function (slot) {
        for (var i = 0; i < voice.length; i++) {
          if (String(voice[i].day) === String(r.day) && voice[i].slot === slot) {
            row.appendChild(voiceBlock(clientId, r.day, slot, voice[i].secs));
            return;
          }
        }
      });

      box.appendChild(row);
    });
  }

  var LOOP_Q = [
    ["cue",      "גירוי · מה מזכיר לו"],
    ["crave",    "חשק · למה זה חשוב לו"],
    ["response", "תגובה · הפעולה עצמה"],
    ["reward",   "תגמול · מה הוא מקבל אחרי"]
  ];

  // המשפט על השלב השבור הוא התוצר של המשימה, ולכן הוא ראשון ולא אחרון.
  function renderLoopLog(box, row) {
    box.innerHTML = "";

    var d = (row && row.data) || {};
    var any = LOOP_Q.some(function (q) { return d[q[0]]; }) || d.broken;
    if (!any) {
      var p = document.createElement("p");
      p.className = "empty";
      p.textContent = "עוד לא התחיל.";
      box.appendChild(p);
      return;
    }

    if (d.broken) {
      var head = document.createElement("div");
      head.className = "row";
      head.appendChild(said("השלב השבור", d.broken + (d.why ? " — " + d.why : "")));
      box.appendChild(head);
    }

    LOOP_Q.forEach(function (q) {
      if (!d[q[0]]) return;
      var r = document.createElement("div");
      r.className = "row";
      r.appendChild(said(q[1], d[q[0]]));
      box.appendChild(r);
    });

    var foot = document.createElement("p");
    foot.className = "empty";
    foot.textContent = (row && row.done) ? "הושלם" : "באמצע";
    box.appendChild(foot);
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
    // "השבוע" הוא שבוע לוח שמתחיל ביום ראשון, לא שבעה ימים אחרונים.
    // הכתוב בתווית אומר את זה, כדי שלא יהיה ספק מה המספר סופר.
    stats.appendChild(stat("השבוע · מראשון", c.attended_week + " / " + (c.weekly_target || 5)));
    stats.appendChild(stat("בסך הכול", c.attended_total + " / " + total));
    stats.appendChild(stat("דיווחים השבוע", String(c.reported_week)));
    stats.appendChild(stat("דיווח אחרון", gapText(gap), gap !== null && gap >= 2));
    card.appendChild(stats);

    /* כניסה לאפליקציה בתור הלקוח, כדי לבדוק דברים באמת ולא לנחש.
       לקוח שכבר דיווח פעם אחת מקבל אישור לפני הפתיחה: דיווח שיישלח
       משם נרשם על שמו, וזה כבר קרה כאן פעם אחת בטעות. ללקוח בדיקה,
       שאין לו דיווחים, אין מה להזהיר ואין על מה ללחוץ פעמיים. */
    var asClient = document.createElement("a");
    asClient.className = "toggle";
    asClient.href = "index.html?c=" + encodeURIComponent(c.code || "");
    asClient.target = "_blank";
    asClient.rel = "noopener";
    asClient.textContent = "לראות את האפליקציה כמו " + c.first_name + " ↗";
    asClient.addEventListener("click", function (e) {
      if (!c.last_day) return;
      var ok = window.confirm(
        "זאת האפליקציה של " + c.first_name + " עצמו.\n" +
        "כל דיווח שתשלח משם יירשם על שמו.\n\n" +
        "לבדיקות עדיף להיכנס כמו לקוח הבדיקה. להמשיך בכל זאת?"
      );
      if (!ok) e.preventDefault();
    });
    card.appendChild(asClient);

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
      // רשימת ההקלטות בלבד, בלי האודיו. אם הטבלה עוד לא קיימת אצל
      // מלווה מסוים, היומן נטען בכל זאת — רק בלי כפתורי ההשמעה.
      Promise.all([
        sb.from("checkins")
          .select("day,attended,blockers,decided,created_at")
          .eq("client_id", c.id)
          .order("day", { ascending: false })
          .limit(21),
        sb.from("checkin_voice")
          .select("day,slot,secs")
          .eq("client_id", c.id)
      ]).then(function (res) {
        if (res[0].error) { log.innerHTML = '<p class="empty">לא הצלחתי לטעון.</p>'; return; }
        var v = (res[1] && !res[1].error && res[1].data) || [];
        renderLog(log, res[0].data || [], v, c.id);
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

    // לולאת ההרגל — משימת שבוע 1
    var lbox = document.createElement("div");
    lbox.className = "log";
    lbox.hidden = true;

    var lbtn = document.createElement("button");
    lbtn.className = "toggle";
    lbtn.type = "button";
    lbtn.textContent = "לולאת ההרגל ↓";
    var lloaded = false;
    lbtn.addEventListener("click", function () {
      if (!lbox.hidden) { lbox.hidden = true; lbtn.textContent = "לולאת ההרגל ↓"; return; }
      lbox.hidden = false;
      lbtn.textContent = "סגור ↑";
      if (lloaded) return;
      lloaded = true;
      lbox.innerHTML = '<p class="empty">טוען…</p>';
      sb.from("answers")
        .select("data,done,updated_at")
        .eq("client_id", c.id)
        .eq("task_key", "loop")
        .maybeSingle()
        .then(function (res) {
          if (res.error) { lbox.innerHTML = '<p class="empty">לא הצלחתי לטעון.</p>'; return; }
          renderLoopLog(lbox, res.data);
        });
    });

    card.appendChild(lbtn);
    card.appendChild(lbox);

    // מתג פתיחה — הלקוח רואה את המשימה רק אחרי שלוחצים כאן
    // המין הדקדוקי נשמר לכל משימה — "לוח" זכר, "לולאה" נקבה
    [["loop", "לולאת ההרגל", "פתוחה", "נעולה"],
     ["board", "לוח ההרגלים", "פתוח", "נעול"],
     ["stack", "צימוד הרגלים", "פתוח", "נעול"],
     ["env", "עיצוב הסביבה", "פתוח", "נעול"]].forEach(function (pair) {
      var key = pair[0], title = pair[1], openWord = pair[2], shutWord = pair[3];

      var lock = document.createElement("button");
      lock.className = "toggle lock";
      lock.type = "button";

      var isOpen = (c.open_tasks || []).indexOf(key) !== -1;

      function paintLock() {
        lock.textContent = isOpen
          ? title + " " + openWord + " ללקוח · ללחוץ כדי לנעול"
          : title + " " + shutWord + " · ללחוץ כדי לפתוח";
        if (isOpen) lock.classList.add("on");
        else lock.classList.remove("on");
      }
      paintLock();

      lock.addEventListener("click", function () {
        var current = c.open_tasks || [];
        var next = isOpen
          ? current.filter(function (k) { return k !== key; })
          : current.concat([key]);
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
    });

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
