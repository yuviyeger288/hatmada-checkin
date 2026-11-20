/* בונים התמדה — תזכורת יומית ב-push
   כל מה שקשור לתזכורת יושב כאן. app.js לא יודע על הקובץ הזה, וב-index.html
   יש תג script אחד וכפתור אחד. החוצה נחשפת פונקציה אחת: askForPush().

   שלוש מלכודות שהקובץ הזה בנוי סביבן:
   1. באייפון התזכורת עובדת רק מהאפליקציה שבמסך הבית, ורק מ-iOS 16.4 ומעלה.
      בספארי רגיל אין בכלל PushManager, ולכן אי אפשר "לנסות ולראות".
   2. בקשת הרשות חייבת לצאת מתוך לחיצה של המשתמש. לכן requestPermission
      נקראת ראשונה בתוך המטפל בלחיצה, לפני כל await אחר.
   3. סירוב אחד הוא סופי — מהאתר אי אפשר לבקש שוב. לכן ההסבר מה הכפתור
      עושה כתוב בדף ונקרא לפני הלחיצה, ולא אחריה. */

(function () {
  "use strict";

  var KEY_CODE = "bh.code";

  var el = function (id) { return document.getElementById(id); };

  /* ---------- הקוד של הלקוח, באותו סדר עדיפות כמו ב-app.js ---------- */

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function codeFromUrl() {
    try { return new URLSearchParams(location.search).get("c") || ""; }
    catch (e) { return ""; }
  }

  function codeFromCookie() {
    try {
      var m = document.cookie.match(/(?:^|;\s*)bhc=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : "";
    } catch (e) { return ""; }
  }

  function clientCode() {
    return (codeFromUrl() || lsGet(KEY_CODE) || codeFromCookie() || "").trim().toLowerCase();
  }

  /* ---------- קריאה ל-Supabase, אותה קריאה כמו ב-app.js ---------- */

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

  /* ---------- המרות base64url, בלי תלות בשום ספרייה ---------- */

  function b64ToBytes(base64) {
    var s = String(base64 || "").replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var raw = atob(s);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function bytesToB64url(buf) {
    var b = new Uint8Array(buf), s = "";
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  /* מנוי שנרשם מחזיר את שני המפתחות. toJSON נותן אותם מוכנים ב-base64url,
     ו-getKey הוא הגיבוי למי שאין לו toJSON. */
  function subKeys(sub) {
    var out = { p256dh: "", auth: "" };
    try {
      var j = sub.toJSON ? sub.toJSON() : null;
      if (j && j.keys) { out.p256dh = j.keys.p256dh || ""; out.auth = j.keys.auth || ""; }
    } catch (e) {}
    if (!out.p256dh || !out.auth) {
      try {
        if (sub.getKey) {
          var p = sub.getKey("p256dh"), a = sub.getKey("auth");
          if (p) out.p256dh = bytesToB64url(p);
          if (a) out.auth = bytesToB64url(a);
        }
      } catch (e) {}
    }
    return out;
  }

  /* ---------- מה חוסם, אם משהו חוסם ---------- */

  function isStandalone() {
    try {
      return window.matchMedia("(display-mode: standalone)").matches ||
             window.navigator.standalone === true;
    } catch (e) { return false; }
  }

  // אייפון ואייפד. iPadOS 13 ומעלה מציג את עצמו כמק עם מסך מגע,
  // ולכן גם המקרה הזה נספר. הזיהוי משמש רק לבחירת נוסח ההודעה.
  function looksApple() {
    try {
      var ua = navigator.userAgent || "";
      if (/iPad|iPhone|iPod/.test(ua)) return true;
      return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
    } catch (e) { return false; }
  }

  function blocker() {
    if (!window.isSecureContext) return "insecure";
    if (!("serviceWorker" in navigator)) return "unsupported";
    if (!("Notification" in window)) return "unsupported";
    if (!("PushManager" in window)) {
      // באייפון זה בדיוק מה שקורה בספארי רגיל, ובגרסאות לפני 16.4
      return looksApple() && !isStandalone() ? "ios-home-screen" : "unsupported";
    }
    if (Notification.permission === "denied") return "denied";
    return null;
  }

  var SAYS = {
    insecure:         "התזכורת עובדת רק בחיבור מאובטח.",
    unsupported:      "הדפדפן הזה לא יודע לקבל תזכורות. באייפון צריך iOS 16.4 ומעלה, ולפתוח את האפליקציה מהמסך הבית. באנדרואיד — כרום מעודכן.",
    "ios-home-screen":"באייפון התזכורת עובדת רק מהאפליקציה שבמסך הבית. תוסיף אותה למסך הבית, תפתח אותה משם, ותלחץ כאן שוב.",
    denied:           "ההתראות חסומות למכשיר הזה, ומהאתר אי אפשר לבקש שוב. אפשר להחזיר אותן בהגדרות המכשיר, בהרשאות של האפליקציה הזאת.",
    dismissed:        "לא אישרת, ולכן אין תזכורת. אפשר ללחוץ שוב.",
    nokey:            "התזכורות עוד לא חוברו באתר.",
    nocode:           "צריך להיכנס עם הקוד לפני שמפעילים תזכורת.",
    failed:           "ההרשאה אושרה, אבל השמירה לא עברה. תנסה שוב בעוד רגע.",
    on:               "התזכורת פועלת. כל ערב תגיע תזכורת — רק אם עוד לא דיווחת על היום."
  };

  function say(key) {
    var box = el("push-msg");
    if (!box) return;
    box.textContent = SAYS[key] || "";
    box.hidden = !box.textContent;
  }

  function showButton(on) {
    var b = el("push-btn");
    if (b) b.hidden = !on;
    var why = el("push-why");
    if (why) why.hidden = !on;
  }

  function busy(on) {
    var b = el("push-btn");
    if (!b) return;
    b.disabled = on;
    b.textContent = on ? "רגע…" : "להפעיל תזכורת יומית";
  }

  /* ---------- הרשמה ---------- */

  function vapidKey() {
    var k = (window.CONFIG && window.CONFIG.VAPID_PUBLIC_KEY) || "";
    return String(k).trim();
  }

  // navigator.serviceWorker.ready ממתין לנצח אם הרישום נכשל, ולכן יש גבול
  function readySW() {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (!done) { done = true; reject(new Error("sw-timeout")); }
      }, 10000);
      navigator.serviceWorker.ready.then(function (reg) {
        if (done) return;
        done = true; clearTimeout(timer); resolve(reg);
      }, function (err) {
        if (done) return;
        done = true; clearTimeout(timer); reject(err);
      });
    });
  }

  function subscribe(reg) {
    return reg.pushManager.getSubscription().then(function (existing) {
      if (existing) return existing;
      return reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64ToBytes(vapidKey())
      });
    });
  }

  function save(sub, code) {
    var k = subKeys(sub);
    if (!sub.endpoint || !k.p256dh || !k.auth) return Promise.reject(new Error("no-keys"));
    return rpc("app_save_push", {
      p_code: code,
      p_endpoint: sub.endpoint,
      p_p256dh: k.p256dh,
      p_auth: k.auth
    });
  }

  /* הפונקציה היחידה שנחשפת. נקראת מתוך לחיצה, ולכן requestPermission
     היא הדבר הראשון שקורה כאן — לפני כל המתנה אחרת. */
  function askForPush() {
    var stop = blocker();
    if (stop) { showButton(stop === "ios-home-screen"); say(stop); return; }

    var code = clientCode();
    if (!code) { say("nocode"); return; }
    if (!vapidKey()) { say("nokey"); return; }

    say("");
    busy(true);

    var asked;
    try { asked = Notification.requestPermission(); } catch (e) { asked = null; }

    // ספארי הישן מחזיר את התשובה ב-callback ולא ב-Promise
    if (!asked || typeof asked.then !== "function") {
      asked = new Promise(function (resolve) {
        try { Notification.requestPermission(resolve); } catch (e) { resolve(Notification.permission); }
      });
    }

    asked.then(function (perm) {
      if (perm !== "granted") {
        busy(false);
        showButton(perm !== "denied");
        say(perm === "denied" ? "denied" : "dismissed");
        return;
      }
      return readySW()
        .then(subscribe)
        .then(function (sub) { return save(sub, code); })
        .then(function () {
          busy(false);
          showButton(false);
          say("on");
        })
        .catch(function () {
          busy(false);
          showButton(true);
          say("failed");
        });
    }).catch(function () {
      busy(false);
      showButton(true);
      say("failed");
    });
  }

  /* ---------- מצב הכפתור בטעינה ---------- */

  /* כשההרשאה כבר ניתנה, המנוי נשמר שוב בשקט. זה מה שמציל את המקרה
     שבו ההרשמה עברה בדפדפן אבל השמירה במסד נפלה: בלי זה הלקוח רואה
     כפתור מאושר ולא מקבל תזכורות לעולם, ואין לו שום דרך לדעת. */
  function resave() {
    var code = clientCode();
    if (!code || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    readySW()
      .then(function (reg) { return reg.pushManager.getSubscription(); })
      .then(function (sub) { if (sub) return save(sub, code); })
      .catch(function () {});
  }

  function render() {
    if (!el("push-btn")) return;

    var granted = ("Notification" in window) && Notification.permission === "granted";
    if (granted) {
      showButton(false);
      say("on");
      resave();
      return;
    }

    // בלי מפתח VAPID אין תזכורות בכלל. כפתור מת גרוע מכפתור שאין,
    // ולכן עד שהמפתח נכנס ל-config.js הלקוח לא רואה כאן שום דבר.
    if (!vapidKey()) { showButton(false); say(""); return; }

    var stop = blocker();
    if (stop === "denied" || stop === "insecure" || stop === "unsupported") {
      // אין טעם בכפתור שלא יכול לעבוד. ההסבר נשאר, כדי שיהיה ברור למה.
      showButton(false);
      say(stop);
      return;
    }

    showButton(true);
    busy(false);
    say("");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }

  var btn = el("push-btn");
  if (btn) btn.addEventListener("click", askForPush);
  else document.addEventListener("DOMContentLoaded", function () {
    var b = el("push-btn");
    if (b) b.addEventListener("click", askForPush);
  });

  window.askForPush = askForPush;
})();
