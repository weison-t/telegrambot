-- Calendar module: confirmed appointments become calendar events with reminders.

alter table kw_accounts
  add column autoreply_timezone text not null default 'Asia/Kuala_Lumpur',
  add column autoreply_reminder_recipient text,
  add column autoreply_reminder_offsets text not null default '1440,30';

-- Track the parsed meeting time + the both-sides confirmation flow.
alter table kw_appointment_requests
  add column scheduled_for timestamptz;

create table kw_calendar_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references kw_accounts (id) on delete cascade,
  request_id uuid references kw_appointment_requests (id) on delete set null,
  title text not null,
  sender_chat_id text,
  sender_name text,
  receiver_chat_id text,
  scheduled_for timestamptz not null,
  timezone text not null default 'Asia/Kuala_Lumpur',
  status text not null default 'scheduled',
  created_at timestamptz not null default now()
);

create index kw_calendar_events_account_time_idx
  on kw_calendar_events (account_id, scheduled_for);

create table kw_calendar_reminders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references kw_calendar_events (id) on delete cascade,
  account_id uuid references kw_accounts (id) on delete cascade,
  recipient_chat_id text not null,
  offset_minutes int not null,
  label text,
  remind_at timestamptz not null,
  sent boolean not null default false,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create index kw_calendar_reminders_due_idx
  on kw_calendar_reminders (sent, remind_at);

alter publication supabase_realtime add table kw_calendar_events;

alter table kw_calendar_events enable row level security;
alter table kw_calendar_reminders enable row level security;

create policy "anon read kw_calendar_events"
  on kw_calendar_events for select to anon using (true);
create policy "anon read kw_calendar_reminders"
  on kw_calendar_reminders for select to anon using (true);
