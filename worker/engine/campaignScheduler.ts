import { getServiceClient } from "@/lib/supabase";
import { startCampaign, isRunning } from "./runCampaign";

const POLL_MS = 30_000;
let timer: ReturnType<typeof setInterval> | null = null;

// Launch any campaigns whose scheduled time has arrived.
const launchDueCampaigns = async (): Promise<void> => {
  const supabase = getServiceClient();
  const nowIso = new Date().toISOString();

  const { data: due } = await supabase
    .from("kw_campaigns")
    .select("id, name")
    .eq("status", "scheduled")
    .lte("start_at", nowIso)
    .order("start_at", { ascending: true })
    .limit(10);
  if (!due || due.length === 0) return;

  for (const campaign of due) {
    if (isRunning(campaign.id)) continue;
    try {
      await startCampaign(campaign.id);
      console.log(
        `[campaign-scheduler] launched scheduled campaign ${campaign.id} (${campaign.name})`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(
        `[campaign-scheduler] failed to launch ${campaign.id}:`,
        msg
      );
    }
  }
};

export const startCampaignScheduler = (): void => {
  if (timer) return;
  timer = setInterval(() => {
    launchDueCampaigns().catch((err) =>
      console.error("[campaign-scheduler] poll error:", err)
    );
  }, POLL_MS);
  launchDueCampaigns().catch(() => undefined);
  console.log("[campaign-scheduler] scheduler started");
};

export const stopCampaignScheduler = (): void => {
  if (timer) clearInterval(timer);
  timer = null;
};
