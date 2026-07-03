import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { callWorker, WorkerError } from "@/lib/worker-client";
import type {
  PhoneLookupResultInsert,
  PhoneLookupSource,
} from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  accountId?: string;
  phones?: string[];
  source?: string;
  defaultCountryCode?: string;
};

// Normalizes a raw phone entry into E.164 (leading + and digits only).
// When the number has no leading +, an optional default country code is
// prepended so operators don't have to retype it on every row.
const normalizePhone = (
  raw: string,
  defaultCountryCode?: string
): string | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const cc = (defaultCountryCode ?? "").replace(/[^\d]/g, "");
  let digits: string;
  if (trimmed.startsWith("+")) {
    digits = trimmed.slice(1).replace(/[^\d]/g, "");
  } else {
    const local = trimmed.replace(/[^\d]/g, "").replace(/^0+/, "");
    digits = `${cc}${local}`;
  }

  // Telegram numbers are 8-15 digits including country code.
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
};

const isValidSource = (value: string | undefined): value is PhoneLookupSource =>
  value === "single" || value === "multiple" || value === "batch";

export const POST = async (request: Request) => {
  const body = (await request.json()) as Body;
  const accountId = body.accountId?.trim();
  const source: PhoneLookupSource = isValidSource(body.source)
    ? body.source
    : "single";

  if (!accountId) {
    return NextResponse.json(
      { error: "accountId is required." },
      { status: 400 }
    );
  }
  if (!Array.isArray(body.phones) || body.phones.length === 0) {
    return NextResponse.json(
      { error: "At least one phone number is required." },
      { status: 400 }
    );
  }

  // Normalize + dedupe. Keep the invalid entries so we can report them back.
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of body.phones) {
    const normalized = normalizePhone(raw, body.defaultCountryCode);
    if (!normalized) {
      if (raw.trim()) invalid.push(raw.trim());
      continue;
    }
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    valid.push(normalized);
  }

  if (valid.length === 0) {
    return NextResponse.json(
      {
        error:
          "No valid phone numbers. Use full international format, e.g. +14155550123.",
        invalid,
      },
      { status: 400 }
    );
  }

  const supabase = getServiceClient();

  const { data: batch, error: batchErr } = await supabase
    .from("kw_phone_lookup_batches")
    .insert({
      account_id: accountId,
      source,
      status: "pending",
      total_count: valid.length,
    })
    .select()
    .single();
  if (batchErr || !batch) {
    return NextResponse.json(
      { error: batchErr?.message ?? "Failed to create batch." },
      { status: 500 }
    );
  }

  const rows: PhoneLookupResultInsert[] = valid.map((phone) => ({
    batch_id: batch.id,
    phone,
    status: "pending",
  }));
  const { error: rowsErr } = await supabase
    .from("kw_phone_lookup_results")
    .insert(rows);
  if (rowsErr) {
    await supabase.from("kw_phone_lookup_batches").delete().eq("id", batch.id);
    return NextResponse.json({ error: rowsErr.message }, { status: 500 });
  }

  try {
    await callWorker("/lookup/phone", {
      batchId: batch.id,
      accountId,
      phones: valid,
    });
  } catch (err) {
    // The batch rows exist; mark it failed so the UI doesn't spin forever.
    await supabase
      .from("kw_phone_lookup_batches")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", batch.id);
    const status = err instanceof WorkerError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Failed to start lookup.";
    return NextResponse.json(
      { batchId: batch.id, warning: message },
      { status }
    );
  }

  return NextResponse.json({ batchId: batch.id, invalid });
};

// Deletes a batch (results cascade) to clear history.
export const DELETE = async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const batchId = searchParams.get("batch_id");
  if (!batchId) {
    return NextResponse.json(
      { error: "batch_id is required." },
      { status: 400 }
    );
  }

  const supabase = getServiceClient();
  const { error } = await supabase
    .from("kw_phone_lookup_batches")
    .delete()
    .eq("id", batchId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
};
