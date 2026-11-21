/* בונים התמדה — צ'ק-אין יומי
   דף אחד, חמישה מסכים, בלי התחברות. */

(function () {
  "use strict";

  var KEY_CODE    = "bh.code";
  var KEY_PENDING = "bh.pending";
  var KEY_WELCOME = "bh.welcome.done";
  var KEY_BOARD   = "bh.board";
  var KEY_ANSWERS = "bh.answers";

  var el = function (id) { return document.getElementById(id); };
  var screens = ["welcome", "gate", "home", "q1", "q2", "q3", "tasks", "board", "loop", "loading"];

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

  // משאלה 2 ו-3 החזרה היא צעד אחורה. משאלה 1 היא יציאה אל הקו.
  el("back").addEventListener("click", function () {
    if (!el("q3").hidden) show("q2");
    else if (!el("q2").hidden) show("q1");
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

  // מהקו אל השאלות
  el("report-btn").addEventListener("click", function () {
    state.answers = { attended: null, blockers: [], decided: "" };
    el("hard").value = "";
    el("decided").value = "";
    Array.prototype.slice.call(document.querySelectorAll("#q1 .choice")).forEach(function (o) {
      o.setAttribute("aria-pressed", "false");
    });
    el("again").hidden = !reportedToday();
    show("q1");
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
    var any = taskOpen("loop") || taskOpen("board");
    el("tasks-title").textContent = any ? "מה פתוח עכשיו" : "עוד לא נפתחה משימה";
    var list = el("task-list");
    list.innerHTML = "";
    // לפי סדר התוכנית: לולאת ההרגל היא שבוע 1, לוח ההרגלים שבוע 2
    list.appendChild(loopCard());
    list.appendChild(boardCard());
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
        var raw = lsGet(KEY_BOARD);
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
    lsSet(KEY_BOARD, JSON.stringify({ items: board.items, phase: board.phase }));
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
        var raw = lsGet(KEY_ANSWERS);
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

    lsSet(KEY_ANSWERS, JSON.stringify(answers));
    if (loopTimer) clearTimeout(loopTimer);
    loopTimer = setTimeout(function () {
      rpc("app_save_answer", {
        p_code: state.code, p_task: "loop", p_data: a.data, p_done: a.done
      })
        .then(function () { el("loop-offline").hidden = true; })
        .catch(function () { el("loop-offline").hidden = false; });
    }, 600);
  }

  function openLoop() {
    var a = loopData();
    var started = LOOP_FIELDS.some(function (k) { return String(a.data[k] || "").trim(); })
                  || !!a.data.broken;
    loopIntro = !started;
    show("loop");
    renderLoop();
  }

  function renderLoop() {
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
    renderHome(false, false);
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
