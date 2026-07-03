import { TelegramClient, Api } from "telegram";
import type { NewMessageEvent } from "telegram/events";
import { getServiceClient } from "@/lib/supabase";
import { splitIntoMessages } from "@/lib/autoreplyPrompt";
import { generateAutoReply } from "../openai";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// A recipient counts as a broadcast contact only for a while after we message
// them, so a much later unrelated DM doesn't get hijacked by broadcast logic.
const REPLY_WINDOW_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

type BroadcastForReply = {
  id: string;
  reply_ai_enabled: boolean;
  reply_knowledge: string | null;
  reply_persona: string | null;
  reply_instructions: string | null;
  reply_link: string | null;
  model: string;
};

// Find the most recent broadcast target on this account for the given peer, so a
// reply can be attributed to the broadcast that reached them.
const findTarget = async (
  accountId: string,
  senderId: string | null,
  peerId: string
): Promise<{
  targetId: string;
  repliedAt: string | null;
  broadcast: BroadcastForReply;
} | null> => {
  const supabase = getServiceClient();
  const sinceIso = new Date(Date.now() - REPLY_WINDOW_MS).toISOString();

  const idCandidates = [peerId];
  if (senderId && senderId !== peerId) idCandidates.push(senderId);

  const { data } = await supabase
    .from("kw_broadcast_targets")
    .select(
      "id, replied_at, broadcast_id, kw_broadcasts!inner(id, reply_ai_enabled, reply_knowledge, reply_persona, reply_instructions, reply_link, model)"
    )
    .eq("account_id", accountId)
    .eq("status", "sent")
    .in("peer_id", idCandidates)
    .gte("sent_at", sinceIso)
    .order("sent_at", { ascending: false })
    .limit(1);

  const row = data?.[0] as
    | {
        id: string;
        replied_at: string | null;
        kw_broadcasts:
          | BroadcastForReply
          | BroadcastForReply[];
      }
    | undefined;
  if (!row) return null;

  const broadcast = Array.isArray(row.kw_broadcasts)
    ? row.kw_broadcasts[0]
    : row.kw_broadcasts;
  if (!broadcast) return null;

  return { targetId: row.id, repliedAt: row.replied_at, broadcast };
};

// Handles a broadcast recipient's reply: records the response, and (when the
// broadcast has AI replies enabled) answers using the broadcast's product
// knowledge and optional link. Returns true if this reply was handled, so the
// caller can skip the account's normal auto-reply path.
export const maybeHandleBroadcastReply = async (
  accountId: string,
  client: TelegramClient,
  event: NewMessageEvent,
  sender: Api.User | null
): Promise<boolean> => {
  if (!event.isPrivate) return false;

  const message = event.message;
  const senderId = message.senderId ? String(message.senderId) : null;
  const peerId = message.chatId ? String(message.chatId) : senderId ?? "";
  if (!peerId) return false;

  const match = await findTarget(accountId, senderId, peerId);
  if (!match) return false;

  const supabase = getServiceClient();
  const nowIso = new Date().toISOString();

  // Record the first response (drives the respond-rate stat).
  if (!match.repliedAt) {
    await supabase
      .from("kw_broadcast_targets")
      .update({ replied_at: nowIso })
      .eq("id", match.targetId);
    const { data: b } = await supabase
      .from("kw_broadcasts")
      .select("replied_count")
      .eq("id", match.broadcast.id)
      .single();
    await supabase
      .from("kw_broadcasts")
      .update({ replied_count: (b?.replied_count ?? 0) + 1 })
      .eq("id", match.broadcast.id);
  }

  if (!match.broadcast.reply_ai_enabled) return true;

  const incomingText = message.text?.trim() ?? "";
  if (!incomingText) return true;

  const personaName =
    match.broadcast.reply_persona?.split(/[.,\n]/)[0]?.trim() ||
    sender?.firstName ||
    "me";

  const linkNote = match.broadcast.reply_link
    ? `\nWhen relevant, share this link naturally: ${match.broadcast.reply_link}`
    : "";
  const instructions = `${match.broadcast.reply_instructions ?? ""}${linkNote}`.trim();

  try {
    const reply = await generateAutoReply({
      model: match.broadcast.model || process.env.OPENAI_MODEL || "gpt-4o-mini",
      personaName,
      persona: match.broadcast.reply_persona,
      instructions: instructions || null,
      isGroup: false,
      history: [],
      incomingText,
      faq: match.broadcast.reply_knowledge,
      noAssistantTone: true,
    });
    if (!reply) return true;

    const chunks = splitIntoMessages(reply);
    const peer = sender ?? (peerId as unknown as Api.TypeEntityLike);
    for (const chunk of chunks) {
      try {
        await client.invoke(
          new Api.messages.SetTyping({
            peer,
            action: new Api.SendMessageTypingAction(),
          })
        );
      } catch {
        // ignore typing errors
      }
      await sleep(Math.min(6000, 800 + chunk.length * 40));
      try {
        await client.sendMessage(peer, { message: chunk });
      } catch (err) {
        const seconds = (err as { seconds?: number })?.seconds;
        if (typeof seconds === "number") {
          await sleep((seconds + 1) * 1000);
          await client.sendMessage(peer, { message: chunk });
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[broadcast-reply ${accountId}] reply failed:`, msg);
  }

  return true;
};

// Marks broadcast targets as read when the recipient's outbox read pointer
// advances past our sent message id (from UpdateReadHistoryOutbox).
export const markBroadcastRead = async (
  accountId: string,
  peerId: string,
  maxId: number
): Promise<void> => {
  const supabase = getServiceClient();

  const { data: targets } = await supabase
    .from("kw_broadcast_targets")
    .select("id, broadcast_id, tg_message_id")
    .eq("account_id", accountId)
    .eq("peer_id", peerId)
    .eq("status", "sent")
    .is("read_at", null);
  if (!targets || targets.length === 0) return;

  const nowIso = new Date().toISOString();
  const byBroadcast = new Map<string, number>();

  for (const t of targets) {
    if (t.tg_message_id != null && t.tg_message_id <= maxId) {
      await supabase
        .from("kw_broadcast_targets")
        .update({ read_at: nowIso })
        .eq("id", t.id);
      byBroadcast.set(
        t.broadcast_id,
        (byBroadcast.get(t.broadcast_id) ?? 0) + 1
      );
    }
  }

  for (const [broadcastId, inc] of byBroadcast) {
    const { data: b } = await supabase
      .from("kw_broadcasts")
      .select("read_count")
      .eq("id", broadcastId)
      .single();
    await supabase
      .from("kw_broadcasts")
      .update({ read_count: (b?.read_count ?? 0) + inc })
      .eq("id", broadcastId);
  }
};
