-- Conversations module: per-contact auto-reply override, cached AI summaries,
-- and status tags (ongoing/completed) for each auto-reply conversation.

create table kw_conversations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references kw_accounts (id) on delete cascade,
  peer_id text not null,
  peer_name text,
  -- When true, the auto-responder skips this contact entirely, overriding the
  -- account-level auto-reply configuration.
  disabled boolean not null default false,
  -- 'ongoing' | 'completed' (auto-derived from activity unless overridden).
  status text not null default 'ongoing',
  -- When the user manually sets a status, the sweeper stops auto-changing it.
  status_manual boolean not null default false,
  summary text,
  summary_updated_at timestamptz,
  -- The created_at of the last message included in the cached summary, used to
  -- detect whether new messages have arrived since the summary was generated.
  summarized_through timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, peer_id)
);

create index kw_conversations_account_peer_idx
  on kw_conversations (account_id, peer_id);

alter publication supabase_realtime add table kw_conversations;

alter table kw_conversations enable row level security;

create policy "anon read kw_conversations"
  on kw_conversations for select to anon using (true);
