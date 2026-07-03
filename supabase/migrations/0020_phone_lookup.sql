-- Telegram ID Search: resolve phone numbers to Telegram users by importing them
-- as contacts on a chosen connected account. Batches group single/multiple/CSV
-- lookups; results hold the resolved user (or a reason when not found).

create table kw_phone_lookup_batches (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references kw_accounts (id) on delete set null,
  source text not null default 'single',
  status text not null default 'pending',
  total_count int not null default 0,
  completed_count int not null default 0,
  found_count int not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table kw_phone_lookup_results (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references kw_phone_lookup_batches (id) on delete cascade,
  phone text not null,
  status text not null default 'pending',
  telegram_user_id bigint,
  username text,
  first_name text,
  last_name text,
  phone_visible text,
  is_premium boolean,
  is_verified boolean,
  bio text,
  reason text,
  details jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index kw_phone_lookup_results_batch_idx
  on kw_phone_lookup_results (batch_id, status);

alter publication supabase_realtime add table kw_phone_lookup_batches;
alter publication supabase_realtime add table kw_phone_lookup_results;

alter table kw_phone_lookup_batches enable row level security;
alter table kw_phone_lookup_results enable row level security;

create policy "anon read kw_phone_lookup_batches"
  on kw_phone_lookup_batches for select to anon using (true);

create policy "anon read kw_phone_lookup_results"
  on kw_phone_lookup_results for select to anon using (true);
