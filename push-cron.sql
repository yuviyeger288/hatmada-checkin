-- התזכורת היומית — התזמון
-- להריץ אחרי schema-push.sql ואחרי שהפונקציה daily-push נפרסה.
-- לפני ההרצה: להדליק את ההרחבות pg_cron ו-pg_net. ההוראות ב-PUSH-SETUP.md.
--
-- ⚠ בקובץ הזה יש שורה אחת שצריך למלא ביד, והיא מכילה סוד.
--    אחרי שמריצים אותה — לא לשמור את הגרסה הממולאת, ולא לדחוף אותה
--    ל-git. המאגר ציבורי. מה שנשמר במאגר הוא הקובץ הזה עם המילה
--    PASTE_SECRET_KEY_HERE כמו שהיא.
-- ====================================================================


-- ====================================================================
-- 1. שני הערכים שהתזמון צריך, בכספת של Supabase
--
-- למה בכספת ולא בתוך פקודת ה-cron: פקודת cron נשמרת כטקסט בטבלה
-- cron.job, וכל מי שמציץ בה היה רואה את המפתח הסודי. בכספת נשמר
-- רק השם, והערך נשלף בזמן ההרצה.
-- ====================================================================

-- להחליף PASTE_SECRET_KEY_HERE במפתח הסודי של הפרויקט (service_role /
-- secret key) — זה שאסור שיהיה בדפדפן. איפה מוצאים אותו: PUSH-SETUP.md.
select vault.create_secret(
  'https://kzwmerqvzxfbkpslriud.supabase.co',
  'hatmada_project_url',
  'כתובת הפרויקט, לקריאה מתוך ה-cron'
);

select vault.create_secret(
  'PASTE_SECRET_KEY_HERE',
  'hatmada_secret_key',
  'המפתח הסודי, לקריאת הפונקציה daily-push מתוך ה-cron'
);

-- אם מריצים את הקובץ פעם שנייה, שתי השורות למעלה ייכשלו כי השם כבר
-- תפוס. כדי לעדכן ערך קיים במקום ליצור חדש:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'hatmada_secret_key'),
--     'המפתח החדש'
--   );


-- ====================================================================
-- 2. העבודה המתוזמנת
--
-- רצה כל שעה בראש השעה, והפונקציה עצמה שולחת רק בשעה אחת ביום.
--
-- למה כל שעה ולא פעם ביום: pg_cron מתזמן לפי שעון השרת, שהוא UTC.
-- "פעם ביום ב-18:00 UTC" זה 20:00 בישראל בחורף ו-21:00 בקיץ, כלומר
-- התזכורת זזה שעה פעמיים בשנה. cron שרץ כל שעה, והשוואה לשעה
-- המקומית בתוך הפונקציה, נותנים שעה ישראלית קבועה כל השנה.
--
-- השעה עצמה נקבעת במשתנה הסביבה PUSH_HOUR של הפונקציה (ברירת מחדל 20).
-- שינוי שעה = שינוי המשתנה, בלי לגעת כאן.
-- 23 קריאות מתוך 24 מסתיימות בלי לשלוח כלום ובלי לגעת במסד.
-- ====================================================================

-- מוחק עבודה קודמת באותו שם, כדי שהקובץ יהיה בטוח להרצה חוזרת
do $$
begin
  perform cron.unschedule('hatmada-daily-push');
exception when others then
  null;  -- עוד לא הייתה עבודה כזאת
end $$;

select cron.schedule(
  'hatmada-daily-push',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets
             where name = 'hatmada_project_url') || '/functions/v1/daily-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- שתי הכותרות בכוונה: שער ה-JWT של הפלטפורמה קורא את
      -- Authorization, והפונקציה בודקת בעצמה גם apikey. כך זה עובד
      -- גם אם היא נפרסה עם --no-verify-jwt וגם בלי.
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                      where name = 'hatmada_secret_key'),
      'apikey', (select decrypted_secret from vault.decrypted_secrets
                  where name = 'hatmada_secret_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);


-- ====================================================================
-- 3. לראות שזה עובד
-- ====================================================================

-- העבודה רשומה?
--   select jobid, jobname, schedule, active from cron.job
--    where jobname = 'hatmada-daily-push';

-- מה קרה בהרצות האחרונות? (status צריך להיות 'succeeded')
--   select start_time, status, return_message
--     from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'hatmada-daily-push')
--    order by start_time desc limit 10;

-- מה הפונקציה החזירה בפועל? pg_net שומר את התשובה בנפרד.
-- בשעה שאינה שעת התזכורת מצפים ל-{"skipped":"not the hour",...}.
--   select id, status_code, content
--     from net._http_response
--    order by id desc limit 10;

-- לכבות את התזכורת בלי למחוק אותה:
--   update cron.job set active = false where jobname = 'hatmada-daily-push';
-- ולהחזיר:
--   update cron.job set active = true  where jobname = 'hatmada-daily-push';
