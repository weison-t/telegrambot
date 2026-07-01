-- Auto-reply liveliness: structured voice/style/behavior controls, knowledge,
-- active hours, and per-contact memory.

alter table kw_accounts
  add column autoreply_tone text not null default 'friendly',
  add column autoreply_emoji_level text not null default 'sometimes',
  add column autoreply_length text not null default 'normal',
  add column autoreply_formality text not null default 'casual',
  add column autoreply_language text not null default 'mirror',
  add column autoreply_examples text,
  add column autoreply_faq text,
  add column autoreply_hours_enabled boolean not null default false,
  add column autoreply_active_start text not null default '09:00',
  add column autoreply_active_end text not null default '23:00',
  add column autoreply_offhours_behavior text not null default 'silent',
  add column autoreply_away_message text,
  add column autoreply_scale_delay boolean not null default true,
  add column autoreply_ask_questions boolean not null default false,
  add column autoreply_match_mood boolean not null default true,
  add column autoreply_avoid text,
  add column autoreply_signoff text;

-- Per-contact memory injected into the reply prompt (edited in Conversations).
alter table kw_conversations
  add column notes text;
