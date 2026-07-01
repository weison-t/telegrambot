-- Auto-responder appointment relay: when someone asks about an appointment or
-- meeting, the account messages a preset receiver, waits for their confirmation,
-- then replies to the original sender based on that answer.

alter table kw_accounts
  add column autoreply_appointment_enabled boolean not null default false,
  add column autoreply_receiver text;

create table kw_appointment_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references kw_accounts (id) on delete cascade,
  sender_chat_id text not null,
  sender_msg_id bigint,
  sender_name text,
  question text,
  receiver_chat_id text not null,
  forwarded_msg_id bigint,
  status text not null default 'pending',
  receiver_answer text,
  reply text,
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create index kw_appointment_requests_lookup_idx
  on kw_appointment_requests (account_id, receiver_chat_id, status);

alter publication supabase_realtime add table kw_appointment_requests;

alter table kw_appointment_requests enable row level security;

create policy "anon read kw_appointment_requests"
  on kw_appointment_requests for select to anon using (true);
