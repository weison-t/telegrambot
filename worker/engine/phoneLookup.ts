import { TelegramClient, Api } from "telegram";
import bigInt from "big-integer";
import { getServiceClient } from "@/lib/supabase";
import { decryptSession } from "@/lib/crypto";
import { clientManager } from "../telegram/clientManager";
import type { PhoneLookupResultUpdate } from "@/lib/types";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Delay between contact imports so we don't trip Telegram's contact-import
// rate limits and get the lookup account flagged.
const IMPORT_DELAY_MS = 2500;

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

const NOT_FOUND_REASON =
  "Not on Telegram, or the user restricts who can find them by phone number.";

export type PhoneResolution =
  | {
      status: "found";
      fields: PhoneLookupResultUpdate;
    }
  | {
      status: "not_found";
      reason: string;
    };

// Import a single phone as a contact to resolve the Telegram user, enrich via
// GetFullUser, then delete the temporary contact to keep the agent's list clean.
export const resolvePhoneUser = async (
  client: TelegramClient,
  phone: string
): Promise<PhoneResolution> => {
  const result = (await client.invoke(
    new Api.contacts.ImportContacts({
      contacts: [
        new Api.InputPhoneContact({
          clientId: bigInt(Date.now()),
          phone,
          firstName: "Lookup",
          lastName: "",
        }),
      ],
    })
  )) as Api.contacts.ImportedContacts;

  const user = result.users.find((u): u is Api.User => u instanceof Api.User);
  if (!user) {
    return { status: "not_found", reason: NOT_FOUND_REASON };
  }

  let bio: string | null = null;
  try {
    const full = (await client.invoke(
      new Api.users.GetFullUser({ id: user.id })
    )) as Api.users.UserFull;
    bio = full.fullUser.about ?? null;
  } catch {
    // Bio is best-effort; a missing full profile does not fail the lookup.
  }

  // Best-effort cleanup: remove the just-imported contact. Raw invoke needs a
  // proper InputUser (id + access hash), not a bare id.
  try {
    await client.invoke(
      new Api.contacts.DeleteContacts({
        id: [
          new Api.InputUser({
            userId: user.id,
            accessHash: user.accessHash ?? bigInt(0),
          }),
        ],
      })
    );
  } catch {
    // Ignore cleanup failures.
  }

  return {
    status: "found",
    fields: {
      telegram_user_id: Number(user.id.toString()),
      username: user.username ?? null,
      first_name: user.firstName ?? null,
      last_name: user.lastName ?? null,
      phone_visible: user.phone ?? null,
      is_premium: Boolean(user.premium),
      is_verified: Boolean(user.verified),
      bio,
      details: {
        bot: Boolean(user.bot),
        scam: Boolean(user.scam),
        fake: Boolean(user.fake),
        restricted: Boolean(user.restricted),
        lang_code: user.langCode ?? null,
      },
    },
  };
};

// Runs a full batch: iterates phones sequentially with throttling + FloodWait
// handling, writing each result row and updating batch progress as it goes.
export const runPhoneLookupBatch = async (
  batchId: string,
  accountId: string,
  phones: string[]
): Promise<void> => {
  const supabase = getServiceClient();

  await supabase
    .from("kw_phone_lookup_batches")
    .update({ status: "processing" })
    .eq("id", batchId);

  let client: TelegramClient;
  try {
    const { data } = await supabase
      .from("kw_accounts")
      .select("session_enc")
      .eq("id", accountId)
      .single();
    if (!data?.session_enc) {
      throw new Error("Account is not logged in.");
    }
    client = await clientManager.getClient(
      accountId,
      decryptSession(data.session_enc)
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Mark every pending row and the batch as failed so the UI stops spinning.
    await supabase
      .from("kw_phone_lookup_results")
      .update({ status: "error", reason: message, resolved_at: new Date().toISOString() })
      .eq("batch_id", batchId)
      .eq("status", "pending");
    await supabase
      .from("kw_phone_lookup_batches")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", batchId);
    return;
  }

  let completed = 0;
  let found = 0;

  for (const phone of phones) {
    const base: PhoneLookupResultUpdate = {
      resolved_at: new Date().toISOString(),
    };

    try {
      const resolution = await resolvePhoneUser(client, phone);
      if (resolution.status === "found") {
        found += 1;
        await supabase
          .from("kw_phone_lookup_results")
          .update({ status: "found", reason: null, ...resolution.fields, ...base })
          .eq("batch_id", batchId)
          .eq("phone", phone)
          .eq("status", "pending");
      } else {
        await supabase
          .from("kw_phone_lookup_results")
          .update({ status: "not_found", reason: resolution.reason, ...base })
          .eq("batch_id", batchId)
          .eq("phone", phone)
          .eq("status", "pending");
      }
    } catch (err) {
      const flood = isFloodWait(err);
      if (flood) {
        await sleep((flood + 1) * 1000);
        try {
          const retry = await resolvePhoneUser(client, phone);
          if (retry.status === "found") {
            found += 1;
            await supabase
              .from("kw_phone_lookup_results")
              .update({ status: "found", reason: null, ...retry.fields, ...base })
              .eq("batch_id", batchId)
              .eq("phone", phone)
              .eq("status", "pending");
          } else {
            await supabase
              .from("kw_phone_lookup_results")
              .update({ status: "not_found", reason: retry.reason, ...base })
              .eq("batch_id", batchId)
              .eq("phone", phone)
              .eq("status", "pending");
          }
        } catch (retryErr) {
          const message =
            retryErr instanceof Error ? retryErr.message : String(retryErr);
          await supabase
            .from("kw_phone_lookup_results")
            .update({ status: "error", reason: message, ...base })
            .eq("batch_id", batchId)
            .eq("phone", phone)
            .eq("status", "pending");
        }
      } else {
        const message = err instanceof Error ? err.message : String(err);
        await supabase
          .from("kw_phone_lookup_results")
          .update({ status: "error", reason: message, ...base })
          .eq("batch_id", batchId)
          .eq("phone", phone)
          .eq("status", "pending");
      }
    }

    completed += 1;
    await supabase
      .from("kw_phone_lookup_batches")
      .update({ completed_count: completed, found_count: found })
      .eq("id", batchId);

    if (completed < phones.length) await sleep(IMPORT_DELAY_MS);
  }

  await supabase
    .from("kw_phone_lookup_batches")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", batchId);
};
