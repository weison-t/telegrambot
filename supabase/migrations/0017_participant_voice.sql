-- Move voice & realism controls from the campaign level to each participant so
-- every selected account can have its own voice.
alter table kw_campaign_participants
  add column if not exists language text not null default 'mirror',
  add column if not exists emoji_level text not null default 'sometimes',
  add column if not exists formality text not null default 'casual',
  add column if not exists msg_length text not null default 'normal',
  add column if not exists humanize boolean not null default true,
  add column if not exists no_assistant_tone boolean not null default false,
  add column if not exists reply_threading boolean not null default false,
  add column if not exists avoid_topics text,
  add column if not exists objective text;

-- These were added in 0016 and never used in a real run; voice is now
-- per-participant.
alter table kw_campaigns
  drop column if exists language,
  drop column if exists emoji_level,
  drop column if exists formality,
  drop column if exists msg_length,
  drop column if exists humanize,
  drop column if exists no_assistant_tone,
  drop column if exists reply_threading,
  drop column if exists avoid_topics,
  drop column if exists objective;
