import { TelegramClient, Api } from "telegram";
import bigInt from "big-integer";
import { getServiceClient } from "@/lib/supabase";
import { decryptSession } from "@/lib/crypto";
import { clientManager } from "../telegram/clientManager";
import type { GroupScrapeMemberInsert } from "@/lib/types";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Randomized delay between member pages so paging doesn't look mechanical and
// stays under Telegram's request-rate radar.
const pageDelayMs = (): number => 1500 + Math.floor(Math.random() * 1500);

// Members fetched per GetParticipants call. Telegram caps this near 200.
const PAGE_SIZE = 200;

// How many recent messages to scan when falling back to active senders.
const HISTORY_SCAN_LIMIT = 3000;

// Abort if the account keeps hitting FloodWaits (Telegram is rate-limiting).
const MAX_CONSECUTIVE_FLOODS = 3;

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

// Resolve a group/channel the account is already in. Deliberately does NOT join
// (joining is high ban-risk); warms the dialog cache so the access hash is known.
const resolveGroupEntity = async (
  client: TelegramClient,
  input: string
): Promise<Api.TypeEntityLike> => {
  const trimmed = input.trim();
  await client.getDialogs({ limit: 300 }).catch(() => undefined);
  if (trimmed.startsWith("@")) {
    return client.getEntity(trimmed);
  }
  if (/^-?\d+$/.test(trimmed)) {
    return client.getEntity(Number(trimmed) as unknown as Api.TypeEntityLike);
  }
  return client.getEntity(trimmed);
};

const entityTitle = (entity: Api.TypeEntityLike): string | null => {
  const e = entity as { title?: string; firstName?: string };
  return e.title ?? e.firstName ?? null;
};

const memberFromUser = (
  jobId: string,
  user: Api.User,
  source: "members" | "history",
  isAdmin: boolean
): GroupScrapeMemberInsert => ({
  job_id: jobId,
  telegram_user_id: Number(user.id.toString()),
  username: user.username ?? null,
  first_name: user.firstName ?? null,
  last_name: user.lastName ?? null,
  is_premium: Boolean(user.premium),
  is_bot: Boolean(user.bot),
  is_verified: Boolean(user.verified),
  is_admin: isAdmin,
  source,
  details: {
    scam: Boolean(user.scam),
    fake: Boolean(user.fake),
    restricted: Boolean(user.restricted),
    lang_code: user.langCode ?? null,
  },
});

// Insert a page of members, ignoring duplicates (unique job_id+telegram_user_id).
const upsertMembers = async (
  rows: GroupScrapeMemberInsert[]
): Promise<void> => {
  if (rows.length === 0) return;
  const supabase = getServiceClient();
  await supabase
    .from("kw_group_scrape_members")
    .upsert(rows, { onConflict: "job_id,telegram_user_id", ignoreDuplicates: true });
};

// Page the member list via channels.GetParticipants. Returns the number of
// members captured (0 typically means hidden/admin-only -> caller falls back).
const scrapeMembers = async (
  client: TelegramClient,
  jobId: string,
  channel: Api.TypeEntityLike,
  maxMembers: number,
  bumpTotal: (n: number) => Promise<void>
): Promise<number> => {
  let offset = 0;
  let captured = 0;
  let consecutiveFloods = 0;

  for (;;) {
    if (captured >= maxMembers) break;

    let result: Api.channels.TypeChannelParticipants;
    try {
      result = (await client.invoke(
        new Api.channels.GetParticipants({
          channel,
          filter: new Api.ChannelParticipantsSearch({ q: "" }),
          offset,
          limit: PAGE_SIZE,
          hash: bigInt(0),
        })
      )) as Api.channels.TypeChannelParticipants;
      consecutiveFloods = 0;
    } catch (err) {
      const flood = isFloodWait(err);
      if (flood) {
        consecutiveFloods += 1;
        if (consecutiveFloods >= MAX_CONSECUTIVE_FLOODS) {
          throw new Error("Stopped after repeated Telegram rate limits.");
        }
        await sleep((flood + 1) * 1000);
        continue;
      }
      // CHAT_ADMIN_REQUIRED / channel is a broadcast channel -> let caller fall back.
      throw err;
    }

    if (!(result instanceof Api.channels.ChannelParticipants)) break;

    const users = result.users.filter(
      (u): u is Api.User => u instanceof Api.User
    );
    if (users.length === 0) break;

    // Admin/creator ids so we can flag them.
    const adminIds = new Set<string>();
    for (const p of result.participants) {
      if (
        p instanceof Api.ChannelParticipantAdmin ||
        p instanceof Api.ChannelParticipantCreator
      ) {
        adminIds.add(p.userId.toString());
      }
    }

    const rows = users
      .filter((u) => !u.deleted)
      .map((u) =>
        memberFromUser(jobId, u, "members", adminIds.has(u.id.toString()))
      );
    await upsertMembers(rows);
    captured += rows.length;
    await bumpTotal(captured);

    offset += result.participants.length;
    if (result.participants.length < PAGE_SIZE) break;

    await sleep(pageDelayMs());
  }

  return captured;
};

// Fallback: harvest unique senders from recent history. Works even when the
// member list is hidden, but only yields users who have posted recently.
const scrapeHistorySenders = async (
  client: TelegramClient,
  jobId: string,
  entity: Api.TypeEntityLike,
  maxMembers: number,
  bumpTotal: (n: number) => Promise<void>
): Promise<number> => {
  const seen = new Set<string>();
  let batch: GroupScrapeMemberInsert[] = [];
  let scanned = 0;

  for await (const message of client.iterMessages(entity, {
    limit: HISTORY_SCAN_LIMIT,
  })) {
    scanned += 1;
    const sender = message.sender;
    if (sender instanceof Api.User && !sender.bot && !sender.deleted) {
      const key = sender.id.toString();
      if (!seen.has(key)) {
        seen.add(key);
        batch.push(memberFromUser(jobId, sender, "history", false));
        if (batch.length >= 100) {
          await upsertMembers(batch);
          await bumpTotal(seen.size);
          batch = [];
        }
      }
    }
    if (seen.size >= maxMembers) break;
    // Light throttle every few hundred messages scanned.
    if (scanned % 300 === 0) await sleep(pageDelayMs());
  }

  if (batch.length > 0) {
    await upsertMembers(batch);
    await bumpTotal(seen.size);
  }
  return seen.size;
};

// Runs a full group scrape: resolves the group, pages members, and falls back
// to active senders when the member list is hidden/empty. Streams progress to
// the DB (and the UI via realtime).
export const runGroupScrape = async (
  jobId: string,
  accountId: string,
  input: string,
  maxMembers: number
): Promise<void> => {
  const supabase = getServiceClient();

  await supabase
    .from("kw_group_scrape_jobs")
    .update({ status: "processing" })
    .eq("id", jobId);

  const bumpTotal = async (n: number): Promise<void> => {
    await supabase
      .from("kw_group_scrape_jobs")
      .update({ total_count: n })
      .eq("id", jobId);
  };

  const fail = async (message: string): Promise<void> => {
    await supabase
      .from("kw_group_scrape_jobs")
      .update({
        status: "failed",
        error: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  };

  let client: TelegramClient;
  try {
    const { data } = await supabase
      .from("kw_accounts")
      .select("session_enc")
      .eq("id", accountId)
      .single();
    if (!data?.session_enc) throw new Error("Account is not logged in.");
    client = await clientManager.getClient(
      accountId,
      decryptSession(data.session_enc)
    );
  } catch (err) {
    await fail(err instanceof Error ? err.message : String(err));
    return;
  }

  let entity: Api.TypeEntityLike;
  try {
    entity = await resolveGroupEntity(client, input);
  } catch {
    await fail(
      "Could not resolve that group. The selected account must already be a member (this module never joins groups)."
    );
    return;
  }

  await supabase
    .from("kw_group_scrape_jobs")
    .update({
      group_id: (entity as { id?: { toString(): string } }).id?.toString() ?? null,
      group_title: entityTitle(entity),
    })
    .eq("id", jobId);

  const cap = Math.max(1, Math.min(maxMembers || 10000, 50000));

  try {
    let method: "members" | "history" = "members";
    let usedFallback = false;
    let captured = 0;

    // Basic (non-supergroup) chats don't support GetParticipants; go straight
    // to history-sender harvesting for those.
    const isChannel = entity instanceof Api.Channel;

    if (isChannel) {
      try {
        captured = await scrapeMembers(client, jobId, entity, cap, bumpTotal);
      } catch (err) {
        // Admin-required or similar -> fall back to history senders.
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("repeated Telegram rate limits")) throw err;
        captured = 0;
      }
    }

    if (captured === 0) {
      method = "history";
      usedFallback = isChannel;
      captured = await scrapeHistorySenders(
        client,
        jobId,
        entity,
        cap,
        bumpTotal
      );
    }

    await supabase
      .from("kw_group_scrape_jobs")
      .update({
        status: "completed",
        method,
        used_fallback: usedFallback,
        total_count: captured,
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
  } catch (err) {
    await fail(err instanceof Error ? err.message : String(err));
  }
};
