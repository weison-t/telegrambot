-- Capture every incoming private message in Conversations, not just replied
-- ones. Inbound-only rows have no reply, and we record the sender's identity.
alter table kw_autoreply_messages
  alter column reply drop not null;

alter table kw_autoreply_messages
  add column if not exists sender_username text,
  add column if not exists sender_tg_id text;
