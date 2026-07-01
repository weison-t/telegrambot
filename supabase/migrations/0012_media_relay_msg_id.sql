-- Store the forwarded media message id (in the receiver chat) alongside the
-- note id, so the receiver can quote EITHER the forwarded media or the note to
-- answer, and we still resolve the correct original sender.

alter table kw_media_relays
  add column media_msg_id bigint;
