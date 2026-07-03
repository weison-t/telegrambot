-- Group Scraper: extract member usernames + Telegram IDs (plus profile flags in
-- the participant list) from a supergroup the chosen account belongs to. Jobs
-- run read-only via channels.GetParticipants with a fallback to active message
-- senders when the member list is hidden or capped.

create table kw_group_scrape_jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references kw_accounts (id) on delete set null,
  group_input text not null,
  group_id text,
  group_title text,
  method text not null default 'members',
  used_fallback boolean not null default false,
  status text not null default 'pending',
  max_members int not null default 10000,
  total_count int not null default 0,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table kw_group_scrape_members (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references kw_group_scrape_jobs (id) on delete cascade,
  telegram_user_id bigint,
  username text,
  first_name text,
  last_name text,
  is_premium boolean,
  is_bot boolean,
  is_verified boolean,
  is_admin boolean,
  source text not null default 'members',
  details jsonb,
  created_at timestamptz not null default now(),
  unique (job_id, telegram_user_id)
);

create index kw_group_scrape_members_job_idx
  on kw_group_scrape_members (job_id);

alter publication supabase_realtime add table kw_group_scrape_jobs;
alter publication supabase_realtime add table kw_group_scrape_members;

alter table kw_group_scrape_jobs enable row level security;
alter table kw_group_scrape_members enable row level security;

create policy "anon read kw_group_scrape_jobs"
  on kw_group_scrape_jobs for select to anon using (true);

create policy "anon read kw_group_scrape_members"
  on kw_group_scrape_members for select to anon using (true);
