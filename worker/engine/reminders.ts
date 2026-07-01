import { Api, TelegramClient } from "telegram";
import { getServiceClient } from "@/lib/supabase";
import { decryptSession } from "@/lib/crypto";
import { clientManager } from "../telegram/clientManager";
import { formatLocal } from "./calendar";

const POLL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;

const resolvePeer = async (
  client: TelegramClient,
  recipient: string
): Promise<Api.TypeEntityLike> => {
  if (/^-?\d+$/.test(recipient)) {
    return client.getInputEntity(
      Number(recipient) as unknown as Api.TypeEntityLike
    );
  }
  const handle = recipient.startsWith("@") ? recipient : `@${recipient}`;
  return client.getEntity(handle);
};

const markSent = async (id: string): Promise<void> => {
  const supabase = getServiceClient();
  await supabase
    .from("kw_calendar_reminders")
    .update({ sent: true, sent_at: new Date().toISOString() })
    .eq("id", id);
};

const processDueReminders = async (): Promise<void> => {
  const supabase = getServiceClient();
  const nowIso = new Date().toISOString();

  const { data: due } = await supabase
    .from("kw_calendar_reminders")
    .select("*")
    .eq("sent", false)
    .lte("remind_at", nowIso)
    .order("remind_at", { ascending: true })
    .limit(25);
  if (!due || due.length === 0) return;

  const eventIds = [...new Set(due.map((r) => r.event_id).filter(Boolean))];
  const { data: events } = await supabase
    .from("kw_calendar_events")
    .select("*")
    .in("id", eventIds as string[]);
  const eventMap = new Map((events ?? []).map((e) => [e.id, e]));

  for (const reminder of due) {
    const event = reminder.event_id ? eventMap.get(reminder.event_id) : null;
    if (!event || event.status === "cancelled") {
      await markSent(reminder.id);
      continue;
    }
    if (!reminder.account_id) {
      await markSent(reminder.id);
      continue;
    }

    try {
      const { data: account } = await supabase
        .from("kw_accounts")
        .select("*")
        .eq("id", reminder.account_id)
        .single();
      if (!account?.session_enc) {
        // Account not logged in; retry on a later cycle.
        continue;
      }

      const client = await clientManager.getClient(
        account.id,
        decryptSession(account.session_enc)
      );
      const peer = await resolvePeer(client, reminder.recipient_chat_id);

      const when = formatLocal(event.scheduled_for, event.timezone);
      const who = event.sender_name ? ` with ${event.sender_name}` : "";
      const message = `Reminder: "${event.title}"${who} is coming up (${
        reminder.label ?? "soon"
      }). Scheduled for ${when}.`;

      await client.sendMessage(peer, { message });
      await markSent(reminder.id);
      console.log(
        `[reminders] sent ${reminder.label ?? ""} reminder for event ${event.id}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[reminders] failed reminder ${reminder.id}:`, msg);
      // Left unsent to retry next cycle.
    }
  }
};

export const startReminderScheduler = (): void => {
  if (timer) return;
  timer = setInterval(() => {
    processDueReminders().catch((err) =>
      console.error("[reminders] poll error:", err)
    );
  }, POLL_MS);
  processDueReminders().catch(() => undefined);
  console.log("[reminders] scheduler started");
};

export const stopReminderScheduler = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
};
