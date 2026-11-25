/* מה הלקוח רואה במסך "היום", בכל מצב של הרשאות ושל מפתח.
 *
 * זה היה החור ב-PUSH-SETUP.md: "המצב שבו הכפתור מופיע" לא נבדק, כי
 * בדפדפן שבו נבדק האתר ההתראות חסומות ולכן הקוד תמיד נכנס לאותו ענף.
 *
 * כאן push.js מורץ בארגז חול עם DOM מזויף, ולכן אפשר לקבוע בדיוק מה
 * Notification.permission מחזיר, אם קיים PushManager, ומה יש
 * ב-VAPID_PUBLIC_KEY — בלי דפדפן, בלי מכשיר ובלי מפתחות.
 *
 * הבדיקה הראשונה והאחרונה הן ההבטחה שחייבת להישמר: כל עוד
 * VAPID_PUBLIC_KEY ריק, הלקוח לא רואה כאן שום דבר.
 *
 * fetch חסום בכוונה — אם הקוד ינסה לפנות ל-Supabase זה ייכשל וייראה,
 * כדי שבדיקה לא תיגע בנתונים של לקוח אמיתי.
 *
 * להרצה:
 *   node supabase/tests/push-button.test.ts
 */

import fs from "node:fs";
import vm from "node:vm";

const SRC = fs.readFileSync(new URL("../../push.js", import.meta.url), "utf8");

let failures = 0;

function check(name: string, got: unknown, want: unknown): void {
  if (JSON.stringify(got) === JSON.stringify(want)) {
    console.log("  ok   " + name);
  } else {
    failures++;
    console.log("  FAIL " + name);
    console.log("       got:  " + JSON.stringify(got));
    console.log("       want: " + JSON.stringify(want));
  }
}

interface El {
  id: string;
  hidden: boolean;
  textContent: string;
  disabled: boolean;
  addEventListener(ev: string, fn: unknown): void;
}

function fakeEl(id: string): El {
  return {
    id, hidden: true, textContent: "", disabled: false,
    addEventListener() {},
  };
}

interface Opts {
  key?: string;
  permission?: string;
  push?: boolean;
  notif?: boolean;
  sw?: boolean;
  secure?: boolean;
  standalone?: boolean;
  ua?: string;
  touch?: number;
}

interface Seen {
  button: string;
  label: string;
  why: string;
  msg: string;
  fetches: unknown[];
  exposed: string;
}

/* מריץ את push.js במצב נתון, ומחזיר מה שהלקוח רואה בסוף */
function run(opts: Opts): Seen {
  const els: Record<string, El> = {
    "push-btn": fakeEl("push-btn"),
    "push-why": fakeEl("push-why"),
    "push-msg": fakeEl("push-msg"),
  };
  const fetches: unknown[] = [];

  const navigator: Record<string, unknown> = {
    userAgent: opts.ua || "Mozilla/5.0 (Linux; Android 14) Chrome/120",
    maxTouchPoints: opts.touch || 0,
  };
  if (opts.sw !== false) {
    navigator.serviceWorker = { ready: new Promise(() => {}), register: () => Promise.resolve({}) };
  }

  const sandbox: Record<string, any> = {
    console, setTimeout, clearTimeout, Promise, URLSearchParams, atob, btoa,
    Uint8Array, JSON, String, Math, Date, Error, RegExp, Array, Object,
    navigator,
    location: { search: "", pathname: "/hatmada-checkin/" },
    localStorage: {
      getItem: () => null, setItem: () => {}, removeItem: () => {},
    },
    document: {
      readyState: "complete",
      cookie: "",
      getElementById: (id: string) => els[id] || null,
      addEventListener: () => {},
      querySelectorAll: () => [],
    },
    fetch: (u: unknown) => { fetches.push(u); return Promise.reject(new Error("blocked in test")); },
  };

  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.isSecureContext = opts.secure !== false;
  sandbox.CONFIG = {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_x",
    VAPID_PUBLIC_KEY: opts.key === undefined ? "" : opts.key,
  };
  sandbox.matchMedia = () => ({ matches: !!opts.standalone });
  if (opts.push !== false) sandbox.PushManager = function () {};
  if (opts.notif !== false) {
    const N: Record<string, any> = function () {} as any;
    N.permission = opts.permission || "default";
    N.requestPermission = () => Promise.resolve(opts.permission || "default");
    sandbox.Notification = N;
  }

  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  return {
    button: els["push-btn"].hidden ? "hidden" : "shown",
    label: els["push-btn"].textContent,
    why: els["push-why"].hidden ? "hidden" : "shown",
    msg: els["push-msg"].hidden ? "" : els["push-msg"].textContent,
    fetches,
    exposed: typeof sandbox.askForPush,
  };
}

// מפתח בצורה הנכונה. לא מפתח של הפרויקט — רק 65 בייט ב-base64url.
const KEY = "BNbxGYNM6uHGTmz6N6rxJcfbqPJHCpmWqhsvVbQ-sLQTJpnlZ8TDHhXD6-c6fBYW6rqGtCgEXMFXBJpXFxEWYZk";

/* ---------- 1. בלי מפתח: שום דבר לא מופיע ---------- */

console.log("בלי מפתח VAPID — המצב שבאוויר כרגע");
let r = run({ key: "", permission: "default" });
check("הכפתור לא מופיע", r.button, "hidden");
check("ההסבר לא מופיע", r.why, "hidden");
check("אין שום הודעה", r.msg, "");
check("ולא נעשתה שום פנייה לרשת", r.fetches, []);
check("askForPush נחשפה בכל זאת", r.exposed, "function");

/* ---------- 2. עם מפתח, דפדפן תומך, ההרשאה עוד לא נשאלה ---------- */

console.log("עם מפתח, אנדרואיד, ההרשאה עוד לא נשאלה");
r = run({ key: KEY, permission: "default" });
check("הכפתור מופיע", r.button, "shown");
check("ההסבר מופיע יחד איתו, לפני הלחיצה", r.why, "shown");
check("הכתובית על הכפתור", r.label, "להפעיל תזכורת יומית");
check("בלי הודעה מקדימה", r.msg, "");
check("ובלי פנייה לרשת לפני שנלחץ", r.fetches, []);

/* ---------- 3. ההרשאה כבר אושרה ---------- */

console.log("ההרשאה כבר אושרה");
r = run({ key: KEY, permission: "granted" });
check("הכפתור נעלם", r.button, "hidden");
check("וההודעה אומרת שהתזכורת פועלת",
  r.msg, "התזכורת פועלת. כל ערב תגיע תזכורת — רק אם עוד לא דיווחת על היום.");

/* ---------- 4. ההרשאה נדחתה — אין דרך חזרה מהאתר ---------- */

console.log("ההרשאה נדחתה");
r = run({ key: KEY, permission: "denied" });
check("אין כפתור מת", r.button, "hidden");
check("וההודעה מפנה להגדרות המכשיר", r.msg.indexOf("בהגדרות המכשיר") > -1, true);

/* ---------- 5. אייפון בספארי, לא מהמסך הבית ---------- */

console.log("אייפון בספארי, לא מהמסך הבית");
r = run({
  key: KEY, push: false, standalone: false,
  ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari",
});
check("הכפתור נשאר, כדי שאפשר יהיה לנסות שוב אחרי ההתקנה", r.button, "shown");

/* ---------- 6. דפדפן בלי התראות בכלל ---------- */

console.log("דפדפן בלי התראות");
r = run({ key: KEY, notif: false, push: false });
check("אין כפתור", r.button, "hidden");
check("וההודעה אומרת מה כן צריך", r.msg.indexOf("iOS 16.4") > -1, true);

/* ---------- 7. בלי מפתח, גם אם ההרשאה אושרה בעבר ---------- */

console.log("בלי מפתח — גם הרשאה שאושרה לא מחזירה את הכפתור");
r = run({ key: "", permission: "granted" });
check("עדיין שום דבר", r.button, "hidden");
check("ובלי פנייה לרשת", r.fetches, []);

/* ---------- סיום ---------- */

console.log("");
if (failures) {
  console.log(failures + " בדיקות נכשלו");
  process.exitCode = 1;
} else {
  console.log("כל הבדיקות עברו");
}
