/* בונים התמדה — הקלטה בצ'ק-אין
   שתי שאלות הצ'ק-אין שנכתבות בהן מילים מקבלות כפתור הקלטה. הכתיבה
   נשארת בדיוק כמו שהיא; ההקלטה היא דרך שנייה לענות על אותה שאלה.
   app.js לא יודע איך זה עובד — החוצה נחשפות שתי פונקציות בלבד:
   voiceSync(day) ו-voiceStop().

   ארבע מלכודות שהקובץ בנוי סביבן:
   1. המיקרופון נשאר דלוק אם לא עוצרים את ה-tracks בעצמנו. באייפון זה
      נקודה כתומה שלא נכבית. release() נקראת בכל יציאה, גם בשגיאה.
   2. כל דפדפן מקליט בפורמט אחר. ספארי נותן audio/mp4, כרום audio/webm.
      mp4 ראשון בתור בכוונה: הוא מתנגן גם בכרום וגם בספארי, ולכן הקלטה
      של הלקוח תמיד תתנגן אצל המלווה.
   3. play() אחרי המתנה לרשת נחסם באייפון. לכן אין כאן נגן משלנו: כשיש
      הקלטה מוצג audio controls של הדפדפן, והלחיצה על play היא על
      האלמנט עצמו.
   4. הקלטה שלא נשמרה היא הקלטה שאבדה. אם השמירה נפלה, נאמר בדיוק את
      זה במקום להציג הקלטה שקיימת רק במכשיר. */

(function () {
  "use strict";

  var MAX_SECS  = 60;         // נעצר לבד. דיווח יומי הוא משפט, לא הרצאה
  var LIMIT_B64 = 2000000;    // אותו חסם שנמצא גם בצד השרת
  var SLOTS     = ["hard", "decided"];

  var el = function (id) { return document.getElementById(id); };

  /* ---------- הקוד של הלקוח, אותו סדר עדיפות כמו ב-app.js ---------- */

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function clientCode() {
    var u = "", c = "";
    try { u = new URLSearchParams(location.search).get("c") || ""; } catch (e) {}
    try {
      var m = document.cookie.match(/(?:^|;\s*)bhc=([^;]+)/);
      c = m ? decodeURIComponent(m[1]) : "";
    } catch (e) {}
    return (u || lsGet("bh.code") || c || "").trim().toLowerCase();
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

  function today() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function fmt(s) {
    s = Math.max(0, Math.round(s));
    var r = s % 60;
    return Math.floor(s / 60) + ":" + (r < 10 ? "0" : "") + r;
  }

  /* ---------- מצב ---------- */

  // לכל שאלה view אחד: idle · asking · rec · busy · has
  var st  = { hard: { view: "idle" }, decided: { view: "idle" } };
  var day = null;    // היום שמדווחים עליו. app.js קובע אותו
  var rec = null;    // ההקלטה שרצה כרגע, אם רצה

  function dayKey() { return day || today(); }

  function supported() {
    try {
      return !!(window.isSecureContext &&
                navigator.mediaDevices &&
                navigator.mediaDevices.getUserMedia &&
                window.MediaRecorder);
    } catch (e) { return false; }
  }

  function pickMime() {
    var want = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    for (var i = 0; i < want.length; i++) {
      try {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported &&
            MediaRecorder.isTypeSupported(want[i])) return want[i];
      } catch (e) {}
    }
    return "";   // אין העדפה — המקליט יבחר לבד
  }

  function release(stream) {
    try {
      stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
    } catch (e) {}
  }

  /* ---------- ציור ---------- */

  function chip(text, cls, onClick, labelId) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "voice-chip " + cls;
    var s = document.createElement("span");
    if (labelId) s.id = labelId;
    s.textContent = text;
    b.appendChild(s);
    b.addEventListener("click", onClick);
    return b;
  }

  function small(text, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "voice-small";
    b.textContent = text;
    b.addEventListener("click", onClick);
    return b;
  }

  function note(text, cls) {
    var p = document.createElement("p");
    p.className = cls || "voice-note";
    p.textContent = text;
    return p;
  }

  function render(slot) {
    var host = el("voice-" + slot);
    if (!host) return;
    host.innerHTML = "";

    if (!supported()) { host.hidden = true; return; }
    host.hidden = false;

    var s = st[slot];

    if (s.view === "asking") { host.appendChild(note("מבקש רשות למיקרופון…")); return; }
    if (s.view === "busy")   { host.appendChild(note(s.busy || "רגע…")); return; }

    if (s.view === "rec") {
      host.appendChild(chip("לעצור · " + fmt(0), "rec", stop, "voice-lab-" + slot));
      host.appendChild(note("נעצר לבד אחרי דקה."));
      return;
    }

    if (s.view === "has") {
      if (s.url) {
        var a = document.createElement("audio");
        a.className = "voice-audio";
        a.controls = true;
        a.preload = "metadata";
        a.src = s.url;
        host.appendChild(a);
      } else {
        host.appendChild(chip("לשמוע את ההקלטה · " + fmt(s.secs || 0), "play",
                              function () { load(slot); }));
      }
      var row = document.createElement("div");
      row.className = "voice-row";
      row.appendChild(small("להקליט מחדש", function () { start(slot); }));
      row.appendChild(small("למחוק", function () { del(slot); }));
      host.appendChild(row);
      if (s.msg) host.appendChild(note(s.msg, "voice-warn"));
      return;
    }

    host.appendChild(chip("להקליט במקום לכתוב", "start", function () { start(slot); }));
    if (s.msg) host.appendChild(note(s.msg, "voice-warn"));
  }

  function renderAll() { SLOTS.forEach(render); }

  function fail(slot, msg) {
    st[slot] = { view: "idle", msg: msg };
    render(slot);
  }

  /* ---------- הקלטה ---------- */

  function start(slot) {
    if (rec) stop();

    if (!clientCode())  { fail(slot, "צריך להיכנס עם הקוד לפני שמקליטים."); return; }
    if (!supported())   { fail(slot, "המכשיר הזה לא מאפשר הקלטה. אפשר לכתוב."); return; }

    st[slot] = { view: "asking" };
    render(slot);

    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      var mime = pickMime();
      var opts = { audioBitsPerSecond: 32000 };
      if (mime) opts.mimeType = mime;

      var mr;
      try { mr = new MediaRecorder(stream, opts); }
      catch (e) {
        try { mr = new MediaRecorder(stream); }
        catch (e2) { release(stream); fail(slot, "המכשיר הזה לא מאפשר הקלטה. אפשר לכתוב."); return; }
      }

      var chunks = [], t0 = Date.now(), timer = null;

      mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };

      mr.onerror = function () {
        if (timer) clearInterval(timer);
        release(stream);
        rec = null;
        fail(slot, "ההקלטה נקטעה. תנסה שוב.");
      };

      mr.onstop = function () {
        if (timer) clearInterval(timer);
        release(stream);
        rec = null;
        if (!chunks.length) { fail(slot, "לא נקלט כלום. תנסה שוב."); return; }
        var secs = Math.max(1, Math.min(MAX_SECS, Math.round((Date.now() - t0) / 1000)));
        var type = (chunks[0] && chunks[0].type) || mr.mimeType || mime || "audio/mp4";
        save(slot, new Blob(chunks, { type: type }), secs);
      };

      // רק התווית מתעדכנת, לא כל הקופסה: ציור מחדש כל חצי שנייה היה
      // מחליף את כפתור העצירה בדיוק מתחת לאצבע.
      timer = setInterval(function () {
        var s = Math.round((Date.now() - t0) / 1000);
        var lab = el("voice-lab-" + slot);
        if (lab) lab.textContent = "לעצור · " + fmt(s);
        if (s >= MAX_SECS) stop();
      }, 500);

      try { mr.start(); }
      catch (e) {
        clearInterval(timer);
        release(stream);
        fail(slot, "ההקלטה לא התחילה. תנסה שוב.");
        return;
      }

      rec = { mr: mr, slot: slot, stream: stream };
      st[slot] = { view: "rec" };
      render(slot);
    }).catch(function () {
      fail(slot, "אין רשות למיקרופון. אפשר לאשר בהגדרות, או פשוט לכתוב.");
    });
  }

  function stop() {
    if (!rec) return;
    var mr = rec.mr, slot = rec.slot, stream = rec.stream;
    st[slot] = { view: "busy", busy: "שומר את ההקלטה…" };
    render(slot);
    try { mr.stop(); }
    catch (e) { release(stream); rec = null; fail(slot, "ההקלטה נקטעה. תנסה שוב."); }
  }

  /* ---------- שרת ---------- */

  function toB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () {
        var s = String(r.result || "");
        var i = s.indexOf(",");
        res(i < 0 ? "" : s.slice(i + 1));
      };
      r.onerror = function () { rej(new Error("read")); };
      r.readAsDataURL(blob);
    });
  }

  function toBlob(b64, mime) {
    var bin = atob(b64);
    var n = bin.length, a = new Uint8Array(n);
    for (var i = 0; i < n; i++) a[i] = bin.charCodeAt(i);
    return new Blob([a], { type: (mime || "audio/mp4") });
  }

  function save(slot, blob, secs) {
    st[slot] = { view: "busy", busy: "שומר את ההקלטה…" };
    render(slot);

    toB64(blob).then(function (b64) {
      if (!b64) throw new Error("empty");
      if (b64.length > LIMIT_B64) throw new Error("big");
      return rpc("app_save_voice", {
        p_code: clientCode(),
        p_day:  dayKey(),
        p_slot: slot,
        p_mime: blob.type || "audio/mp4",
        p_secs: secs,
        p_b64:  b64
      }).then(function () {
        st[slot] = { view: "has", secs: secs, url: URL.createObjectURL(blob) };
        render(slot);
      });
    }).catch(function (e) {
      var big = e && e.message === "big";
      // ההקלטה קיימת במכשיר אבל לא אצלי. אומרים את זה, ולא מראים "נשמר".
      st[slot] = {
        view: "has",
        secs: secs,
        url: URL.createObjectURL(blob),
        msg: big ? "ההקלטה גדולה מדי. תנסה קצרה יותר."
                 : "ההקלטה עוד לא הגיעה אליי. כשתהיה רשת — להקליט מחדש."
      };
      render(slot);
    });
  }

  function load(slot) {
    var secs = st[slot].secs || 0;
    st[slot] = { view: "busy", busy: "טוען את ההקלטה…" };
    render(slot);

    rpc("app_get_voice", { p_code: clientCode(), p_day: dayKey(), p_slot: slot })
      .then(function (rows) {
        var r = rows && rows[0];
        if (!r || !r.b64) { st[slot] = { view: "idle" }; render(slot); return; }
        st[slot] = {
          view: "has",
          secs: r.secs || secs,
          url: URL.createObjectURL(toBlob(r.b64, r.mime))
        };
        render(slot);
      })
      .catch(function () {
        st[slot] = { view: "has", secs: secs, msg: "לא הצלחתי לטעון. יש רשת?" };
        render(slot);
      });
  }

  function del(slot) {
    st[slot] = { view: "busy", busy: "מוחק…" };
    render(slot);
    rpc("app_del_voice", { p_code: clientCode(), p_day: dayKey(), p_slot: slot })
      .then(function () { st[slot] = { view: "idle" }; render(slot); })
      .catch(function () { st[slot] = { view: "has", msg: "לא הצלחתי למחוק. תנסה שוב." }; render(slot); });
  }

  /* ---------- מה ש-app.js קורא לו ---------- */

  // נקראת כשנפתח דיווח, עם היום שמדווחים עליו. מראה מיד את כפתור
  // ההקלטה, ואם כבר יש הקלטה ליום הזה — מחליפה אותו בנגן.
  function sync(d) {
    if (rec) stop();
    day = d || null;

    SLOTS.forEach(function (s) { st[s] = { view: "idle" }; });
    renderAll();

    if (!supported()) return;
    var code = clientCode();
    if (!code) return;

    rpc("app_get_voice_list", { p_code: code })
      .then(function (rows) {
        var k = dayKey();
        (rows || []).forEach(function (r) {
          if (String(r.day) !== k) return;
          if (SLOTS.indexOf(r.slot) === -1) return;
          if (st[r.slot].view !== "idle") return;
          st[r.slot] = { view: "has", secs: r.secs || 0 };
          render(r.slot);
        });
      })
      .catch(function () {});
  }

  // המיקרופון לא נשאר דלוק כשהדף נסגר באמצע הקלטה.
  window.addEventListener("pagehide", function () {
    if (rec) {
      release(rec.stream);
      try { rec.mr.stop(); } catch (e) {}
      rec = null;
    }
  });

  window.voiceSync = sync;
  window.voiceStop = stop;
})();
