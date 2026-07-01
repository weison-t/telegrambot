import { env } from "./env";
import { buildServer } from "./control/server";
import { clientManager } from "./telegram/clientManager";
import { startAllAccountListeners } from "./engine/autoResponder";
import { startReminderScheduler } from "./engine/reminders";
import { startCampaignScheduler } from "./engine/campaignScheduler";

const main = async (): Promise<void> => {
  const app = buildServer();
  const host = env.workerHost();
  const port = env.workerPort();
  await app.listen({ port, host });
  console.log(`[worker] control API listening on http://${host}:${port}`);

  // Start a listener for every logged-in account so we capture incoming
  // messages even when an account's auto-reply is off.
  startAllAccountListeners().catch((err) =>
    console.error("[worker] failed to start account listeners:", err)
  );

  // Poll for due calendar reminders and deliver them.
  startReminderScheduler();

  // Poll for scheduled campaigns whose launch time has arrived.
  startCampaignScheduler();

  const shutdown = async (): Promise<void> => {
    console.log("[worker] shutting down...");
    await clientManager.disconnectAll();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
};

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
