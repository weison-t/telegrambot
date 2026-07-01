-- Dedicated receiver for media relays (falls back to the appointment receiver
-- when left blank).

alter table kw_accounts
  add column autoreply_media_receiver text;
