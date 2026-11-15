/* בונים התמדה — צ'ק-אין יומי
   דף אחד, חמישה מסכים, בלי התחברות. */

(function () {
  "use strict";

  var KEY_CODE    = "bh.code";
  var KEY_PENDING = "bh.pending";
  var KEY_WELCOME = "bh.welcome.done";

  var el = function (id) { return document.getElementById(id); };
  var screens = ["welcome", "gate", "q1", "q2", "q3", "done", "loading"];

  var STEP = { q1: 1, q2: 2, q3: 3 };
  var STEPS_TOTAL = 3;

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
      el("back").hidden = (step === 1);
      head.hidden = false;
    } else {
      head.hidden = true;
    }

    window.scrollTo(0, 0);
  }

  el("back").addEventListener("click", function () {
    if (!el("q3").hidden) show("q2");
    else if (!el("q2").hidden) show("q1");
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
        return loadCheckins().then(start);
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

  el("q2-next").addEventListener("click", function () {
    state.answers.blockers = hardText();
    show("q3");
  });

  el("q3-send").addEventListener("click", function () {
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
      p_day: today(),
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
        renderDone(false);
      })
      .catch(function () {
        lsSet(KEY_PENDING, JSON.stringify(p));
        renderDone(true);
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

  function renderDone(pending) {
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

    el("climb-goal").classList.toggle("reached", total > 0 && filled >= total);

    el("count-filled").textContent = String(filled);
    el("count-total").textContent = String(total);
    el("destination").textContent = c.destination || c.identity_sentence || "";
    el("pending").hidden = !pending;

    el("done-eyebrow").textContent = "נרשם. הנה הדרך שלך.";

    show("done");
  }

  // חזרה לשאלות ממסך הקו
  el("again-btn").addEventListener("click", function () {
    state.answers = { attended: null, blockers: [], decided: "" };
    el("hard").value = "";
    el("decided").value = "";
    Array.prototype.slice.call(document.querySelectorAll("#q1 .choice")).forEach(function (o) {
      o.setAttribute("aria-pressed", "false");
    });
    el("again").hidden = false;
    show("q1");
  });

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
    goToCheckin();
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
    goToCheckin();
  }

  // הקו הוא תמיד התחנה האחרונה: קודם ההתקנה, אחר כך השאלות, ורק אז הוא.
  function goToCheckin() {
    var reported = state.checkins.some(function (k) { return k.day === today(); });
    el("again").hidden = !reported;
    show("q1");
  }

  function boot() {
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
