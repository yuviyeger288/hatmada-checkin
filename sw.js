/* מטמין את המעטפת בלבד. הנתונים תמיד מהרשת. */
var CACHE = "bh-shell-v1";
var SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "config.js",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () {
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
    fetch(req)
      .then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      })
      .catch(function () { return caches.match(req, { ignoreSearch: true }); })
  );
});
