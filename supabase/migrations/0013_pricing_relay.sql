-- Pricing relay: when a sender asks about pricing/cost, forward the question to
-- the receiver (instead of auto-replying) and relay their answer back. Reuses
-- the kw_media_relays table with media_type = 'pricing inquiry'.

alter table kw_accounts
  add column autoreply_pricing_relay boolean not null default false;
