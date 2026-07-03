import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { callWorker, WorkerError } from "@/lib/worker-client";

export const runtime = "nodejs";

const WORKER_ACTIONS = new Set(["start", "pause", "stop"]);
const LOCAL_ACTIONS = new Set(["reset", "duplicate"]);

const isRunningState = (status: string): boolean =>
  status === "running" || status === "paused";

// Clears all per-target send state + counters so the broadcast can be re-run.
const resetBroadcast = async (id: string) => {
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
      { error: "Stop the broadcast before resetting it." },
      { status: 409 }
    );
  }

  await supabase
    .from("kw_broadcast_targets")
    .update({
      status: "pending",
      account_id: null,
      telegram_user_id: null,
      username: null,
      peer_id: null,
      tg_message_id: null,
      error: null,
      sent_at: null,
      read_at: null,
      replied_at: null,
    })
    .eq("broadcast_id", id);

  const { data, error } = await supabase
    .from("kw_broadcasts")
    .update({
      sent_count: 0,
      failed_count: 0,
      read_count: 0,
      replied_count: 0,
      status: "draft",
      completed_at: null,
    })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Failed to reset broadcast" },
      { status: 400 }
    );
  }
  return NextResponse.json({ broadcast: data });
};

const duplicateBroadcast = async (id: string) => {
  const supabase = getServiceClient();

  const { data: source, error: srcErr } = await supabase
    .from("kw_broadcasts")
    .select("*")
    .eq("id", id)
    .single();
  if (srcErr || !source) {
    return NextResponse.json(
      { error: srcErr?.message || "Broadcast not found" },
      { status: 404 }
    );
  }

  const { data: clone, error: cloneErr } = await supabase
    .from("kw_broadcasts")
    .insert({
      name: `${source.name} (copy)`,
      message: source.message,
      min_delay_s: source.min_delay_s,
      max_delay_s: source.max_delay_s,
      per_account_daily_limit: source.per_account_daily_limit,
      dry_run: source.dry_run,
      model: source.model,
      reply_ai_enabled: source.reply_ai_enabled,
      reply_knowledge: source.reply_knowledge,
      reply_persona: source.reply_persona,
      reply_instructions: source.reply_instructions,
      reply_link: source.reply_link,
      total_count: source.total_count,
      status: "draft",
    })
    .select("*")
    .single();
  if (cloneErr || !clone) {
    return NextResponse.json(
      { error: cloneErr?.message || "Failed to duplicate broadcast" },
      { status: 400 }
    );
  }

  const { data: accounts } = await supabase
    .from("kw_broadcast_accounts")
    .select("account_id")
    .eq("broadcast_id", id);
  if (accounts && accounts.length > 0) {
    const { error: aErr } = await supabase.from("kw_broadcast_accounts").insert(
      accounts.map((a) => ({ broadcast_id: clone.id, account_id: a.account_id }))
    );
    if (aErr) {
      await supabase.from("kw_broadcasts").delete().eq("id", clone.id);
      return NextResponse.json({ error: aErr.message }, { status: 400 });
    }
  }

  const { data: targets } = await supabase
    .from("kw_broadcast_targets")
    .select("input, kind")
    .eq("broadcast_id", id);
  if (targets && targets.length > 0) {
    const { error: tErr } = await supabase.from("kw_broadcast_targets").insert(
      targets.map((t) => ({
        broadcast_id: clone.id,
        input: t.input,
        kind: t.kind,
        status: "pending",
      }))
    );
    if (tErr) {
      await supabase.from("kw_broadcasts").delete().eq("id", clone.id);
      return NextResponse.json({ error: tErr.message }, { status: 400 });
    }
  }

  return NextResponse.json({ broadcast: clone });
};

export const POST = async (
  _request: Request,
  { params }: { params: Promise<{ id: string; action: string }> }
) => {
  const { id, action } = await params;

  if (LOCAL_ACTIONS.has(action)) {
    if (action === "reset") return resetBroadcast(id);
    return duplicateBroadcast(id);
  }

  if (!WORKER_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    const result = await callWorker(`/broadcasts/${id}/${action}`);
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof WorkerError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status });
  }
};
