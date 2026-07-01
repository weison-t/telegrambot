-- Suppress the eager "AI assistant / customer-service" voice (e.g. "here to
-- help", "happy to chat", "what can I do for you?"). On by default so replies
-- sound like a normal person texting, not support.

alter table kw_accounts
  add column autoreply_no_assistant_tone boolean not null default true;
