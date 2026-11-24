/* הכפתור "לשלוח תזכורת עכשיו" בדף הצוות — מה הוא אומר בכל מצב.
 *
 * push-test.js מורץ בארגז חול עם DOM מזויף ו-fetch מזויף, ולכן אפשר
 * לקבוע בדיוק מה השרת מחזיר ולראות מה המלווה קורא על הכפתור.
 *
 * המצב החשוב כאן הוא **לפני שההגדרה הושלמה**: הפונקציה עוד לא פרוסה,
 * הקריאה מחזירה 404, והכפתור צריך להגיד את זה במילים ולא ליפול.
 *
 * להרצה:
 *   node supabase/tests/push-test.test.ts
 */

import fs from "node:fs";
import vm from "node:vm";

const SRC = fs.readFileSync(new URL("../../push-test.js", import.meta.url), "utf8");

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

function ok(name: string, cond: boolean): void {
  if (cond) console.log("  ok   " + name);
  else { failures++; console.log("  FAIL " + name); }
}

const TOKEN = "coach-session-token";
const CLIENT = { id: "22222222-2222-2222-2222-222222222222", first_name: "בדיקה" };

interface Btn {
  type: string;
  className: string;
  textContent: string;
  disabled: boolean;
  _click?: () => void;
  addEventListener(ev: string, fn: () => void): void;
}

interface Sent {
  url: string;
  auth: string;
  apikey: string;
  body: Record<string, unknown>;
}

interface Harness {
  button: Btn;
  sent: Sent[];
  press: () => Promise<string>;
}

/* בונה סביבה, מריץ את push-test.js, ומחזיר כפתור שאפשר ללחוץ עליו */
function harness(opts: {
  reply?: { status: number; body?: unknown } | "throw";
  session?: boolean;
  url?: string;
}): Harness {
  const sent: Sent[] = [];

  const sandbox: Record<string, any> = {
    console, setTimeout, clearTimeout, Promise, JSON, String, Number, Object, Error,
    document: {
      createElement(): Btn {
        const b: Btn = {
          type: "", className: "", textContent: "", disabled: false,
          addEventListener(ev: string, fn: () => void) { if (ev === "click") b._click = fn; },
        };
        return b;
      },
    },
    fetch(url: string, init: any) {
      const h = (init && init.headers) || {};
      sent.push({
        url: String(url),
        auth: String(h["Authorization"] || ""),
        apikey: String(h["apikey"] || ""),
        body: JSON.parse(String(init.body || "{}")),
      });
      if (opts.reply === "throw") return Promise.reject(new Error("offline"));
      const r = opts.reply || { status: 200, body: { status: "sent", sent: 1, devices: 1 } };
      return Promise.resolve({
        status: r.status,
        json: () => Promise.resolve(r.body),
      });
    },
  };

  sandbox.window = sandbox;
  sandbox.CONFIG = {
    SUPABASE_URL: opts.url === undefined ? "https://project.supabase.co" : opts.url,
    SUPABASE_ANON_KEY: "sb_publishable_test",
  };

  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  const sb = {
    auth: {
      getSession: () => Promise.resolve({
        data: { session: opts.session === false ? null : { access_token: TOKEN } },
      }),
    },
  };

  const button: Btn = sandbox.pushTestButton(sb, CLIENT);

  // לוחץ, ומחכה עד שהכפתור חוזר להיות לחיץ ויש עליו תשובה
  async function press(): Promise<string> {
    button._click!();
    for (let i = 0; i < 60; i++) {
      if (!button.disabled && button.textContent !== "שולח…") break;
      await new Promise((r) => setTimeout(r, 0));
    }
    return button.textContent;
  }

  return { button, sent, press };
}

/* ---------- 1. הכפתור עצמו ---------- */

console.log("הכפתור");
let h = harness({});
check("הכתובית", h.button.textContent, "לשלוח תזכורת עכשיו");
check("נראה כמו שאר הכפתורים בכרטיס", h.button.className, "toggle");
check("type=button, שלא ישלח טופס", h.button.type, "button");

/* ---------- 2. נשלח ---------- */

console.log("נשלח");
h = harness({ reply: { status: 200, body: { status: "sent", sent: 1, devices: 1 } } });
check("מה שהמלווה קורא", await h.press(), "נשלח. תסתכל על המכשיר.");
check("פנייה אחת", h.sent.length, 1);
check("לפונקציה הנכונה", h.sent[0].url, "https://project.supabase.co/functions/v1/daily-push");
check("עם הטוקן של המלווה", h.sent[0].auth, "Bearer " + TOKEN);
check("ועם המפתח הציבורי", h.sent[0].apikey, "sb_publishable_test");
check("הגוף מבקש בדיקה ללקוח הזה", h.sent[0].body, { test: true, client_id: CLIENT.id });
check("הכפתור חזר להיות לחיץ", h.button.disabled, false);

console.log("נשלח לשני מכשירים");
h = harness({ reply: { status: 200, body: { status: "sent", sent: 2, devices: 2 } } });
check("המספר נאמר", await h.press(), "נשלח ל-2 מכשירים. תסתכל על המכשיר.");

/* ---------- 3. לפני שההגדרה הושלמה ---------- */

console.log("הפונקציה עוד לא נפרסה");
h = harness({ reply: { status: 404, body: null } });
check("אומר שלא חובר, ולא נופל",
  await h.press(), "התזכורות עוד לא חוברו. הצעדים ב-PUSH-SETUP.md.");
check("ואפשר ללחוץ שוב", h.button.disabled, false);

console.log("המפתחות עוד לא הוגדרו");
h = harness({ reply: { status: 200, body: { status: "no-key", devices: 0, sent: 0 } } });
check("אותה תשובה", await h.press(), "התזכורות עוד לא חוברו. הצעדים ב-PUSH-SETUP.md.");

console.log("האתר בלי כתובת Supabase");
h = harness({ url: "" });
check("לא נופל", await h.press(), "התזכורות עוד לא חוברו. הצעדים ב-PUSH-SETUP.md.");
check("ולא יצאה שום פנייה", h.sent.length, 0);

/* ---------- 4. אין מכשיר רשום ---------- */

console.log("אין מכשיר רשום ללקוח");
h = harness({ reply: { status: 200, body: { status: "no-device", devices: 0, sent: 0 } } });
check("אומר מה צריך לקרות קודם",
  await h.press(), "אין מכשיר רשום ללקוח הזה. הוא צריך להפעיל תזכורת מהאפליקציה קודם.");

/* ---------- 5. לקוח של מלווה אחר ---------- */

console.log("לקוח שאינו שלו");
h = harness({ reply: { status: 403, body: { status: "not-allowed" } } });
check("אומר את זה", await h.press(), "הלקוח הזה לא שלך.");

/* ---------- 6. כשל אמיתי ---------- */

console.log("כשל בשירות ההתראות");
h = harness({
  reply: { status: 200, body: { status: "failed", sent: 0, devices: 1, problems: ["fcm.example → 500"] } },
});
const said = await h.press();
ok("אומר שנכשל", said.indexOf("לא הצלחתי לשלוח.") === 0);
ok("ומוסיף את הפירוט", said.indexOf("fcm.example → 500") > -1);

console.log("אין רשת");
h = harness({ reply: "throw" });
check("אומר לנסות שוב", await h.press(), "אין חיבור כרגע. ללחוץ שוב בעוד רגע.");

/* ---------- 7. אין חיבור של מלווה ---------- */

console.log("אין סשן מחובר");
h = harness({ session: false });
check("מבקש להיכנס מחדש", await h.press(), "צריך להיכנס מחדש.");
check("ולא יצאה פנייה לפונקציה", h.sent.length, 0);

/* ---------- סיום ---------- */

console.log("");
if (failures) {
  console.log(failures + " בדיקות נכשלו");
  process.exitCode = 1;
} else {
  console.log("כל הבדיקות עברו");
}
