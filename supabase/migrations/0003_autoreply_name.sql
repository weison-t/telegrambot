-- Auto-responder: persona display name used when asked "what's your name".
alter table kw_accounts
  add column autoreply_name text;
