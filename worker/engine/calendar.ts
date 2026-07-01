import { DateTime } from "luxon";
import { getServiceClient } from "@/lib/supabase";
import type { Account } from "@/lib/types";

// Convert a local wall-clock string ("YYYY-MM-DDTHH:mm") in a named timezone to
// an absolute UTC ISO string.
export const localToUtcIso = (local: string, tz: string): string | null => {
  const dt = DateTime.fromISO(local, { zone: tz });
  if (!dt.isValid) return null;
  return dt.toUTC().toISO();
};

// A human-readable "now" in the given timezone, used to ground relative dates.
export const nowLocalString = (tz: string): string =>
  DateTime.now().setZone(tz).toFormat("cccc, yyyy-LL-dd HH:mm");

// Format a stored UTC ISO instant for display in the given timezone.
export const formatLocal = (iso: string, tz: string): string =>
  DateTime.fromISO(iso, { zone: "utc" })
    .setZone(tz)
    .toFormat("ccc, dd LLL yyyy 'at' HH:mm");

// Parse "1440,30" style config into a list of positive minute offsets.
export const parseOffsets = (raw: string): number[] =>
  (raw || "")
    .split(/[,\s]+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n) && n > 0);

export const offsetLabel = (minutes: number): string => {
  if (minutes % 1440 === 0) {
    const d = minutes / 1440;
    return `${d} day${d > 1 ? "s" : ""} before`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return `${h} hour${h > 1 ? "s" : ""} before`;
  }
  return `${minutes} min before`;
};

export type CreateEventParams = {
  account: Account;
  requestId: string;
  title: string;
  senderChatId: string;
  senderName: string;
  receiverChatId: string;
  scheduledForUtc: string;
};

// Record a confirmed appointment as a calendar event and queue its reminders.
export const createCalendarEvent = async (
  p: CreateEventParams
): Promise<string | null> => {
  const supabase = getServiceClient();
  const { data: event, error } = await supabase
    .from("kw_calendar_events")
    .insert({
      account_id: p.account.id,
      request_id: p.requestId,
      title: p.title,
      sender_chat_id: p.senderChatId,
      sender_name: p.senderName,
      receiver_chat_id: p.receiverChatId,
      scheduled_for: p.scheduledForUtc,
      timezone: p.account.autoreply_timezone,
      status: "scheduled",
    })
    .select("id")
    .single();
  if (error || !event) return null;

  const recipient =
    p.account.autoreply_reminder_recipient?.trim() || p.receiverChatId;
  const offsets = parseOffsets(p.account.autoreply_reminder_offsets);
  const scheduledMs = new Date(p.scheduledForUtc).getTime();
  const now = Date.now();

  const reminders = offsets
    .map((min) => ({
      event_id: event.id,
      account_id: p.account.id,
      recipient_chat_id: recipient,
      offset_minutes: min,
      label: offsetLabel(min),
      remind_at: new Date(scheduledMs - min * 60000).toISOString(),
    }))
    // Skip reminders whose time has already passed.
    .filter((r) => new Date(r.remind_at).getTime() > now);

  if (reminders.length > 0) {
    await supabase.from("kw_calendar_reminders").insert(reminders);
  }
  return event.id;
};
