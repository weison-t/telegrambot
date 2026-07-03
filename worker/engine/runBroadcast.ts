import { TelegramClient, Api } from "telegram";
import { getServiceClient } from "@/lib/supabase";
import { decryptSession } from "@/lib/crypto";
import type {
  Account,
  Broadcast,
  BroadcastTarget,
  BroadcastUpdate,
} from "@/lib/types";
import { clientManager } from "../telegram/clientManager";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const randomDelayMs = (minS: number, maxS: number): number => {
  const min = Math.max(1, minS);
  const max = Math.max(min, maxS);
  return Math.floor((min + Math.random() * (max - min)) * 1000);
};

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

// Abort a broadcast if the sending accounts keep hitting FloodWaits, which is a
// strong signal Telegram is rate-limiting (and escalating toward a ban).
const MAX_CONSECUTIVE_FLOODS = 3;

type RunState = { stop: boolean };
const running = new Map<string, RunState>();

export const isRunning = (broadcastId: string): boolean =>
  running.has(broadcastId);

export const requestStop = (broadcastId: string): void => {
  const state = running.get(broadcastId);
  if (state) state.stop = true;
};

const setBroadcastStatus = async (
  broadcastId: string,
  status: Broadcast["status"],
  completed = false
): Promise<void> => {
  const supabase = getServiceClient();
  const update: BroadcastUpdate = { status };
  if (completed) update.completed_at = new Date().toISOString();
  await supabase.from("kw_broadcasts").update(update).eq("id", broadcastId);
};

// Reads the broadcast's current status; blocks while paused.
// Returns false if the broadcast should stop.
const waitWhilePaused = async (
  broadcastId: string,
  state: RunState
): Promise<boolean> => {
  const supabase = getServiceClient();
  for (;;) {
    if (state.stop) return false;
    const { data } = await supabase
      .from("kw_broadcasts")
      .select("status")
      .eq("id", broadcastId)
      .single();
    const status = data?.status;
    if (status === "stopped" || status === "done") return false;
    if (status === "running") return true;
    await sleep(2000);
  }
};

type SenderAccount = {
  account: Account;
  client: TelegramClient | null;
  sentToday: number;
};

// Resolve a @username or numeric id to an entity for the given client.
const resolveTargetPeer = async (
  client: TelegramClient,
  input: string,
  kind: string
): Promise<Api.User> => {
  const trimmed = input.trim();
  if (kind === "id" || /^-?\d+$/.test(trimmed)) {
    await client.getDialogs({ limit: 200 }).catch(() => undefined);
    const ent = await client.getEntity(
      Number(trimmed) as unknown as Api.TypeEntityLike
    );
    return ent as Api.User;
  }
  const handle = trimmed.startsWith("@") ? trimmed : `@${trimmed}`;
  const ent = await client.getEntity(handle);
  return ent as Api.User;
};

// Personalize the message with optional {name}/{username} placeholders.
const renderMessage = (
  template: string,
  user: Api.User | null,
  fallbackInput: string
): string => {
  const name = user?.firstName || user?.username || fallbackInput.replace(/^@/, "");
  const username = user?.username ? `@${user.username}` : fallbackInput;
  return template
    .replace(/\{name\}/gi, name)
    .replace(/\{username\}/gi, username);
};

type LoadedBroadcast = {
  broadcast: Broadcast;
  senders: SenderAccount[];
  targets: BroadcastTarget[];
};

const loadBroadcast = async (broadcastId: string): Promise<LoadedBroadcast> => {
  const supabase = getServiceClient();

  const { data: broadcast, error: bErr } = await supabase
    .from("kw_broadcasts")
    .select("*")
    .eq("id", broadcastId)
    .single();
  if (bErr || !broadcast) throw new Error(`Broadcast not found: ${broadcastId}`);

  const { data: accountLinks, error: aErr } = await supabase
    .from("kw_broadcast_accounts")
    .select("account_id")
    .eq("broadcast_id", broadcastId);
  if (aErr) throw aErr;

  const accountIds = (accountLinks ?? []).map((a) => a.account_id);
  if (accountIds.length === 0) {
    throw new Error("No sending accounts configured for this broadcast.");
  }

  const { data: accounts, error: accErr } = await supabase
    .from("kw_accounts")
    .select("*")
    .in("id", accountIds);
  if (accErr) throw accErr;

  const senders: SenderAccount[] = (accounts as Account[])
    .filter((a) => Boolean(a.session_enc))
    .map((account) => ({ account, client: null, sentToday: 0 }));
  if (senders.length === 0) {
    throw new Error("None of the selected accounts are logged in.");
  }

  // Only pending targets so a resumed run doesn't re-send.
  const { data: targets, error: tErr } = await supabase
    .from("kw_broadcast_targets")
    .select("*")
    .eq("broadcast_id", broadcastId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (tErr) throw tErr;

  return {
    broadcast: broadcast as Broadcast,
    senders,
    targets: (targets as BroadcastTarget[]) ?? [],
  };
};

const connectSenders = async (
  senders: SenderAccount[],
  dryRun: boolean
): Promise<void> => {
  if (dryRun) return;
  for (const sender of senders) {
    if (!sender.account.session_enc) continue;
    const session = decryptSession(sender.account.session_enc);
    sender.client = await clientManager.getClient(sender.account.id, session);
  }
};

// Count how many messages each sending account has already sent today so we can
// respect the per-account daily cap across restarts.
const preloadDailyCounts = async (
  broadcastId: string,
  senders: SenderAccount[]
): Promise<void> => {
  const supabase = getServiceClient();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  for (const sender of senders) {
    const { count } = await supabase
      .from("kw_broadcast_targets")
      .select("id", { count: "exact", head: true })
      .eq("broadcast_id", broadcastId)
      .eq("account_id", sender.account.id)
      .eq("status", "sent")
      .gte("sent_at", startOfDay.toISOString());
    sender.sentToday = count ?? 0;
  }
};

export const startBroadcast = async (broadcastId: string): Promise<void> => {
  if (running.has(broadcastId)) return;
  const state: RunState = { stop: false };
  running.set(broadcastId, state);

  await setBroadcastStatus(broadcastId, "running");

  // Run detached; the control API returns immediately.
  void (async () => {
    const supabase = getServiceClient();
    try {
      const { broadcast, senders, targets } = await loadBroadcast(broadcastId);
      await connectSenders(senders, broadcast.dry_run);
      await preloadDailyCounts(broadcastId, senders);

      let sentCount = broadcast.sent_count;
      let failedCount = broadcast.failed_count;
      let rr = 0;
      let consecutiveFloods = 0;

      for (const target of targets) {
        if (!(await waitWhilePaused(broadcastId, state))) break;

        // Pick the next sender with daily capacity (round-robin).
        let sender: SenderAccount | null = null;
        for (let i = 0; i < senders.length; i += 1) {
          const candidate = senders[(rr + i) % senders.length];
          if (candidate.sentToday < broadcast.per_account_daily_limit) {
            sender = candidate;
            rr = (rr + i + 1) % senders.length;
            break;
          }
        }
        if (!sender) {
          // Every account hit its daily cap; stop for now (targets stay pending).
          console.log(
            `[broadcast ${broadcastId}] all accounts hit daily cap; pausing run`
          );
          break;
        }

        let user: Api.User | null = null;
        try {
          if (!broadcast.dry_run && sender.client) {
            user = await resolveTargetPeer(sender.client, target.input, target.kind);
          }
          const body = renderMessage(broadcast.message, user, target.input);

          let tgMessageId: number | null = null;
          if (!broadcast.dry_run && sender.client && user) {
            try {
              const sent = await sender.client.sendMessage(user, { message: body });
              tgMessageId = Number(sent.id);
            } catch (err) {
              const flood = isFloodWait(err);
              if (flood) {
                consecutiveFloods += 1;
                await sleep((flood + 1) * 1000);
                const sent = await sender.client.sendMessage(user, {
                  message: body,
                });
                tgMessageId = Number(sent.id);
              } else {
                throw err;
              }
            }
          }
          consecutiveFloods = 0;

          sentCount += 1;
          sender.sentToday += 1;
          await supabase
            .from("kw_broadcast_targets")
            .update({
              status: "sent",
              account_id: sender.account.id,
              telegram_user_id: user ? Number(user.id.toString()) : null,
              username: user?.username ?? null,
              peer_id: user ? String(user.id.toString()) : null,
              tg_message_id: tgMessageId,
              sent_at: new Date().toISOString(),
              error: null,
            })
            .eq("id", target.id);
          await supabase
            .from("kw_broadcasts")
            .update({ sent_count: sentCount })
            .eq("id", broadcastId);
        } catch (err) {
          const flood = isFloodWait(err);
          if (flood) consecutiveFloods += 1;
          const message = err instanceof Error ? err.message : String(err);
          failedCount += 1;
          await supabase
            .from("kw_broadcast_targets")
            .update({
              status: "failed",
              account_id: sender.account.id,
              error: message,
            })
            .eq("id", target.id);
          await supabase
            .from("kw_broadcasts")
            .update({ failed_count: failedCount })
            .eq("id", broadcastId);
        }

        if (consecutiveFloods >= MAX_CONSECUTIVE_FLOODS) {
          console.error(
            `[broadcast ${broadcastId}] too many FloodWaits; stopping to protect accounts`
          );
          state.stop = true;
          break;
        }

        if (!state.stop) {
          await sleep(randomDelayMs(broadcast.min_delay_s, broadcast.max_delay_s));
        }
      }

      const finalStatus = state.stop ? "stopped" : "done";
      await setBroadcastStatus(broadcastId, finalStatus, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[broadcast ${broadcastId}] failed:`, message);
      await setBroadcastStatus(broadcastId, "stopped", true);
    } finally {
      running.delete(broadcastId);
    }
  })();
};
