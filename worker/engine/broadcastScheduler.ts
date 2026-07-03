import { getServiceClient } from "@/lib/supabase";
import { startBroadcast, isRunning } from "./runBroadcast";

const POLL_MS = 30_000;
let timer: ReturnType<typeof setInterval> | null = null;

// Launch any broadcasts whose scheduled time has arrived.
const launchDueBroadcasts = async (): Promise<void> => {
  const supabase = getServiceClient();
  const nowIso = new Date().toISOString();

  const { data: due } = await supabase
    .from("kw_broadcasts")
    .select("id, name")
    .eq("status", "scheduled")
    .lte("start_at", nowIso)
    .order("start_at", { ascending: true })
    .limit(10);
  if (!due || due.length === 0) return;

  for (const broadcast of due) {
    if (isRunning(broadcast.id)) continue;
    try {
      await startBroadcast(broadcast.id);
      console.log(
        `[broadcast-scheduler] launched scheduled broadcast ${broadcast.id} (${broadcast.name})`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[broadcast-scheduler] failed to launch ${broadcast.id}:`,
        msg
      );
    }
  }
};

export const startBroadcastScheduler = (): void => {
  if (timer) return;
  timer = setInterval(() => {
    launchDueBroadcasts().catch((err) =>
      console.error("[broadcast-scheduler] poll error:", err)
    );
  }, POLL_MS);
  launchDueBroadcasts().catch(() => undefined);
  console.log("[broadcast-scheduler] scheduler started");
};

export const stopBroadcastScheduler = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
};
