import { TelegramClient, Api } from "telegram";
import bigInt from "big-integer";
import { getServiceClient } from "@/lib/supabase";
import { decryptSession } from "@/lib/crypto";
import type { Account, Campaign, Participant } from "@/lib/types";
import { clientManager } from "../telegram/clientManager";
import { generateReply, type HistoryLine, type SpeakerPersona } from "../openai";
import { splitIntoMessages } from "@/lib/autoreplyPrompt";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const randomDelayMs = (minS: number, maxS: number): number => {
  const min = Math.max(1, minS);
  const max = Math.max(min, maxS);
  return Math.floor((min + Math.random() * (max - min)) * 1000);
};

// Tracks running campaigns so they can be stopped.
type RunState = { stop: boolean };
const running = new Map<string, RunState>();

export const isRunning = (campaignId: string): boolean =>
  running.has(campaignId);

export const requestStop = (campaignId: string): void => {
  const state = running.get(campaignId);
  if (state) state.stop = true;
};

type SpeakerVoice = {
  language: string;
  emojiLevel: string;
  formality: string;
  msgLength: string;
  humanize: boolean;
  noAssistantTone: boolean;
  replyThreading: boolean;
  avoidTopics: string | null;
  objective: string | null;
};

type Speaker = {
  account: Account;
  client: TelegramClient | null;
  persona: SpeakerPersona;
  voice: SpeakerVoice;
};

const personaFor = (account: Account, p?: Participant): SpeakerPersona => ({
  name:
    p?.persona_name ||
    account.first_name ||
    account.username ||
    account.label,
  traits: p?.persona_traits || "an opinionated regular person with strong views",
});

const voiceFor = (p?: Participant): SpeakerVoice => ({
  language: p?.language ?? "mirror",
  emojiLevel: p?.emoji_level ?? "sometimes",
  formality: p?.formality ?? "casual",
  msgLength: p?.msg_length ?? "normal",
  humanize: p?.humanize ?? true,
  noAssistantTone: p?.no_assistant_tone ?? false,
  replyThreading: p?.reply_threading ?? false,
  avoidTopics: p?.avoid_topics ?? null,
  objective: p?.objective ?? null,
});

const isFloodWait = (err: unknown): number | null => {
  if (err && typeof err === "object") {
    const e = err as { seconds?: number; errorMessage?: string };
    if (typeof e.seconds === "number") return e.seconds;
    if (e.errorMessage?.startsWith("FLOOD_WAIT_")) {
      const n = parseInt(e.errorMessage.replace("FLOOD_WAIT_", ""), 10);
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
};

const showTyping = async (
  client: TelegramClient,
  peer: Api.TypeInputPeer | string | object
): Promise<void> => {
  try {
    await client.invoke(
      new Api.messages.SetTyping({
        peer: peer as never,
        action: new Api.SendMessageTypingAction(),
      })
    );
  } catch {
    // Non-fatal: typing indicator failed.
  }
};

// Reads the campaign's current status; handles pause by waiting.
// Returns false if the campaign should stop.
const waitWhilePaused = async (
  campaignId: string,
  state: RunState
): Promise<boolean> => {
  const supabase = getServiceClient();
  for (;;) {
    if (state.stop) return false;
    const { data } = await supabase
      .from("kw_campaigns")
      .select("status")
      .eq("id", campaignId)
      .single();
    const status = data?.status;
    if (status === "stopped" || status === "done") return false;
    if (status === "running") return true;
    // paused -> keep waiting
    await sleep(2000);
  }
};

const logMessage = async (
  campaignId: string,
  accountId: string,
  content: string,
  tgMessageId: number | null,
  dryRun: boolean,
  pairId: string | null
): Promise<void> => {
  const supabase = getServiceClient();
  await supabase.from("kw_messages").insert({
    campaign_id: campaignId,
    account_id: accountId,
    content,
    tg_message_id: tgMessageId,
    dry_run: dryRun,
    pair_id: pairId,
  });
};

const bumpSentCount = async (campaignId: string, count: number): Promise<void> => {
  const supabase = getServiceClient();
  await supabase
    .from("kw_campaigns")
    .update({ messages_sent: count })
    .eq("id", campaignId);
};

const HISTORY_PRELOAD = 20;

// Rehydrate recent conversation turns so a resumed/extended run stays coherent
// instead of starting from a blank slate.
const preloadHistory = async (
  campaignId: string,
  speakers: Speaker[],
  pairId: string | null
): Promise<HistoryLine[]> => {
  const supabase = getServiceClient();
  let query = supabase
    .from("kw_messages")
    .select("account_id, content, pair_id, created_at")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_PRELOAD);
  query = pairId ? query.eq("pair_id", pairId) : query.is("pair_id", null);

  const { data } = await query;
  if (!data || data.length === 0) return [];

  const nameByAccount = new Map(
    speakers.map((s) => [s.account.id, s.persona.name])
  );
  // Query is newest-first; reverse to chronological order.
  return data
    .reverse()
    .filter((m) => m.account_id && m.content)
    .map((m) => ({
      speaker: nameByAccount.get(m.account_id as string) ?? "someone",
      content: m.content as string,
    }));
};

// Resolve a chat/user entity, optionally joining a public group first.
const resolveGroupPeer = async (
  client: TelegramClient,
  target: string
): Promise<Api.TypeEntityLike> => {
  const trimmed = target.trim();
  if (trimmed.startsWith("@")) {
    try {
      await client.invoke(new Api.channels.JoinChannel({ channel: trimmed }));
    } catch {
      // Already a member or not joinable as a channel - ignore.
    }
    return client.getEntity(trimmed);
  }
  // Numeric marked id (e.g. -1001234567890): populate the dialog cache so the
  // entity's access hash is known to this account, then resolve.
  if (/^-?\d+$/.test(trimmed)) {
    await client.getDialogs({ limit: 300 }).catch(() => undefined);
    return client.getEntity(Number(trimmed) as unknown as Api.TypeEntityLike);
  }
  return client.getEntity(trimmed);
};

// Resolve the peer that `fromClient` should message to reach `target` account.
const resolvePeerForAccount = async (
  fromClient: TelegramClient,
  target: Account
): Promise<Api.TypeEntityLike> => {
  if (target.username) return fromClient.getEntity(`@${target.username}`);
  // Fall back to importing the phone number as a contact.
  const result = (await fromClient.invoke(
    new Api.contacts.ImportContacts({
      contacts: [
        new Api.InputPhoneContact({
          clientId: bigInt(Date.now()),
          phone: target.phone,
          firstName: target.first_name || target.label,
          lastName: "",
        }),
      ],
    })
  )) as Api.contacts.ImportedContacts;
  const imported = result.users[0];
  if (!imported) {
    throw new Error(
      `Cannot reach account "${target.label}" - no username and phone not on Telegram/contacts.`
    );
  }
  return imported;
};

type LoadedCampaign = {
  campaign: Campaign;
  speakers: Speaker[];
  participants: Participant[];
};

const loadCampaign = async (campaignId: string): Promise<LoadedCampaign> => {
  const supabase = getServiceClient();

  const { data: campaign, error: cErr } = await supabase
    .from("kw_campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();
  if (cErr || !campaign) throw new Error(`Campaign not found: ${campaignId}`);

  const { data: participants, error: pErr } = await supabase
    .from("kw_campaign_participants")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("turn_order", { ascending: true });
  if (pErr) throw pErr;

  const accountIds = (participants ?? []).map((p) => p.account_id);
  const { data: accounts, error: aErr } = await supabase
    .from("kw_accounts")
    .select("*")
    .in("id", accountIds);
  if (aErr) throw aErr;

  const accountById = new Map((accounts ?? []).map((a) => [a.id, a]));
  const speakers: Speaker[] = (participants ?? []).map((p) => {
    const account = accountById.get(p.account_id);
    if (!account) throw new Error(`Missing account ${p.account_id}`);
    return {
      account,
      client: null,
      persona: personaFor(account, p),
      voice: voiceFor(p),
    };
  });

  return { campaign, speakers, participants: participants ?? [] };
};

const connectSpeakers = async (
  speakers: Speaker[],
  dryRun: boolean
): Promise<void> => {
  if (dryRun) return;
  for (const speaker of speakers) {
    if (!speaker.account.session_enc) {
      throw new Error(
        `Account "${speaker.account.label}" is not logged in (no session).`
      );
    }
    const session = decryptSession(speaker.account.session_enc);
    speaker.client = await clientManager.getClient(speaker.account.id, session);
  }
};

const setCampaignStatus = async (
  campaignId: string,
  status: Campaign["status"]
): Promise<void> => {
  const supabase = getServiceClient();
  await supabase
    .from("kw_campaigns")
    .update({ status })
    .eq("id", campaignId);
};

// One message turn: generate, (optionally) send, log.
const takeTurn = async (
  campaign: Campaign,
  speaker: Speaker,
  others: string[],
  history: HistoryLine[],
  peer: Api.TypeEntityLike | null,
  pairId: string | null,
  // Shared per-conversation reply-to tracker (group venue only); null disables.
  thread: { lastId: number | null } | null
): Promise<number> => {
  const voice = speaker.voice;
  const reply = await generateReply({
    model: campaign.model,
    topic: campaign.topic,
    style: campaign.style,
    extraInstructions: campaign.extra_instructions,
    venue: campaign.venue,
    speaker: speaker.persona,
    others,
    history,
    language: voice.language,
    emojiLevel: voice.emojiLevel,
    formality: voice.formality,
    msgLength: voice.msgLength,
    humanize: voice.humanize,
    noAssistantTone: voice.noAssistantTone,
    avoidTopics: voice.avoidTopics,
    objective: voice.objective,
  });
  if (!reply) return 0;

  // Humanize: occasionally break a longer thought into up to 2 messages.
  const parts = voice.humanize
    ? splitIntoMessages(reply, 2).slice(0, 2)
    : [reply];
  const messages = parts.length ? parts : [reply];

  let logged = 0;
  for (let i = 0; i < messages.length; i += 1) {
    const part = messages[i];
    let tgMessageId: number | null = null;

    if (!campaign.dry_run && speaker.client && peer) {
      await showTyping(speaker.client, peer as never);
      // Human-like typing time, capped.
      await sleep(Math.min(6000, 400 + part.length * 60));

      // Reply-threading: sometimes reply to the most recent message.
      const replyTo =
        thread && voice.replyThreading && thread.lastId && Math.random() < 0.35
          ? thread.lastId
          : undefined;
      const params = replyTo ? { message: part, replyTo } : { message: part };

      try {
        const sentMsg = await speaker.client.sendMessage(peer, params);
        tgMessageId = Number(sentMsg.id);
      } catch (err) {
        const flood = isFloodWait(err);
        if (flood) {
          await sleep((flood + 1) * 1000);
          const sentMsg = await speaker.client.sendMessage(peer, params);
          tgMessageId = Number(sentMsg.id);
        } else {
          throw err;
        }
      }

      if (thread && tgMessageId) thread.lastId = tgMessageId;
      // Brief gap between split messages so they feel typed separately.
      if (i < messages.length - 1) await sleep(randomDelayMs(1, 2));
    }

    history.push({ speaker: speaker.persona.name, content: part });
    await logMessage(
      campaign.id,
      speaker.account.id,
      part,
      tgMessageId,
      campaign.dry_run,
      pairId
    );
    logged += 1;
  }

  return logged;
};

const runGroup = async (
  loaded: LoadedCampaign,
  state: RunState
): Promise<void> => {
  const { campaign, speakers } = loaded;
  if (!campaign.target_chat) {
    throw new Error("Group campaign requires a target chat.");
  }

  const peers = new Map<string, Api.TypeEntityLike>();
  if (!campaign.dry_run) {
    for (const speaker of speakers) {
      if (!speaker.client) continue;
      peers.set(
        speaker.account.id,
        await resolveGroupPeer(speaker.client, campaign.target_chat)
      );
    }
  }

  const history: HistoryLine[] = await preloadHistory(
    campaign.id,
    speakers,
    null
  );
  const thread = { lastId: null as number | null };
  let sent = campaign.messages_sent ?? 0;
  let index = 0;

  while (sent < campaign.max_messages) {
    const proceed = await waitWhilePaused(campaign.id, state);
    if (!proceed) return;

    const speaker = speakers[index % speakers.length];
    const others = speakers
      .filter((s) => s.account.id !== speaker.account.id)
      .map((s) => s.persona.name);

    const count = await takeTurn(
      campaign,
      speaker,
      others,
      history,
      peers.get(speaker.account.id) ?? null,
      null,
      thread
    );

    sent += Math.max(1, count);
    index += 1;
    await bumpSentCount(campaign.id, sent);
    if (sent >= campaign.max_messages) break;
    await sleep(randomDelayMs(campaign.min_delay_s, campaign.max_delay_s));
  }
};

const runPairs = async (
  loaded: LoadedCampaign,
  state: RunState
): Promise<void> => {
  const { campaign, speakers } = loaded;
  const supabase = getServiceClient();

  const { data: pairs } = await supabase
    .from("kw_campaign_pairs")
    .select("*")
    .eq("campaign_id", campaign.id);
  if (!pairs || pairs.length === 0) {
    throw new Error("Pair campaign has no pairings configured.");
  }

  const speakerByAccount = new Map(speakers.map((s) => [s.account.id, s]));
  let totalSent = campaign.messages_sent ?? 0;

  const runOnePair = async (pair: {
    id: string;
    account_a_id: string;
    account_b_id: string;
  }): Promise<void> => {
    const a = speakerByAccount.get(pair.account_a_id);
    const b = speakerByAccount.get(pair.account_b_id);
    if (!a || !b) return;

    let peerForA: Api.TypeEntityLike | null = null;
    let peerForB: Api.TypeEntityLike | null = null;
    if (!campaign.dry_run && a.client && b.client) {
      peerForA = await resolvePeerForAccount(a.client, b.account);
      peerForB = await resolvePeerForAccount(b.client, a.account);
    }

    const history: HistoryLine[] = await preloadHistory(
      campaign.id,
      [a, b],
      pair.id
    );
    let turn = 0;
    while (totalSent < campaign.max_messages) {
      const proceed = await waitWhilePaused(campaign.id, state);
      if (!proceed) return;

      const isA = turn % 2 === 0;
      const speaker = isA ? a : b;
      const other = isA ? b : a;
      const peer = isA ? peerForA : peerForB;

      const count = await takeTurn(
        campaign,
        speaker,
        [other.persona.name],
        history,
        peer,
        pair.id,
        null
      );

      totalSent += Math.max(1, count);
      turn += 1;
      await bumpSentCount(campaign.id, totalSent);
      if (totalSent >= campaign.max_messages) return;
      await sleep(randomDelayMs(campaign.min_delay_s, campaign.max_delay_s));
    }
  };

  await Promise.all(pairs.map(runOnePair));
};

export const startCampaign = async (campaignId: string): Promise<void> => {
  if (running.has(campaignId)) return;
  const state: RunState = { stop: false };
  running.set(campaignId, state);

  await setCampaignStatus(campaignId, "running");

  // Run detached; the control API returns immediately.
  void (async () => {
    try {
      const loaded = await loadCampaign(campaignId);
      await connectSpeakers(loaded.speakers, loaded.campaign.dry_run);

      if (loaded.campaign.venue === "group") {
        await runGroup(loaded, state);
      } else {
        await runPairs(loaded, state);
      }

      const finalStatus = state.stop ? "stopped" : "done";
      await setCampaignStatus(campaignId, finalStatus);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[campaign ${campaignId}] failed:`, message);
      const supabase = getServiceClient();
      await supabase
        .from("kw_messages")
        .insert({
          campaign_id: campaignId,
          content: `[engine error] ${message}`,
          dry_run: true,
        });
      await setCampaignStatus(campaignId, "stopped");
    } finally {
      running.delete(campaignId);
    }
  })();
};
