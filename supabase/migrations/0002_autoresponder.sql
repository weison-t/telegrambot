-- Auto-responder: per-account config + whitelist + reply log.

alter table kw_accounts
  add column autoreply_enabled boolean not null default false,
  add column autoreply_persona text,
  add column autoreply_instructions text,
  add column autoreply_scope text not null default 'dm_mention',
  add column autoreply_audience text not null default 'contacts',
  add column autoreply_min_delay_s int not null default 4,
  add column autoreply_max_delay_s int not null default 20,
  add column autoreply_daily_limit int not null default 50;

create table kw_autoreply_whitelist (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references kw_accounts (id) on delete cascade,
  peer text not null,
  created_at timestamptz not null default now()
);

create index kw_autoreply_whitelist_account_idx
  on kw_autoreply_whitelist (account_id);

create table kw_autoreply_messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references kw_accounts (id) on delete cascade,
  peer_id text,
  peer_name text,
  incoming text,
  reply text not null,
  created_at timestamptz not null default now()
);

create index kw_autoreply_messages_account_created_idx
  on kw_autoreply_messages (account_id, created_at);

alter publication supabase_realtime add table kw_autoreply_messages;

alter table kw_autoreply_whitelist enable row level security;
alter table kw_autoreply_messages enable row level security;

create policy "anon read kw_autoreply_whitelist"
  on kw_autoreply_whitelist for select to anon using (true);
create policy "anon read kw_autoreply_messages"
  on kw_autoreply_messages for select to anon using (true);
