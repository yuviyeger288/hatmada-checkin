/* בונים התמדה — "לשלוח תזכורת עכשיו", בדף הצוות

   כפתור אחד בכרטיס הלקוח, שמפעיל את אותה פונקציה שה-cron מפעיל —
   ללקוח הזה בלבד, ובלי לחכות ל-21:00.

   כל ההיגיון והטקסטים כאן, כדי ש-team.js יצטרך שורה אחת בלבד.
   החוצה נחשפת פונקציה אחת: pushTestButton(sb, client) מחזירה כפתור.

   שלושה דברים שהקובץ הזה בנוי סביבם:
   1. **הבדיקה לא מסמנת את היום כ"נשלח"** — זה נאכף בצד השרת
      (runTest ב-index.ts לא קורא ל-push_mark_sent), אחרת בדיקה בערב
      היתה מבטלת את התזכורת האמיתית של אותו ערב.
   2. **הכפתור אומר מה קרה.** נשלח · אין מכשיר · לא חובר · אין הרשאה —
      ארבע תשובות שונות. בדיקה שנכשלת בשקט גרועה מאין בדיקה.
   3. **לפני שההגדרה הושלמה הוא לא עובד, ואומר את זה.** הפונקציה עדיין
      לא פרוסה, ולכן הקריאה מחזירה 404 — וזאת תשובה, לא תקלה. */

(function () {
  "use strict";

  var LABEL = "לשלוח תזכורת עכשיו";

  var SAYS = {
    sent:          "נשלח. תסתכל על המכשיר.",
    "no-device":   "אין מכשיר רשום ללקוח הזה. הוא צריך להפעיל תזכורת מהאפליקציה קודם.",
    "no-key":      "התזכורות עוד לא חוברו. הצעדים ב-PUSH-SETUP.md.",
    "not-allowed": "הלקוח הזה לא שלך.",
    "bad-request": "משהו לא תקין בבקשה.",
    failed:        "לא הצלחתי לשלוח.",
    offline:       "אין חיבור כרגע. ללחוץ שוב בעוד רגע.",
    nosession:     "צריך להיכנס מחדש."
  };

  function fnUrl() {
    var cfg = window.CONFIG || {};
    if (!cfg.SUPABASE_URL) return "";
    return cfg.SUPABASE_URL.replace(/\/+$/, "") + "/functions/v1/daily-push";
  }

  /* הקריאה היא fetch רגיל ולא functions.invoke, כדי שהקוד יראה את
     קוד התשובה ואת הגוף כמו שהם. 404 פה הוא מצב צפוי ולא שגיאה. */
  function ask(token, clientId) {
    var url = fnUrl();
    if (!url) return Promise.resolve({ status: "no-key" });

    var cfg = window.CONFIG || {};
    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": cfg.SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({ test: true, client_id: clientId })
    }).then(function (r) {
      // הפונקציה עוד לא נפרסה — הצעד הרביעי ב-PUSH-SETUP.md
      if (r.status === 404) return { status: "no-key" };
      if (r.status === 401 || r.status === 403) return { status: "not-allowed" };
      return r.json().then(function (d) {
        return d && d.status ? d : { status: "failed" };
      }, function () {
        return { status: "failed" };
      });
    });
  }

  function message(res) {
    var text = SAYS[res.status] || SAYS.failed;

    // כשיש פירוט, הוא נאמר אחרי המשפט ולא במקומו
    if (res.status === "failed" && res.problems && res.problems.length) {
      text += " " + res.problems[0];
    }
    // יותר ממכשיר אחד לאותו לקוח — שווה לדעת
    if (res.status === "sent" && res.sent > 1) {
      text = "נשלח ל-" + res.sent + " מכשירים. תסתכל על המכשיר.";
    }
    return text;
  }

  function run(sb, client, btn) {
    btn.disabled = true;
    btn.textContent = "שולח…";

    sb.auth.getSession().then(function (s) {
      var token = s && s.data && s.data.session && s.data.session.access_token;
      if (!token) {
        btn.disabled = false;
        btn.textContent = SAYS.nosession;
        return;
      }
      return ask(token, client.id).then(function (res) {
        btn.disabled = false;
        btn.textContent = message(res);
      });
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = SAYS.offline;
    });
  }

  /* הכפתור נראה כמו שאר הכפתורים בכרטיס, ומדווח דרך הטקסט של עצמו —
     אותו דפוס כמו מתגי הפתיחה של המשימות. התוצאה נשארת על המסך עד
     הלחיצה הבאה, כדי שלא תיעלם לפני שקראו אותה. */
  window.pushTestButton = function (sb, client) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toggle";
    btn.textContent = LABEL;
    btn.addEventListener("click", function () { run(sb, client, btn); });
    return btn;
  };
})();
