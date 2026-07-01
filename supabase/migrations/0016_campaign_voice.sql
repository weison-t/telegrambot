-- Campaign voice & realism controls: per-campaign style and humanization knobs
-- mirroring the auto-reply module, applied across all participant personas.
alter table kw_campaigns
  add column if not exists language text not null default 'mirror',
  add column if not exists emoji_level text not null default 'sometimes',
  add column if not exists formality text not null default 'casual',
  add column if not exists msg_length text not null default 'normal',
  add column if not exists humanize boolean not null default true,
  add column if not exists no_assistant_tone boolean not null default false,
  add column if not exists reply_threading boolean not null default false,
  add column if not exists avoid_topics text,
  add column if not exists objective text;
