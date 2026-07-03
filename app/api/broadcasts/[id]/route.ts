import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { normalizeTargets } from "@/lib/broadcastTargets";
import type {
  BroadcastTargetInsert,
  BroadcastUpdate,
  UpdateBroadcastPayload,
} from "@/lib/types";

export const runtime = "nodejs";

const isRunningState = (status: string): boolean =>
  status === "running" || status === "paused";

export const PATCH = async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const body = (await request.json()) as UpdateBroadcastPayload;
  const supabase = getServiceClient();

  const { data: current, error: readErr } = await supabase
    .from("kw_broadcasts")
    .select("status")
    .eq("id", id)
    .single();
  if (readErr || !current) {
    return NextResponse.json(
      { error: readErr?.message || "Broadcast not found" },
      { status: 404 }
    );
  }

  // The engine snapshots config when a run starts, so editing mid-run would be
  // inconsistent. Require a stop first.
  if (isRunningState(current.status)) {
    return NextResponse.json(
      { error: "Stop the broadcast before editing it." },
      { status: 409 }
    );
  }

  const update: BroadcastUpdate = {};
  if (typeof body.name === "string") update.name = body.name.trim();
  if (typeof body.message === "string") update.message = body.message.trim();
  if (typeof body.min_delay_s === "number")
    update.min_delay_s = Math.max(1, body.min_delay_s);
  if (typeof body.max_delay_s === "number")
    update.max_delay_s = Math.max(1, body.max_delay_s);
  if (typeof body.per_account_daily_limit === "number")
    update.per_account_daily_limit = Math.max(1, body.per_account_daily_limit);
  if (typeof body.model === "string") update.model = body.model;
  if (typeof body.dry_run === "boolean") update.dry_run = body.dry_run;
  if (typeof body.reply_ai_enabled === "boolean")
    update.reply_ai_enabled = body.reply_ai_enabled;
  if (body.reply_knowledge !== undefined)
    update.reply_knowledge = body.reply_knowledge || null;
  if (body.reply_persona !== undefined)
    update.reply_persona = body.reply_persona || null;
  if (body.reply_instructions !== undefined)
    update.reply_instructions = body.reply_instructions || null;
  if (body.reply_link !== undefined)
    update.reply_link = body.reply_link || null;

  if (update.name !== undefined && !update.name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (update.message !== undefined && !update.message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }
  if (
    update.min_delay_s !== undefined &&
    update.max_delay_s !== undefined &&
    update.min_delay_s > update.max_delay_s
  ) {
    return NextResponse.json(
      { error: "Min delay cannot exceed max delay." },
      { status: 400 }
    );
  }

  // Scheduling: a provided start_at schedules the launch; null clears it.
  if (body.start_at !== undefined) {
    if (body.start_at === null) {
      update.start_at = null;
      update.timezone = null;
      if (current.status === "scheduled") update.status = "draft";
    } else {
      if (new Date(body.start_at).getTime() <= Date.now()) {
        return NextResponse.json(
          { error: "The scheduled time must be in the future." },
          { status: 400 }
        );
      }
      update.start_at = body.start_at;
      update.timezone = body.timezone ?? null;
      update.status = "scheduled";
    }
  }

  if (Object.keys(update).length > 0) {
    const { error: updErr } = await supabase
      .from("kw_broadcasts")
      .update(update)
      .eq("id", id);
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 400 });
    }
  }

  // Replace the sending-account pool when supplied.
  if (body.account_ids !== undefined) {
    const accountIds = Array.from(new Set(body.account_ids));
    if (accountIds.length === 0) {
      return NextResponse.json(
        { error: "Select at least one sending account." },
        { status: 400 }
      );
    }
    await supabase.from("kw_broadcast_accounts").delete().eq("broadcast_id", id);
    const { error: aErr } = await supabase
      .from("kw_broadcast_accounts")
      .insert(accountIds.map((account_id) => ({ broadcast_id: id, account_id })));
    if (aErr) {
      return NextResponse.json({ error: aErr.message }, { status: 400 });
    }
  }

  // Replace the recipient list when supplied (resets per-target send state).
  if (body.targets !== undefined) {
    const { valid } = normalizeTargets(body.targets);
    if (valid.length === 0) {
      return NextResponse.json(
        { error: "No valid recipients." },
        { status: 400 }
      );
    }
    await supabase.from("kw_broadcast_targets").delete().eq("broadcast_id", id);
    const rows: BroadcastTargetInsert[] = valid.map((t) => ({
      broadcast_id: id,
      input: t.input,
      kind: t.kind,
      status: "pending",
    }));
    const { error: tErr } = await supabase
      .from("kw_broadcast_targets")
      .insert(rows);
    if (tErr) {
      return NextResponse.json({ error: tErr.message }, { status: 400 });
    }
    await supabase
      .from("kw_broadcasts")
      .update({
        total_count: valid.length,
        sent_count: 0,
        failed_count: 0,
        read_count: 0,
        replied_count: 0,
      })
      .eq("id", id);
  }

  const { data, error } = await supabase
    .from("kw_broadcasts")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Failed to load broadcast" },
      { status: 400 }
    );
  }
  return NextResponse.json({ broadcast: data });
};

export const DELETE = async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const supabase = getServiceClient();

  const { data: current, error: readErr } = await supabase
    .from("kw_broadcasts")
    .select("status")
    .eq("id", id)
    .single();
  if (readErr || !current) {
    return NextResponse.json(
      { error: readErr?.message || "Broadcast not found" },
      { status: 404 }
    );
  }
  if (isRunningState(current.status)) {
    return NextResponse.json(
      { error: "Stop the broadcast before deleting it." },
      { status: 409 }
    );
  }

  // Children cascade via FK, but delete explicitly to be safe.
  await supabase.from("kw_broadcast_targets").delete().eq("broadcast_id", id);
  await supabase.from("kw_broadcast_accounts").delete().eq("broadcast_id", id);
  const { error } = await supabase.from("kw_broadcasts").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
};
