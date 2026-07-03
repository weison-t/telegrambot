import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { callWorker, WorkerError } from "@/lib/worker-client";
import { normalizeTargets } from "@/lib/broadcastTargets";
import type {
  BroadcastTargetInsert,
  CreateBroadcastPayload,
} from "@/lib/types";

export const runtime = "nodejs";

export const GET = async () => {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("kw_broadcasts")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ broadcasts: data });
};

export const POST = async (request: Request) => {
  const supabase = getServiceClient();
  const payload = (await request.json()) as CreateBroadcastPayload;

  if (!payload.name?.trim()) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (!payload.message?.trim()) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }
  const accountIds = Array.from(new Set(payload.account_ids ?? []));
  if (accountIds.length === 0) {
    return NextResponse.json(
      { error: "Select at least one sending account." },
      { status: 400 }
    );
  }

  const { valid, invalid } = normalizeTargets(payload.targets ?? []);
  if (valid.length === 0) {
    return NextResponse.json(
      {
        error:
          "No valid recipients. Use @usernames or numeric Telegram ids (one per line).",
        invalid,
      },
      { status: 400 }
    );
  }

  const minDelay = Math.max(1, payload.min_delay_s ?? 45);
  const maxDelay = Math.max(minDelay, payload.max_delay_s ?? 90);

  const startAt = payload.start_at ?? null;
  const scheduled = !!startAt && new Date(startAt).getTime() > Date.now();

  const { data: broadcast, error } = await supabase
    .from("kw_broadcasts")
    .insert({
      name: payload.name.trim(),
      message: payload.message.trim(),
      min_delay_s: minDelay,
      max_delay_s: maxDelay,
      per_account_daily_limit: Math.max(1, payload.per_account_daily_limit ?? 30),
      dry_run: !!payload.dry_run,
      model: payload.model,
      reply_ai_enabled: payload.reply_ai_enabled ?? true,
      reply_knowledge: payload.reply_knowledge || null,
      reply_persona: payload.reply_persona || null,
      reply_instructions: payload.reply_instructions || null,
      reply_link: payload.reply_link || null,
      total_count: valid.length,
      start_at: scheduled ? startAt : null,
      timezone: scheduled ? payload.timezone ?? null : null,
      status: scheduled ? "scheduled" : "draft",
    })
    .select("*")
    .single();
  if (error || !broadcast) {
    return NextResponse.json(
      { error: error?.message || "Failed to create broadcast" },
      { status: 400 }
    );
  }

  const accountRows = accountIds.map((account_id) => ({
    broadcast_id: broadcast.id,
    account_id,
  }));
  const { error: aErr } = await supabase
    .from("kw_broadcast_accounts")
    .insert(accountRows);
  if (aErr) {
    await supabase.from("kw_broadcasts").delete().eq("id", broadcast.id);
    return NextResponse.json({ error: aErr.message }, { status: 400 });
  }

  const targetRows: BroadcastTargetInsert[] = valid.map((t) => ({
    broadcast_id: broadcast.id,
    input: t.input,
    kind: t.kind,
    status: "pending",
  }));
  const { error: tErr } = await supabase
    .from("kw_broadcast_targets")
    .insert(targetRows);
  if (tErr) {
    await supabase.from("kw_broadcasts").delete().eq("id", broadcast.id);
    return NextResponse.json({ error: tErr.message }, { status: 400 });
  }

  // Launch now only when the operator asked to start and it isn't scheduled.
  if (!scheduled && payload.start_now) {
    try {
      await callWorker(`/broadcasts/${broadcast.id}/start`);
    } catch (err) {
      const status = err instanceof WorkerError ? err.status : 500;
      const message =
        err instanceof Error ? err.message : "Failed to start broadcast.";
      return NextResponse.json(
        { broadcast, invalid, warning: message },
        { status }
      );
    }
  }

  return NextResponse.json({ broadcast, invalid });
};
