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

const VAPID: Vapid = {
  publicKey: env("VAPID_PUBLIC_KEY"),
  privateKey: env("VAPID_PRIVATE_KEY"),
  subject: env("VAPID_SUBJECT") || "mailto:push@hatmada.invalid",
};

const PUSH_HOUR = parseInt(env("PUSH_HOUR") || "21", 10);

const TEXT = {
  title: env("PUSH_TITLE") || "בונים התמדה",
  body: env("PUSH_BODY") || "עוד לא דיווחת על היום. שתי דקות וזה נסגר.",
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

/* ---------- השער ---------- */

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handler(req: Request): Promise<Response> {
  if (!allowed(req)) return json({ error: "unauthorized" }, 401);

  if (!PROJECT_URL || !SECRET_KEY) {
    return json({ error: "missing SUPABASE_URL or secret key" }, 500);
  }
  if (!VAPID.publicKey || !VAPID.privateKey) {
    return json({ error: "missing VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY" }, 500);
  }

  // force מדלג על בדיקת השעה בלבד. שתי ההחלטות נשמרות גם אז: מי
  // שדיווח לא יקבל, ומי שכבר קיבל היום לא יקבל שוב.
  let force = false;
  try {
    const body = await req.json();
    force = body && body.force === true;
  } catch { /* גוף ריק זה המצב הרגיל כשה-cron קורא */ }

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
