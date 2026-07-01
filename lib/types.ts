import type { Database } from "./database.types";

type Tables = Database["public"]["Tables"];

export type Account = Tables["kw_accounts"]["Row"];
export type AccountInsert = Tables["kw_accounts"]["Insert"];
export type AccountUpdate = Tables["kw_accounts"]["Update"];

export type Campaign = Tables["kw_campaigns"]["Row"];
export type CampaignInsert = Tables["kw_campaigns"]["Insert"];
export type CampaignUpdate = Tables["kw_campaigns"]["Update"];

export type Participant = Tables["kw_campaign_participants"]["Row"];
export type ParticipantInsert = Tables["kw_campaign_participants"]["Insert"];

export type Pair = Tables["kw_campaign_pairs"]["Row"];
export type PairInsert = Tables["kw_campaign_pairs"]["Insert"];

export type Message = Tables["kw_messages"]["Row"];
export type MessageInsert = Tables["kw_messages"]["Insert"];

export type AutoreplyMessage = Tables["kw_autoreply_messages"]["Row"];
export type AutoreplyWhitelist = Tables["kw_autoreply_whitelist"]["Row"];
export type AppointmentRequest = Tables["kw_appointment_requests"]["Row"];
export type MediaRelay = Tables["kw_media_relays"]["Row"];
export type CalendarEvent = Tables["kw_calendar_events"]["Row"];
export type CalendarReminder = Tables["kw_calendar_reminders"]["Row"];
export type Conversation = Tables["kw_conversations"]["Row"];
export type ConversationInsert = Tables["kw_conversations"]["Insert"];

export type ConversationStatus = "ongoing" | "completed";

export const CONVERSATION_STATUSES: {
  value: ConversationStatus;
  label: string;
}[] = [
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
];

export type AutoreplyScope = "dm" | "dm_mention" | "all";
export type AutoreplyAudience = "contacts" | "whitelist" | "everyone";

export const AUTOREPLY_SCOPES: { value: AutoreplyScope; label: string }[] = [
  { value: "dm", label: "Direct messages only" },
  { value: "dm_mention", label: "DMs + group @mentions/replies" },
  { value: "all", label: "DMs + all messages in groups (risky)" },
];

export const AUTOREPLY_AUDIENCES: {
  value: AutoreplyAudience;
  label: string;
}[] = [
  { value: "contacts", label: "Existing contacts only (safest)" },
  { value: "whitelist", label: "Whitelisted users only" },
  { value: "everyone", label: "Anyone (highest ban risk)" },
];

export type AutoreplyEmojiLevel = "none" | "rare" | "sometimes" | "lots";
export type AutoreplyLength = "terse" | "normal" | "chatty";
export type AutoreplyFormality = "formal" | "casual" | "slang";
export type AutoreplyLanguage =
  | "mirror"
  | "english"
  | "malay"
  | "chinese"
  | "manglish";
export type AutoreplyOffhoursBehavior = "silent" | "away_note";

export type SecurityStatus = "normal" | "suspected" | "blocked";

export const SECURITY_STATUS_LABELS: Record<SecurityStatus, string> = {
  normal: "Normal",
  suspected: "Flagged",
  blocked: "Blocked",
};

export const AUTOREPLY_TONES: string[] = [
  "friendly",
  "warm",
  "witty",
  "sarcastic",
  "flirty",
  "hype",
  "professional",
  "chill",
];

export const AUTOREPLY_EMOJI_LEVELS: {
  value: AutoreplyEmojiLevel;
  label: string;
}[] = [
  { value: "none", label: "No emojis" },
  { value: "rare", label: "Rarely" },
  { value: "sometimes", label: "Sometimes" },
  { value: "lots", label: "Lots" },
];

export const AUTOREPLY_LENGTHS: { value: AutoreplyLength; label: string }[] = [
  { value: "terse", label: "Terse (1 line)" },
  { value: "normal", label: "Normal (1-3 sentences)" },
  { value: "chatty", label: "Chatty (can be longer)" },
];

export const AUTOREPLY_FORMALITIES: {
  value: AutoreplyFormality;
  label: string;
}[] = [
  { value: "formal", label: "Formal (proper grammar)" },
  { value: "casual", label: "Casual (relaxed, contractions)" },
  { value: "slang", label: "Slang (very casual, abbreviations)" },
];

export const AUTOREPLY_LANGUAGES: {
  value: AutoreplyLanguage;
  label: string;
}[] = [
  { value: "mirror", label: "Mirror the sender" },
  { value: "english", label: "English" },
  { value: "malay", label: "Malay" },
  { value: "chinese", label: "Chinese" },
  { value: "manglish", label: "Manglish" },
];

export const AUTOREPLY_OFFHOURS_BEHAVIORS: {
  value: AutoreplyOffhoursBehavior;
  label: string;
}[] = [
  { value: "silent", label: "Stay silent" },
  { value: "away_note", label: "Send an away message (once/day)" },
];

export type AutoreplyConfig = {
  autoreply_enabled: boolean;
  autoreply_name: string;
  autoreply_persona: string;
  autoreply_instructions: string;
  autoreply_scope: AutoreplyScope;
  autoreply_audience: AutoreplyAudience;
  autoreply_min_delay_s: number;
  autoreply_max_delay_s: number;
  autoreply_daily_limit: number;
  autoreply_appointment_enabled: boolean;
  autoreply_receiver: string;
  autoreply_timezone: string;
  autoreply_reminder_recipient: string;
  autoreply_reminder_offsets: string;
  autoreply_tone: string;
  autoreply_emoji_level: AutoreplyEmojiLevel;
  autoreply_length: AutoreplyLength;
  autoreply_formality: AutoreplyFormality;
  autoreply_language: string;
  autoreply_examples: string;
  autoreply_faq: string;
  autoreply_hours_enabled: boolean;
  autoreply_active_start: string;
  autoreply_active_end: string;
  autoreply_offhours_behavior: AutoreplyOffhoursBehavior;
  autoreply_away_message: string;
  autoreply_scale_delay: boolean;
  autoreply_ask_questions: boolean;
  autoreply_match_mood: boolean;
  autoreply_avoid: string;
  autoreply_signoff: string;
  autoreply_guard_enabled: boolean;
  autoreply_alert_recipient: string;
  autoreply_no_assistant_tone: boolean;
  autoreply_media_relay: boolean;
  autoreply_media_receiver: string;
  autoreply_pricing_relay: boolean;
  whitelist: string[];
};

export type AccountStatus = Database["public"]["Enums"]["kw_account_status"];
export type CampaignStatus = Database["public"]["Enums"]["kw_campaign_status"];
export type CampaignVenue = Database["public"]["Enums"]["kw_campaign_venue"];

export const MAX_ACCOUNTS = 12;
export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 12;

export const CONVERSATION_STYLES = [
  "heated debate",
  "friendly banter",
  "sarcastic roast",
  "supportive hype squad",
  "conspiracy theorists",
  "academic discussion",
  "casual small talk",
  "passionate argument",
] as const;

export type GroupInfo = {
  id: string;
  title: string;
  username: string | null;
  type: "group" | "supergroup" | "channel";
};

export type ParticipantConfig = {
  account_id: string;
  persona_name: string;
  persona_traits: string;
  // Per-participant voice & realism controls.
  language: string;
  emoji_level: string;
  formality: string;
  msg_length: string;
  humanize: boolean;
  no_assistant_tone: boolean;
  reply_threading: boolean;
  avoid_topics: string | null;
  objective: string | null;
};

// Payload the dashboard sends to create a campaign.
export type CreateCampaignPayload = {
  name: string;
  topic: string;
  style: string;
  extra_instructions?: string;
  venue: CampaignVenue;
  target_chat?: string;
  min_delay_s: number;
  max_delay_s: number;
  max_messages: number;
  dry_run: boolean;
  model: string;
  participants: ParticipantConfig[];
  // Optional pre-scheduled launch (UTC ISO) and the timezone it was set in.
  start_at?: string | null;
  timezone?: string | null;
};
