-- תשובות של לקוח למשימות — טבלה אחת לכל המשימות הבאות.
--
-- בכוונה כללית: `task_key` ו-`data` כ-jsonb, כך שמשימה חדשה היא קוד
-- באפליקציה בלבד ולא עוד הרצת SQL. (טבלת `boards` קדמה לזה ונשארת
-- כמו שהיא — אין סיבה להזיז נתונים חיים בשביל אחידות.)
--
-- הכול תוספתי. שלוש הפונקציות שהצ'ק-אין חי עליהן לא נוגעים בהן.
-- ====================================================================

create table if not exists public.answers (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,
  task_key   text not null,
  data       jsonb not null default '{}'::jsonb,
  done       boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, task_key)
);

alter table public.answers enable row level security;

-- ====================================================================
-- הלקוח: קריאה ושמירה לפי הקוד שלו
-- ====================================================================

create or replace function public.app_get_answers(p_code text)
returns table (task_key text, data jsonb, done boolean, updated_at timestamptz)
language sql security definer set search_path = public as $$
  select a.task_key, a.data, a.done, a.updated_at
  from public.answers a
  join public.clients c on c.id = a.client_id
  where c.code = lower(trim(p_code));
$$;

create or replace function public.app_save_answer(
  p_code text,
  p_task text,
  p_data jsonb,
  p_done boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  select id into v_client from public.clients where code = lower(trim(p_code));
  if v_client is null then
    raise exception 'unknown code';
  end if;

  if coalesce(trim(p_task), '') = '' then
    raise exception 'no task';
  end if;

  insert into public.answers (client_id, task_key, data, done)
  values (v_client, trim(p_task), coalesce(p_data, '{}'::jsonb), coalesce(p_done, false))
  on conflict (client_id, task_key) do update
    set data       = excluded.data,
        done       = excluded.done,
        updated_at = now();
end;
$$;

grant execute on function public.app_get_answers(text)                      to anon;
grant execute on function public.app_save_answer(text, text, jsonb, boolean) to anon;

-- ====================================================================
-- המלווה והמנהל קוראים את התשובות של הלקוחות שלהם
-- ====================================================================

drop policy if exists answers_read on public.answers;
create policy answers_read on public.answers
  for select to authenticated
  using (
    exists (
      select 1 from public.clients c
      where c.id = answers.client_id
        and (c.coach_id = public.me_coach_id() or public.me_is_admin())
    )
  );

grant select on public.answers to authenticated;
