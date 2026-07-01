-- Soft-delete (archive) accounts so removing an account preserves its
-- conversation history instead of cascade-deleting kw_autoreply_messages and
-- kw_conversations. Archived accounts are hidden from active surfaces but still
-- resolve their label for attribution under Conversations.

alter table kw_accounts
  add column archived boolean not null default false;
