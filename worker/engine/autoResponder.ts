import { TelegramClient, Api } from "telegram";
import { NewMessage, NewMessageEvent } from "telegram/events";
import { DateTime } from "luxon";
import { getServiceClient } from "@/lib/supabase";
import { decryptSession } from "@/lib/crypto";
import type { Account, AppointmentRequest, MediaRelay } from "@/lib/types";
import { lengthBudget, splitIntoMessages } from "@/lib/autoreplyPrompt";
import { clientManager } from "../telegram/clientManager";
import {
  generateAutoReply,
  classifyAppointment,
  classifyAcceptance,
  classifyPricing,
  classifyThreat,
  extractAppointmentDateTime,
  generateAppointmentReply,
  type HistoryLine,
} from "../openai";
import { isEmojiOnly, pickSimilarEmoji } from "../emoji";
import {
  createCalendarEvent,
  localToUtcIso,
  nowLocalString,
  formatLocal,
} from "./calendar";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const randomDelayMs = (minS: number, maxS: number): number => {
  const min = Math.max(1, minS);
  const max = Math.max(min, maxS);
  return Math.floor((min + Math.random() * (max - min)) * 1000);
};

type Registration = {
  client: TelegramClient;
  handler: (event: NewMessageEvent) => Promise<void>;
  builder: NewMessage;
};

// The preset person an account relays appointment requests to.
type ReceiverInfo = { id: string; entity: Api.TypeEntityLike };

const OPENAI_MODEL = (): string => process.env.OPENAI_MODEL || "gpt-4o-mini";

// Resolve the configured receiver (@username or numeric id) to an entity.
const resolveReceiver = async (
  client: TelegramClient,
  raw: string
): Promise<ReceiverInfo | null> => {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    if (/^-?\d+$/.test(trimmed)) {
      await client.getDialogs({ limit: 200 }).catch(() => undefined);
      const ent = await client.getEntity(
        Number(trimmed) as unknown as Api.TypeEntityLike
      );
      return { id: String((ent as Api.User).id), entity: ent };
    }
    const handle = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
    const ent = await client.getEntity(handle);
    return { id: String((ent as Api.User).id), entity: ent };
  } catch {
    return null;
  }
};

// Resolve a stored chat id back to a sendable peer (entity is cached because
// the sender recently messaged this account).
const resolveSenderPeer = async (
  client: TelegramClient,
  chatId: string
): Promise<Api.TypeEntityLike> => {
  if (/^-?\d+$/.test(chatId)) {
    return client.getInputEntity(
      Number(chatId) as unknown as Api.TypeEntityLike
    );
  }
  return client.getInputEntity(chatId);
};

const registry = new Map<string, Registration>();
const dailyCounters = new Map<string, { date: string; count: number }>();

// Per-peer debounce queue: collects rapid bursts and replies once to the
// latest message (with full recent context) instead of dropping follow-ups.
type PendingMsg = {
  accountId: string;
  account: Account;
  client: TelegramClient;
  event: NewMessageEvent;
  isGroup: boolean;
  // All messages received from this peer during the current burst.
  texts: string[];
  sender: Api.User | null;
  chatId: string;
  receiverInfo: ReceiverInfo | null;
  mediaReceiverInfo: ReceiverInfo | null;
};

type PeerState = {
  pending: PendingMsg | null;
  inFlight: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

const peerStates = new Map<string, PeerState>();

// How long to wait for a burst to settle before replying.
const DEBOUNCE_MS = 3000;

// Cache of telegram_user_ids that are actively auto-replying, to avoid
// bot-to-bot loops. Accounts with auto-reply OFF are treated as normal users
// (they won't reply back, so there's no loop to prevent).
let controlledIds: { ids: Set<string>; ts: number } | null = null;
const getControlledIds = async (): Promise<Set<string>> => {
  if (controlledIds && Date.now() - controlledIds.ts < 60_000) {
    return controlledIds.ids;
  }
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("kw_accounts")
    .select("telegram_user_id")
    .eq("autoreply_enabled", true);
  const ids = new Set(
    (data ?? [])
      .map((r) => r.telegram_user_id)
      .filter((v): v is number => v != null)
      .map((v) => String(v))
  );
  controlledIds = { ids, ts: Date.now() };
  return ids;
};

const todayKey = (): string => new Date().toISOString().slice(0, 10);

const underDailyLimit = (accountId: string, limit: number): boolean => {
  const today = todayKey();
  const current = dailyCounters.get(accountId);
  if (!current || current.date !== today) return true;
  return current.count < limit;
};

const incrementDaily = (accountId: string): void => {
  const today = todayKey();
  const current = dailyCounters.get(accountId);
  if (!current || current.date !== today) {
    dailyCounters.set(accountId, { date: today, count: 1 });
    return;
  }
  current.count += 1;
};

export const isAutoReplyRunning = (accountId: string): boolean =>
  registry.has(accountId);

const passesScope = (
  scope: string,
  isPrivate: boolean,
  mentioned: boolean
): boolean => {
  if (isPrivate) return true;
  if (scope === "dm") return false;
  if (scope === "dm_mention") return mentioned;
  return true; // "all"
};

const passesAudience = (
  audience: string,
  sender: Api.User | null,
  whitelist: Set<string>
): boolean => {
  if (audience === "everyone") return true;
  if (audience === "contacts") return Boolean(sender?.contact);
  // whitelist
  if (!sender) return false;
  const username = sender.username?.toLowerCase();
  const id = String(sender.id);
  return (
    (username != null && whitelist.has(username)) || whitelist.has(id)
  );
};

// Per-contact override + memory: the disabled flag makes the auto-responder
// skip a peer entirely (overriding the account config), and notes are injected
// into the reply prompt as things the persona "remembers" about this person.
type ConversationMeta = {
  disabled: boolean;
  notes: string | null;
  securityStatus: string;
  threatScore: number;
};

const getConversationMeta = async (
  accountId: string,
  peerId: string
): Promise<ConversationMeta> => {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("kw_conversations")
    .select("disabled, notes, security_status, threat_score")
    .eq("account_id", accountId)
    .eq("peer_id", peerId)
    .limit(1)
    .maybeSingle();
  return {
    disabled: Boolean(data?.disabled),
    notes: data?.notes ?? null,
    securityStatus: data?.security_status ?? "normal",
    threatScore: data?.threat_score ?? 0,
  };
};

// Persists the security state for a conversation (upsert on account+peer).
const setConversationSecurity = async (
  accountId: string,
  peerId: string,
  peerName: string,
  patch: {
    security_status: string;
    threat_score: number;
    last_threat_reason: string | null;
  }
): Promise<void> => {
  const supabase = getServiceClient();
  await supabase.from("kw_conversations").upsert(
    {
      account_id: accountId,
      peer_id: peerId,
      peer_name: peerName,
      flagged_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...patch,
    },
    { onConflict: "account_id,peer_id" }
  );
};

// Cheap pre-filter so the threat classifier only runs on candidate messages
// (keeps cost near zero for normal chats).
const SUSPECT_PATTERNS: RegExp[] = [
  /\bare\s+(you|u)\s+(a\s+|an\s+)?(bot|ai|robot|human|real|chat\s?gpt|gpt|llm|machine)\b/i,
  /\bis\s+this\s+(a\s+|an\s+)?(bot|ai|robot|automated|real\s+person)\b/i,
  /\b(you('?re|\s+are)|u\s*r|ur)\s+(a\s+|an\s+)?(bot|ai|robot|chatbot|automated|not\s+real|fake)\b/i,
  /\b(sound|talk|reply|type|chat)(s|ing)?\s+like\s+(a\s+|an\s+)?(bot|ai|robot)\b/i,
  /\bprove\s+(you('?re|\s+are)|ur|u\s*r)\s+(a\s+)?human\b/i,
  /\bare\s+(you|u)\s+real\b/i,
  /\b(chatbot|chat\s?gpt|automated\s+(message|reply|response))\b/i,
];
const INJECTION_PATTERNS: RegExp[] = [
  /\bignore\s+(all\s+|any\s+)?(previous|prior|the|your)\s+(instruction|prompt|rule)/i,
  /\b(system|initial|original)\s+prompt\b/i,
  /\bwhat\s+(are|were)\s+your\s+(instruction|rule|prompt)/i,
  /\b(reveal|show|tell\s+me|repeat|print|output)\s+(your\s+)?(instruction|prompt|rules|system)/i,
  /\b(act|pretend|roleplay|behave)\s+as\b/i,
  /\byou\s+are\s+now\b/i,
  /\bdisregard\s+(all|any|the|your|previous)\b/i,
  /\bjailbreak\b/i,
  /\brepeat\s+after\s+me\b/i,
];

const isInjection = (text: string): boolean =>
  INJECTION_PATTERNS.some((re) => re.test(text));
const isThreatCandidate = (text: string): boolean =>
  isInjection(text) || SUSPECT_PATTERNS.some((re) => re.test(text));

// Returns the threat level for a message, confirming heuristic hits with the
// classifier (which can downgrade false positives). null = no threat.
const detectThreat = async (
  text: string
): Promise<{ level: "suspect" | "serious"; reason: string } | null> => {
  if (!isThreatCandidate(text)) return null;
  const fallback: "suspect" | "serious" = isInjection(text)
    ? "serious"
    : "suspect";
  try {
    const ai = await classifyThreat(OPENAI_MODEL(), text);
    if (ai.level === "none") return null;
    return { level: ai.level, reason: ai.reason || "pattern match" };
  } catch {
    return { level: fallback, reason: "pattern match" };
  }
};

// Resolves who to alert about a security event, falling back through the
// reminder recipient and appointment receiver.
const notifyAlert = async (
  account: Account,
  client: TelegramClient,
  kind: "suspected" | "blocked",
  info: { peerName: string; chatId: string; reason: string; sample: string }
): Promise<void> => {
  const raw =
    account.autoreply_alert_recipient?.trim() ||
    account.autoreply_reminder_recipient?.trim() ||
    account.autoreply_receiver?.trim() ||
    "";
  if (!raw) {
    console.warn(
      `[guard ${account.id}] threat from ${info.chatId} but no alert recipient configured`
    );
    return;
  }
  const recipient = await resolveReceiver(client, raw);
  if (!recipient) {
    console.warn(`[guard ${account.id}] could not resolve alert recipient`);
    return;
  }
  const header =
    kind === "blocked"
      ? `[Security] Auto-reply PAUSED for ${info.peerName} (${info.chatId}).`
      : `[Security] Possible bot-probing/exploit from ${info.peerName} (${info.chatId}). Replies slowed.`;
  const footer =
    kind === "blocked"
      ? `Clear the flag in the dashboard (Conversations) to resume auto-replies.`
      : `Keeping an eye on it.`;
  const message = [
    header,
    info.reason ? `Reason: ${info.reason}` : "",
    `Their message: "${info.sample.slice(0, 280)}"`,
    ``,
    footer,
  ]
    .filter(Boolean)
    .join("\n");
  try {
    await client.sendMessage(recipient.entity, { message });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[guard ${account.id}] alert send failed:`, msg);
  }
};

// Parse "HH:MM" into minutes since midnight; returns null when malformed.
const parseTimeMinutes = (raw: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
};

// Whether the account is currently within its configured active hours (in the
// account's timezone). Handles overnight windows (e.g. 22:00 -> 06:00).
const isWithinActiveHours = (account: Account): boolean => {
  if (!account.autoreply_hours_enabled) return true;
  const start = parseTimeMinutes(account.autoreply_active_start);
  const end = parseTimeMinutes(account.autoreply_active_end);
  if (start == null || end == null || start === end) return true;
  const now = DateTime.now().setZone(account.autoreply_timezone);
  const cur = now.hour * 60 + now.minute;
  if (start < end) return cur >= start && cur < end;
  // Overnight window wraps past midnight.
  return cur >= start || cur < end;
};

// In-memory dedupe so an away note is sent at most once per peer per local day.
const awayNotes = new Map<string, string>();
const shouldSendAwayNote = (account: Account, peerKey: string): boolean => {
  const day = DateTime.now()
    .setZone(account.autoreply_timezone)
    .toFormat("yyyy-LL-dd");
  if (awayNotes.get(peerKey) === day) return false;
  awayNotes.set(peerKey, day);
  return true;
};

// Sent to a relay receiver (at most once per day) when they reply without
// quoting, so they understand why nothing was relayed.
const QUOTE_HINT =
  "Heads up: to relay your answer to the right person, please reply by QUOTING the specific forwarded message (swipe to reply, or hold the message and pick Reply). Plain replies are ignored.";
const quoteHints = new Map<string, string>();
const shouldSendQuoteHint = (account: Account, receiverKey: string): boolean => {
  const day = DateTime.now()
    .setZone(account.autoreply_timezone)
    .toFormat("yyyy-LL-dd");
  if (quoteHints.get(receiverKey) === day) return false;
  quoteHints.set(receiverKey, day);
  return true;
};

// Computes a human-like delay before a chunk, optionally scaled by length so a
// longer message takes longer to "type".
const chunkDelayMs = (
  account: Account,
  text: string,
  isFirst: boolean
): number => {
  const base = isFirst
    ? randomDelayMs(account.autoreply_min_delay_s, account.autoreply_max_delay_s)
    : randomDelayMs(1, 3);
  if (!account.autoreply_scale_delay) return base;
  return base + Math.min(text.length * 40, 8000);
};

// Logs an outbound auto-reply as its own row. Inbound messages are captured
// separately (see captureIncoming), so we never store the incoming text here.
const logReply = async (
  accountId: string,
  peerId: string,
  peerName: string,
  reply: string
): Promise<void> => {
  const supabase = getServiceClient();
  await supabase.from("kw_autoreply_messages").insert({
    account_id: accountId,
    peer_id: peerId,
    peer_name: peerName,
    incoming: null,
    reply,
  });
};

// Records every incoming private message (text or a media placeholder) so it
// shows up in Conversations even when no auto-reply is sent. Skips our own
// controlled accounts and non-private chats. The reply column stays null.
const captureIncoming = async (
  accountId: string,
  event: NewMessageEvent,
  sender: Api.User | null
): Promise<void> => {
  if (!event.isPrivate) return;

  const message = event.message;
  const senderId = message.senderId ? String(message.senderId) : null;
  if (senderId) {
    const controlled = await getControlledIds();
    if (controlled.has(senderId)) return;
  }

  const peerId = message.chatId ? String(message.chatId) : senderId ?? "?";
  const text = message.text?.trim() ?? "";
  const mediaType = getRelayMediaType(message);
  const incoming = text || (mediaType ? `[${mediaType}]` : message.media ? "[media]" : "");
  if (!incoming) return;

  const username = sender?.username ?? null;
  const peerName = sender?.firstName || (username ? `@${username}` : peerId);
  const nowIso = new Date().toISOString();

  const supabase = getServiceClient();
  await supabase.from("kw_autoreply_messages").insert({
    account_id: accountId,
    peer_id: peerId,
    peer_name: peerName,
    incoming,
    reply: null,
    sender_username: username,
    sender_tg_id: senderId,
  });
  // Keep the conversation row fresh without disturbing its other fields
  // (disabled override, notes, security status).
  await supabase.from("kw_conversations").upsert(
    {
      account_id: accountId,
      peer_id: peerId,
      peer_name: peerName,
      last_message_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "account_id,peer_id" }
  );
};

// Sends one or more chunks to a peer with typing indicators and human-like
// delays, retrying once on FloodWait. Returns nothing.
const sendChunks = async (
  client: TelegramClient,
  peer: Api.TypeEntityLike,
  chunks: string[],
  account: Account,
  replyToFirstId?: number
): Promise<void> => {
  for (let i = 0; i < chunks.length; i += 1) {
    const isFirst = i === 0;
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
    await sleep(chunkDelayMs(account, chunks[i], isFirst));
    try {
      await client.sendMessage(peer, {
        message: chunks[i],
        replyTo: isFirst ? replyToFirstId : undefined,
      });
    } catch (err) {
      const seconds = (err as { seconds?: number })?.seconds;
      if (typeof seconds === "number") {
        await sleep((seconds + 1) * 1000);
        await client.sendMessage(peer, { message: chunks[i] });
      } else {
        throw err;
      }
    }
  }
};

// Relays an appointment request to the preset receiver and records it as
// pending. The original sender is intentionally not answered yet. When
// `existingRequestId` is given, the same request is reused (a re-negotiation)
// instead of inserting a new one.
const relayAppointment = async (params: {
  accountId: string;
  client: TelegramClient;
  receiverInfo: ReceiverInfo;
  incomingText: string;
  summary: string;
  senderName: string;
  chatId: string;
  senderMsgId: number;
  existingRequestId?: string;
}): Promise<void> => {
  const {
    accountId,
    client,
    receiverInfo,
    incomingText,
    summary,
    senderName,
    chatId,
    senderMsgId,
    existingRequestId,
  } = params;

  const revised = Boolean(existingRequestId);
  const relayText = [
    revised
      ? `${senderName} proposed a different time:`
      : `New appointment request from ${senderName}:`,
    `"${incomingText}"`,
    summary ? `(${summary})` : "",
    ``,
    `Reply to this message to confirm or suggest another time, and I'll pass it on.`,
  ]
    .filter(Boolean)
    .join("\n");

  const sent = (await client.sendMessage(receiverInfo.entity, {
    message: relayText,
  })) as Api.Message;

  const supabase = getServiceClient();
  if (existingRequestId) {
    // Re-open the same request for a fresh round of confirmation.
    await supabase
      .from("kw_appointment_requests")
      .update({
        question: incomingText,
        sender_msg_id: senderMsgId,
        forwarded_msg_id: sent?.id ?? null,
        receiver_answer: null,
        reply: null,
        scheduled_for: null,
        status: "pending",
      })
      .eq("id", existingRequestId);
  } else {
    await supabase.from("kw_appointment_requests").insert({
      account_id: accountId,
      sender_chat_id: chatId,
      sender_msg_id: senderMsgId,
      sender_name: senderName,
      question: incomingText,
      receiver_chat_id: receiverInfo.id,
      forwarded_msg_id: sent?.id ?? null,
      status: "pending",
    });
  }
  console.log(
    `[autoreply ${accountId}] ${
      revised ? "re-relayed" : "relayed"
    } appointment to receiver ${receiverInfo.id}`
  );
};

// Handles a confirmation from the receiver: matches it to a pending request
// (by reply-to, else the latest), replies to the original sender based on the
// decision, and marks the request answered. Returns true if it matched.
const handleReceiverAnswer = async (
  accountId: string,
  account: Account,
  client: TelegramClient,
  event: NewMessageEvent,
  answerText: string
): Promise<boolean> => {
  const message = event.message;
  const receiverChatId = message.chatId
    ? String(message.chatId)
    : String(message.senderId);
  const replyHeader = message.replyTo as Api.MessageReplyHeader | undefined;
  const replyToId = replyHeader?.replyToMsgId ?? null;
  // The receiver must quote the relayed request so we reply to the right
  // sender; a bare (non-quoted) message is never matched here.
  if (replyToId == null) return false;

  const supabase = getServiceClient();

  const { data } = await supabase
    .from("kw_appointment_requests")
    .select("*")
    .eq("account_id", accountId)
    .eq("receiver_chat_id", receiverChatId)
    .eq("forwarded_msg_id", replyToId)
    .eq("status", "pending")
    .limit(1);
  const request: AppointmentRequest | null = data?.[0] ?? null;
  if (!request) return false;

  const personaName =
    account.autoreply_name?.trim() ||
    account.first_name ||
    account.username ||
    account.label;

  const reply = await generateAppointmentReply({
    model: OPENAI_MODEL(),
    personaName,
    persona: account.autoreply_persona,
    instructions: account.autoreply_instructions,
    question: request.question ?? "",
    receiverAnswer: answerText,
  });

  if (reply) {
    try {
      const senderPeer = await resolveSenderPeer(
        client,
        request.sender_chat_id
      );
      const chunks = splitIntoMessages(reply);
      await sendChunks(
        client,
        senderPeer,
        chunks,
        account,
        request.sender_msg_id ? Number(request.sender_msg_id) : undefined
      );
      incrementDaily(accountId);
      await logReply(
        accountId,
        request.sender_chat_id,
        request.sender_name ?? request.sender_chat_id,
        chunks.join("\n")
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[autoreply ${accountId}] appointment reply failed:`, msg);
    }
  }

  // Try to resolve a concrete meeting time now so it's ready when the sender
  // accepts. Stored on the request; the calendar event is created on acceptance.
  let scheduledForUtc: string | null = null;
  const local = await extractAppointmentDateTime({
    model: OPENAI_MODEL(),
    timezone: account.autoreply_timezone,
    nowLocal: nowLocalString(account.autoreply_timezone),
    question: request.question ?? "",
    receiverAnswer: answerText,
  });
  if (local) scheduledForUtc = localToUtcIso(local, account.autoreply_timezone);

  await supabase
    .from("kw_appointment_requests")
    .update({
      status: "awaiting_sender",
      receiver_answer: answerText,
      reply: reply || null,
      scheduled_for: scheduledForUtc,
      answered_at: new Date().toISOString(),
    })
    .eq("id", request.id);

  return true;
};

// Finalizes a both-sides-confirmed appointment: confirms to the sender, records
// the calendar event with reminders, and marks the request confirmed.
const finalizeAppointment = async (p: {
  account: Account;
  client: TelegramClient;
  inputChat: Api.TypeEntityLike;
  messageId: number;
  isGroup: boolean;
  request: AppointmentRequest;
  senderAck: string;
  sender: Api.User | null;
  chatId: string;
}): Promise<void> => {
  const { account, client, inputChat, messageId, isGroup, request, senderAck, sender, chatId } =
    p;

  let scheduledForUtc = request.scheduled_for;
  if (!scheduledForUtc) {
    const local = await extractAppointmentDateTime({
      model: OPENAI_MODEL(),
      timezone: account.autoreply_timezone,
      nowLocal: nowLocalString(account.autoreply_timezone),
      question: request.question ?? "",
      receiverAnswer: request.receiver_answer ?? "",
      senderAck,
    });
    if (local) scheduledForUtc = localToUtcIso(local, account.autoreply_timezone);
  }

  const when = scheduledForUtc
    ? formatLocal(scheduledForUtc, account.autoreply_timezone)
    : null;
  const confirmMsg = when
    ? `Perfect, locking it in for ${when}. See you then!`
    : `Perfect, it's all set. See you then!`;

  try {
    await sendChunks(
      client,
      inputChat,
      [confirmMsg],
      account,
      isGroup ? messageId : undefined
    );
    incrementDaily(account.id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[autoreply ${account.id}] confirm send failed:`, msg);
  }

  if (scheduledForUtc) {
    const senderName = request.sender_name || sender?.firstName || chatId;
    const question = request.question ?? "";
    const title = question
      ? `Meeting: ${question.slice(0, 60)}`
      : "Appointment";
    await createCalendarEvent({
      account,
      requestId: request.id,
      title,
      senderChatId: request.sender_chat_id,
      senderName,
      receiverChatId: request.receiver_chat_id,
      scheduledForUtc,
    });
  }

  const supabase = getServiceClient();
  await supabase
    .from("kw_appointment_requests")
    .update({
      status: "confirmed",
      scheduled_for: scheduledForUtc,
      answered_at: new Date().toISOString(),
    })
    .eq("id", request.id);

  await logReply(account.id, chatId, request.sender_name ?? chatId, confirmMsg);
};

// Returns a human label for a relay-worthy media message, or null if there is
// nothing to relay (plain text, sticker, link preview, etc.).
const getRelayMediaType = (msg: Api.Message): string | null => {
  if (msg.photo) return "photo";
  if (msg.voice) return "voice message";
  if (msg.videoNote) return "video note";
  if (msg.video) return "video";
  if (msg.audio) return "audio";
  if (msg.document) return "file";
  return null;
};

// Forwards a sender's photo/file/voice to the preset receiver for review and
// records the relay so the receiver's reply can be sent back. Returns true if
// the message was handled as a media relay.
const handleMediaRelay = async (
  accountId: string,
  account: Account,
  client: TelegramClient,
  whitelist: Set<string>,
  mediaReceiverInfo: ReceiverInfo | null,
  event: NewMessageEvent
): Promise<boolean> => {
  if (!account.autoreply_media_relay || !mediaReceiverInfo) return false;
  if (!event.isPrivate) return false; // only relay 1:1 DMs

  const message = event.message;
  const mediaType = getRelayMediaType(message);
  if (!mediaType) return false;

  const senderId = message.senderId ? String(message.senderId) : null;
  // Loop prevention: never relay media from another account we control.
  if (senderId) {
    const controlled = await getControlledIds();
    if (controlled.has(senderId)) return false;
  }

  const sender = (await message.getSender()) as Api.User | null;
  if (!passesAudience(account.autoreply_audience, sender, whitelist)) return false;

  const chatId = message.chatId ? String(message.chatId) : senderId ?? "?";

  const convMeta = await getConversationMeta(accountId, chatId);
  if (convMeta.disabled) return false;
  if (account.autoreply_guard_enabled && convMeta.securityStatus === "blocked") {
    return false;
  }

  const senderName =
    sender?.firstName || (sender?.username ? `@${sender.username}` : chatId);
  const caption = message.text?.trim() ?? "";

  // Forward the actual media so the receiver can view it.
  let forwardedId: number | null = null;
  try {
    const fromPeer = await message.getInputChat();
    if (fromPeer) {
      const res = await client.forwardMessages(mediaReceiverInfo.entity, {
        messages: [message.id],
        fromPeer,
      });
      const arr = res as unknown as Api.Message[];
      forwardedId = Array.isArray(arr) ? arr[0]?.id ?? null : null;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[media ${accountId}] forward failed:`, msg);
  }

  const noteText = [
    `${senderName} sent a ${mediaType}${
      caption ? ` with: "${caption}"` : ""
    }.`,
    `Reply by QUOTING this message (or the forwarded one above) with your answer and I'll relay it to ${senderName}.`,
  ].join("\n");

  let noteId: number | null = null;
  try {
    const note = (await client.sendMessage(mediaReceiverInfo.entity, {
      message: noteText,
    })) as Api.Message;
    noteId = note?.id ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[media ${accountId}] relay note failed:`, msg);
    return false;
  }

  const supabase = getServiceClient();
  await supabase.from("kw_media_relays").insert({
    account_id: accountId,
    sender_chat_id: chatId,
    sender_msg_id: message.id,
    sender_name: senderName,
    media_type: mediaType,
    caption: caption || null,
    receiver_chat_id: mediaReceiverInfo.id,
    // Store both quotable anchors: the note (what they're told to reply to) and
    // the forwarded media itself, so quoting either resolves this sender.
    forwarded_msg_id: noteId,
    media_msg_id: forwardedId,
    status: "pending",
  });

  // Stay silent to the sender until the receiver responds; their answer is then
  // relayed back via handleMediaRelayAnswer.
  console.log(
    `[media ${accountId}] relayed ${mediaType} from ${chatId} to receiver ${mediaReceiverInfo.id}`
  );
  return true;
};

// When a sender quotes an attachment they already sent (now a pending media
// relay) to add more info, forward that text to the receiver as extra context
// for the same item and stay silent - instead of replying "send it over again".
// Returns true if the message was handled as relay follow-up.
const handleMediaRelayFollowup = async (
  accountId: string,
  account: Account,
  client: TelegramClient,
  whitelist: Set<string>,
  mediaReceiverInfo: ReceiverInfo | null,
  event: NewMessageEvent
): Promise<boolean> => {
  if (!account.autoreply_media_relay || !mediaReceiverInfo) return false;
  if (!event.isPrivate) return false;

  const message = event.message;
  const incomingText = message.text?.trim() ?? "";
  if (!incomingText) return false;

  const replyHeader = message.replyTo as Api.MessageReplyHeader | undefined;
  const replyToId = replyHeader?.replyToMsgId ?? null;
  if (replyToId == null) return false;

  const senderId = message.senderId ? String(message.senderId) : null;
  // Loop prevention: never relay follow-ups from another auto-replying account.
  if (senderId) {
    const controlled = await getControlledIds();
    if (controlled.has(senderId)) return false;
  }

  const sender = (await message.getSender()) as Api.User | null;
  if (!passesAudience(account.autoreply_audience, sender, whitelist)) return false;

  const chatId = message.chatId ? String(message.chatId) : senderId ?? "?";

  const convMeta = await getConversationMeta(accountId, chatId);
  if (convMeta.disabled) return false;
  if (account.autoreply_guard_enabled && convMeta.securityStatus === "blocked") {
    return false;
  }

  const supabase = getServiceClient();
  // Find the pending relay this quote refers to (matched by the attachment's
  // original message id in the sender chat). Pricing relays are not attachments.
  const { data } = await supabase
    .from("kw_media_relays")
    .select("*")
    .eq("account_id", accountId)
    .eq("sender_chat_id", chatId)
    .eq("sender_msg_id", replyToId)
    .eq("status", "pending")
    .neq("media_type", PRICING_MEDIA_TYPE)
    .order("created_at", { ascending: false })
    .limit(1);
  const relay: MediaRelay | null = data?.[0] ?? null;
  if (!relay) return false;

  const senderName =
    sender?.firstName || (sender?.username ? `@${sender.username}` : chatId);

  // Forward the added context to the receiver, quoting the ORIGINAL relay note
  // so they still answer via the anchor that handleMediaRelayAnswer matches.
  try {
    await client.sendMessage(mediaReceiverInfo.entity, {
      message: `${senderName} added about the ${relay.media_type}: "${incomingText}"`,
      replyTo: relay.forwarded_msg_id ?? relay.media_msg_id ?? undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[media ${accountId}] follow-up relay failed:`, msg);
    return false;
  }

  const newCaption = [relay.caption, incomingText].filter(Boolean).join(" | ");
  await supabase
    .from("kw_media_relays")
    .update({ caption: newCaption })
    .eq("id", relay.id);

  console.log(
    `[media ${accountId}] forwarded follow-up context from ${chatId} to receiver ${mediaReceiverInfo.id}`
  );
  return true;
};

// Forwards a sender's pricing question to the receiver for review instead of
// auto-replying. Reuses kw_media_relays (media_type 'pricing inquiry') so the
// receiver's quoted answer is relayed back via handleMediaRelayAnswer.
const PRICING_MEDIA_TYPE = "pricing inquiry";
const relayPricing = async (params: {
  accountId: string;
  client: TelegramClient;
  mediaReceiverInfo: ReceiverInfo;
  question: string;
  summary: string;
  senderName: string;
  chatId: string;
  senderMsgId: number;
}): Promise<void> => {
  const {
    accountId,
    client,
    mediaReceiverInfo,
    question,
    summary,
    senderName,
    chatId,
    senderMsgId,
  } = params;

  const supabase = getServiceClient();

  // Avoid spamming the receiver: if a pricing question from this sender is
  // already pending, don't relay another.
  const { data: existing } = await supabase
    .from("kw_media_relays")
    .select("id")
    .eq("account_id", accountId)
    .eq("sender_chat_id", chatId)
    .eq("media_type", PRICING_MEDIA_TYPE)
    .eq("status", "pending")
    .limit(1);
  if (existing && existing.length > 0) {
    console.log(
      `[pricing ${accountId}] pending pricing relay already exists for ${chatId}; skipping`
    );
    return;
  }

  const noteText = [
    `${senderName} is asking about pricing: "${question}"${
      summary ? ` (${summary})` : ""
    }.`,
    `Reply by QUOTING this message with your answer and I'll relay it to ${senderName}.`,
  ].join("\n");

  let noteId: number | null = null;
  try {
    const note = (await client.sendMessage(mediaReceiverInfo.entity, {
      message: noteText,
    })) as Api.Message;
    noteId = note?.id ?? null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[pricing ${accountId}] relay note failed:`, msg);
    return;
  }

  await supabase.from("kw_media_relays").insert({
    account_id: accountId,
    sender_chat_id: chatId,
    sender_msg_id: senderMsgId,
    sender_name: senderName,
    media_type: PRICING_MEDIA_TYPE,
    caption: question,
    receiver_chat_id: mediaReceiverInfo.id,
    forwarded_msg_id: noteId,
    status: "pending",
  });

  console.log(
    `[pricing ${accountId}] relayed pricing question from ${chatId} to receiver ${mediaReceiverInfo.id}`
  );
};

// Handles the receiver's reply to a media relay. The receiver MUST quote the
// forwarded note or media so we can resolve the exact original sender; without
// a quote (or a matching one) this returns false and nothing is relayed.
const handleMediaRelayAnswer = async (
  accountId: string,
  account: Account,
  client: TelegramClient,
  event: NewMessageEvent,
  answerText: string
): Promise<boolean> => {
  const message = event.message;
  const receiverChatId = message.chatId
    ? String(message.chatId)
    : String(message.senderId);
  const replyHeader = message.replyTo as Api.MessageReplyHeader | undefined;
  const replyToId = replyHeader?.replyToMsgId ?? null;
  if (replyToId == null) return false;

  const supabase = getServiceClient();

  // Quoting either the note (forwarded_msg_id) or the forwarded media
  // (media_msg_id) resolves the same pending relay.
  const { data } = await supabase
    .from("kw_media_relays")
    .select("*")
    .eq("account_id", accountId)
    .eq("receiver_chat_id", receiverChatId)
    .eq("status", "pending")
    .or(`forwarded_msg_id.eq.${replyToId},media_msg_id.eq.${replyToId}`)
    .limit(1);
  const relay: MediaRelay | null = data?.[0] ?? null;
  if (!relay) return false;

  try {
    const senderPeer = await resolveSenderPeer(client, relay.sender_chat_id);
    const chunks = splitIntoMessages(answerText);
    await sendChunks(
      client,
      senderPeer,
      chunks,
      account,
      relay.sender_msg_id ? Number(relay.sender_msg_id) : undefined
    );
    incrementDaily(accountId);
    await logReply(
      accountId,
      relay.sender_chat_id,
      relay.sender_name ?? relay.sender_chat_id,
      chunks.join("\n")
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[media ${accountId}] relay-back failed:`, msg);
  }

  await supabase
    .from("kw_media_relays")
    .update({
      status: "relayed",
      receiver_answer: answerText,
      answered_at: new Date().toISOString(),
    })
    .eq("id", relay.id);

  return true;
};

// Receives an incoming message, applies cheap filters, and enqueues it for a
// debounced reply (latest message in a burst wins).
const handleEvent = async (
  accountId: string,
  account: Account,
  client: TelegramClient,
  whitelist: Set<string>,
  receiverInfo: ReceiverInfo | null,
  mediaReceiverInfo: ReceiverInfo | null,
  event: NewMessageEvent,
  // When false, the account's auto-reply is off: we only capture the message.
  autoReplyActive: boolean
): Promise<void> => {
  const message = event.message;
  if (message.out) return;

  const incomingText = message.text?.trim() ?? "";
  const senderId = message.senderId ? String(message.senderId) : null;

  // Receiver path: any private message from a preset receiver is treated as a
  // relay answer and never auto-replied to. The receiver must QUOTE the relayed
  // message so we resolve the correct sender; otherwise we send a one-time hint
  // and stop (nothing is relayed).
  const fromApptReceiver = Boolean(
    receiverInfo && senderId === receiverInfo.id
  );
  const fromMediaReceiver = Boolean(
    mediaReceiverInfo && senderId === mediaReceiverInfo.id
  );
  if ((fromApptReceiver || fromMediaReceiver) && Boolean(event.isPrivate)) {
    const replyHeader = message.replyTo as Api.MessageReplyHeader | undefined;
    const hasQuote = replyHeader?.replyToMsgId != null;

    if (hasQuote && incomingText) {
      if (fromApptReceiver) {
        const handledAppt = await handleReceiverAnswer(
          accountId,
          account,
          client,
          event,
          incomingText
        );
        if (handledAppt) return;
      }
      if (fromMediaReceiver) {
        const handledMedia = await handleMediaRelayAnswer(
          accountId,
          account,
          client,
          event,
          incomingText
        );
        if (handledMedia) return;
      }
      // Quoted but matched nothing (likely already answered): stay silent.
      return;
    }

    // No quote: remind the receiver to quote, at most once per day.
    if (!hasQuote) {
      const receiverChatId = message.chatId
        ? String(message.chatId)
        : senderId ?? "?";
      if (shouldSendQuoteHint(account, `${accountId}:${receiverChatId}`)) {
        try {
          const inputChat = await message.getInputChat();
          if (inputChat) await sendChunks(client, inputChat, [QUOTE_HINT], account);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[relay ${accountId}] quote hint failed:`, msg);
        }
      }
    }
    // Receiver messages never fall through to a normal auto-reply.
    return;
  }

  // Capture every incoming private message (even when we won't auto-reply) so
  // it appears in Conversations. Resolve the sender once and reuse it below.
  const captureSender = event.isPrivate
    ? ((await message.getSender()) as Api.User | null)
    : null;
  await captureIncoming(accountId, event, captureSender);

  // Auto-reply turned off for this account: capture only, nothing else.
  if (!autoReplyActive) return;

  // Media relay: forward a sender's photo/file/voice to the media receiver.
  if (
    await handleMediaRelay(
      accountId,
      account,
      client,
      whitelist,
      mediaReceiverInfo,
      event
    )
  ) {
    return;
  }

  // Media relay follow-up: a text quoting an already-relayed attachment is
  // forwarded to the receiver as added context (instead of a clueless reply).
  if (
    await handleMediaRelayFollowup(
      accountId,
      account,
      client,
      whitelist,
      mediaReceiverInfo,
      event
    )
  ) {
    return;
  }

  // Everything below needs text to work with.
  if (!incomingText) return;

  const isPrivate = Boolean(event.isPrivate);
  const isGroup = Boolean(event.isGroup);
  const mentioned = Boolean(message.mentioned);

  if (!passesScope(account.autoreply_scope, isPrivate, mentioned)) return;

  // Loop prevention: never reply to another account we control.
  if (senderId) {
    const controlled = await getControlledIds();
    if (controlled.has(senderId)) return;
  }

  const sender =
    captureSender ?? ((await message.getSender()) as Api.User | null);
  if (!passesAudience(account.autoreply_audience, sender, whitelist)) return;

  const chatId = message.chatId ? String(message.chatId) : senderId ?? "?";
  const key = `${accountId}:${chatId}`;

  const state: PeerState =
    peerStates.get(key) ?? { pending: null, inFlight: false, timer: null };
  // Accumulate the whole burst; the reply is generated from all of them at once.
  if (state.pending) {
    state.pending.texts.push(incomingText);
    state.pending.event = event;
    state.pending.sender = sender;
  } else {
    state.pending = {
      accountId,
      account,
      client,
      event,
      isGroup,
      texts: [incomingText],
      sender,
      chatId,
      receiverInfo,
      mediaReceiverInfo,
    };
  }
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    void maybeProcess(key);
  }, DEBOUNCE_MS);
  peerStates.set(key, state);
};

// Processes a peer's pending message if one is queued and nothing is in flight.
const maybeProcess = async (key: string): Promise<void> => {
  const state = peerStates.get(key);
  if (!state || state.inFlight || !state.pending) return;

  const pending = state.pending;
  state.pending = null;
  state.inFlight = true;

  try {
    await processPending(pending);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[autoreply ${pending.accountId}] reply error:`, message);
  } finally {
    state.inFlight = false;
    // If new messages arrived while we were replying, handle them next.
    if (state.pending && !state.timer) {
      state.timer = setTimeout(() => {
        state.timer = null;
        void maybeProcess(key);
      }, DEBOUNCE_MS);
    }
  }
};

const processPending = async (pending: PendingMsg): Promise<void> => {
  const {
    accountId,
    account,
    client,
    event,
    isGroup,
    texts,
    sender,
    chatId,
    receiverInfo,
    mediaReceiverInfo,
  } = pending;

  // Consolidate the whole burst into one message to understand before replying.
  const incomingText = texts.map((t) => t.trim()).filter(Boolean).join("\n");
  if (!incomingText) return;

  // Per-contact override beats the account-level config: stay silent. Notes are
  // reused below as the persona's memory of this contact.
  const convMeta = await getConversationMeta(accountId, chatId);
  if (convMeta.disabled) {
    console.log(
      `[autoreply ${accountId}] auto-reply disabled for ${chatId}; skipping`
    );
    return;
  }

  // A blocked conversation stays paused until the dashboard user clears the
  // flag (which resets security_status to 'normal').
  if (account.autoreply_guard_enabled && convMeta.securityStatus === "blocked") {
    console.log(
      `[guard ${accountId}] conversation ${chatId} is blocked; skipping`
    );
    return;
  }

  if (!underDailyLimit(accountId, account.autoreply_daily_limit)) return;

  const message = event.message;
  const inputChat = await message.getInputChat();
  if (!inputChat) return;

  // Respect active hours (evaluated in the account's timezone).
  if (!isWithinActiveHours(account)) {
    const peerKey = `${accountId}:${chatId}`;
    const awayMsg = (account.autoreply_away_message ?? "").trim();
    if (
      account.autoreply_offhours_behavior === "away_note" &&
      awayMsg &&
      shouldSendAwayNote(account, peerKey)
    ) {
      try {
        await sendChunks(
          client,
          inputChat,
          [awayMsg],
          account,
          isGroup ? message.id : undefined
        );
        incrementDaily(accountId);
        const peerName =
          sender?.firstName ||
          (sender?.username ? `@${sender.username}` : chatId);
        await logReply(accountId, chatId, peerName, awayMsg);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[autoreply ${accountId}] away note failed:`, msg);
      }
    } else {
      console.log(
        `[autoreply ${accountId}] outside active hours; staying silent for ${chatId}`
      );
    }
    return;
  }

  // Emoji-only messages get a quick similar-emoji reply (no AI, no splitting).
  const emojiReply = isEmojiOnly(incomingText);

  // Exploitation / AI-detection guard. Emoji-only messages can't be threats.
  let slowMode = false;
  let guarded = false;
  if (account.autoreply_guard_enabled && !emojiReply) {
    const threat = await detectThreat(incomingText);
    if (threat) {
      const peerName =
        sender?.firstName ||
        (sender?.username ? `@${sender.username}` : chatId);
      const newScore =
        convMeta.threatScore + (threat.level === "serious" ? 3 : 1);
      const block = threat.level === "serious" || newScore >= 3;

      if (block) {
        await setConversationSecurity(accountId, chatId, peerName, {
          security_status: "blocked",
          threat_score: newScore,
          last_threat_reason: threat.reason,
        });
        await notifyAlert(account, client, "blocked", {
          peerName,
          chatId,
          reason: threat.reason,
          sample: incomingText,
        });
        console.log(
          `[guard ${accountId}] blocked ${chatId} (${threat.reason || threat.level})`
        );
        return;
      }

      await setConversationSecurity(accountId, chatId, peerName, {
        security_status: "suspected",
        threat_score: newScore,
        last_threat_reason: threat.reason,
      });
      // Notify only on the transition into the suspected state.
      if (convMeta.securityStatus !== "suspected") {
        await notifyAlert(account, client, "suspected", {
          peerName,
          chatId,
          reason: threat.reason,
          sample: incomingText,
        });
      }
      slowMode = true;
      guarded = true;
      console.log(
        `[guard ${accountId}] suspected ${chatId} (${threat.reason || threat.level}); slowing replies`
      );
    }
  }

  // Appointment flow (both-sides confirmation).
  if (account.autoreply_appointment_enabled && receiverInfo) {
    const supabase = getServiceClient();
    const { data: awaitingRows } = await supabase
      .from("kw_appointment_requests")
      .select("*")
      .eq("account_id", accountId)
      .eq("sender_chat_id", chatId)
      .eq("status", "awaiting_sender")
      .order("created_at", { ascending: false })
      .limit(1);
    const awaiting = awaitingRows?.[0] ?? null;

    if (awaiting) {
      // The receiver already confirmed; check if the sender now accepts.
      const accepted = await classifyAcceptance(
        OPENAI_MODEL(),
        awaiting.reply ?? awaiting.receiver_answer ?? "",
        incomingText
      );
      if (accepted) {
        await finalizeAppointment({
          account,
          client,
          inputChat,
          messageId: message.id,
          isGroup,
          request: awaiting,
          senderAck: incomingText,
          sender,
          chatId,
        });
        return;
      }
      // Not an acceptance. If the sender is proposing a different time, send it
      // back to the receiver for confirmation instead of replying directly.
      if (!emojiReply) {
        const cls = await classifyAppointment(OPENAI_MODEL(), incomingText);
        if (cls.isAppointment) {
          const senderName =
            sender?.firstName ||
            (sender?.username ? `@${sender.username}` : chatId);
          await relayAppointment({
            accountId,
            client,
            receiverInfo,
            incomingText,
            summary: cls.summary,
            senderName,
            chatId,
            senderMsgId: message.id,
            existingRequestId: awaiting.id,
          });
          return;
        }
      }
      // Otherwise (unrelated chatter) fall through to a normal reply.
    } else if (!emojiReply) {
      // No pending appointment: is this a new appointment request to relay?
      const cls = await classifyAppointment(OPENAI_MODEL(), incomingText);
      if (cls.isAppointment) {
        const senderName =
          sender?.firstName ||
          (sender?.username ? `@${sender.username}` : chatId);
        await relayAppointment({
          accountId,
          client,
          receiverInfo,
          incomingText,
          summary: cls.summary,
          senderName,
          chatId,
          senderMsgId: message.id,
        });
        return;
      }
    }
  }

  // Pricing relay: forward pricing questions to the receiver instead of
  // answering directly. Runs after appointment handling, before a normal reply.
  if (account.autoreply_pricing_relay && mediaReceiverInfo && !emojiReply) {
    const cls = await classifyPricing(OPENAI_MODEL(), incomingText);
    if (cls.isPricing) {
      const senderName =
        sender?.firstName ||
        (sender?.username ? `@${sender.username}` : chatId);
      await relayPricing({
        accountId,
        client,
        mediaReceiverInfo,
        question: incomingText,
        summary: cls.summary,
        senderName,
        chatId,
        senderMsgId: message.id,
      });
      return;
    }
  }

  let chunks: string[];
  if (emojiReply) {
    chunks = [pickSimilarEmoji(incomingText)];
  } else {
    const personaName =
      account.autoreply_name?.trim() ||
      account.first_name ||
      account.username ||
      account.label;

    // Gather recent context (skip the burst messages; passed separately).
    let history: HistoryLine[] = [];
    try {
      const recent = await client.getMessages(inputChat, {
        limit: 8 + texts.length,
      });
      history = recent
        .slice(texts.length)
        .reverse()
        .map((m) => ({
          speaker: m.out ? personaName : "them",
          content: m.text?.trim() ?? "",
        }))
        .filter((h) => h.content);
    } catch {
      history = [];
    }

    const reply = await generateAutoReply({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      personaName,
      persona: account.autoreply_persona,
      instructions: account.autoreply_instructions,
      isGroup,
      history,
      incomingText,
      // Voice & style controls.
      tone: account.autoreply_tone,
      emojiLevel: account.autoreply_emoji_level,
      length: account.autoreply_length,
      formality: account.autoreply_formality,
      language: account.autoreply_language,
      examples: account.autoreply_examples,
      faq: account.autoreply_faq,
      askQuestions: account.autoreply_ask_questions,
      matchMood: account.autoreply_match_mood,
      avoid: account.autoreply_avoid,
      signoff: account.autoreply_signoff,
      memory: convMeta.notes,
      // Avoid the eager assistant / customer-service voice.
      noAssistantTone: account.autoreply_no_assistant_tone,
      // Sender may be probing for a bot; reply extra naturally and deflect.
      guarded,
      // With relay on, never let the persona self-confirm meeting times.
      noSelfSchedule: Boolean(
        account.autoreply_appointment_enabled && receiverInfo
      ),
    });
    if (!reply) return;

    // Split a long reply into natural messages sized to the length preference.
    chunks = splitIntoMessages(
      reply,
      lengthBudget(account.autoreply_length).maxSentences
    );
  }

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i];
    const isFirst = i === 0;

    // Typing indicator before each message.
    try {
      await client.invoke(
        new Api.messages.SetTyping({
          peer: inputChat,
          action: new Api.SendMessageTypingAction(),
        })
      );
    } catch {
      // ignore typing errors
    }

    // Emoji reactions come quickly; text replies use the configured delay,
    // optionally scaled by length. When the guard flagged this contact, add a
    // big extra delay so suspicious senders see a deliberately slow human pace.
    const baseDelay = emojiReply
      ? randomDelayMs(1, isFirst ? 4 : 3)
      : chunkDelayMs(account, chunk, isFirst);
    await sleep(baseDelay + (slowMode && isFirst ? randomDelayMs(25, 75) : 0));

    try {
      await client.sendMessage(inputChat, {
        message: chunk,
        // Only thread the first message to the incoming one (group chats).
        replyTo: isGroup && isFirst ? message.id : undefined,
      });
    } catch (err) {
      const seconds = (err as { seconds?: number })?.seconds;
      if (typeof seconds === "number") {
        await sleep((seconds + 1) * 1000);
        await client.sendMessage(inputChat, { message: chunk });
      } else {
        throw err;
      }
    }
  }

  // The whole reply counts once toward the daily limit and the log.
  incrementDaily(accountId);

  const peerName =
    sender?.firstName || (sender?.username ? `@${sender.username}` : chatId);
  await logReply(accountId, chatId, peerName, chunks.join("\n"));
};

export const startAutoResponder = async (accountId: string): Promise<void> => {
  controlledIds = null; // force loop-guard set to refresh on next message
  await stopAutoResponder(accountId);

  const supabase = getServiceClient();
  const { data: account } = await supabase
    .from("kw_accounts")
    .select("*")
    .eq("id", accountId)
    .single();

  if (!account) throw new Error("Account not found.");
  if (!account.session_enc) throw new Error("Account is not logged in.");

  // The listener is always-on so we capture incoming messages even when
  // auto-reply is off; this flag gates the actual reply behavior.
  const autoReplyActive = Boolean(account.autoreply_enabled);

  const client = await clientManager.getClient(
    accountId,
    decryptSession(account.session_enc)
  );

  // Whitelist + receivers are only needed by the auto-reply path.
  let whitelist = new Set<string>();
  let receiverInfo: ReceiverInfo | null = null;
  let mediaReceiverInfo: ReceiverInfo | null = null;

  if (autoReplyActive) {
    if (account.autoreply_audience === "whitelist") {
      const { data: rows } = await supabase
        .from("kw_autoreply_whitelist")
        .select("peer")
        .eq("account_id", accountId);
      whitelist = new Set(
        (rows ?? []).map((r) => r.peer.replace(/^@/, "").toLowerCase())
      );
    }

    // Resolve the appointment receiver, if configured.
    if (account.autoreply_appointment_enabled && account.autoreply_receiver) {
      receiverInfo = await resolveReceiver(client, account.autoreply_receiver);
      if (!receiverInfo) {
        console.warn(
          `[autoreply ${accountId}] could not resolve receiver "${account.autoreply_receiver}"`
        );
      }
    }

    // Resolve the media/pricing receiver (dedicated, falling back to the
    // appointment one). Used for media relays AND pricing relays.
    if (account.autoreply_media_relay || account.autoreply_pricing_relay) {
      const rawMedia =
        account.autoreply_media_receiver?.trim() ||
        account.autoreply_receiver?.trim() ||
        "";
      if (rawMedia) {
        mediaReceiverInfo =
          receiverInfo && rawMedia === account.autoreply_receiver?.trim()
            ? receiverInfo
            : await resolveReceiver(client, rawMedia);
        if (!mediaReceiverInfo) {
          console.warn(
            `[autoreply ${accountId}] could not resolve media receiver "${rawMedia}"`
          );
        }
      }
    }
  }

  const builder = new NewMessage({ incoming: true });
  const handler = async (event: NewMessageEvent): Promise<void> => {
    try {
      await handleEvent(
        accountId,
        account as Account,
        client,
        whitelist,
        receiverInfo,
        mediaReceiverInfo,
        event,
        autoReplyActive
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[autoreply ${accountId}] handler error:`, message);
    }
  };

  client.addEventHandler(handler, builder);
  registry.set(accountId, { client, handler, builder });
  console.log(
    `[autoreply ${accountId}] listening for incoming messages` +
      (autoReplyActive ? "" : " (capture only; auto-reply off)")
  );
};

export const stopAutoResponder = async (accountId: string): Promise<void> => {
  controlledIds = null; // force loop-guard set to refresh on next message
  // Clear any pending debounce timers/state for this account's peers.
  const prefix = `${accountId}:`;
  for (const [key, state] of peerStates) {
    if (!key.startsWith(prefix)) continue;
    if (state.timer) clearTimeout(state.timer);
    peerStates.delete(key);
  }

  const reg = registry.get(accountId);
  if (!reg) return;
  try {
    reg.client.removeEventHandler(reg.handler, reg.builder);
  } catch {
    // ignore
  }
  registry.delete(accountId);
  console.log(`[autoreply ${accountId}] stopped`);
};

// Called on worker boot to start a listener for every logged-in account. The
// listener captures incoming messages regardless of the auto-reply flag (the
// flag only gates whether a reply is sent).
export const startAllAccountListeners = async (): Promise<void> => {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("kw_accounts")
    .select("id")
    .not("session_enc", "is", null)
    .eq("archived", false);

  for (const row of data ?? []) {
    try {
      await startAutoResponder(row.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[autoreply ${row.id}] failed to start:`, message);
    }
  }
};
