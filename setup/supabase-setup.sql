-- ============================================================
-- FiveM Clothing Tracker - Supabase setup
-- Paste this whole file into: Supabase dashboard -> SQL Editor -> Run
-- ============================================================

-- Usernames + online status (one row per account)
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  last_seen timestamptz not null default now()
);

-- Clothing / ped items
create table public.items (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  username text not null default '',
  section text not null check (section in ('male','female','ped')),
  category text not null,
  name text not null,
  drawable text not null default '',
  texture text not null default '',
  pack text not null default '',
  status text not null default '',
  gang text not null default '',
  image text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

-- Activity feed
create table public.activity (
  id bigint generated always as identity primary key,
  username text not null,
  action text not null,
  item_name text not null,
  section text not null,
  created_at timestamptz not null default now()
);

-- Important information board (single row)
create table public.board (
  id int primary key check (id = 1),
  content text not null default '',
  updated_by text,
  updated_at timestamptz
);
insert into public.board (id, content) values (1, '');

-- ---------- Security rules ----------
alter table public.profiles enable row level security;
alter table public.items enable row level security;
alter table public.activity enable row level security;
alter table public.board enable row level security;

-- Logged-in people can see everything; you can only change what's yours
create policy "profiles read"   on public.profiles for select to authenticated using (true);
create policy "profiles insert" on public.profiles for insert to authenticated with check (user_id = auth.uid());
create policy "profiles update" on public.profiles for update to authenticated using (user_id = auth.uid());

create policy "items read"   on public.items for select to authenticated using (true);
create policy "items insert" on public.items for insert to authenticated with check (user_id = auth.uid());
create policy "items update" on public.items for update to authenticated using (user_id = auth.uid());
create policy "items delete" on public.items for delete to authenticated using (user_id = auth.uid());

create policy "activity read"   on public.activity for select to authenticated using (true);
create policy "activity insert" on public.activity for insert to authenticated with check (true);

create policy "board read"   on public.board for select to authenticated using (true);
create policy "board update" on public.board for update to authenticated using (id = 1);
