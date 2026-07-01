-- Media relay: when a sender sends a photo, file, or voice/video message, the
-- account forwards it to the preset receiver for review. The receiver replies
-- with their answer, which the account relays back to the original sender.

alter table kw_accounts
  add column autoreply_media_relay boolean not null default false;

create table kw_media_relays (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references kw_accounts (id) on delete cascade,
  sender_chat_id text not null,
  sender_msg_id bigint,
  sender_name text,
  media_type text not null,
  caption text,
  receiver_chat_id text not null,
  forwarded_msg_id bigint,
  status text not null default 'pending',
  receiver_answer text,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create index kw_media_relays_lookup_idx
  on kw_media_relays (account_id, receiver_chat_id, status);

alter publication supabase_realtime add table kw_media_relays;

alter table kw_media_relays enable row level security;

create policy "anon read kw_media_relays"
  on kw_media_relays for select to anon using (true);
