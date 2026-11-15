/* בונים התמדה — צ'ק-אין יומי
   דף אחד, חמישה מסכים, בלי התחברות. */

(function () {
  "use strict";

  var KEY_CODE    = "bh.code";
  var KEY_PENDING = "bh.pending";

  var BLOCKERS = [
    "פחדתי לחזור לפציעה",
    "חשבתי שלא אצליח להיות עד הסוף עם הקבוצה",
    "כאב לי",
    "הייתי עייף או שחוק",
    "בית ספר או לוח הזמנים",
    "סתם תירוץ קטן שאני לא יודע להסביר",
    "שום דבר, היה קל היום"
  ];

  var el = function (id) { return document.getElementById(id); };
  var screens = ["gate", "q1", "q2", "q3", "done", "loading"];

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
    el("gate").appendChild(el("install"));
    renderInstall();
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
        history.replaceState(null, "", location.pathname);
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

  function buildBlockers() {
    var box = el("blockers");
    box.innerHTML = "";
    BLOCKERS.forEach(function (text) {
      var b = document.createElement("button");
      b.className = "choice";
      b.type = "button";
      b.textContent = text;
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", function () {
        var on = b.getAttribute("aria-pressed") === "true";
        b.setAttribute("aria-pressed", on ? "false" : "true");
      });
      box.appendChild(b);
    });
  }

  function selectedBlockers() {
    return Array.prototype.slice
      .call(el("blockers").querySelectorAll('[aria-pressed="true"]'))
      .map(function (b) { return b.textContent; });
  }

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
    state.answers.blockers = selectedBlockers();
    show("q3");
  });

  el("q3-send").addEventListener("click", function () {
    state.answers.decided = el("decided").value.trim();
    send();
  });

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

    var track = el("track");
    track.innerHTML = "";
    track.style.gridTemplateColumns = "repeat(" + perWeek + ", 1fr)";
    track.style.maxWidth = (perWeek * 54) + "px";
    for (var i = 0; i < total; i++) {
      var cell = document.createElement("div");
      cell.className = "cell" + (i < filled ? " filled" : "");
      track.appendChild(cell);
    }

    el("count-filled").textContent = String(filled);
    el("count-total").textContent = String(total);
    el("identity").textContent = c.identity_sentence || "";
    el("pending").hidden = !pending;

    var reported = state.checkins.some(function (k) { return k.day === today(); });
    el("done-eyebrow").textContent = reported ? "דיווחת היום. הנה הדרך שלך." : "הדרך שלך";
    el("redo").hidden = !reported;

    // מי שעוד לא התקין רואה את ההסבר גם כאן, אחרי הדיווח
    el("done").appendChild(el("install"));
    renderInstall();

    show("done");
  }

  el("redo").addEventListener("click", function () {
    state.answers = { attended: null, blockers: [], decided: "" };
    buildBlockers();
    el("decided").value = "";
    Array.prototype.slice.call(document.querySelectorAll("#q1 .choice")).forEach(function (o) {
      o.setAttribute("aria-pressed", "false");
    });
    show("q1");
  });

  /* ================= הוספה למסך הבית ================= */

  var deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    renderInstall();
  });

  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    el("install").hidden = true;
  });

  function isStandalone() {
    try {
      return window.matchMedia("(display-mode: standalone)").matches ||
             window.navigator.standalone === true;
    } catch (e) { return false; }
  }

  function isIOS() {
    var ua = navigator.userAgent || "";
    return /iPad|iPhone|iPod/.test(ua) ||
           (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function steps(list) {
    var ol = el("install-steps");
    ol.innerHTML = "";
    list.forEach(function (html) {
      var li = document.createElement("li");
      li.innerHTML = html;
      ol.appendChild(li);
    });
  }

  function renderInstall() {
    var box = el("install");
    var btn = el("install-btn");
    var arrow = el("install-arrow");

    if (isStandalone()) { box.hidden = true; return; }

    if (deferredPrompt) {
      steps([]);
      btn.hidden = false;
      arrow.hidden = true;
    } else if (isIOS()) {
      steps([
        'לחץ על כפתור השיתוף <span class="glyph">&#x2191;</span> בתחתית המסך',
        'גלול ובחר <b>הוספה למסך הבית</b>',
        'לחץ <b>הוסף</b> — וזהו'
      ]);
      btn.hidden = true;
      arrow.hidden = false;
      arrow.textContent = "↓";
      arrow.classList.remove("up");
    } else {
      steps([
        'פתח את התפריט <span class="glyph">&#x22EE;</span> בפינה העליונה',
        'בחר <b>הוספה למסך הבית</b>',
        'אשר — וזהו'
      ]);
      btn.hidden = true;
      arrow.hidden = false;
      arrow.textContent = "↑";
      arrow.classList.add("up");
    }
    box.hidden = false;
  }

  el("install-btn").addEventListener("click", function () {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(function () {
      deferredPrompt = null;
      el("install").hidden = true;
    });
  });

  /* ================= הפעלה ================= */

  function start() {
    buildBlockers();
    var t = new Date();
    Array.prototype.slice.call(document.querySelectorAll(".today")).forEach(function (n) {
      n.textContent = t.toLocaleDateString("he-IL", { weekday: "long", day: "numeric", month: "long" });
    });

    var reported = state.checkins.some(function (k) { return k.day === today(); });
    if (reported) renderDone(!!lsGet(KEY_PENDING));
    else show("q1");
  }

  function boot() {
    var params = new URLSearchParams(location.search);
    var code = (params.get("c") || lsGet(KEY_CODE) || "").trim().toLowerCase();
    if (!code) { openGate(); return; }
    flushPending().then(function () { tryCode(code); });
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }

  boot();
})();
