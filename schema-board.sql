-- לוח ההרגלים — התרגיל מפרק 4: רושמים יום שלם, ואז מסמנים כל שורה.
-- הכול כאן תוספתי. שלוש הפונקציות שהאפליקציה של הלקוח כבר משתמשת בהן
-- (app_get_client / app_get_checkins / app_save_checkin) לא נוגעים בהן,
-- ולכן הצ'ק-אין היומי ממשיך לעבוד בדיוק כמו קודם גם לפני שמריצים את זה.
-- ====================================================================

create table if not exists public.boards (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.clients(id) on delete cascade,
  -- מערך של {"t": טקסט הפעולה, "m": "+" | "-" | "=" | null}
  items      jsonb not null default '[]'::jsonb,
  phase      text  not null default 'write' check (phase in ('write','mark','done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id)
);

alter table public.boards enable row level security;

-- ====================================================================
-- הלקוח: קריאה ושמירה לפי הקוד שלו, כמו בצ'ק-אין
-- ====================================================================

create or replace function public.app_get_board(p_code text)
returns table (items jsonb, phase text, updated_at timestamptz)
language sql security definer set search_path = public as $$
  select b.items, b.phase, b.updated_at
  from public.boards b
  join public.clients c on c.id = b.client_id
  where c.code = lower(trim(p_code));
$$;

create or replace function public.app_save_board(p_code text, p_items jsonb, p_phase text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  select id into v_client from public.clients where code = lower(trim(p_code));
  if v_client is null then
    raise exception 'unknown code';
  end if;

  insert into public.boards (client_id, items, phase)
  values (v_client, coalesce(p_items, '[]'::jsonb), coalesce(p_phase, 'write'))
  on conflict (client_id) do update
    set items      = excluded.items,
        phase      = excluded.phase,
        updated_at = now();
end;
$$;

grant execute on function public.app_get_board(text)              to anon;
grant execute on function public.app_save_board(text, jsonb, text) to anon;

-- ====================================================================
-- המלווה: רואה את הלוח של הלקוחות שלו בלבד. המנהל רואה הכול.
-- אותה מדיניות בדיוק כמו על checkins.
-- ====================================================================

drop policy if exists boards_read on public.boards;
create policy boards_read on public.boards
  for select to authenticated
  using (
    exists (
      select 1 from public.clients c
      where c.id = boards.client_id
        and (c.coach_id = public.me_coach_id() or public.me_is_admin())
    )
  );

grant select on public.boards to authenticated;
