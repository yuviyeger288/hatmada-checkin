/* התזכורת היומית — הפונקציה ששולחת.
 *
 * pg_cron קורא לה כל שעה, והיא שולחת רק בשעה אחת ביום, לפי שעון ישראל
 * (ראו israelHour למה כל שעה ולא פעם ביום).
 *
 * שתי ההחלטות שהיא מקיימת:
 *   1. שולחים רק למי שעוד לא דיווח היום. הבדיקה היא push_due_today()
 *      במסד, שבודקת מול checkins לפני כל שליחה.
 *   2. התראה אחת ליום, בלי נדנוד. push_mark_sent() רושם מי קיבל, ולכן
 *      גם הרצה ידנית נוספת באותו יום לא תשלח שוב.
 *
 * אין כאן שום ייבוא חיצוני בכוונה: ההצפנה ב-webpush.ts כתובה מעל
 * Web Crypto, והקריאות למסד הן fetch רגיל. ייבוא שנשבר מתגלה רק בפריסה.
 */

import { send, type Subscription, type Vapid } from "./webpush.ts";

/* ---------- סביבה, בלי להניח איזה runtime זה ---------- */

function env(name: string): string {
  const g = globalThis as Record<string, any>;
  if (g.Deno && g.Deno.env && typeof g.Deno.env.get === "function") {
    return g.Deno.env.get(name) || "";
  }
  if (g.process && g.process.env) return g.process.env[name] || "";
  return "";
}

/* Supabase מזריק את שני אלה לבד. השם של המפתח הסודי השתנה בין
   גרסאות של הפלטפורמה, ולכן נבדקים כמה שמות לפי הסדר. */
const PROJECT_URL = env("SUPABASE_URL");
const SECRET_KEY =
  env("SUPABASE_SERVICE_ROLE_KEY") ||
  env("SUPABASE_SECRET_KEY") ||
  env("SB_SECRET_KEY");

/* המפתח הציבורי, לאימות הטוקן של המלווה מול Supabase Auth בלבד */
const PUBLIC_KEY =
  env("SUPABASE_ANON_KEY") ||
  env("SUPABASE_PUBLISHABLE_KEY") ||
  env("SB_PUBLISHABLE_KEY");

const VAPID: Vapid = {
  publicKey: env("VAPID_PUBLIC_KEY"),
  privateKey: env("VAPID_PRIVATE_KEY"),
  subject: env("VAPID_SUBJECT") || "mailto:push@hatmada.invalid",
};

const PUSH_HOUR = parseInt(env("PUSH_HOUR") || "21", 10);

const TEXT = {
  title: env("PUSH_TITLE") || "בונים התמדה",
  // אותו משפט שהאתר כבר אומר במסך "היום" (app.js), ולא ניסוח נוסף
  body: env("PUSH_BODY") || "עוד לא דיווחת היום.",
};

/* תזכורת הבדיקה אומרת שהיא בדיקה. היא נשלחת למלווה, לא ללקוח. */
const TEST_TEXT = {
  title: "בונים התמדה",
  body: "בדיקה. ככה נראית התזכורת.",
};

/* ---------- השעה בישראל ---------- */

/* למה הפונקציה נקראת כל שעה ולא פעם ביום: pg_cron מתזמן לפי שעון
   השרת, שהוא UTC, ולכן "פעם ביום ב-18:00 UTC" זז שעה אחורה וקדימה
   פעמיים בשנה עם שעון הקיץ בישראל. cron שרץ כל שעה, עם השוואה
   לשעה המקומית כאן, נותן שעה ישראלית קבועה כל השנה. */
export function israelHour(now: Date = new Date()): number {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  return parseInt(s, 10);
}

/* ---------- אימות הקורא ---------- */

/* השוואה שלא מדליפה את אורך ההתאמה דרך זמן התגובה */
export function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* הפונקציה בודקת את המפתח בעצמה, ולא נשענת רק על שער ה-JWT של
   הפלטפורמה. כך היא מוגנת גם אם נפרסה עם --no-verify-jwt. */
function allowed(req: Request): boolean {
  if (!SECRET_KEY) return false;
  const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return sameSecret(bearer, SECRET_KEY) ||
         sameSecret(req.headers.get("apikey") || "", SECRET_KEY);
}

/* ---------- קריאות למסד ---------- */

async function rpc(fn: string, args: unknown): Promise<any> {
  const res = await fetch(PROJECT_URL.replace(/\/+$/, "") + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SECRET_KEY,
      "Authorization": "Bearer " + SECRET_KEY,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    throw new Error("rpc " + fn + " → " + res.status + " " + (await res.text()).slice(0, 200));
  }
  return res.status === 204 ? null : await res.json();
}

/* ---------- מי הקורא ----------
   הפונקציה נפרסה עם verify_jwt=false (הנימוק ב-supabase/config.toml),
   ולכן אימות הטוקן של המלווה הוא שלנו. Supabase Auth הוא זה שקובע אם
   הטוקן אמיתי, ולא אנחנו. */

async function callerUserId(req: Request): Promise<string | null> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  // טוקן שהוא עצמו המפתח הסודי אינו משתמש מחובר
  if (sameSecret(token, SECRET_KEY)) return null;

  try {
    const res = await fetch(PROJECT_URL.replace(/\/+$/, "") + "/auth/v1/user", {
      headers: {
        "Authorization": "Bearer " + token,
        "apikey": PUBLIC_KEY || SECRET_KEY,
      },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return (user && typeof user.id === "string" && user.id) || null;
  } catch {
    return null;
  }
}

/* ---------- ההרצה ---------- */

interface Summary {
  hour: number;
  due: number;
  sent: number;
  dropped: number;
  failed: number;
  // רק המוצא של שירות ההתראות, בלי הכתובת של המכשיר עצמו.
  // כתובת מנוי היא מזהה אישי ואין לה מה להופיע ביומן.
  problems: string[];
}

async function run(): Promise<Summary> {
  const out: Summary = {
    hour: israelHour(), due: 0, sent: 0, dropped: 0, failed: 0, problems: [],
  };

  const rows = (await rpc("push_due_today", {})) as Subscription[] | null;
  const due = rows || [];
  out.due = due.length;

  for (const sub of due) {
    const r = await send(sub, TEXT, VAPID);

    if (r.ok) {
      await rpc("push_mark_sent", { p_endpoint: sub.endpoint });
      out.sent++;
      continue;
    }

    if (r.gone) {
      await rpc("push_forget", { p_endpoint: sub.endpoint });
      out.dropped++;
      continue;
    }

    out.failed++;
    let where = "?";
    try { where = new URL(sub.endpoint).host; } catch { /* כתובת לא תקינה */ }
    out.problems.push(where + " → " + r.status + " " + r.detail);
  }

  return out;
}

/* ---------- תזכורת בדיקה, ללקוח אחד ----------
   שני הבדלים מהמסלול הרגיל, ושניהם במתכוון:

   1. נשלח גם למי שכבר דיווח היום (push_targets_for ולא push_due_today),
      אחרת אי אפשר לבדוק אחרי שדיווחת.
   2. **אין push_mark_sent.** אם הבדיקה היתה מסמנת את היום כ"נשלח",
      התזכורת האמיתית של אותו ערב לא היתה יוצאת — והבדיקה היתה הורסת
      בדיוק את מה שהיא באה לבדוק. */

interface TestResult {
  status: "sent" | "no-device" | "no-key" | "failed";
  devices: number;
  sent: number;
  problems: string[];
}

async function runTest(clientId: string): Promise<TestResult> {
  const out: TestResult = { status: "failed", devices: 0, sent: 0, problems: [] };

  const rows = (await rpc("push_targets_for", { p_client: clientId })) as Subscription[] | null;
  const targets = rows || [];
  out.devices = targets.length;

  if (!targets.length) {
    out.status = "no-device";
    return out;
  }

  for (const sub of targets) {
    const r = await send(sub, TEST_TEXT, VAPID);

    if (r.ok) { out.sent++; continue; }

    if (r.gone) {
      await rpc("push_forget", { p_endpoint: sub.endpoint });
      out.problems.push("מנוי שלא קיים יותר — נמחק");
      continue;
    }

    let where = "?";
    try { where = new URL(sub.endpoint).host; } catch { /* כתובת לא תקינה */ }
    out.problems.push(where + " → " + r.status + " " + r.detail);
  }

  out.status = out.sent > 0 ? "sent" : "failed";
  return out;
}

/* ---------- השער ---------- */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handler(req: Request): Promise<Response> {
  if (!PROJECT_URL || !SECRET_KEY) {
    return json({ error: "missing SUPABASE_URL or secret key" }, 500);
  }

  let body: Record<string, any> = {};
  try { body = (await req.json()) || {}; } catch { /* גוף ריק — ככה ה-cron קורא */ }

  const haveKeys = !!(VAPID.publicKey && VAPID.privateKey);

  /* ---- מסלול הבדיקה: מלווה מחובר, לקוח אחד ----
     כאן אין מפתח סודי, ולכן ההרשאה נבדקת פעמיים: Supabase Auth מאמת
     שהטוקן אמיתי, ו-push_may_test במסד קובע אם המלווה הזה אחראי על
     הלקוח הזה. אף אחת מהשתיים אינה בדפדפן. */
  if (body.test === true) {
    const clientId = String(body.client_id || "");
    if (!clientId) return json({ status: "bad-request" }, 400);

    const uid = await callerUserId(req);
    if (!uid) return json({ status: "not-allowed" }, 401);

    const may = await rpc("push_may_test", { p_user: uid, p_client: clientId });
    if (may !== true) return json({ status: "not-allowed" }, 403);

    // לפני שיובל סיים את ההגדרה אין מה לשלוח. זאת תשובה, לא תקלה.
    if (!haveKeys) return json({ status: "no-key", devices: 0, sent: 0, problems: [] });

    try {
      return json(await runTest(clientId));
    } catch (e) {
      return json({ status: "failed", devices: 0, sent: 0, problems: [String(e)] }, 500);
    }
  }

  /* ---- המסלול הרגיל: רק ה-cron, ורק עם המפתח הסודי ---- */
  if (!allowed(req)) return json({ error: "unauthorized" }, 401);
  if (!haveKeys) {
    return json({ error: "missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY" }, 500);
  }

  // force מדלג על בדיקת השעה בלבד. שתי ההחלטות נשמרות גם אז: מי
  // שדיווח לא יקבל, ומי שכבר קיבל היום לא יקבל שוב.
  const force = body.force === true;

  const hour = israelHour();
  if (!force && hour !== PUSH_HOUR) {
    return json({ skipped: "not the hour", hour, want: PUSH_HOUR });
  }

  try {
    return json(await run());
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

// נרשם רק כשרצים באמת על Deno, כדי שהקובץ יהיה גם בר-ייבוא לבדיקה
const D = (globalThis as Record<string, any>).Deno;
if (D && typeof D.serve === "function") D.serve(handler);
