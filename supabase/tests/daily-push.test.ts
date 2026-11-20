/* בדיקת הפונקציה ששולחת, בלי מפתחות אמיתיים ובלי מכשיר.
 *
 * ה-fetch הגלובלי מוחלף בבדל שמחזיר תשובות במקום שירות ההתראות
 * ובמקום המסד, ולכן אפשר לבדוק את ההיגיון כולו: מי נחסם, מתי לא
 * שולחים בגלל השעה, מה קורה למנוי מת, ומה נרשם אחרי שליחה מוצלחת.
 * ההצפנה עצמה רצה כאן באמת — היא נבדקת מול ה-RFC ב-webpush.test.ts.
 *
 * להרצה:
 *   node supabase/tests/daily-push.test.ts
 */

let failures = 0;

function check(name: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log("  ok   " + name);
  else {
    failures++;
    console.log("  FAIL " + name);
    console.log("       got:  " + g);
    console.log("       want: " + w);
  }
}

function ok(name: string, cond: boolean): void {
  if (cond) console.log("  ok   " + name);
  else { failures++; console.log("  FAIL " + name); }
}

function bytesToB64url(b: Uint8Array | ArrayBuffer): string {
  const u = b instanceof Uint8Array ? b : new Uint8Array(b);
  let s = "";
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* מנוי תקין: המפתחות של המכשיר מדוגמת הבדיקה של RFC 8291, כדי
   שההצפנה האמיתית תרוץ על נתונים חוקיים */
const SUB = {
  endpoint: "https://push.example.net/push/abc123",
  p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
};

const SECRET = "sb_secret_test_only_not_a_real_key";

/* ---------- סביבה מזויפת, נקבעת לפני הייבוא ---------- */

const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
) as CryptoKeyPair;
const vapidPub = bytesToB64url(await crypto.subtle.exportKey("raw", pair.publicKey));
const vapidPriv = String((await crypto.subtle.exportKey("jwk", pair.privateKey) as JsonWebKey).d);

process.env.SUPABASE_URL = "https://project.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET;
process.env.VAPID_PUBLIC_KEY = vapidPub;
process.env.VAPID_PRIVATE_KEY = vapidPriv;
process.env.VAPID_SUBJECT = "mailto:a@b.co";
process.env.PUSH_HOUR = "20";

/* ---------- בדל ל-fetch ---------- */

interface Call { kind: string; endpoint?: string }

let calls: Call[] = [];
let due: typeof SUB[] = [];
let pushStatus = 201;

const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(typeof input === "string" ? input : input.url);
  const body = init && init.body ? init.body : null;

  // קריאות למסד
  if (url.indexOf("/rest/v1/rpc/") > -1) {
    const fn = url.split("/rest/v1/rpc/")[1];
    const args = typeof body === "string" ? JSON.parse(body) : {};
    calls.push({ kind: fn, endpoint: args.p_endpoint });

    const headers = (init && init.headers) || {};
    if (headers["apikey"] !== SECRET) {
      return new Response("bad key", { status: 401 });
    }
    if (fn === "push_due_today") {
      return new Response(JSON.stringify(due), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(null, { status: 204 });
  }

  // שירות ההתראות
  calls.push({ kind: "push", endpoint: url });
  const h = (init && init.headers) || {};
  ok("כותרת ההצפנה נשלחה", h["Content-Encoding"] === "aes128gcm");
  ok("כותרת VAPID נשלחה", String(h["Authorization"] || "").indexOf("vapid t=") === 0);
  ok("גוף בינארי נשלח", init.body instanceof Uint8Array && init.body.length > 100);
  ok("TTL נשלח", String(h["TTL"] || "") === "3600");
  return new Response("", { status: pushStatus });
}) as typeof fetch;

const mod = await import("../functions/daily-push/index.ts");

function post(body: unknown, auth = true): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth) headers["Authorization"] = "Bearer " + SECRET;
  return new Request("https://project.supabase.co/functions/v1/daily-push", {
    method: "POST", headers, body: JSON.stringify(body),
  });
}

/* ---------- 1. השעה בישראל, משני צדי שעון הקיץ ---------- */

console.log("השעה בישראל");
check("חורף: 18:00 UTC הוא 20 בישראל",
  mod.israelHour(new Date("2026-01-15T18:00:00Z")), 20);
check("קיץ: 17:00 UTC הוא 20 בישראל",
  mod.israelHour(new Date("2026-07-15T17:00:00Z")), 20);
ok("ולכן אותה שעה מקומית היא שעת UTC אחרת בקיץ ובחורף",
  mod.israelHour(new Date("2026-01-15T17:00:00Z")) !==
  mod.israelHour(new Date("2026-07-15T17:00:00Z")));
check("חצות מוחזר כ-0 ולא כ-24",
  mod.israelHour(new Date("2026-01-15T22:00:00Z")), 0);

/* ---------- 2. השוואת הסוד ---------- */

console.log("אימות הקורא");
ok("סוד זהה עובר", mod.sameSecret("abc", "abc"));
ok("סוד שונה נדחה", !mod.sameSecret("abc", "abd"));
ok("אורך שונה נדחה", !mod.sameSecret("abc", "abcd"));
ok("ריק נדחה", !mod.sameSecret("", ""));

/* ---------- 3. בלי מפתח — נדחה ---------- */

console.log("בקשה בלי הרשאה");
calls = [];
let res = await mod.handler(post({ force: true }, false));
check("401", res.status, 401);
check("ולא נגענו במסד בכלל", calls.length, 0);

res = await mod.handler(new Request("https://x/y", {
  method: "POST", headers: { "Authorization": "Bearer wrong" }, body: "{}",
}));
check("מפתח שגוי גם הוא 401", res.status, 401);

/* ---------- 4. השעה הלא נכונה ---------- */

console.log("שעה שאינה שעת התזכורת");
calls = [];
process.env.PUSH_HOUR = String((mod.israelHour() + 1) % 24);
const other = await import("../functions/daily-push/index.ts?hour");
res = await other.handler(post({}));
const skipped = await res.json();
check("מדווח שדילג", skipped.skipped, "not the hour");
check("ולא שלח כלום", calls.length, 0);
process.env.PUSH_HOUR = "20";

/* ---------- 5. שליחה מוצלחת ---------- */

console.log("שליחה מוצלחת");
calls = [];
due = [SUB];
pushStatus = 201;
res = await mod.handler(post({ force: true }));
let out = await res.json();
check("200", res.status, 200);
check("אחד היה צריך לקבל", out.due, 1);
check("אחד נשלח", out.sent, 1);
check("אף אחד לא נמחק", out.dropped, 0);
check("אף אחד לא נכשל", out.failed, 0);
check("הסדר: שאילתה, שליחה, סימון",
  calls.map((c) => c.kind), ["push_due_today", "push", "push_mark_sent"]);
check("הסימון הוא על אותו מנוי",
  calls[2].endpoint, SUB.endpoint);

/* ---------- 6. אף אחד לא צריך לקבל ---------- */

console.log("כולם כבר דיווחו");
calls = [];
due = [];
res = await mod.handler(post({ force: true }));
out = await res.json();
check("לא נשלח כלום", out.sent, 0);
check("ולא נקראה שום שליחה", calls.map((c) => c.kind), ["push_due_today"]);

/* ---------- 7. מנוי מת ---------- */

console.log("מנוי שמת");
calls = [];
due = [SUB];
pushStatus = 410;
res = await mod.handler(post({ force: true }));
out = await res.json();
check("לא נחשב כנשלח", out.sent, 0);
check("נמחק", out.dropped, 1);
check("נקרא push_forget ולא push_mark_sent",
  calls.map((c) => c.kind), ["push_due_today", "push", "push_forget"]);

/* ---------- 8. כשל זמני ---------- */

console.log("כשל זמני בשירות ההתראות");
calls = [];
due = [SUB];
pushStatus = 500;
res = await mod.handler(post({ force: true }));
out = await res.json();
check("נחשב ככשל", out.failed, 1);
check("לא נמחק ולא סומן",
  calls.map((c) => c.kind), ["push_due_today", "push"]);
ok("היומן מזכיר את שירות ההתראות",
  out.problems.length === 1 && out.problems[0].indexOf("push.example.net") === 0);
ok("והיומן לא מכיל את כתובת המכשיר",
  out.problems[0].indexOf("/push/abc123") === -1);

/* ---------- סיום ---------- */

globalThis.fetch = realFetch;

console.log("");
if (failures) {
  console.log(failures + " בדיקות נכשלו");
  process.exitCode = 1;
} else {
  console.log("כל הבדיקות עברו");
}
