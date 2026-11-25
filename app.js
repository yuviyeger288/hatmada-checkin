/* בונים התמדה — צ'ק-אין יומי
   דף אחד, חמישה מסכים, בלי התחברות. */

(function () {
  "use strict";

  var KEY_CODE    = "bh.code";
  var KEY_PENDING = "bh.pending";
  var KEY_WELCOME = "bh.welcome.done";
  var KEY_BOARD   = "bh.board";
  var KEY_ANSWERS = "bh.answers";

  /* האחסון המקומי נפרד לכל קוד לקוח. בלי זה מכשיר אחד שפתח שני קודים
     מערבב ביניהם — ומה שלקוח אחד כתב מופיע אצל אחר. */
  function mine(base) { return base + "." + (state.code || "-"); }

  var el = function (id) { return document.getElementById(id); };
  var screens = ["welcome", "gate", "login", "home", "days", "q1", "q2", "q3", "tasks",
                 "board", "loop", "stack", "env", "deck", "loading"];

  var STEP = { q1: 1, q2: 2, q3: 3 };
  var STEPS_TOTAL = 3;

  // מסך שהוא מקום מקבל סרגל טאבים. מסך שהוא שלב לא מקבל, כדי שלא
  // יהיה אפשר לברוח באמצע שאלה ולהשאיר דיווח חצי.
  var TABBED = { home: true, tasks: true };

  function show(id) {
    screens.forEach(function (s) {
      var n = el(s);
      if (n) n.hidden = (s !== id);
    });

    var step = STEP[id];
    var head = el("qhead");
    if (step) {
      el("step-text").textContent = "שאלה " + step + " מתוך " + STEPS_TOTAL;
      el("progress-fill").style.width = (step / STEPS_TOTAL * 100) + "%";
      el("back").hidden = false;
      head.hidden = false;
    } else {
      head.hidden = true;
    }

    var tabbed = TABBED[id] === true;
    el("tabs").hidden = !tabbed;
    document.body.classList.toggle("has-tabs", tabbed);
    if (tabbed) {
      Array.prototype.slice.call(document.querySelectorAll(".tab")).forEach(function (t) {
        t.setAttribute("aria-current", t.getAttribute("data-tab") === id ? "true" : "false");
      });
    }

    window.scrollTo(0, 0);
  }

  // משאלה 2 ו-3 החזרה היא צעד אחורה. משאלה 1 היא יציאה — אל רשימת
  // הימים אם הדיווח נפתח משם, ואחרת אל הקו.
  el("back").addEventListener("click", function () {
    if (window.voiceStop) window.voiceStop();
    if (!el("q3").hidden) show("q2");
    else if (!el("q2").hidden) show("q1");
    else if (state.from === "days") { renderDays(); show("days"); }
    else renderHome(false, false);
  });

  Array.prototype.slice.call(document.querySelectorAll(".tab")).forEach(function (t) {
    t.addEventListener("click", function () {
      var target = t.getAttribute("data-tab");
      if (target === "home") renderHome(false, false);
      else { renderTasks(); show(target); }
    });
  });

  /* ---------- אחסון מקומי, שלא יפיל את הדף ---------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  /* ---------- "היום" לפי שעון המכשיר, לא UTC ---------- */
  function today() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  /* ---------- קריאה ל-Supabase ---------- */
  function rpc(fn, args) {
    var cfg = window.CONFIG || {};
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      return Promise.reject(new Error("no-config"));
    }
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

  /* הכתובת נקראת פעם אחת בטעינה, לפני שהקוד מנקה אותה */
  var initialParams = (function () {
    try { return new URLSearchParams(location.search); }
    catch (e) { return { get: function () { return null; } }; }
  })();

  /* ---------- מצב ---------- */
  var state = {
    code: null,
    client: null,
    checkins: [],
    // היום שמדווחים עליו. בדרך כלל היום, אבל אפשר להשלים יום שפספסת.
    day: null,
    from: "home",
    answers: { attended: null, blockers: [], decided: "" }
  };

  /* ================= מסך הקוד ================= */

  function openGate(message) {
    var msg = el("gate-msg");
    if (message) { msg.textContent = message; msg.hidden = false; }
    else { msg.hidden = true; }
    show("gate");
    el("gate-code").focus();
  }

  /* ================= כניסה עם שם משתמש =================
     הכניסה לא מחליפה את הקוד — היא מסתיימת בו. מי שנכנס עם שם משתמש
     מקבל את הקוד שלו מהשרת, ומשם האפליקציה עובדת בדיוק כמו תמיד:
     אותן פונקציות, אותו אחסון, אותם נתונים. ולכן גם מי שכבר באמצע
     התוכנית ממשיך מאיפה שהוא, בלי שום העברה.

     שם משתמש ולא מייל: Supabase דורש כתובת, ולכן שם משתמש נשמר אצלו
     כ-<שם>@hatmada.local — דומיין שלא קיים. המייל האמיתי של הלקוח
     לא נכנס למערכת. */

  var USER_DOMAIN = "@hatmada.local";

  function loginMsg(text) {
    var m = el("login-msg");
    if (text) { m.textContent = text; m.hidden = false; }
    else { m.hidden = true; }
  }

  function openLogin(message) {
    loginMsg(message || null);
    show("login");
    el("login-user").focus();
  }

  function base() {
    return (window.CONFIG || {}).SUPABASE_URL.replace(/\/+$/, "");
  }

  function signIn(user, pass) {
    var cfg = window.CONFIG || {};
    return fetch(base() + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": cfg.SUPABASE_ANON_KEY },
      body: JSON.stringify({ email: user + USER_DOMAIN, password: pass })
    }).then(function (r) {
      return r.json().then(function (b) {
        if (!r.ok || !b.access_token) throw new Error("bad-login");
        return b.access_token;
      });
    });
  }

  // קריאה בשם המשתמש המחובר, ולא עם המפתח הציבורי
  function asUser(fn, token) {
    var cfg = window.CONFIG || {};
    return fetch(base() + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg.SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + token
      },
      body: "{}"
    }).then(function (r) {
      if (!r.ok) throw new Error("http-" + r.status);
      return r.json();
    });
  }

  el("gate-to-login").addEventListener("click", function () { openLogin(); });
  el("login-to-gate").addEventListener("click", function () { openGate(); });

  el("login-pass").addEventListener("keydown", function (e) {
    if (e.key === "Enter") el("login-go").click();
  });

  el("login-go").addEventListener("click", function () {
    var user = el("login-user").value.trim().toLowerCase();
    var pass = el("login-pass").value;
    if (!user || !pass) return;

    loginMsg(null);
    show("loading");

    signIn(user, pass)
      .then(function (token) {
        return asUser("app_my_code", token).then(function (code) {
          // מלווה או מנהל שמקליד כאן את הפרטים שלו אין לו מסלול,
          // ולכן אומרים לו לאן ללכת במקום "סיסמה שגויה".
          if (!code) return asUser("me_is_admin", token).then(function (adm) {
            throw new Error(adm ? "staff" : "no-client");
          });
          return String(code);
        });
      })
      .then(function (code) {
        el("login-pass").value = "";
        tryCode(code);
      })
      .catch(function (e) {
        el("login-pass").value = "";
        var why = e && e.message;
        openLogin(
          why === "staff"     ? "זאת כניסה של מלווה. הניהול נמצא בדף הצוות." :
          why === "no-client" ? "המשתמש הזה עוד לא מחובר למסלול. תשאל את יובל." :
                                "שם המשתמש או הסיסמה לא נכונים."
        );
      });
  });

  el("gate-go").addEventListener("click", function () {
    var v = el("gate-code").value.trim().toLowerCase();
    if (!v) return;
    tryCode(v);
  });

  el("gate-code").addEventListener("keydown", function (e) {
    if (e.key === "Enter") el("gate-go").click();
  });

  function tryCode(code) {
    show("loading");
    rpc("app_get_client", { p_code: code })
      .then(function (rows) {
        if (!rows || !rows.length) {
          openGate("הקוד הזה לא מוכר לי. תבדוק שוב, או תשאל את יובל.");
          return;
        }
        state.code = code;
        state.client = rows[0];
        lsSet(KEY_CODE, code);
        pinCodeToUrl(code);
        return loadCheckins().then(loadTasks).then(loadBoard).then(loadAnswers).then(start);
      })
      .catch(function (err) {
        if (err && err.message === "no-config") {
          openGate("האתר עוד לא חובר לנתונים.");
        } else {
          openGate("אין חיבור כרגע. תנסה שוב בעוד רגע.");
        }
      });
  }

  function loadCheckins() {
    return rpc("app_get_checkins", { p_code: state.code })
      .then(function (rows) { state.checkins = rows || []; })
      .catch(function () { state.checkins = []; });
  }

  /* ================= שלוש השאלות ================= */

  Array.prototype.slice.call(document.querySelectorAll("#q1 .choice")).forEach(function (b) {
    b.addEventListener("click", function () {
      Array.prototype.slice.call(document.querySelectorAll("#q1 .choice")).forEach(function (o) {
        o.setAttribute("aria-pressed", o === b ? "true" : "false");
      });
      state.answers.attended = b.getAttribute("data-v");
      if (state.answers.attended === "none") {
        state.answers.blockers = [];
        state.answers.decided = "";
        send();
      } else {
        show("q2");
      }
    });
  });

  // הקלטה שרצה נשמרת לפני המעבר, ולא נזרקת.
  el("q2-next").addEventListener("click", function () {
    if (window.voiceStop) window.voiceStop();
    state.answers.blockers = hardText();
    show("q3");
  });

  el("q3-send").addEventListener("click", function () {
    if (window.voiceStop) window.voiceStop();
    state.answers.decided = el("decided").value.trim();
    send();
  });

  // הטור במסד הוא מערך טקסט, אז משפט חופשי נשמר כאיבר יחיד
  function hardText() {
    var v = el("hard").value.trim();
    return v ? [v] : [];
  }

  /* ================= שליחה ================= */

  function payload() {
    return {
      p_code: state.code,
      p_day: state.day || today(),
      p_attended: state.answers.attended,
      p_blockers: state.answers.blockers,
      p_decided: state.answers.decided
    };
  }

  function applyLocally(p) {
    var found = false;
    state.checkins = state.checkins.map(function (c) {
      if (c.day === p.p_day) {
        found = true;
        return { day: p.p_day, attended: p.p_attended, blockers: p.p_blockers, decided: p.p_decided };
      }
      return c;
    });
    if (!found) {
      state.checkins.push({ day: p.p_day, attended: p.p_attended, blockers: p.p_blockers, decided: p.p_decided });
    }
  }

  function send() {
    var p = payload();
    show("loading");
    applyLocally(p);
    rpc("app_save_checkin", p)
      .then(function () {
        lsDel(KEY_PENDING);
        renderHome(false, true);
      })
      .catch(function () {
        lsSet(KEY_PENDING, JSON.stringify(p));
        renderHome(true, true);
      });
  }

  function flushPending() {
    var raw = lsGet(KEY_PENDING);
    if (!raw) return Promise.resolve();
    var p;
    try { p = JSON.parse(raw); } catch (e) { lsDel(KEY_PENDING); return Promise.resolve(); }
    return rpc("app_save_checkin", p)
      .then(function () { lsDel(KEY_PENDING); })
      .catch(function () {});
  }

  /* ================= המסלול ================= */

  function renderHome(pending, justSent) {
    var c = state.client;
    var weeks = c.program_weeks || 8;
    var perWeek = c.weekly_target || 5;
    var total = weeks * perWeek;

    var filled = state.checkins.filter(function (k) { return k.attended === "yes"; }).length;
    if (filled > total) filled = total;

    // הקו מטפס מהפינה הימנית־תחתונה אל היעד שבשמאל־עליון
    var X0 = 298, Y0 = 174, X1 = 42, Y1 = 30;
    var t = total ? (filled / total) : 0;

    var fill = el("climb-fill");
    fill.setAttribute("x2", String(X0 + (X1 - X0) * t));
    fill.setAttribute("y2", String(Y0 + (Y1 - Y0) * t));

    // קווי שבוע חוצים את המסילה, כמו הסימונים בקו הישר
    var dx = X1 - X0, dy = Y1 - Y0;
    var len = Math.sqrt(dx * dx + dy * dy);
    var nx = (-dy / len) * 9, ny = (dx / len) * 9;
    var marks = el("climb-weeks");
    marks.innerHTML = "";
    for (var w = 1; w < weeks; w++) {
      var tw = w / weeks;
      var cx = X0 + dx * tw, cy = Y0 + dy * tw;
      var seg = document.createElementNS("http://www.w3.org/2000/svg", "line");
      seg.setAttribute("x1", String(cx - nx)); seg.setAttribute("y1", String(cy - ny));
      seg.setAttribute("x2", String(cx + nx)); seg.setAttribute("y2", String(cy + ny));
      seg.setAttribute("class", "climb-week");
      marks.appendChild(seg);
    }

    el("climb-goal").classList.toggle("reached", total > 0 && filled >= total);

    el("count-filled").textContent = String(filled);
    el("count-total").textContent = String(total);
    el("destination").textContent = c.destination || c.identity_sentence || "";
    el("pending").hidden = !pending;

    var reported = reportedToday();

    el("home-eyebrow").textContent = justSent ? "נרשם. הנה הדרך שלך." : "הדרך שלך";
    el("home-note").textContent = reported
      ? "דיווחת היום. אפשר לשנות את מה שכתבת."
      : "עוד לא דיווחת היום.";

    var btn = el("report-btn");
    btn.textContent = reported ? "לשנות את מה שדיווחתי" : "לדווח על היום";
    btn.className = reported ? "btn ghost" : "btn";

    show("home");
  }

  function reportedToday() {
    return state.checkins.some(function (k) { return k.day === today(); });
  }

  /* ================= לאיזה יום הדיווח שייך =================
     עד כאן הדיווח היה תמיד על היום. מי שפספס ערב אחד לא יכול היה
     להשלים אותו, והמשבצת נשארה ריקה בלי קשר למה שבאמת קרה. */

  var ATT = { yes: "הגעת", no: "לא הגעת", none: "לא היה אימון" };
  var DAYS_BACK = 14;

  function dayKeyOf(d) {
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function shiftDay(n) {
    var d = new Date();
    d.setDate(d.getDate() + n);
    return dayKeyOf(d);
  }

  function dayLabel(key) {
    var p = String(key).split("-");
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return d.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
  }

  function checkinOf(key) {
    for (var i = 0; i < state.checkins.length; i++) {
      if (state.checkins[i].day === key) return state.checkins[i];
    }
    return null;
  }

  // אחורה עד שבועיים, ולא לפני תחילת הליווי — אין על מה לדווח שם.
  function renderDays() {
    var list = el("day-list");
    list.innerHTML = "";
    var startDate = (state.client && state.client.start_date) || "";

    for (var i = 0; i < DAYS_BACK; i++) {
      var key = shiftDay(-i);
      if (startDate && key < startDate) break;

      var rep = checkinOf(key);
      var b = document.createElement("button");
      b.type = "button";
      b.className = "choice day";

      var name = document.createElement("span");
      name.className = "day-name";
      name.textContent = (i === 0 ? "היום · " : i === 1 ? "אתמול · " : "") + dayLabel(key);

      var tag = document.createElement("span");
      tag.className = "day-tag" + (rep ? " on" : "");
      tag.textContent = rep ? (ATT[rep.attended] || "דיווחת") : "לא דיווחת";

      b.appendChild(name);
      b.appendChild(tag);
      b.addEventListener("click", (function (k) {
        return function () { openQuestions(k, "days"); };
      })(key));

      list.appendChild(b);
    }
  }

  /* פותח את שלוש השאלות ליום מסוים. מה שכבר נרשם לאותו יום נטען
     לשדות — "לשנות את מה שדיווחתי" צריך להראות מה נרשם, ולא דף ריק. */
  function openQuestions(day, from) {
    state.day  = day;
    state.from = from || "home";

    var rep = checkinOf(day);

    state.answers = {
      attended: rep ? rep.attended : null,
      blockers: rep ? (rep.blockers || []) : [],
      decided:  rep ? (rep.decided || "") : ""
    };

    el("hard").value    = (state.answers.blockers || []).join(", ");
    el("decided").value = state.answers.decided || "";

    Array.prototype.slice.call(document.querySelectorAll("#q1 .choice")).forEach(function (o) {
      o.setAttribute("aria-pressed",
        rep && o.getAttribute("data-v") === rep.attended ? "true" : "false");
    });

    // השורה מתחת לשאלה הראשונה אומרת על איזה יום מדובר. ביום שעבר
    // זה ההבדל בין דיווח נכון לדיווח שנרשם על התאריך הלא נכון.
    var isToday = day === today();
    Array.prototype.slice.call(document.querySelectorAll(".today")).forEach(function (n) {
      n.textContent = (isToday ? "" : "דיווח על ") + dayLabel(day);
    });

    el("again").textContent = isToday
      ? "כבר דיווחת היום. מה שתענה עכשיו יחליף את מה שרשמת."
      : "כבר דיווחת על היום הזה. מה שתענה עכשיו יחליף את מה שרשמת.";
    el("again").hidden = !rep;

    if (window.voiceSync) window.voiceSync(day);
    show("q1");
  }

  // מהקו אל השאלות
  el("report-btn").addEventListener("click", function () {
    openQuestions(today(), "home");
  });

  el("days-btn").addEventListener("click", function () {
    renderDays();
    show("days");
  });

  el("days-back").addEventListener("click", function () {
    renderHome(false, false);
  });

  /* ================= משימות ================= */

  // המשימות שהמלווה פתח ללקוח. ריק = הכול נעול.
  var openTasks = [];

  function loadTasks() {
    return rpc("app_get_tasks", { p_code: state.code })
      .then(function (rows) { openTasks = Array.isArray(rows) ? rows : []; })
      .catch(function () {
        // אם אי אפשר לברר — נעול. ברירת המחדל הבטוחה היא סגור,
        // כדי ששגיאת רשת לא תפתח משימה לפני הזמן.
        openTasks = [];
      });
  }

  function taskOpen(key) { return openTasks.indexOf(key) !== -1; }

  function renderTasks() {
    var any = ["loop", "board", "stack", "env"].some(taskOpen);
    el("tasks-title").textContent = any ? "מה פתוח עכשיו" : "עוד לא נפתחה משימה";
    var list = el("task-list");
    list.innerHTML = "";
    // לפי סדר התוכנית, וכל אחת נושאת את המקור שלה
    list.appendChild(withFrom(loopCard(), "משימה 1 · סרטון 1"));
    list.appendChild(withFrom(boardCard(), "משימה 2 · שיחה 2"));
    list.appendChild(withFrom(stackCard(), "משימה 3 · סרטון 2"));
    list.appendChild(withFrom(envCard(), "משימה 4 · סרטון 2"));
  }

  function stackCard() {
    var open = taskOpen("stack");
    if (!open) {
      return taskCard({ open: false, title: "צימוד הרגלים", tag: "נעול",
                        note: "תיפתח בהמשך." });
    }
    var a = answers.stack || { data: {}, done: false };
    var n = (a.data.rows || []).filter(function (r) {
      return String(r.after || "").trim() && String(r.then || "").trim();
    }).length;
    if (a.done) {
      return taskCard({ open: true, title: "צימוד הרגלים", tag: "הושלם", tagClass: "ok",
                        note: n + " משפטים של ״אחרי ש..., אני...״", onOpen: openStack });
    }
    if (n) {
      return taskCard({ open: true, title: "צימוד הרגלים", tag: "באמצע", tagClass: "mid",
                        note: n + " מוכנים.", onOpen: openStack });
    }
    return taskCard({ open: true, title: "צימוד הרגלים", tag: "לא התחיל",
                      note: "משפט ״אחרי ש..., אני...״ לכל אימון השבוע.",
                      onOpen: openStack });
  }

  function envCard() {
    var open = taskOpen("env");
    if (!open) {
      return taskCard({ open: false, title: "עיצוב הסביבה", tag: "נעול",
                        note: "תיפתח בהמשך." });
    }
    var a = answers.env || { data: {}, done: false };
    var n = (a.data.adds || []).filter(function (r) {
      return String(r.what || "").trim();
    }).length;
    if (a.done) {
      return taskCard({ open: true, title: "עיצוב הסביבה", tag: "הושלם", tagClass: "ok",
                        note: n + " גירויים נבנו" +
                              (String(a.data.rm || "").trim() ? ", ואחד ירד" : ""),
                        onOpen: openEnv });
    }
    if (n || String(a.data.rm || "").trim()) {
      return taskCard({ open: true, title: "עיצוב הסביבה", tag: "באמצע", tagClass: "mid",
                        note: n ? n + " גירויים עד כה." : "התחלת למלא.",
                        onOpen: openEnv });
    }
    return taskCard({ open: true, title: "עיצוב הסביבה", tag: "לא התחיל",
                      note: "לבנות גירויים שמושכים להרגל, ולהוריד אחד שמושך ממנו.",
                      onOpen: openEnv });
  }

  // מאיזה שלב בתוכנית המשימה הגיעה. יושב מעל השם בכרטיס.
  function withFrom(card, from) {
    var s = document.createElement("span");
    s.className = "task-from";
    s.textContent = from;
    card.insertBefore(s, card.firstChild);
    return card;
  }

  /* כרטיס משימה — אותו מבנה לכל המשימות. מחזיר כפתור מושבת כשהיא נעולה. */
  function taskCard(opts) {
    var card = document.createElement("button");
    card.type = "button";
    card.className = opts.open ? "task" : "task locked";

    var top = document.createElement("div");
    top.className = "task-top";

    var name = document.createElement("span");
    name.className = "task-name";
    name.textContent = opts.title;

    var tag = document.createElement("span");
    tag.className = "task-tag" + (opts.tagClass ? " " + opts.tagClass : "");
    tag.textContent = opts.tag;

    var note = document.createElement("p");
    note.className = "task-note";
    note.textContent = opts.note;

    top.appendChild(name);
    top.appendChild(tag);
    card.appendChild(top);
    card.appendChild(note);

    if (opts.open && opts.onOpen) card.addEventListener("click", opts.onOpen);
    else card.disabled = true;

    return card;
  }

  function loopCard() {
    var open = taskOpen("loop");
    var a = answers.loop || { data: {}, done: false };
    var filled = LOOP_FIELDS.filter(function (k) {
      return String(a.data[k] || "").trim();
    }).length;

    if (!open) {
      return taskCard({ open: false, title: "לולאת ההרגל", tag: "נעול",
                        note: "תיפתח בהמשך." });
    }
    if (a.done) {
      return taskCard({ open: true, title: "לולאת ההרגל", tag: "הושלם", tagClass: "ok",
                        note: "השלב השבור: " + (a.data.broken || "—"), onOpen: openLoop });
    }
    if (filled || a.data.broken) {
      return taskCard({ open: true, title: "לולאת ההרגל", tag: "באמצע", tagClass: "mid",
                        note: "ענית על " + filled + " מתוך 4.", onOpen: openLoop });
    }
    return taskCard({ open: true, title: "לולאת ההרגל", tag: "לא התחיל",
                      note: "ארבע שאלות על ההרגל שלך, ומשפט אחד על מה שבור.",
                      onOpen: openLoop });
  }

  function boardCard() {
    var open = taskOpen("board");
    var n = board.items.length;
    var marked = board.items.filter(function (i) { return !!i.m; }).length;

    var card = document.createElement("button");
    card.type = "button";
    card.className = open ? "task" : "task locked";

    var top = document.createElement("div");
    top.className = "task-top";

    var name = document.createElement("span");
    name.className = "task-name";
    name.textContent = "לוח ההרגלים";

    var tag = document.createElement("span");
    tag.className = "task-tag";

    var note = document.createElement("p");
    note.className = "task-note";

    if (!open) {
      card.disabled = true;
      tag.textContent = "נעול";
      note.textContent = "תיפתח אחרי השיחה הקרובה.";
    } else if (board.phase === "done") {
      tag.className += " ok";
      tag.textContent = "הושלם";
      note.textContent = n + " שורות, כולן מסומנות.";
    } else if (board.phase === "mark") {
      tag.className += " mid";
      tag.textContent = "באמצע";
      note.textContent = "סימנת " + marked + " מתוך " + n + ".";
    } else if (n > 0) {
      tag.className += " mid";
      tag.textContent = "באמצע";
      note.textContent = n + " שורות עד עכשיו. אפשר להמשיך מתי שתרצה.";
    } else {
      tag.textContent = "לא התחיל";
      note.textContent = "יום אחד, שורה לכל פעולה, ואז סימן אחד לכל שורה.";
    }

    top.appendChild(name);
    top.appendChild(tag);
    card.appendChild(top);
    card.appendChild(note);
    if (open) card.addEventListener("click", openBoard);
    return card;
  }

  /* ================= לוח ההרגלים =================
     שני שלבים בכוונה. בשלב הכתיבה אין סימן אחד על המסך, כי מי שמסמן
     תוך כדי כתיבה מתחיל לכתוב את מה שנשמע טוב במקום את מה שקרה. */

  var board = { items: [], phase: "write", loaded: false };
  var boardTimer = null;

  function loadBoard() {
    return rpc("app_get_board", { p_code: state.code })
      .then(function (rows) {
        var r = rows && rows[0];
        if (r) {
          board.items = Array.isArray(r.items) ? r.items : [];
          board.phase = r.phase || "write";
        }
        board.loaded = true;
        el("board-offline").hidden = true;
      })
      .catch(function () {
        // אין רשת, או שהטבלה עוד לא הורצה: ממשיכים ממה ששמור במכשיר
        var raw = lsGet(mine(KEY_BOARD));
        if (raw) {
          try {
            var o = JSON.parse(raw);
            board.items = o.items || [];
            board.phase = o.phase || "write";
          } catch (e) {}
        }
        board.loaded = true;
      });
  }

  // נשמר במכשיר מיד, ועולה לשרת רגע אחרי — שהקלדה לא תייצר בקשה לכל תו
  function saveBoard() {
    lsSet(mine(KEY_BOARD), JSON.stringify({ items: board.items, phase: board.phase }));
    if (boardTimer) clearTimeout(boardTimer);
    boardTimer = setTimeout(function () {
      rpc("app_save_board", { p_code: state.code, p_items: board.items, p_phase: board.phase })
        .then(function () { el("board-offline").hidden = true; })
        .catch(function () { el("board-offline").hidden = false; });
    }, 500);
  }

  // ההסבר מופיע רק למי שעוד לא התחיל. מי שחוזר לאמצע ממשיך מאיפה שהפסיק.
  var boardIntro = false;

  function openBoard() {
    boardIntro = (board.items.length === 0 && board.phase === "write");
    show("board");
    renderBoard();
  }

  function renderBoard() {
    var writing = board.phase === "write";
    el("board-intro").hidden = !boardIntro;
    el("board-write").hidden = boardIntro || !writing;
    el("board-mark").hidden  = boardIntro || writing;
    if (boardIntro) return;
    if (writing) renderWrite(); else renderMark();
  }

  el("board-start").addEventListener("click", function () {
    boardIntro = false;
    renderBoard();
    el("board-input").focus();
  });

  function renderWrite() {
    var n = board.items.length;

    var ol = el("board-written");
    ol.innerHTML = "";
    board.items.forEach(function (it, i) {
      var li = document.createElement("li");

      var span = document.createElement("span");
      span.textContent = it.t;

      var del = document.createElement("button");
      del.type = "button";
      del.className = "row-del";
      del.setAttribute("aria-label", "מחיקת השורה");
      del.textContent = "×";
      del.addEventListener("click", function () {
        board.items.splice(i, 1);
        saveBoard();
        renderWrite();
      });

      li.appendChild(span);
      li.appendChild(del);
      ol.appendChild(li);
    });

    el("board-prompt").textContent = n === 0
      ? "מהרגע שקמת — מה הדבר הראשון שעשית?"
      : "ואז?";

    el("board-count").textContent = n === 0
      ? ""
      : n + " שורות. ברוב הימים יוצאות 25 ומעלה — הדברים הקטנים הם העיקר כאן.";

    el("board-to-mark").hidden = n < 3;
  }

  function renderMark() {
    var n = board.items.length;
    var marked = board.items.filter(function (i) { return !!i.m; }).length;
    var done = board.phase === "done";

    el("mark-title").textContent = done ? "הלוח שלך" : "עכשיו תסמן";
    el("mark-sub").innerHTML = done
      ? "אפשר לשנות מתי שתרצה."
      : "<b>+</b> מקדם אותך למי שאתה רוצה להיות · <b>−</b> מרחיק · <b>=</b> לא משנה";

    var box = el("board-rows");
    box.innerHTML = "";
    board.items.forEach(function (it) {
      var row = document.createElement("div");
      row.className = "board-row";

      var txt = document.createElement("span");
      txt.className = "board-text";
      txt.textContent = it.t;
      row.appendChild(txt);

      var marks = document.createElement("div");
      marks.className = "marks";
      // הסימן לבדו על הכפתור. מה שכל סימן אומר מוסבר במסך הפתיחה.
      // המילה נשארת כ-aria-label בלבד, בשביל מי שמשתמש בקורא מסך.
      [["+", "מקדמת"], ["=", "לא משנה"], ["−", "מרחיקה"]].forEach(function (pair) {
        var sym = pair[0];
        var b = document.createElement("button");
        b.type = "button";
        b.className = "mark " + (sym === "+" ? "plus" : sym === "=" ? "eq" : "minus");
        b.textContent = sym;
        b.setAttribute("aria-label", pair[1]);
        b.setAttribute("aria-pressed", it.m === sym ? "true" : "false");
        b.addEventListener("click", function () {
          it.m = (it.m === sym) ? null : sym;
          saveBoard();
          renderMark();
        });
        marks.appendChild(b);
      });
      row.appendChild(marks);
      box.appendChild(row);
    });

    el("mark-count").textContent = marked >= n
      ? "כל השורות מסומנות."
      : "נשארו " + (n - marked) + " שורות בלי סימן.";

    var btn = el("board-done");
    btn.textContent = done ? "לסגור" : "סיימתי";
    btn.className = done ? "btn ghost" : "btn";
    btn.disabled = !done && marked < n;
  }

  el("board-add").addEventListener("click", addBoardRow);

  el("board-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); addBoardRow(); }
  });

  function addBoardRow() {
    var v = el("board-input").value.trim();
    if (!v) return;
    board.items.push({ t: v, m: null });
    el("board-input").value = "";
    saveBoard();
    renderWrite();
    el("board-input").focus();
  }

  el("board-to-mark").addEventListener("click", function () {
    board.phase = "mark";
    saveBoard();
    renderBoard();
  });

  el("board-more").addEventListener("click", function () {
    board.phase = "write";
    saveBoard();
    renderBoard();
    el("board-input").focus();
  });

  el("board-done").addEventListener("click", function () {
    if (board.phase === "done") { renderTasks(); show("tasks"); return; }
    board.phase = "done";
    saveBoard();
    renderBoard();
  });

  el("board-back").addEventListener("click", function () {
    renderTasks();
    show("tasks");
  });

  /* ================= לולאת ההרגל =================
     ארבע שאלות על ההרגל שהוא בונה, ואז שלב אחד שבור ולמה. המשפט על
     השלב השבור הוא התוצר של המשימה — בלעדיו "סיימתי" לא נפתח. */

  var answers = {};
  var LOOP_FIELDS = ["cue", "crave", "response", "reward"];
  var loopIntro = false;
  var loopTimer = null;

  function loadAnswers() {
    return rpc("app_get_answers", { p_code: state.code })
      .then(function (rows) {
        answers = {};
        (rows || []).forEach(function (r) {
          answers[r.task_key] = { data: r.data || {}, done: !!r.done };
        });
      })
      .catch(function () {
        var raw = lsGet(mine(KEY_ANSWERS));
        if (raw) { try { answers = JSON.parse(raw) || {}; } catch (e) { answers = {}; } }
      });
  }

  function loopData() {
    if (!answers.loop) answers.loop = { data: {}, done: false };
    if (!answers.loop.data) answers.loop.data = {};
    return answers.loop;
  }

  function saveLoop(done) {
    var a = loopData();
    a.data = {
      cue:      el("loop-cue").value.trim(),
      crave:    el("loop-crave").value.trim(),
      response: el("loop-response").value.trim(),
      reward:   el("loop-reward").value.trim(),
      broken:   a.data.broken || "",
      why:      el("loop-why").value.trim()
    };
    if (typeof done === "boolean") a.done = done;

    lsSet(mine(KEY_ANSWERS), JSON.stringify(answers));
    if (loopTimer) clearTimeout(loopTimer);
    loopTimer = setTimeout(function () {
      rpc("app_save_answer", {
        p_code: state.code, p_task: "loop", p_data: a.data, p_done: a.done
      })
        .then(function () { el("loop-offline").hidden = true; })
        .catch(function () { el("loop-offline").hidden = false; });
    }, 600);
  }

  /* ---------- מסך המצגת ---------- */

  // המצגת נקראת בתוך האפליקציה, כטקסט. היא לא PDF ולא מסגרת: שקף
  // 1920×1080 יוצא בטלפון קטן מכדי לקרוא, ואייפון לא מצייר PDF בתוך הדף
  // בכלל — ולכן הגרסה הקודמת מסרה אותו לצופה של המכשיר, והלקוח יצא
  // מהאפליקציה בלי דרך חזרה. זה היה הבאג.
  var deckCache = {};
  var deckReturn = "loop";
  var deckCount = 0;
  var deckIdx = 0;

  /* שקף אחד לכל מסך, ולא גלילה אחת ארוכה (יובל, 24-11). כל השקפים
     נבנים פעם אחת ורק אחד גלוי — חמישה־עשר כרטיסים הם כלום לדפדפן,
     ומעבר בין שקפים לא נוגע ברשת ולא בונה כלום מחדש. */
  function renderDeck(doc) {
    var body = el("deck-body");
    body.innerHTML = "";
    var slides = doc.slides || [];
    deckCount = slides.length;

    slides.forEach(function (s, i) {
      var card = document.createElement("article");
      card.className = "deck-slide";
      card.hidden = i !== 0;

      if (s.eyebrow) {
        var e = document.createElement("p");
        e.className = "eyebrow";
        e.textContent = s.eyebrow;
        card.appendChild(e);
      }

      var h = document.createElement("h2");
      h.textContent = s.title || "";
      card.appendChild(h);

      (s.body || []).forEach(function (b) {
        var p = document.createElement("p");
        p.className = b.k || "note";
        p.textContent = b.t;
        card.appendChild(p);
      });

      body.appendChild(card);
    });

    var many = deckCount > 1;
    el("deck-nav").hidden   = !many;
    el("deck-track").hidden = !many;
    showSlide(0);
  }

  function showSlide(i) {
    if (!deckCount) return;
    if (i < 0) i = 0;
    if (i > deckCount - 1) i = deckCount - 1;
    deckIdx = i;

    var cards = el("deck-body").children;
    for (var k = 0; k < cards.length; k++) cards[k].hidden = (k !== i);

    // "3 / 15" מתהפך בשורה בעברית ונקרא "15 / 3". המילים מפרידות
    // בין המספרים ופותרות את זה, וזה גם הניסוח שכבר יש בשאלות.
    el("deck-pos").textContent = "שקף " + (i + 1) + " מתוך " + deckCount;
    el("deck-fill").style.width = ((i + 1) / deckCount * 100) + "%";
    el("deck-prev").disabled = (i === 0);
    el("deck-next").disabled = (i === deckCount - 1);
    window.scrollTo(0, 0);
  }

  el("deck-prev").addEventListener("click", function () { showSlide(deckIdx - 1); });
  el("deck-next").addEventListener("click", function () { showSlide(deckIdx + 1); });

  /* החלקה. בעברית השקף הבא נמצא משמאל — כמו דף בספר עברי שמושכים
     ימינה כדי להתקדם — ולכן תנועה ימינה היא "הבא".
     גלילה אנכית בשקף ארוך לא נחשבת החלקה, ולכן נדרשת תנועה אופקית
     גדולה יותר מהאנכית. */
  (function () {
    var x0 = 0, y0 = 0, live = false;
    var body = el("deck-body");

    body.addEventListener("touchstart", function (e) {
      if (!e.touches || e.touches.length !== 1) { live = false; return; }
      live = true;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
    }, { passive: true });

    body.addEventListener("touchend", function (e) {
      if (!live) return;
      live = false;
      var t = e.changedTouches && e.changedTouches[0];
      if (!t) return;
      var dx = t.clientX - x0, dy = t.clientY - y0;
      if (Math.abs(dx) < 45) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.5) return;
      showSlide(deckIdx + (dx > 0 ? 1 : -1));
    }, { passive: true });
  })();

  // מקלדת, למי שפותח את המצגת במחשב
  document.addEventListener("keydown", function (e) {
    if (el("deck").hidden) return;
    if (e.key === "ArrowLeft") showSlide(deckIdx + 1);
    else if (e.key === "ArrowRight") showSlide(deckIdx - 1);
  });

  function openDeck(url, name, back) {
    if (!url) return;
    deckReturn = back || "loop";
    el("deck-name").textContent = name || "";
    el("deck-error").hidden = true;
    el("deck-body").innerHTML = "";
    el("deck-pos").textContent = "";
    el("deck-nav").hidden = true;
    el("deck-track").hidden = true;
    deckCount = 0;
    deckIdx = 0;
    show("deck");
    window.scrollTo(0, 0);

    if (deckCache[url]) { renderDeck(deckCache[url]); return; }
    fetch(url, { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (doc) { deckCache[url] = doc; renderDeck(doc); })
      .catch(function () { el("deck-error").hidden = false; });
  }

  el("deck-back").addEventListener("click", function () {
    if (deckReturn === "stack") { show("stack"); renderStack(); return; }
    if (deckReturn === "env") { show("env"); renderEnv(); return; }
    show("loop");
    renderLoop();
  });

  function openLoop() {
    var a = loopData();
    var started = LOOP_FIELDS.some(function (k) { return String(a.data[k] || "").trim(); })
                  || !!a.data.broken;
    loopIntro = !started;
    show("loop");
    renderLoop();
  }

  // הקישורים של המשימה מגיעים מ-config.js. ריק = לא מוצג בכלל,
  // כדי שלא יהיה כפתור שמוביל לשום מקום.
  function setLoopLinks() {
    var L = (window.CONFIG && window.CONFIG.LINKS) || {};
    [["lnk-video", L.video1, true], ["lnk-deck", L.deck1, false]].forEach(function (pair) {
      Array.prototype.slice.call(document.querySelectorAll("." + pair[0])).forEach(function (a) {
        if (pair[1]) { a.href = pair[1]; a.hidden = false; }
        else { a.removeAttribute("href"); a.hidden = true; }
        // לשונית נפרדת רק לכתובת חיצונית. דף שלנו נפתח במקום, אחרת
        // אין היסטוריה ואין דרך לחזור מהאפליקציה שבמסך הבית.
        // הסרטון הוא אתר חיצוני ונפתח בחלון משלו. המצגת שלנו, והיא
        // נפתחת כמסך בתוך האפליקציה — בלי ניווט ובלי מלכודת.
        if (pair[2]) a.setAttribute("target", "_blank");
        else a.onclick = function () {
          openDeck(pair[1], "משימה 1 · לולאת ההרגל", "loop");
        };
      });
    });
  }

  function renderLoop() {
    setLoopLinks();
    el("loop-intro").hidden = !loopIntro;
    el("loop-form").hidden = loopIntro;
    if (loopIntro) return;

    var a = loopData();
    el("loop-cue").value      = a.data.cue || "";
    el("loop-crave").value    = a.data.crave || "";
    el("loop-response").value = a.data.response || "";
    el("loop-reward").value   = a.data.reward || "";
    el("loop-why").value      = a.data.why || "";

    Array.prototype.slice.call(document.querySelectorAll("#loop-broken .choice")).forEach(function (b) {
      b.setAttribute("aria-pressed", b.getAttribute("data-v") === a.data.broken ? "true" : "false");
    });

    refreshLoopDone();
  }

  // נקראת בכל הקלדה. לא נוגעת בערכי השדות, כדי שהסמן לא יקפוץ.
  function refreshLoopDone() {
    var a = loopData();
    var ready = !!a.data.broken && !!String(a.data.why || "").trim();
    el("loop-note").textContent = a.done
      ? "נשלח אליי. אפשר לשנות מתי שתרצה."
      : (ready ? "" : "כדי לסיים צריך לבחור שלב אחד ולכתוב למה דווקא הוא.");
    var btn = el("loop-done");
    btn.textContent = a.done ? "לסגור" : "סיימתי";
    btn.className = a.done ? "btn ghost" : "btn";
    btn.disabled = !a.done && !ready;
  }

  ["loop-cue", "loop-crave", "loop-response", "loop-reward", "loop-why"].forEach(function (id) {
    el(id).addEventListener("input", function () { saveLoop(); refreshLoopDone(); });
  });

  Array.prototype.slice.call(document.querySelectorAll("#loop-broken .choice")).forEach(function (b) {
    b.addEventListener("click", function () {
      var a = loopData();
      var v = b.getAttribute("data-v");
      a.data.broken = (a.data.broken === v) ? "" : v;
      Array.prototype.slice.call(document.querySelectorAll("#loop-broken .choice")).forEach(function (o) {
        o.setAttribute("aria-pressed", o.getAttribute("data-v") === a.data.broken ? "true" : "false");
      });
      saveLoop();
      refreshLoopDone();
    });
  });

  el("loop-start").addEventListener("click", function () {
    loopIntro = false;
    renderLoop();
    el("loop-cue").focus();
  });

  el("loop-done").addEventListener("click", function () {
    var a = loopData();
    if (a.done) { renderTasks(); show("tasks"); return; }
    saveLoop(true);
    renderLoop();
  });

  el("loop-back").addEventListener("click", function () {
    renderTasks();
    show("tasks");
  });

  /* ================= משימה 3 · צימוד הרגלים =================
     שורה לכל פעם שההרגל אמור לקרות השבוע: "אחרי ש..." ו"אני...".
     שורה נחשבת רק כששני הצדדים מלאים — עוגן בלי הרגל, או הרגל בלי
     עוגן, זה בדיוק מה שהסרטון בא למנוע. */

  var stackIntro = false;
  var stackTimer = null;

  function stackData() {
    if (!answers.stack) answers.stack = { data: {}, done: false };
    if (!answers.stack.data) answers.stack.data = {};
    var d = answers.stack.data;
    if (!Array.isArray(d.rows) || !d.rows.length) {
      d.rows = [{ after: "", then: "" }, { after: "", then: "" }, { after: "", then: "" }];
    }
    return answers.stack;
  }

  function stackFull(d) {
    return (d.rows || []).filter(function (r) {
      return String(r.after || "").trim() && String(r.then || "").trim();
    }).length;
  }

  function saveStack(done) {
    var a = stackData();
    a.data.rows = readStackRows();
    if (typeof done === "boolean") a.done = done;
    lsSet(mine(KEY_ANSWERS), JSON.stringify(answers));
    if (stackTimer) clearTimeout(stackTimer);
    stackTimer = setTimeout(function () {
      rpc("app_save_answer", {
        p_code: state.code, p_task: "stack", p_data: a.data, p_done: a.done
      })
        .then(function () { el("stack-offline").hidden = true; })
        .catch(function () { el("stack-offline").hidden = false; });
    }, 600);
  }

  function readStackRows() {
    return Array.prototype.slice
      .call(document.querySelectorAll("#stack-rows .stack-row"))
      .map(function (row) {
        return {
          after: row.querySelector(".s-after").value.trim(),
          then: row.querySelector(".s-then").value.trim()
        };
      });
  }

  function stackRow(r, i) {
    var wrap = document.createElement("div");
    wrap.className = "q stack-row";

    var head = document.createElement("p");
    head.className = "q-head";
    head.innerHTML = "<b>אימון " + (i + 1) + "</b>";
    wrap.appendChild(head);

    [["s-after", "אחרי ש...", "פעולה שאני עושה ממילא, ברגע מדויק"],
     ["s-then", "אני...", "ההרגל עצמו"]].forEach(function (f) {
      var lab = document.createElement("p");
      lab.className = "q-head";
      lab.textContent = f[1];
      var ta = document.createElement("textarea");
      ta.className = "field area " + f[0];
      ta.rows = 2;
      ta.placeholder = f[2];
      ta.value = (f[0] === "s-after" ? r.after : r.then) || "";
      ta.addEventListener("input", function () { saveStack(); renderStackNote(); });
      wrap.appendChild(lab);
      wrap.appendChild(ta);
    });
    return wrap;
  }

  function renderStackNote() {
    var a = stackData();
    var n = stackFull({ rows: readStackRows() });
    el("stack-note").textContent = a.done
      ? "נשלח למלווה."
      : (n ? n + " אימונים מוכנים." : "משפט אחד לפחות, ואפשר לסיים.");
    var btn = el("stack-done");
    btn.textContent = a.done ? "חזרה למשימות" : "סיימתי";
    btn.disabled = !a.done && !n;
  }

  function renderStack() {
    setDeck2Links();
    el("stack-intro").hidden = !stackIntro;
    el("stack-form").hidden = stackIntro;
    if (stackIntro) return;
    var a = stackData();
    var host = el("stack-rows");
    host.innerHTML = "";
    a.data.rows.forEach(function (r, i) { host.appendChild(stackRow(r, i)); });
    renderStackNote();
  }

  function openStack() {
    var a = stackData();
    stackIntro = !stackFull(a.data);
    show("stack");
    renderStack();
  }

  el("stack-start").addEventListener("click", function () {
    stackIntro = false;
    renderStack();
    var first = document.querySelector("#stack-rows .s-after");
    if (first) first.focus();
  });

  el("stack-add").addEventListener("click", function () {
    var a = stackData();
    a.data.rows = readStackRows();
    a.data.rows.push({ after: "", then: "" });
    renderStack();
  });

  el("stack-done").addEventListener("click", function () {
    var a = stackData();
    if (a.done) { renderTasks(); show("tasks"); return; }
    saveStack(true);
    renderStack();
  });

  el("stack-back").addEventListener("click", function () {
    renderTasks();
    show("tasks");
  });

  /* ================= משימה 4 · עיצוב הסביבה =================
     שני שדות עיקריים ולא רשימה: הסרטון מבקש גירוי אחד להוסיף ואחד
     להוריד. השדה השלישי, על מקום שמשמש לשני דברים, הוא רשות. */

  var envIntro = false;
  var envTimer = null;

  function envData() {
    if (!answers.env) answers.env = { data: {}, done: false };
    if (!answers.env.data) answers.env.data = {};
    var d = answers.env.data;
    if (!Array.isArray(d.adds) || !d.adds.length) {
      d.adds = [{ what: "", where: "" }, { what: "", where: "" },
                { what: "", where: "" }];
    }
    return answers.env;
  }

  function envAddCount(d) {
    return (d.adds || []).filter(function (r) {
      return String(r.what || "").trim();
    }).length;
  }

  function envStarted(d) {
    return !!(envAddCount(d) || String(d.rm || "").trim() ||
              String(d.place || "").trim());
  }

  // הרשימה היא העיקר כאן, ולכן גירוי אחד שנבנה מספיק כדי לסיים:
  // הסרטון מבקש כמה שיותר, לא מספר קבוע.
  function envReady(d) {
    return envAddCount(d) > 0;
  }

  function readEnvRows() {
    return Array.prototype.slice
      .call(document.querySelectorAll("#env-rows .env-row"))
      .map(function (row) {
        return {
          what: row.querySelector(".e-what").value.trim(),
          where: row.querySelector(".e-where").value.trim()
        };
      });
  }

  function saveEnv(done) {
    var a = envData();
    a.data = {
      adds:     readEnvRows(),
      rm:       el("env-rm").value.trim(),
      rmWhere:  el("env-rm-where").value.trim(),
      place:    el("env-place").value.trim(),
      purpose:  el("env-purpose").value.trim()
    };
    if (typeof done === "boolean") a.done = done;
    lsSet(mine(KEY_ANSWERS), JSON.stringify(answers));
    if (envTimer) clearTimeout(envTimer);
    envTimer = setTimeout(function () {
      rpc("app_save_answer", {
        p_code: state.code, p_task: "env", p_data: a.data, p_done: a.done
      })
        .then(function () { el("env-offline").hidden = true; })
        .catch(function () { el("env-offline").hidden = false; });
    }, 600);
  }

  function envRow(r, i) {
    var wrap = document.createElement("div");
    wrap.className = "q env-row";
    [["e-what", "גירוי " + (i + 1), "הציוד, התיק, הבגדים, הנעליים, פתק"],
     ["e-where", "איפה בדיוק", "המקום שבו אני בטוח שאראה אותו"]].forEach(function (f) {
      var lab = document.createElement("p");
      lab.className = "q-head";
      lab.textContent = f[1];
      var ta = document.createElement("textarea");
      ta.className = "field area " + f[0];
      ta.rows = 2;
      ta.placeholder = f[2];
      ta.value = (f[0] === "e-what" ? r.what : r.where) || "";
      ta.addEventListener("input", function () { saveEnv(); renderEnvNote(); });
      wrap.appendChild(lab);
      wrap.appendChild(ta);
    });
    return wrap;
  }

  function renderEnvNote() {
    var a = envData();
    var n = envAddCount({ adds: readEnvRows() });
    el("env-note").textContent = a.done
      ? "נשלח למלווה."
      : (n ? n + " גירויים שבנית. כמה שיותר." : "גירוי אחד לפחות, ואפשר לסיים.");
    var btn = el("env-done");
    btn.textContent = a.done ? "חזרה למשימות" : "סיימתי";
    btn.disabled = !a.done && !n;
  }

  function renderEnv() {
    setDeck2Links();
    el("env-intro").hidden = !envIntro;
    el("env-form").hidden = envIntro;
    if (envIntro) return;
    var a = envData();
    var host = el("env-rows");
    host.innerHTML = "";
    a.data.adds.forEach(function (r, i) { host.appendChild(envRow(r, i)); });
    el("env-rm").value = a.data.rm || "";
    el("env-rm-where").value = a.data.rmWhere || "";
    el("env-place").value = a.data.place || "";
    el("env-purpose").value = a.data.purpose || "";
    renderEnvNote();
  }

  ["env-rm", "env-rm-where", "env-place", "env-purpose"].forEach(function (id) {
    el(id).addEventListener("input", function () { saveEnv(); renderEnvNote(); });
  });

  el("env-add-row").addEventListener("click", function () {
    var a = envData();
    a.data.adds = readEnvRows();
    a.data.adds.push({ what: "", where: "" });
    renderEnv();
  });

  function openEnv() {
    var a = envData();
    envIntro = !envStarted(a.data);
    show("env");
    renderEnv();
  }

  el("env-start").addEventListener("click", function () {
    envIntro = false;
    renderEnv();
    var first = document.querySelector("#env-rows .e-what");
    if (first) first.focus();
  });

  el("env-done").addEventListener("click", function () {
    var a = envData();
    if (a.done) { renderTasks(); show("tasks"); return; }
    saveEnv(true);
    renderEnv();
  });

  el("env-back").addEventListener("click", function () {
    renderTasks();
    show("tasks");
  });

  /* הקישורים של שבוע 2 — אותו כלל כמו בשבוע 1: ריק = לא מוצג כלל,
     כדי שלא יהיה כפתור שמוביל לשום מקום. הסרטון הוא אתר חיצוני
     ונפתח בלשונית; המצגת היא שלנו ונפתחת כמסך בתוך האפליקציה. */
  function setDeck2Links() {
    var L = (window.CONFIG && window.CONFIG.LINKS) || {};
    var here = el("stack").hidden ? "env" : "stack";
    [["lnk-video2", L.video2, true], ["lnk-deck2", L.deck2, false]].forEach(function (pair) {
      Array.prototype.slice.call(document.querySelectorAll("." + pair[0])).forEach(function (a) {
        if (pair[1]) { a.href = pair[1]; a.hidden = false; }
        else { a.removeAttribute("href"); a.hidden = true; }
        if (pair[2]) a.setAttribute("target", "_blank");
        else a.onclick = function () {
          openDeck(pair[1], "שבוע 2 · שיהיה ברור", here);
        };
      });
    });
  }

  /* ================= הקוד שורד את ההתקנה ================= */

  /* האייפון שומר את הכתובת שבמסך ברגע ההוספה, ואנדרואיד שומר את
     start_url שבמניפסט. שניהם חייבים לשאת את הקוד, אחרת האפליקציה
     במסך הבית נפתחת בלי לדעת מי זה — ובאייפון האחסון שלה נפרד מספארי. */

  function pinCodeToUrl(code) {
    try {
      history.replaceState(null, "", location.pathname + "?c=" + encodeURIComponent(code));
    } catch (e) {}
    try {
      // גיבוי לאנדרואיד: עוגייה נשמרת גם כשהאפליקציה נפתחת מהאייקון
      document.cookie = "bhc=" + encodeURIComponent(code) + ";path=/;max-age=31536000;samesite=lax";
    } catch (e) {}
  }

  function codeFromCookie() {
    try {
      var m = document.cookie.match(/(?:^|;\s*)bhc=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : "";
    } catch (e) { return ""; }
  }

  /* ================= הוספה למסך הבית ================= */

  var deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    renderInstall();
  });

  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    if (!el("welcome").hidden) leaveWelcome();
  });

  function isStandalone() {
    try {
      return window.matchMedia("(display-mode: standalone)").matches ||
             window.navigator.standalone === true;
    } catch (e) { return false; }
  }

  // ההסבר מוצג לשתי המערכות תמיד, כדי שזיהוי שגוי לא יבלבל אף אחד.
  // כפתור ההתקנה מופיע רק כשהדפדפן עצמו מציע אותו.
  function renderInstall() {
    el("install-btn").hidden = !deferredPrompt;
  }

  // מסך ההתקנה מופיע בכל פתיחה כל עוד האתר לא רץ מהאייקון.
  // ברגע שהוא מותקן — הוא לא יופיע שוב לעולם.
  function needsWelcome() {
    return !isStandalone();
  }

  function leaveWelcome() {
    goHome();
  }

  el("welcome-next").addEventListener("click", leaveWelcome);

  el("install-btn").addEventListener("click", function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () {
      deferredPrompt = null;
      leaveWelcome();
    });
  });

  /* ================= הפעלה ================= */

  function start() {
    var t = new Date();
    Array.prototype.slice.call(document.querySelectorAll(".today")).forEach(function (n) {
      n.textContent = t.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
    });

    if (needsWelcome()) {
      renderInstall();
      show("welcome");
      return;
    }
    goHome();
  }

  // "היום" הוא מסך הנחיתה: קודם ההתקנה, ואז הקו — והשאלות נפתחות ממנו.
  function goHome() {
    var back = null;
    try {
      back = sessionStorage.getItem("bh.resume");
      sessionStorage.removeItem("bh.resume");
    } catch (e) {}

    if (back === "loop" && taskOpen("loop")) { renderTasks(); openLoop(); return; }
    renderHome(false, false);
  }

  function boot() {
    lsDel(KEY_BOARD); lsDel(KEY_ANSWERS);   // שאריות מלפני ההפרדה לפי קוד

    var code = (initialParams.get("c") || lsGet(KEY_CODE) || codeFromCookie() || "").trim().toLowerCase();
    if (!code) { openGate(); return; }
    flushPending().then(function () { tryCode(code); });
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      // updateViaCache:"none" — שגם קובץ ה-sw עצמו לא יישלף מהמטמון של הדפדפן
      // updateViaCache:"none" — שגם קובץ ה-sw עצמו לא יישלף מהמטמון של הדפדפן.
      // אין כאן רענון אוטומטי בכוונה: כל בקשה כבר עוקפת את המטמון,
      // ורענון שמופעל מאירוע השתלטות יוצר לולאה.
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" })
        .then(function (reg) { reg.update(); })
        .catch(function () {});
    });
  }

  boot();
})();
