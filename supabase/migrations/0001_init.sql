-- Telegram Keyboard Warrior schema (namespaced with kw_ to share a project).

create type kw_account_status as enum (
  'new',
  'code_sent',
  'awaiting_2fa',
  'connecting',
  'online',
  'offline',
  'error'
);

create type kw_campaign_venue as enum ('group', 'pair');

create type kw_campaign_status as enum (
  'draft',
  'running',
  'paused',
  'stopped',
  'done'
);

-- Real Telegram user accounts under control.
create table kw_accounts (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  phone text not null unique,
  telegram_user_id bigint,
  username text,
  first_name text,
  -- AES-256-GCM encrypted GramJS StringSession (never plaintext).
  session_enc text,
  status kw_account_status not null default 'new',
  last_error text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

-- A configured conversation run.
create table kw_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  topic text not null,
  style text not null default 'heated debate',
  extra_instructions text,
  venue kw_campaign_venue not null default 'group',
  -- Group username/id, e.g. "@mygroup" or "-1001234567890". Null for pair mode.
  target_chat text,
  participant_count int not null default 2 check (participant_count between 2 and 12),
  status kw_campaign_status not null default 'draft',
  -- Timing / safety controls (seconds).
  min_delay_s int not null default 8,
  max_delay_s int not null default 30,
  max_messages int not null default 40,
  start_at timestamptz,
  -- When true, replies are generated + logged but NOT sent to Telegram.
  dry_run boolean not null default false,
  model text not null default 'gpt-4o-mini',
  messages_sent int not null default 0,
  created_at timestamptz not null default now()
);

-- Which accounts take part, with their AI persona.
create table kw_campaign_participants (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references kw_campaigns (id) on delete cascade,
  account_id uuid not null references kw_accounts (id) on delete cascade,
  persona_name text,
  persona_traits text,
  turn_order int not null default 0,
  unique (campaign_id, account_id)
);

-- 1-on-1 pairings (only used when venue = 'pair').
create table kw_campaign_pairs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references kw_campaigns (id) on delete cascade,
  account_a_id uuid not null references kw_accounts (id) on delete cascade,
  account_b_id uuid not null references kw_accounts (id) on delete cascade
);

-- Every generated/sent message for monitoring.
create table kw_messages (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references kw_campaigns (id) on delete cascade,
  account_id uuid references kw_accounts (id) on delete set null,
  pair_id uuid references kw_campaign_pairs (id) on delete set null,
  tg_message_id bigint,
  content text not null,
  dry_run boolean not null default false,
  created_at timestamptz not null default now()
);

create index kw_messages_campaign_created_idx on kw_messages (campaign_id, created_at);
create index kw_participants_campaign_idx on kw_campaign_participants (campaign_id);
create index kw_pairs_campaign_idx on kw_campaign_pairs (campaign_id);

-- Enable realtime for the live monitor.
alter publication supabase_realtime add table kw_messages;
alter publication supabase_realtime add table kw_campaigns;
alter publication supabase_realtime add table kw_accounts;

-- Row Level Security. The worker + Next.js API routes use the service role
-- key (bypasses RLS). The browser uses the anon key for read-only listing
-- and realtime subscriptions only.
alter table kw_accounts enable row level security;
alter table kw_campaigns enable row level security;
alter table kw_campaign_participants enable row level security;
alter table kw_campaign_pairs enable row level security;
alter table kw_messages enable row level security;

create policy "anon read kw_accounts" on kw_accounts for select to anon using (true);
create policy "anon read kw_campaigns" on kw_campaigns for select to anon using (true);
create policy "anon read kw_participants" on kw_campaign_participants for select to anon using (true);
create policy "anon read kw_pairs" on kw_campaign_pairs for select to anon using (true);
create policy "anon read kw_messages" on kw_messages for select to anon using (true);
