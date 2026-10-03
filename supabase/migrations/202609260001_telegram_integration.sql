BEGIN;

create table if not exists public.telegram_bot_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default false,
  timezone text not null default 'Asia/Tashkent',
  daily_time text not null default '09:00',
  reminder_interval_minutes integer not null default 30 check (reminder_interval_minutes > 0),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.telegram_worker_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  worker_identifier text not null,
  chat_id bigint not null unique,
  telegram_username text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  linked_at timestamptz not null default now(),
  last_verified_at timestamptz not null default now(),
  unique (user_id, worker_identifier)
);

create table if not exists public.telegram_link_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  worker_identifier text not null,
  code text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.telegram_daily_statuses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  worker_identifier text not null,
  chat_id bigint not null,
  response_date date not null,
  status text not null check (status in ('full', 'half', 'day_off')),
  created_at timestamptz not null default now(),
  unique (worker_identifier, response_date),
  unique (chat_id, response_date)
);

create table if not exists public.telegram_logs (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  event_status text not null default 'info',
  message text,
  payload jsonb,
  chat_id bigint,
  worker_identifier text,
  created_at timestamptz not null default now()
);

alter table public.telegram_bot_settings enable row level security;
alter table public.telegram_worker_links enable row level security;
alter table public.telegram_link_tokens enable row level security;
alter table public.telegram_daily_statuses enable row level security;
alter table public.telegram_logs enable row level security;

drop policy if exists telegram_bot_settings_all on public.telegram_bot_settings;
drop policy if exists telegram_worker_links_all on public.telegram_worker_links;
drop policy if exists telegram_link_tokens_all on public.telegram_link_tokens;
drop policy if exists telegram_daily_statuses_all on public.telegram_daily_statuses;
drop policy if exists telegram_logs_all on public.telegram_logs;

create policy telegram_bot_settings_all on public.telegram_bot_settings
for all to authenticated
using (true)
with check (true);

create policy telegram_worker_links_all on public.telegram_worker_links
for all to authenticated
using (true)
with check (true);

create policy telegram_link_tokens_all on public.telegram_link_tokens
for all to authenticated
using (true)
with check (true);

create policy telegram_daily_statuses_all on public.telegram_daily_statuses
for all to authenticated
using (true)
with check (true);

create policy telegram_logs_all on public.telegram_logs
for all to authenticated
using (true)
with check (true);

create or replace function public.upsert_telegram_bot_settings(
  p_enabled boolean,
  p_daily_time text default '09:00',
  p_reminder_interval_minutes integer default 30,
  p_timezone text default 'Asia/Tashkent',
  p_updated_by uuid default null
)
returns public.telegram_bot_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.telegram_bot_settings;
begin
  insert into public.telegram_bot_settings (id, enabled, timezone, daily_time, reminder_interval_minutes, updated_by, updated_at)
  values (1, p_enabled, p_timezone, p_daily_time, p_reminder_interval_minutes, p_updated_by, now())
  on conflict (id)
  do update set
    enabled = excluded.enabled,
    timezone = excluded.timezone,
    daily_time = excluded.daily_time,
    reminder_interval_minutes = excluded.reminder_interval_minutes,
    updated_by = coalesce(excluded.updated_by, public.telegram_bot_settings.updated_by),
    updated_at = now()
  returning * into row;

  return row;
end;
$$;

create or replace function public.generate_telegram_link_code(
  p_user_id uuid,
  p_worker_identifier text,
  p_chat_id bigint,
  p_username text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  code text;
  expires_at timestamptz := now() + interval '15 minutes';
begin
  code := upper(substr(md5(random()::text), 1, 8));

  insert into public.telegram_link_tokens (user_id, worker_identifier, code, expires_at)
  values (p_user_id, p_worker_identifier, code, expires_at);

  insert into public.telegram_logs (event_type, event_status, message, payload, chat_id, worker_identifier)
  values (
    'telegram_link_token_created',
    'info',
    'Telegram linking token was generated',
    jsonb_build_object('worker_identifier', p_worker_identifier, 'chat_id', p_chat_id, 'username', p_username, 'expires_at', expires_at),
    p_chat_id,
    p_worker_identifier
  );

  return code;
end;
$$;

create or replace function public.verify_telegram_link_code(
  p_code text,
  p_chat_id bigint,
  p_username text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  token_row public.telegram_link_tokens;
  result jsonb;
begin
  select * into token_row
  from public.telegram_link_tokens
  where code = upper(trim(p_code))
    and expires_at > now()
    and used_at is null
  order by created_at desc
  limit 1;

  if token_row is null then
    return jsonb_build_object('ok', false, 'error', 'Invalid or expired link code');
  end if;

  insert into public.telegram_worker_links (user_id, worker_identifier, chat_id, telegram_username, status, linked_at, last_verified_at)
  values (token_row.user_id, token_row.worker_identifier, p_chat_id, p_username, 'active', now(), now())
  on conflict (chat_id) do update set
    user_id = excluded.user_id,
    worker_identifier = excluded.worker_identifier,
    telegram_username = excluded.telegram_username,
    status = 'active',
    last_verified_at = now(),
    linked_at = coalesce(public.telegram_worker_links.linked_at, now())
  returning to_jsonb(public.telegram_worker_links) into result;

  update public.telegram_link_tokens
  set used_at = now()
  where id = token_row.id;

  insert into public.telegram_logs (event_type, event_status, message, payload, chat_id, worker_identifier)
  values (
    'telegram_link_verified',
    'success',
    'Telegram worker link verified',
    jsonb_build_object('worker_identifier', token_row.worker_identifier, 'chat_id', p_chat_id, 'username', p_username),
    p_chat_id,
    token_row.worker_identifier
  );

  return jsonb_build_object('ok', true, 'worker_identifier', token_row.worker_identifier, 'user_id', token_row.user_id, 'chat_id', p_chat_id, 'data', result);
end;
$$;

create or replace function public.record_telegram_daily_status(
  p_user_id uuid,
  p_worker_identifier text,
  p_chat_id bigint,
  p_response_date date,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.telegram_daily_statuses;
begin
  if p_status not in ('full', 'half', 'day_off') then
    return jsonb_build_object('ok', false, 'error', 'Unsupported Telegram response status');
  end if;

  insert into public.telegram_daily_statuses (user_id, worker_identifier, chat_id, response_date, status)
  values (p_user_id, p_worker_identifier, p_chat_id, p_response_date, p_status)
  on conflict (worker_identifier, response_date)
  do update set
    chat_id = excluded.chat_id,
    status = excluded.status,
    created_at = now()
  returning to_jsonb(public.telegram_daily_statuses) into row;

  insert into public.telegram_logs (event_type, event_status, message, payload, chat_id, worker_identifier)
  values (
    'telegram_daily_status_recorded',
    'success',
    'Daily attendance status recorded from Telegram',
    jsonb_build_object('worker_identifier', p_worker_identifier, 'response_date', p_response_date, 'status', p_status),
    p_chat_id,
    p_worker_identifier
  );

  return jsonb_build_object('ok', true, 'data', to_jsonb(row));
end;
$$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.telegram_bot_settings to authenticated;
grant select, insert, update, delete on public.telegram_worker_links to authenticated;
grant select, insert, update, delete on public.telegram_link_tokens to authenticated;
grant select, insert, update, delete on public.telegram_daily_statuses to authenticated;
grant select, insert, update, delete on public.telegram_logs to authenticated;
grant execute on function public.upsert_telegram_bot_settings(boolean, text, integer, text, uuid) to authenticated;
grant execute on function public.generate_telegram_link_code(uuid, text, bigint, text) to authenticated;
grant execute on function public.verify_telegram_link_code(text, bigint, text) to authenticated;
grant execute on function public.record_telegram_daily_status(uuid, text, bigint, date, text) to authenticated;

insert into public.telegram_bot_settings (id, enabled, timezone, daily_time, reminder_interval_minutes, updated_at)
values (1, false, 'Asia/Tashkent', '09:00', 30, now())
on conflict (id) do nothing;

commit;
