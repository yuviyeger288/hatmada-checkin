-- תזכורת יומית ב-push — סכימה
-- להדביק כמו שהוא ב-Supabase: SQL Editor → New query → Run
--
-- הכול כאן תוספתי. שלוש הפונקציות שהאפליקציה של הלקוח כבר משתמשת בהן
-- (app_get_client / app_get_checkins / app_save_checkin) לא נוגעים בהן,
-- ולכן הצ'ק-אין היומי ממשיך לעבוד בדיוק כמו קודם גם לפני שמריצים את זה.
-- ====================================================================

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,

  -- הכתובת שדפדפן המכשיר נתן. היא המפתח: אותו מכשיר שנרשם שוב מחליף
  -- את השורה שלו ולא מוסיף אחת, אחרת הוא יקבל שתי התראות על אותו ערב.
  endpoint   text not null unique,

  -- שני המפתחות שהדפדפן מחזיר, לצורך הצפנת גוף ההודעה (RFC 8291)
  p256dh     text not null,
  auth       text not null,

  -- "התראה אחת ליום, בלי נדנוד" — נשמר כאן ולא בזיכרון של השולח,
  -- כדי שגם הרצה ידנית נוספת באותו יום לא תשלח התראה שנייה.
  last_push_on date,

  created_at timestamptz not null default now()
);

-- סגורה לחלוטין בפני המפתח הציבורי, כמו שאר הטבלאות.
-- הכתיבה היחידה מהדפדפן היא דרך app_save_push שלמטה.
-- מי שקורא את הטבלה הוא השולח, שרץ עם המפתח הסודי ולכן עוקף RLS.
alter table public.push_subscriptions enable row level security;

-- ====================================================================
-- הדפדפן נרשם: שומר את המנוי לפי הקוד של הלקוח.
-- אותו דפוס בדיוק כמו app_save_checkin.
-- ====================================================================
create or replace function public.app_save_push(
  p_code     text,
  p_endpoint text,
  p_p256dh   text,
  p_auth     text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  select id into v_client from public.clients where code = lower(trim(p_code));
  if v_client is null then
    raise exception 'unknown code';
  end if;

  if coalesce(trim(p_endpoint), '') = '' then
    raise exception 'no endpoint';
  end if;

  insert into public.push_subscriptions (client_id, endpoint, p256dh, auth)
  values (v_client, trim(p_endpoint), trim(p_p256dh), trim(p_auth))
  on conflict (endpoint) do update
    -- מכשיר שעבר לקוח אחר, או שהמפתחות שלו התחלפו, מתעדכן במקום
    set client_id = excluded.client_id,
        p256dh    = excluded.p256dh,
        auth      = excluded.auth;
end;
$$;

grant execute on function public.app_save_push(text, text, text, text) to anon;

-- ====================================================================
-- שלוש הפונקציות של השולח.
--
-- הן לא מוענקות ל-anon בשום צורה: push_due_today מחזירה כתובות של
-- מכשירים, ומפתח ציבורי שיכול לקרוא אותן הוא דליפה. ב-Postgres כל
-- פונקציה חדשה מוענקת ל-PUBLIC כברירת מחדל, ולכן כאן יש revoke מפורש
-- לפני ה-grant ל-service_role.
-- ====================================================================

-- "היום" הוא תמיד לפי שעון ישראל, בשני המקומות שסופרים אותו, כדי
-- שהגבול בין יום ליום לא יזוז פעמיים בשנה עם שעון הקיץ.
create or replace function public.push_today()
returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Jerusalem')::date;
$$;

-- מי צריך לקבל התראה עכשיו: מי שעוד לא דיווח היום, ושעוד לא קיבל
-- התראה היום. ההחלטה "שולחים רק למי שעוד לא דיווח" יושבת כאן, צמוד
-- לנתונים, ולא אצל השולח.
create or replace function public.push_due_today()
returns table (endpoint text, p256dh text, auth text)
language sql security definer set search_path = public as $$
  select s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s
  where s.last_push_on is distinct from public.push_today()
    and not exists (
      select 1
      from public.checkins k
      where k.client_id = s.client_id
        and k.day = public.push_today()
    );
$$;

-- נרשם אחרי שליחה מוצלחת. מכאן מגיעה ההבטחה של התראה אחת ליום.
create or replace function public.push_mark_sent(p_endpoint text)
returns void
language sql security definer set search_path = public as $$
  update public.push_subscriptions
     set last_push_on = public.push_today()
   where endpoint = p_endpoint;
$$;

-- מכשיר שהדפדפן שלו הודיע שהמנוי מת (410/404) נמחק, אחרת הוא ייכשל
-- כל יום לנצח.
create or replace function public.push_forget(p_endpoint text)
returns void
language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

revoke all on function public.push_today()             from public;
revoke all on function public.push_due_today()         from public;
revoke all on function public.push_mark_sent(text)     from public;
revoke all on function public.push_forget(text)        from public;

grant execute on function public.push_today()          to service_role;
grant execute on function public.push_due_today()      to service_role;
grant execute on function public.push_mark_sent(text)  to service_role;
grant execute on function public.push_forget(text)     to service_role;
