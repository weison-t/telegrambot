import Fastify, { type FastifyRequest } from "fastify";
import { getServiceClient } from "@/lib/supabase";
import { encryptSession, decryptSession } from "@/lib/crypto";
import { env } from "../env";
import { clientManager, type TelegramUserInfo } from "../telegram/clientManager";
import { startCampaign, requestStop, isRunning } from "../engine/runCampaign";
import {
  startBroadcast,
  requestStop as requestBroadcastStop,
  isRunning as isBroadcastRunning,
} from "../engine/runBroadcast";
import {
  startAutoResponder,
  stopAutoResponder,
} from "../engine/autoResponder";
import { runPhoneLookupBatch } from "../engine/phoneLookup";

const persistLoggedIn = async (
  accountId: string,
  sessionString: string,
  user: TelegramUserInfo
): Promise<void> => {
  const supabase = getServiceClient();
  await supabase
    .from("kw_accounts")
    .update({
      session_enc: encryptSession(sessionString),
      telegram_user_id: user.telegramUserId,
      username: user.username,
      first_name: user.firstName,
      status: "online",
      last_error: null,
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", accountId);
};

const setAccountStatus = async (
  accountId: string,
  status: "code_sent" | "awaiting_2fa" | "error" | "offline",
  lastError?: string
): Promise<void> => {
  const supabase = getServiceClient();
  await supabase
    .from("kw_accounts")
    .update({ status, last_error: lastError ?? null })
    .eq("id", accountId);
};

const getAccountPhone = async (accountId: string): Promise<string> => {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("kw_accounts")
    .select("phone")
    .eq("id", accountId)
    .single();
  if (error || !data) throw new Error("Account not found.");
  return data.phone;
};

export const buildServer = () => {
  const app = Fastify({ logger: false });

  // Shared-secret auth for every route.
  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") return;
    const secret = request.headers["x-worker-secret"];
    if (secret !== env.workerSecret()) {
      reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.get("/health", async () => ({ ok: true }));

  type IdParams = { id: string };

  app.post(
    "/accounts/:id/login/start",
    async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      const { id } = request.params;
      try {
        const phone = await getAccountPhone(id);
        await clientManager.startLogin(id, phone);
        await setAccountStatus(id, "code_sent");
        return { status: "code_sent" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await setAccountStatus(id, "error", message);
        return reply.code(400).send({ error: message });
      }
    }
  );

  app.post(
    "/accounts/:id/login/code",
    async (
      request: FastifyRequest<{ Params: IdParams; Body: { code?: string } }>,
      reply
    ) => {
      const { id } = request.params;
      const code = request.body?.code;
      if (!code) return reply.code(400).send({ error: "code is required" });
      try {
        const result = await clientManager.confirmCode(id, code);
        if (result.status === "awaiting_2fa") {
          await setAccountStatus(id, "awaiting_2fa");
          return { status: "awaiting_2fa" };
        }
        await persistLoggedIn(id, result.sessionString, result.user);
        // Start the always-on capture listener for the freshly logged-in
        // account (captures even if auto-reply stays off).
        await startAutoResponder(id).catch((err) =>
          console.error(`[autoreply ${id}] failed to start after login:`, err)
        );
        return { status: "online", user: result.user };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await setAccountStatus(id, "error", message);
        return reply.code(400).send({ error: message });
      }
    }
  );

  app.post(
    "/accounts/:id/login/2fa",
    async (
      request: FastifyRequest<{ Params: IdParams; Body: { password?: string } }>,
      reply
    ) => {
      const { id } = request.params;
      const password = request.body?.password;
      if (!password)
        return reply.code(400).send({ error: "password is required" });
      try {
        const result = await clientManager.confirm2fa(id, password);
        await persistLoggedIn(id, result.sessionString, result.user);
        // Start the always-on capture listener for the freshly logged-in
        // account (captures even if auto-reply stays off).
        await startAutoResponder(id).catch((err) =>
          console.error(`[autoreply ${id}] failed to start after login:`, err)
        );
        return { status: "online", user: result.user };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await setAccountStatus(id, "error", message);
        return reply.code(400).send({ error: message });
      }
    }
  );

  app.post(
    "/accounts/:id/groups",
    async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      const { id } = request.params;
      const supabase = getServiceClient();
      const { data } = await supabase
        .from("kw_accounts")
        .select("session_enc")
        .eq("id", id)
        .single();
      if (!data?.session_enc) {
        return reply
          .code(400)
          .send({ error: "Account is not logged in. Connect it first." });
      }
      try {
        const groups = await clientManager.listGroups(
          id,
          decryptSession(data.session_enc)
        );
        return { groups };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }
    }
  );

  app.post(
    "/accounts/:id/disconnect",
    async (request: FastifyRequest<{ Params: IdParams }>) => {
      const { id } = request.params;
      // Remove the always-on listener before tearing down the client.
      await stopAutoResponder(id);
      await clientManager.disconnect(id);
      await setAccountStatus(id, "offline");
      return { status: "offline" };
    }
  );

  app.post(
    "/accounts/:id/autoreply/start",
    async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      const { id } = request.params;
      try {
        await startAutoResponder(id);
        return { status: "listening" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }
    }
  );

  app.post(
    "/accounts/:id/autoreply/stop",
    async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      const { id } = request.params;
      // Keep capturing incoming messages: re-register the listener, which now
      // reads autoreply_enabled=false from the DB and runs capture-only.
      try {
        await startAutoResponder(id);
        return { status: "capture_only" };
      } catch (err) {
        // If the account can't host a listener (e.g. logged out), tear down.
        await stopAutoResponder(id);
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(200).send({ status: "stopped", warning: message });
      }
    }
  );

  app.post(
    "/campaigns/:id/start",
    async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      const { id } = request.params;
      if (isRunning(id))
        return reply.code(409).send({ error: "Campaign already running." });
      try {
        await startCampaign(id);
        return { status: "running" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }
    }
  );

  app.post(
    "/campaigns/:id/pause",
    async (request: FastifyRequest<{ Params: IdParams }>) => {
      const { id } = request.params;
      const supabase = getServiceClient();
      await supabase
        .from("kw_campaigns")
        .update({ status: "paused" })
        .eq("id", id);
      return { status: "paused" };
    }
  );

  app.post(
    "/campaigns/:id/stop",
    async (request: FastifyRequest<{ Params: IdParams }>) => {
      const { id } = request.params;
      requestStop(id);
      const supabase = getServiceClient();
      await supabase
        .from("kw_campaigns")
        .update({ status: "stopped" })
        .eq("id", id);
      return { status: "stopped" };
    }
  );

  app.post(
    "/broadcasts/:id/start",
    async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      const { id } = request.params;
      if (isBroadcastRunning(id))
        return reply.code(409).send({ error: "Broadcast already running." });
      try {
        await startBroadcast(id);
        return { status: "running" };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.code(400).send({ error: message });
      }
    }
  );

  app.post(
    "/broadcasts/:id/pause",
    async (request: FastifyRequest<{ Params: IdParams }>) => {
      const { id } = request.params;
      const supabase = getServiceClient();
      await supabase
        .from("kw_broadcasts")
        .update({ status: "paused" })
        .eq("id", id);
      return { status: "paused" };
    }
  );

  app.post(
    "/broadcasts/:id/stop",
    async (request: FastifyRequest<{ Params: IdParams }>) => {
      const { id } = request.params;
      requestBroadcastStop(id);
      const supabase = getServiceClient();
      await supabase
        .from("kw_broadcasts")
        .update({ status: "stopped" })
        .eq("id", id);
      return { status: "stopped" };
    }
  );

  type PhoneLookupBody = {
    batchId?: string;
    accountId?: string;
    phones?: string[];
  };

  app.post(
    "/lookup/phone",
    async (request: FastifyRequest<{ Body: PhoneLookupBody }>, reply) => {
      const { batchId, accountId, phones } = request.body ?? {};
      if (!batchId || !accountId || !Array.isArray(phones) || !phones.length) {
        return reply
          .code(400)
          .send({ error: "batchId, accountId and phones[] are required." });
      }

      const supabase = getServiceClient();
      const { data } = await supabase
        .from("kw_accounts")
        .select("session_enc")
        .eq("id", accountId)
        .single();
      if (!data?.session_enc) {
        return reply
          .code(400)
          .send({ error: "Account is not logged in. Connect it first." });
      }

      // Fire-and-forget: the batch runs in the background and streams progress
      // to the DB (and the UI via realtime). Return immediately.
      void runPhoneLookupBatch(batchId, accountId, phones).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[lookup ${batchId}] batch failed:`, message);
      });

      return { ok: true, batchId };
    }
  );

  return app;
};
