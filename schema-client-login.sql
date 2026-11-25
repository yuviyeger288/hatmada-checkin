-- כניסה עם שם משתמש ללקוח
--
-- מה שהיה: הלקוח מזוהה בקוד שבכתובת. הקוד נשאר ועובד בדיוק כמו קודם —
-- מי שכבר מותקן על הטלפון לא נוגעים בו, וגם אם הכניסה החדשה תיפול
-- בערב אחד הוא עדיין נכנס. הכניסה היא תוספת, לא החלפה.
--
-- שלוש ההחלטות שהקובץ בנוי סביבן:
--
-- 1. שם משתמש ולא מייל. Supabase Auth דורש כתובת מייל, ולכן שם משתמש
--    נשמר פנימית כ-<שם>@hatmada.local — דומיין שלא קיים ולא מקבל דואר.
--    כך כתובת המייל האמיתית של הלקוח לא נכנסת למערכת בכלל, וזה שומר
--    על הכלל שכבר נוהג כאן: במסד נשמר שם פרטי, ולא יותר מזה.
--
-- 2. המשתמש נתלה על השורה הקיימת של הלקוח, ולא נפתח לקוח חדש.
--    לקוח שכבר באמצע התוכנית נכנס עם שם משתמש וממשיך מאיפה שהוא —
--    אותם דיווחים, אותן משימות, אותו מסלול, אותן הקלטות. שום דבר לא זז.
--
-- 3. פונקציה אחת, ולא שכבת RLS חדשה על חמש טבלאות. הלקוח המחובר שואל
--    רק "מה הקוד שלי", ומשם כל האתר עובד דרך אותן פונקציות שכבר
--    נבדקו וחיות. פחות קוד חדש בנתיב של הנתונים, פחות מקום לטעות.
--
-- הקובץ הזה נדחף ל-GitHub, והמאגר ציבורי. לכן אין בו שום קוד לקוח
-- ושום שם משתמש אמיתי — רק מצייני מקום. אם אתה ממלא אותם, אל תשמור.
-- ====================================================================

alter table public.clients
  add column if not exists user_id uuid references auth.users(id) on delete set null;

create unique index if not exists clients_user_id_uniq
  on public.clients(user_id) where user_id is not null;

-- ====================================================================
-- "מה הקוד שלי"
-- מחזירה את הקוד של המחובר עצמו בלבד. אין לה פרמטר, ולכן אי אפשר
-- לבקש בה את הקוד של מישהו אחר.
-- ====================================================================

create or replace function public.app_my_code()
returns text
language sql stable security definer set search_path = public as $fn$
  select code from public.clients where user_id = auth.uid();
$fn$;

-- חייב להיות anon וגם authenticated ולא רק public: פונקציה חדשה
-- ב-public מקבלת הרשאת הרצה ישירה לשני התפקידים, ו-revoke from public
-- לא מסיר אותה. זה בדיוק החור שנסגר כאן ב-23-11 בפונקציות התזכורת.
revoke all on function public.app_my_code() from anon, authenticated, public;
grant execute on function public.app_my_code() to authenticated;

-- ====================================================================
-- בדיקה
-- ====================================================================
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'clients'
       and column_name = 'user_id')                                          as col_added,
  (select count(*) from pg_proc where proname = 'app_my_code')               as fn_exists,
  has_function_privilege('anon', 'public.app_my_code()', 'execute')          as anon_can_call,
  has_function_privilege('authenticated', 'public.app_my_code()', 'execute') as auth_can_call,
  (select count(*) from public.clients where user_id is not null)            as linked_clients;

-- ====================================================================
-- אחרי ההרצה — שני צעדים לכל לקוח שמקבל כניסה
--
-- 1. Authentication -> Users -> Add user
--    Email:    <שם-משתמש>@hatmada.local    (זה שם המשתמש. לא מייל אמיתי)
--    Password: סיסמה שאתה בוחר ומוסר ללקוח
--    לסמן Auto Confirm User, אחרת הוא ימתין למייל אישור שלא יגיע לעולם.
--
-- 2. לחבר את המשתמש לשורה הקיימת שלו — שורה אחת:
--
--      update public.clients
--         set user_id = (select id from auth.users
--                         where email = '<שם-משתמש>@hatmada.local')
--       where code = '<הקוד של הלקוח>';
--
--    ולאמת, בלי להדפיס שום קוד:
--      select first_name, user_id is not null as has_login
--        from public.clients order by first_name;
--
-- להחלפת סיסמה: Authentication -> Users -> המשתמש -> Reset password.
-- הסיסמה לא נשמרת בפרויקט הזה בשום מקום.
-- ====================================================================

-- ====================================================================
-- הרשמה ציבורית, והכלל שנגזר ממנה
--
-- אם Allow new users to sign up דלוק, כל מי שמחזיק את המפתח הציבורי —
-- והוא יושב במאגר בכוונה — יכול לפתוח לעצמו חשבון.
--
-- מה זה לא: זה לא דלף. משתמש שנפתח ככה לא מחובר לשום לקוח, ולכן
-- app_my_code מחזירה לו null, האתר אומר לו שהוא עוד לא מחובר למסלול,
-- והוא לא מקבל שום נתון. כל שאר הפונקציות דורשות קוד תקין.
--
-- מה זה כן: אפשר להציף את טבלת המשתמשים, ואפשר לתפוס שם משתמש לפני
-- שפותחים אותו, וזה יפיל את היצירה בשגיאת כפילות.
--
-- ומכאן הכלל, והוא נכון בלי קשר למצב הנוכחי של ההגדרה:
-- החיבור בין משתמש ללקוח נעשה ביד, בידי מנהל, ולעולם לא נגזר מכתובת
-- המייל. לא בטריגר על auth.users ולא בהתאמה בתוך app_my_code. אחרת
-- מי שירשם בתור <שם משתמש>@hatmada.local מקבל את המסלול של אותו לקוח.
--
-- כיבוי ההרשמה לא שובר כאן כלום: הקוד קורא רק ל-token ולא ל-signup,
-- וגם הזמנת מלווה לא עוברת שם. Authentication -> Sign In / Providers.
-- ====================================================================
