-- "השבוע" בדף הצוות — תיקון
--
-- היה: `k.day > current_date - 7`, כלומר חלון מתגלגל של שבעה ימים
-- אחרונים. ביום שני זה סופר עדיין את שלישי–חמישי שעברו, ולכן הדף
-- הראה "3 / 5" בשבוע שבו הלקוח עוד לא היה באימון אחד (יובל, 23-11).
--
-- עכשיו: שבוע לוח שמתחיל ביום ראשון, לפי שעון ישראל.
--   * יום ראשון ולא שני — ככה נספר השבוע בארץ, וככה יובל חושב עליו.
--     `date_trunc('week')` של פוסטגרס מתחיל בשני, ולכן הוא לא בשימוש.
--   * שעון ישראל ולא UTC — המסד יושב ב-UTC, ובין חצות לשתיים לפנות
--     בוקר שעון ישראל `current_date` הוא עוד אתמול.
-- ====================================================================

create or replace function public.il_week_start()
returns date
language sql stable set search_path = public as $$
  select (((now() at time zone 'Asia/Jerusalem')::date)
          - extract(dow from (now() at time zone 'Asia/Jerusalem')::date)::int)::date;
$$;

-- הפונקציה מחזירה תאריך ולא שום דבר אחר, אבל גם ככה אין סיבה
-- שהמפתח הציבורי יוכל לקרוא לה. התצוגה למטה רצה בהרשאות הקורא
-- (security_invoker), ולכן למלווה המחובר כן צריכה להיות הרשאה.
revoke all on function public.il_week_start() from anon, public;
grant execute on function public.il_week_start() to authenticated;

-- ====================================================================
-- התצוגה מחדש. drop ואז create, מאותה סיבה שרשומה ב-schema-tasks.sql:
-- create or replace דורש שכל העמודות יישארו זהות בשם, בטיפוס ובסדר.
-- ====================================================================

drop view if exists public.client_summary;

create view public.client_summary as
  select c.id,
         c.code,
         c.first_name,
         c.coach_id,
         c.weekly_target,
         c.program_weeks,
         c.destination,
         count(k.*) filter (where k.attended = 'yes')                                      as attended_total,
         count(k.*) filter (where k.attended = 'yes' and k.day >= public.il_week_start())  as attended_week,
         count(k.*) filter (where k.day >= public.il_week_start())                         as reported_week,
         max(k.day)                                                                        as last_day,
         c.open_tasks
  from public.clients c
  left join public.checkins k on k.client_id = c.id
  group by c.id;

alter view public.client_summary set (security_invoker = on);
grant select on public.client_summary to authenticated;

-- ====================================================================
-- בדיקה: מה נחשב "השבוע", ומה הדף יראה עכשיו
-- ====================================================================
select public.il_week_start()                                   as week_starts,
       (now() at time zone 'Asia/Jerusalem')::date              as today_il,
       (select string_agg(first_name || ': ' || attended_week || '/' || weekly_target, ', ')
          from public.client_summary)                           as per_client;
