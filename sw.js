/* מטמין את המעטפת בלבד. הנתונים תמיד מהרשת. */
var CACHE = "bh-shell-v29";
var SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "push.js",
  "config.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "coach.html",
  "coach.js"
];

/* GitHub Pages מגיש כל קובץ עם max-age=600, אז בקשה רגילה עלולה לחזור
   מהמטמון של הדפדפן ולא מהרשת. כל בקשה כאן עוקפת אותו במפורש. */
function fresh(req) {
  return new Request(req, { cache: "reload" });
}

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) {
      return fetch(u, { cache: "reload" }).then(function (r) { return c.put(u, r); });
    }));
  }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (k) { return k === CACHE ? null : caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;                 // שמירות הולכות תמיד לרשת
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;       // גופנים ו-Supabase לא נוגעים במטמון

  e.respondWith(
    fetch(fresh(req))
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      })
      .catch(function () { return caches.match(req, { ignoreSearch: true }); })
  );
});

/* ---------- התזכורת היומית ----------
   רק שני המאזינים האלה נוספו כאן. כל שאר ההיגיון של התזכורת יושב
   ב-push.js ובפונקציה שבצד השרת. */

self.addEventListener("push", function (e) {
  var d = {};
  try { if (e.data) d = e.data.json() || {}; } catch (x) { d = {}; }

  var title = d.title || "בונים התמדה";
  var body  = d.body  || "עוד לא דיווחת על היום. שתי דקות וזה נסגר.";

  e.waitUntil(self.registration.showNotification(title, {
    body: body,
    icon: "icon-192.png",
    badge: "icon-192.png",
    lang: "he",
    dir: "rtl",
    // תג קבוע: אם בכל זאת הגיעו שתיים, השנייה מחליפה ולא נערמת
    tag: "bh-daily"
  }));
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ("focus" in list[i]) return list[i].focus();
      }
      // "./" נפתח בתוך ה-scope, והקוד של הלקוח כבר שמור אצלו
      return self.clients.openWindow("./");
    })
  );
});
