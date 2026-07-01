-- Campaign scheduling: a new status for pre-scheduled launches and a timezone
-- column so the scheduled wall-clock time can be displayed back to the user.
alter type kw_campaign_status add value if not exists 'scheduled';

alter table kw_campaigns add column if not exists timezone text;
