export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      kw_accounts: {
        Row: {
          autoreply_alert_recipient: string | null;
          autoreply_appointment_enabled: boolean;
          autoreply_ask_questions: boolean;
          autoreply_active_end: string;
          autoreply_active_start: string;
          autoreply_audience: string;
          autoreply_avoid: string | null;
          autoreply_away_message: string | null;
          autoreply_daily_limit: number;
          autoreply_guard_enabled: boolean;
          autoreply_media_receiver: string | null;
          autoreply_media_relay: boolean;
          autoreply_no_assistant_tone: boolean;
          autoreply_pricing_relay: boolean;
          autoreply_emoji_level: string;
          autoreply_enabled: boolean;
          autoreply_examples: string | null;
          autoreply_faq: string | null;
          autoreply_formality: string;
          autoreply_hours_enabled: boolean;
          autoreply_instructions: string | null;
          autoreply_language: string;
          autoreply_length: string;
          autoreply_match_mood: boolean;
          autoreply_max_delay_s: number;
          autoreply_min_delay_s: number;
          autoreply_name: string | null;
          autoreply_offhours_behavior: string;
          autoreply_persona: string | null;
          autoreply_receiver: string | null;
          autoreply_reminder_offsets: string;
          autoreply_reminder_recipient: string | null;
          autoreply_scale_delay: boolean;
          autoreply_scope: string;
          autoreply_signoff: string | null;
          autoreply_timezone: string;
          autoreply_tone: string;
          archived: boolean;
          created_at: string;
          first_name: string | null;
          id: string;
          label: string;
          last_error: string | null;
          last_seen_at: string | null;
          phone: string;
          session_enc: string | null;
          status: Database["public"]["Enums"]["kw_account_status"];
          telegram_user_id: number | null;
          username: string | null;
        };
        Insert: {
          autoreply_alert_recipient?: string | null;
          autoreply_appointment_enabled?: boolean;
          autoreply_ask_questions?: boolean;
          autoreply_active_end?: string;
          autoreply_active_start?: string;
          autoreply_audience?: string;
          autoreply_avoid?: string | null;
          autoreply_away_message?: string | null;
          autoreply_daily_limit?: number;
          autoreply_guard_enabled?: boolean;
          autoreply_media_receiver?: string | null;
          autoreply_media_relay?: boolean;
          autoreply_no_assistant_tone?: boolean;
          autoreply_pricing_relay?: boolean;
          autoreply_emoji_level?: string;
          autoreply_enabled?: boolean;
          autoreply_examples?: string | null;
          autoreply_faq?: string | null;
          autoreply_formality?: string;
          autoreply_hours_enabled?: boolean;
          autoreply_instructions?: string | null;
          autoreply_language?: string;
          autoreply_length?: string;
          autoreply_match_mood?: boolean;
          autoreply_max_delay_s?: number;
          autoreply_min_delay_s?: number;
          autoreply_name?: string | null;
          autoreply_offhours_behavior?: string;
          autoreply_persona?: string | null;
          autoreply_receiver?: string | null;
          autoreply_reminder_offsets?: string;
          autoreply_reminder_recipient?: string | null;
          autoreply_scale_delay?: boolean;
          autoreply_scope?: string;
          autoreply_signoff?: string | null;
          autoreply_timezone?: string;
          autoreply_tone?: string;
          archived?: boolean;
          created_at?: string;
          first_name?: string | null;
          id?: string;
          label: string;
          last_error?: string | null;
          last_seen_at?: string | null;
          phone: string;
          session_enc?: string | null;
          status?: Database["public"]["Enums"]["kw_account_status"];
          telegram_user_id?: number | null;
          username?: string | null;
        };
        Update: {
          autoreply_alert_recipient?: string | null;
          autoreply_appointment_enabled?: boolean;
          autoreply_ask_questions?: boolean;
          autoreply_active_end?: string;
          autoreply_active_start?: string;
          autoreply_audience?: string;
          autoreply_avoid?: string | null;
          autoreply_away_message?: string | null;
          autoreply_daily_limit?: number;
          autoreply_guard_enabled?: boolean;
          autoreply_media_receiver?: string | null;
          autoreply_media_relay?: boolean;
          autoreply_no_assistant_tone?: boolean;
          autoreply_pricing_relay?: boolean;
          autoreply_emoji_level?: string;
          autoreply_enabled?: boolean;
          autoreply_examples?: string | null;
          autoreply_faq?: string | null;
          autoreply_formality?: string;
          autoreply_hours_enabled?: boolean;
          autoreply_instructions?: string | null;
          autoreply_language?: string;
          autoreply_length?: string;
          autoreply_match_mood?: boolean;
          autoreply_max_delay_s?: number;
          autoreply_min_delay_s?: number;
          autoreply_name?: string | null;
          autoreply_offhours_behavior?: string;
          autoreply_persona?: string | null;
          autoreply_receiver?: string | null;
          autoreply_reminder_offsets?: string;
          autoreply_reminder_recipient?: string | null;
          autoreply_scale_delay?: boolean;
          autoreply_scope?: string;
          autoreply_signoff?: string | null;
          autoreply_timezone?: string;
          autoreply_tone?: string;
          archived?: boolean;
          created_at?: string;
          first_name?: string | null;
          id?: string;
          label?: string;
          last_error?: string | null;
          last_seen_at?: string | null;
          phone?: string;
          session_enc?: string | null;
          status?: Database["public"]["Enums"]["kw_account_status"];
          telegram_user_id?: number | null;
          username?: string | null;
        };
        Relationships: [];
      };
      kw_appointment_requests: {
        Row: {
          account_id: string | null;
          answered_at: string | null;
          created_at: string;
          forwarded_msg_id: number | null;
          id: string;
          question: string | null;
          receiver_answer: string | null;
          receiver_chat_id: string;
          reply: string | null;
          scheduled_for: string | null;
          sender_chat_id: string;
          sender_msg_id: number | null;
          sender_name: string | null;
          status: string;
        };
        Insert: {
          account_id?: string | null;
          answered_at?: string | null;
          created_at?: string;
          forwarded_msg_id?: number | null;
          id?: string;
          question?: string | null;
          receiver_answer?: string | null;
          receiver_chat_id: string;
          reply?: string | null;
          scheduled_for?: string | null;
          sender_chat_id: string;
          sender_msg_id?: number | null;
          sender_name?: string | null;
          status?: string;
        };
        Update: {
          account_id?: string | null;
          answered_at?: string | null;
          created_at?: string;
          forwarded_msg_id?: number | null;
          id?: string;
          question?: string | null;
          receiver_answer?: string | null;
          receiver_chat_id?: string;
          reply?: string | null;
          scheduled_for?: string | null;
          sender_chat_id?: string;
          sender_msg_id?: number | null;
          sender_name?: string | null;
          status?: string;
        };
        Relationships: [];
      };
      kw_media_relays: {
        Row: {
          account_id: string | null;
          answered_at: string | null;
          caption: string | null;
          created_at: string;
          forwarded_msg_id: number | null;
          id: string;
          media_msg_id: number | null;
          media_type: string;
          receiver_answer: string | null;
          receiver_chat_id: string;
          sender_chat_id: string;
          sender_msg_id: number | null;
          sender_name: string | null;
          status: string;
        };
        Insert: {
          account_id?: string | null;
          answered_at?: string | null;
          caption?: string | null;
          created_at?: string;
          forwarded_msg_id?: number | null;
          id?: string;
          media_msg_id?: number | null;
          media_type: string;
          receiver_answer?: string | null;
          receiver_chat_id: string;
          sender_chat_id: string;
          sender_msg_id?: number | null;
          sender_name?: string | null;
          status?: string;
        };
        Update: {
          account_id?: string | null;
          answered_at?: string | null;
          caption?: string | null;
          created_at?: string;
          forwarded_msg_id?: number | null;
          id?: string;
          media_msg_id?: number | null;
          media_type?: string;
          receiver_answer?: string | null;
          receiver_chat_id?: string;
          sender_chat_id?: string;
          sender_msg_id?: number | null;
          sender_name?: string | null;
          status?: string;
        };
        Relationships: [];
      };
      kw_calendar_events: {
        Row: {
          account_id: string | null;
          created_at: string;
          id: string;
          receiver_chat_id: string | null;
          request_id: string | null;
          scheduled_for: string;
          sender_chat_id: string | null;
          sender_name: string | null;
          status: string;
          timezone: string;
          title: string;
        };
        Insert: {
          account_id?: string | null;
          created_at?: string;
          id?: string;
          receiver_chat_id?: string | null;
          request_id?: string | null;
          scheduled_for: string;
          sender_chat_id?: string | null;
          sender_name?: string | null;
          status?: string;
          timezone?: string;
          title: string;
        };
        Update: {
          account_id?: string | null;
          created_at?: string;
          id?: string;
          receiver_chat_id?: string | null;
          request_id?: string | null;
          scheduled_for?: string;
          sender_chat_id?: string | null;
          sender_name?: string | null;
          status?: string;
          timezone?: string;
          title?: string;
        };
        Relationships: [];
      };
      kw_calendar_reminders: {
        Row: {
          account_id: string | null;
          created_at: string;
          event_id: string | null;
          id: string;
          label: string | null;
          offset_minutes: number;
          recipient_chat_id: string;
          remind_at: string;
          sent: boolean;
          sent_at: string | null;
        };
        Insert: {
          account_id?: string | null;
          created_at?: string;
          event_id?: string | null;
          id?: string;
          label?: string | null;
          offset_minutes: number;
          recipient_chat_id: string;
          remind_at: string;
          sent?: boolean;
          sent_at?: string | null;
        };
        Update: {
          account_id?: string | null;
          created_at?: string;
          event_id?: string | null;
          id?: string;
          label?: string | null;
          offset_minutes?: number;
          recipient_chat_id?: string;
          remind_at?: string;
          sent?: boolean;
          sent_at?: string | null;
        };
        Relationships: [];
      };
      kw_conversations: {
        Row: {
          account_id: string | null;
          created_at: string;
          disabled: boolean;
          id: string;
          flagged_at: string | null;
          last_message_at: string | null;
          last_threat_reason: string | null;
          notes: string | null;
          peer_id: string;
          peer_name: string | null;
          security_status: string;
          status: string;
          status_manual: boolean;
          summarized_through: string | null;
          summary: string | null;
          summary_updated_at: string | null;
          threat_score: number;
          updated_at: string;
        };
        Insert: {
          account_id?: string | null;
          created_at?: string;
          disabled?: boolean;
          flagged_at?: string | null;
          id?: string;
          last_message_at?: string | null;
          last_threat_reason?: string | null;
          notes?: string | null;
          peer_id: string;
          peer_name?: string | null;
          security_status?: string;
          status?: string;
          status_manual?: boolean;
          summarized_through?: string | null;
          summary?: string | null;
          summary_updated_at?: string | null;
          threat_score?: number;
          updated_at?: string;
        };
        Update: {
          account_id?: string | null;
          created_at?: string;
          disabled?: boolean;
          flagged_at?: string | null;
          id?: string;
          last_message_at?: string | null;
          last_threat_reason?: string | null;
          notes?: string | null;
          peer_id?: string;
          peer_name?: string | null;
          security_status?: string;
          status?: string;
          status_manual?: boolean;
          summarized_through?: string | null;
          summary?: string | null;
          summary_updated_at?: string | null;
          threat_score?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      kw_autoreply_messages: {
        Row: {
          account_id: string | null;
          created_at: string;
          id: string;
          incoming: string | null;
          peer_id: string | null;
          peer_name: string | null;
          reply: string | null;
          sender_tg_id: string | null;
          sender_username: string | null;
        };
        Insert: {
          account_id?: string | null;
          created_at?: string;
          id?: string;
          incoming?: string | null;
          peer_id?: string | null;
          peer_name?: string | null;
          reply?: string | null;
          sender_tg_id?: string | null;
          sender_username?: string | null;
        };
        Update: {
          account_id?: string | null;
          created_at?: string;
          id?: string;
          incoming?: string | null;
          peer_id?: string | null;
          peer_name?: string | null;
          reply?: string | null;
          sender_tg_id?: string | null;
          sender_username?: string | null;
        };
        Relationships: [];
      };
      kw_autoreply_whitelist: {
        Row: {
          account_id: string;
          created_at: string;
          id: string;
          peer: string;
        };
        Insert: {
          account_id: string;
          created_at?: string;
          id?: string;
          peer: string;
        };
        Update: {
          account_id?: string;
          created_at?: string;
          id?: string;
          peer?: string;
        };
        Relationships: [];
      };
      kw_campaign_pairs: {
        Row: {
          account_a_id: string;
          account_b_id: string;
          campaign_id: string;
          id: string;
        };
        Insert: {
          account_a_id: string;
          account_b_id: string;
          campaign_id: string;
          id?: string;
        };
        Update: {
          account_a_id?: string;
          account_b_id?: string;
          campaign_id?: string;
          id?: string;
        };
        Relationships: [];
      };
      kw_campaign_participants: {
        Row: {
          account_id: string;
          avoid_topics: string | null;
          campaign_id: string;
          emoji_level: string;
          formality: string;
          humanize: boolean;
          id: string;
          language: string;
          msg_length: string;
          no_assistant_tone: boolean;
          objective: string | null;
          persona_name: string | null;
          persona_traits: string | null;
          reply_threading: boolean;
          turn_order: number;
        };
        Insert: {
          account_id: string;
          avoid_topics?: string | null;
          campaign_id: string;
          emoji_level?: string;
          formality?: string;
          humanize?: boolean;
          id?: string;
          language?: string;
          msg_length?: string;
          no_assistant_tone?: boolean;
          objective?: string | null;
          persona_name?: string | null;
          persona_traits?: string | null;
          reply_threading?: boolean;
          turn_order?: number;
        };
        Update: {
          account_id?: string;
          avoid_topics?: string | null;
          campaign_id?: string;
          emoji_level?: string;
          formality?: string;
          humanize?: boolean;
          id?: string;
          language?: string;
          msg_length?: string;
          no_assistant_tone?: boolean;
          objective?: string | null;
          persona_name?: string | null;
          persona_traits?: string | null;
          reply_threading?: boolean;
          turn_order?: number;
        };
        Relationships: [];
      };
      kw_campaigns: {
        Row: {
          created_at: string;
          dry_run: boolean;
          extra_instructions: string | null;
          id: string;
          max_delay_s: number;
          max_messages: number;
          messages_sent: number;
          min_delay_s: number;
          model: string;
          name: string;
          participant_count: number;
          start_at: string | null;
          status: Database["public"]["Enums"]["kw_campaign_status"];
          style: string;
          target_chat: string | null;
          timezone: string | null;
          topic: string;
          venue: Database["public"]["Enums"]["kw_campaign_venue"];
        };
        Insert: {
          created_at?: string;
          dry_run?: boolean;
          extra_instructions?: string | null;
          id?: string;
          max_delay_s?: number;
          max_messages?: number;
          messages_sent?: number;
          min_delay_s?: number;
          model?: string;
          name: string;
          participant_count?: number;
          start_at?: string | null;
          status?: Database["public"]["Enums"]["kw_campaign_status"];
          style?: string;
          target_chat?: string | null;
          timezone?: string | null;
          topic: string;
          venue?: Database["public"]["Enums"]["kw_campaign_venue"];
        };
        Update: {
          created_at?: string;
          dry_run?: boolean;
          extra_instructions?: string | null;
          id?: string;
          max_delay_s?: number;
          max_messages?: number;
          messages_sent?: number;
          min_delay_s?: number;
          model?: string;
          name?: string;
          participant_count?: number;
          start_at?: string | null;
          status?: Database["public"]["Enums"]["kw_campaign_status"];
          style?: string;
          target_chat?: string | null;
          timezone?: string | null;
          topic?: string;
          venue?: Database["public"]["Enums"]["kw_campaign_venue"];
        };
        Relationships: [];
      };
      kw_messages: {
        Row: {
          account_id: string | null;
          campaign_id: string;
          content: string;
          created_at: string;
          dry_run: boolean;
          id: string;
          pair_id: string | null;
          tg_message_id: number | null;
        };
        Insert: {
          account_id?: string | null;
          campaign_id: string;
          content: string;
          created_at?: string;
          dry_run?: boolean;
          id?: string;
          pair_id?: string | null;
          tg_message_id?: number | null;
        };
        Update: {
          account_id?: string | null;
          campaign_id?: string;
          content?: string;
          created_at?: string;
          dry_run?: boolean;
          id?: string;
          pair_id?: string | null;
          tg_message_id?: number | null;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: {
      kw_account_status:
        | "new"
        | "code_sent"
        | "awaiting_2fa"
        | "connecting"
        | "online"
        | "offline"
        | "error";
      kw_campaign_status:
        | "draft"
        | "scheduled"
        | "running"
        | "paused"
        | "stopped"
        | "done";
      kw_campaign_venue: "group" | "pair";
    };
    CompositeTypes: { [_ in never]: never };
  };
};
