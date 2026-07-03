-- Broadcasting: send the same message to many Telegram users (by @username or
-- numeric id), round-robined across chosen accounts, with scheduling, read-rate
-- and respond-rate tracking, and an optional AI "on reply" automation.

create table kw_broadcasts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  message text not null,
  status text not null default 'draft',
  min_delay_s int not null default 45,
  max_delay_s int not null default 90,
  per_account_daily_limit int not null default 30,
  start_at timestamptz,
  timezone text,
  dry_run boolean not null default false,
  model text not null default 'gpt-4o-mini',
  -- On-reply automation (scoped to this broadcast's recipients only).
  reply_ai_enabled boolean not null default true,
  reply_knowledge text,
  reply_persona text,
  reply_instructions text,
  reply_link text,
  -- Denormalized counters updated by the worker for the live monitor.
  total_count int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  read_count int not null default 0,
  replied_count int not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- The round-robin sender pool for a broadcast.
create table kw_broadcast_accounts (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references kw_broadcasts (id) on delete cascade,
  account_id uuid not null references kw_accounts (id) on delete cascade,
  unique (broadcast_id, account_id)
);

-- One row per recipient with per-target delivery + engagement state.
create table kw_broadcast_targets (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references kw_broadcasts (id) on delete cascade,
  input text not null,
  kind text not null default 'username',
  account_id uuid references kw_accounts (id) on delete set null,
  telegram_user_id bigint,
  username text,
  peer_id text,
  tg_message_id bigint,
  status text not null default 'pending',
  error text,
  sent_at timestamptz,
  read_at timestamptz,
  replied_at timestamptz,
  created_at timestamptz not null default now()
);

create index kw_broadcast_targets_broadcast_idx
  on kw_broadcast_targets (broadcast_id, status);

create index kw_broadcast_targets_match_idx
  on kw_broadcast_targets (account_id, peer_id);

alter publication supabase_realtime add table kw_broadcasts;
alter publication supabase_realtime add table kw_broadcast_accounts;
alter publication supabase_realtime add table kw_broadcast_targets;

alter table kw_broadcasts enable row level security;
alter table kw_broadcast_accounts enable row level security;
alter table kw_broadcast_targets enable row level security;

create policy "anon read kw_broadcasts"
  on kw_broadcasts for select to anon using (true);

create policy "anon read kw_broadcast_accounts"
  on kw_broadcast_accounts for select to anon using (true);

create policy "anon read kw_broadcast_targets"
  on kw_broadcast_targets for select to anon using (true);
