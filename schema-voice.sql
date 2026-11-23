-- הקלטות קוליות בצ'ק-אין היומי
--
-- שתי שאלות הצ'ק-אין שנכתבות בהן מילים — "מה היה קשה" ו"מה הכריע" —
-- מקבלות אפשרות להקליט במקום לכתוב. הכתיבה נשארת; ההקלטה היא תוספת.
--
-- שלוש החלטות שהטבלה בנויה סביבן:
--
-- 1. **טבלה נפרדת, ולא טור ב-checkins.** האפליקציה טוענת את כל
--    הדיווחים בכל פתיחה. אודיו בתוך אותה שורה היה הופך את הטעינה
--    הזאת למגה-בייטים. כאן הרשימה (יום, שאלה, אורך) זולה, והאודיו
--    עצמו נשלף רק כשלוחצים "לשמוע".
--
-- 2. **base64 בטור טקסט, ולא Supabase Storage.** העלאה ישירה ל-Storage
--    עם המפתח הציבורי — שמונח במאגר ציבורי — היתה פותחת נקודת העלאה
--    לכל מי שקורא את הדף. כאן נשמר העקרון שכל האתר בנוי עליו: אין
--    גישה בלי קוד לקוח תקף, והכול עובר דרך פונקציה.
--
-- 3. **שתי הקלטות ליום, לכל היותר.** המפתח הייחודי (לקוח, יום, שאלה)
--    הוא מה שחוסם צמיחה: הקלטה שנייה באותה שאלה מחליפה ולא מוסיפה.
--
-- הכול תוספתי. הפונקציות שהצ'ק-אין חי עליהן לא זזות.
-- ====================================================================

create table if not exists public.checkin_voice (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,
  day        date not null,
  slot       text not null check (slot in ('hard','decided')),
  mime       text not null check (mime like 'audio/%'),
  secs       int  not null default 0,
  b64        text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, day, slot)
);

alter table public.checkin_voice enable row level security;

-- ====================================================================
-- הלקוח: רשימה, שליפה, שמירה ומחיקה — לפי הקוד שלו
-- ====================================================================

-- הרשימה בלי האודיו. זה מה שהאפליקציה שואלת כשנפתח דיווח.
create or replace function public.app_get_voice_list(p_code text)
returns table (day date, slot text, secs int)
language sql security definer set search_path = public as $$
  select v.day, v.slot, v.secs
  from public.checkin_voice v
  join public.clients c on c.id = v.client_id
  where c.code = lower(trim(p_code))
  order by v.day desc;
$$;

-- הקלטה אחת, כשלוחצים לשמוע אותה.
create or replace function public.app_get_voice(p_code text, p_day date, p_slot text)
returns table (mime text, secs int, b64 text)
language sql security definer set search_path = public as $$
  select v.mime, v.secs, v.b64
  from public.checkin_voice v
  join public.clients c on c.id = v.client_id
  where c.code = lower(trim(p_code))
    and v.day = p_day
    and v.slot = p_slot;
$$;

create or replace function public.app_save_voice(
  p_code text,
  p_day  date,
  p_slot text,
  p_mime text,
  p_secs int,
  p_b64  text
) returns void
language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  select id into v_client from public.clients where code = lower(trim(p_code));
  if v_client is null then
    raise exception 'unknown code';
  end if;

  if p_slot not in ('hard','decided') then
    raise exception 'unknown slot';
  end if;

  if coalesce(p_b64, '') = '' then
    raise exception 'no audio';
  end if;

  -- חסם עליון. דקה של הקלטה היא פחות מחצי מזה גם בקידוד הכי בזבזני,
  -- ולכן מה שגדול מכאן הוא לא הקלטה של צ'ק-אין.
  if length(p_b64) > 2000000 then
    raise exception 'audio too large';
  end if;

  insert into public.checkin_voice (client_id, day, slot, mime, secs, b64)
  values (
    v_client,
    p_day,
    p_slot,
    case when coalesce(p_mime,'') like 'audio/%' then p_mime else 'audio/mp4' end,
    least(greatest(coalesce(p_secs, 0), 0), 600),
    p_b64
  )
  on conflict (client_id, day, slot) do update
    set mime       = excluded.mime,
        secs       = excluded.secs,
        b64        = excluded.b64,
        updated_at = now();
end;
$$;

create or replace function public.app_del_voice(p_code text, p_day date, p_slot text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  select id into v_client from public.clients where code = lower(trim(p_code));
  if v_client is null then
    raise exception 'unknown code';
  end if;

  delete from public.checkin_voice
  where client_id = v_client and day = p_day and slot = p_slot;
end;
$$;

grant execute on function public.app_get_voice_list(text)                        to anon;
grant execute on function public.app_get_voice(text, date, text)                 to anon;
grant execute on function public.app_save_voice(text, date, text, text, int, text) to anon;
grant execute on function public.app_del_voice(text, date, text)                 to anon;

-- ====================================================================
-- המלווה והמנהל שומעים את ההקלטות של הלקוחות שלהם
-- ====================================================================

drop policy if exists checkin_voice_read on public.checkin_voice;
create policy checkin_voice_read on public.checkin_voice
  for select to authenticated
  using (
    exists (
      select 1 from public.clients c
      where c.id = checkin_voice.client_id
        and (c.coach_id = public.me_coach_id() or public.me_is_admin())
    )
  );

grant select on public.checkin_voice to authenticated;

-- ====================================================================
-- בדיקה
-- ====================================================================
select
  (select count(*) from public.checkin_voice)                                    as rows_now,
  (select count(*) from pg_proc where proname = 'app_save_voice')                as fn_save,
  (select count(*) from pg_policies where policyname = 'checkin_voice_read')     as policy;
