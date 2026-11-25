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
process.env.SUPABASE_ANON_KEY = "sb_publishable_test";

/* ---------- בדל ל-fetch ---------- */

interface Call { kind: string; endpoint?: string }

let calls: Call[] = [];
let due: typeof SUB[] = [];
let pushStatus = 201;

// מסלול הבדיקה מדף הצוות
const COACH_TOKEN = "coach-jwt-not-a-real-one";
const COACH_UID = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";
let targets: typeof SUB[] = [];
let mayTest = true;

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
    if (fn === "push_may_test") {
      ok("ההרשאה נבדקת על המשתמש והלקוח שנשלחו", args.p_user === COACH_UID && args.p_client === CLIENT_ID);
      return new Response(JSON.stringify(mayTest), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    if (fn === "push_targets_for") {
      return new Response(JSON.stringify(targets), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(null, { status: 204 });
  }

  // אימות הטוקן של המלווה מול Supabase Auth
  if (url.indexOf("/auth/v1/user") > -1) {
    const h = (init && init.headers) || {};
    calls.push({ kind: "auth" });
    // המפתח הציבורי, לא הסודי — אין שום סיבה לשלוח את הסודי לכאן
    ok("אימות הטוקן נעשה עם המפתח הציבורי", h["apikey"] === "sb_publishable_test");
    if (String(h["Authorization"] || "") !== "Bearer " + COACH_TOKEN) {
      return new Response("bad token", { status: 401 });
    }
    return new Response(JSON.stringify({ id: COACH_UID }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
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

/* ================= תזכורת בדיקה מדף הצוות ================= */

function postTest(clientId: string | null, token: string | null = COACH_TOKEN): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;
  const payload: Record<string, unknown> = { test: true };
  if (clientId) payload.client_id = clientId;
  return new Request("https://project.supabase.co/functions/v1/daily-push", {
    method: "POST", headers, body: JSON.stringify(payload),
  });
}

/* ---------- 9. נשלח — ובלי לסמן את היום ---------- */

console.log("בדיקה מדף הצוות: נשלחת");
calls = []; targets = [SUB]; mayTest = true; pushStatus = 201;
res = await mod.handler(postTest(CLIENT_ID));
out = await res.json();
check("200", res.status, 200);
check("נשלח", out.status, "sent");
check("מכשיר אחד", out.devices, 1);
check("אחד נשלח", out.sent, 1);
check("הסדר: אימות הטוקן, הרשאה, מכשירים, שליחה",
  calls.map((c) => c.kind), ["auth", "push_may_test", "push_targets_for", "push"]);

// זאת הבדיקה המרכזית של כל המסלול הזה
ok("push_mark_sent לא נקראה — התזכורת של הערב לא בוטלה",
  calls.every((c) => c.kind !== "push_mark_sent"));
ok("ולא push_due_today — בדיקה נשלחת גם למי שכבר דיווח",
  calls.every((c) => c.kind !== "push_due_today"));

/* ---------- 10. אין מכשיר רשום ---------- */

console.log("בדיקה כשאין מכשיר רשום ללקוח");
calls = []; targets = []; mayTest = true;
res = await mod.handler(postTest(CLIENT_ID));
out = await res.json();
check("no-device", out.status, "no-device");
check("אפס מכשירים", out.devices, 0);
ok("ולא נשלחה שום התראה", calls.every((c) => c.kind !== "push"));

/* ---------- 11. לקוח של מלווה אחר ---------- */

console.log("בדיקה על לקוח שאינו שלו");
calls = []; targets = [SUB]; mayTest = false;
res = await mod.handler(postTest(CLIENT_ID));
out = await res.json();
check("403", res.status, 403);
check("not-allowed", out.status, "not-allowed");
ok("לא נשלפו מכשירים ולא נשלח כלום",
  calls.every((c) => c.kind !== "push_targets_for" && c.kind !== "push"));

/* ---------- 12. בלי טוקן, ועם טוקן שגוי ---------- */

console.log("בדיקה בלי טוקן תקף");
calls = []; mayTest = true;
res = await mod.handler(postTest(CLIENT_ID, null));
check("401", res.status, 401);
ok("ולא נגענו במסד בכלל", calls.every((c) => c.kind !== "push_may_test"));

res = await mod.handler(postTest(CLIENT_ID, "some-other-token"));
check("טוקן שגוי גם הוא 401", res.status, 401);

calls = [];
res = await mod.handler(postTest(null));
check("בלי מזהה לקוח — 400", res.status, 400);
ok("ובלי לפנות לשום מקום", calls.length === 0);

/* ---------- 13. מסלול הבדיקה לא פתח את מסלול ה-cron ---------- */

console.log("המסלול הרגיל עדיין דורש את המפתח הסודי");
calls = []; due = [SUB];
res = await mod.handler(new Request("https://x/y", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + COACH_TOKEN },
  body: JSON.stringify({ force: true }),
}));
check("טוקן של מלווה לא מפעיל שליחה לכולם", res.status, 401);
ok("ולא נשלח כלום", calls.every((c) => c.kind !== "push"));

/* ---------- 14. לפני שיובל הגדיר מפתחות ---------- */

console.log("בדיקה לפני שהוגדרו מפתחות VAPID");
const keptPub = process.env.VAPID_PUBLIC_KEY;
const keptPriv = process.env.VAPID_PRIVATE_KEY;
process.env.VAPID_PUBLIC_KEY = "";
process.env.VAPID_PRIVATE_KEY = "";
const nokey = await import("../functions/daily-push/index.ts?nokey");
calls = []; targets = [SUB]; mayTest = true;
res = await nokey.handler(postTest(CLIENT_ID));
out = await res.json();
check("200 — זאת תשובה ולא תקלה", res.status, 200);
check("no-key", out.status, "no-key");
ok("ולא נשלחה שום התראה", calls.every((c) => c.kind !== "push"));
process.env.VAPID_PUBLIC_KEY = keptPub;
process.env.VAPID_PRIVATE_KEY = keptPriv;

/* ---------- סיום ---------- */

globalThis.fetch = realFetch;

console.log("");
if (failures) {
  console.log(failures + " בדיקות נכשלו");
  process.exitCode = 1;
} else {
  console.log("כל הבדיקות עברו");
}
