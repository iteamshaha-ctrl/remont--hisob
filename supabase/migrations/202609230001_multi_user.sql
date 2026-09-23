begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  login_id text not null unique check (login_id = lower(login_id) and length(login_id) between 3 and 40),
  first_name text not null default '',
  last_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_app_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.legacy_state_claims (
  id smallint primary key default 1 check (id = 1),
  user_id uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now()
);

create index if not exists profiles_login_id_idx on public.profiles (login_id);

alter table public.profiles enable row level security;
alter table public.user_app_state enable row level security;
alter table public.legacy_state_claims enable row level security;

drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_update_own on public.profiles;
drop policy if exists user_app_state_select_own on public.user_app_state;
drop policy if exists user_app_state_insert_own on public.user_app_state;
drop policy if exists user_app_state_update_own on public.user_app_state;
drop policy if exists user_app_state_delete_own on public.user_app_state;

create policy profiles_select_own on public.profiles for select to authenticated using (auth.uid() = id);
create policy profiles_update_own on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy user_app_state_select_own on public.user_app_state for select to authenticated using (auth.uid() = user_id);
create policy user_app_state_insert_own on public.user_app_state for insert to authenticated with check (auth.uid() = user_id);
create policy user_app_state_update_own on public.user_app_state for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy user_app_state_delete_own on public.user_app_state for delete to authenticated using (auth.uid() = user_id);

grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.user_app_state to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, login_id, first_name, last_name)
  values (
    new.id,
    lower(trim(coalesce(new.raw_user_meta_data ->> 'login_id', split_part(new.email, '@', 1)))),
    trim(coalesce(new.raw_user_meta_data ->> 'first_name', '')),
    trim(coalesce(new.raw_user_meta_data ->> 'last_name', ''))
  )
  on conflict (id) do update set
    login_id = excluded.login_id,
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.claim_legacy_state()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  claim_owner uuid;
  state_data jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  insert into public.legacy_state_claims (id, user_id)
  values (1, current_user_id)
  on conflict (id) do nothing;

  select user_id into claim_owner
  from public.legacy_state_claims
  where id = 1;

  if claim_owner = current_user_id then
    insert into public.user_app_state (user_id, data)
    select current_user_id, value
    from public.app_state
    where key = 'remont-tracker-v2'
    on conflict (user_id) do nothing;
  end if;

  select data into state_data
  from public.user_app_state
  where user_id = current_user_id;

  return state_data;
end;
$$;

revoke all on function public.claim_legacy_state() from public;
grant execute on function public.claim_legacy_state() to authenticated;

-- Keep legacy tables and rows intact, but stop the browser from reading them directly.
do $$
begin
  if to_regclass('public.app_state') is not null then
    execute 'alter table public.app_state enable row level security';
    execute 'revoke all on table public.app_state from anon, authenticated';
  end if;
  if to_regclass('public.remont_data') is not null then
    execute 'alter table public.remont_data enable row level security';
    execute 'revoke all on table public.remont_data from anon, authenticated';
  end if;
end;
$$;

commit;
