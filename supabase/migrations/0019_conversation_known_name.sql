-- Remember the name a sender states about themselves ("hi, I'm John") so the
-- auto-reply persona can address them by name in future replies.
alter table kw_conversations
  add column if not exists known_name text;
