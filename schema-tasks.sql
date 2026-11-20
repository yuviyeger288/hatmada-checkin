-- פתיחת משימות ללקוח, אחת-אחת, כשהמלווה מחליט.
-- עמודה אחת על clients שמחזיקה את מפתחות המשימות הפתוחות, ופונקציה
-- חדשה שהאתר קורא לה. שום פונקציה קיימת לא משתנה — ולכן הצ'ק-אין
-- היומי לא מרגיש בכלום, גם לפני שמריצים את הקובץ הזה.
--
-- מפתח המשימה היחיד כרגע: 'board' (לוח ההרגלים).
-- ====================================================================

alter table public.clients
  add column if not exists open_tasks text[] not null default '{}';

-- ====================================================================
-- הלקוח: אילו משימות פתוחות לו
-- ====================================================================

create or replace function public.app_get_tasks(p_code text)
returns text[]
language sql security definer set search_path = public as $$
  select coalesce(c.open_tasks, '{}')
  from public.clients c
  where c.code = lower(trim(p_code));
$$;

grant execute on function public.app_get_tasks(text) to anon;

-- ====================================================================
-- המלווה: רשאי לעדכן את הלקוחות שלו, לא רק המנהל.
-- מדיניות נוספת, לא החלפה של קיימת.
-- ====================================================================

drop policy if exists clients_update_own on public.clients;
create policy clients_update_own on public.clients
  for update to authenticated
  using      (coach_id = public.me_coach_id() or public.me_is_admin())
  with check (coach_id = public.me_coach_id() or public.me_is_admin());

-- ====================================================================
-- העמודה נחשפת גם בסיכום, כדי שדף הצוות יוכל להציג מתג.
--
-- drop ואז create, ולא create or replace: האחרון מחייב שכל העמודות
-- הקיימות יישארו באותו שם, טיפוס וסדר בדיוק, וההגדרה כאן שוחזרה
-- מהקובץ ולא מהמסד. הפלה מיותרת של ההרצה כולה בגלל הפרש של עמודה
-- אחת לא שווה את זה. שום דבר לא תלוי בתצוגה הזאת חוץ מדף הצוות,
-- שקורא אותה בזמן ריצה.
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
         count(k.*) filter (where k.attended = 'yes')                              as attended_total,
         count(k.*) filter (where k.attended = 'yes' and k.day > current_date - 7) as attended_week,
         count(k.*) filter (where k.day > current_date - 7)                        as reported_week,
         max(k.day)                                                                as last_day,
         c.open_tasks
  from public.clients c
  left join public.checkins k on k.client_id = c.id
  group by c.id;

alter view public.client_summary set (security_invoker = on);
grant select on public.client_summary to authenticated;
