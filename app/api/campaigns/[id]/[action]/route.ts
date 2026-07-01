import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { callWorker, WorkerError } from "@/lib/worker-client";

export const runtime = "nodejs";

const WORKER_ACTIONS = new Set(["start", "pause", "stop"]);
const LOCAL_ACTIONS = new Set(["reset", "duplicate"]);

const isRunningState = (status: string): boolean =>
  status === "running" || status === "paused";

const resetCampaign = async (id: string) => {
  const supabase = getServiceClient();
  const { data: current, error: readErr } = await supabase
    .from("kw_campaigns")
    .select("status")
    .eq("id", id)
    .single();
  if (readErr || !current) {
    return NextResponse.json(
      { error: readErr?.message || "Campaign not found" },
      { status: 404 }
    );
  }
  if (isRunningState(current.status)) {
    return NextResponse.json(
      { error: "Stop the campaign before resetting it." },
      { status: 409 }
    );
  }

  await supabase.from("kw_messages").delete().eq("campaign_id", id);
  const { data, error } = await supabase
    .from("kw_campaigns")
    .update({ messages_sent: 0, status: "draft" })
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Failed to reset campaign" },
      { status: 400 }
    );
  }
  return NextResponse.json({ campaign: data });
};

const duplicateCampaign = async (id: string) => {
  const supabase = getServiceClient();

  const { data: source, error: srcErr } = await supabase
    .from("kw_campaigns")
    .select("*")
    .eq("id", id)
    .single();
  if (srcErr || !source) {
    return NextResponse.json(
      { error: srcErr?.message || "Campaign not found" },
      { status: 404 }
    );
  }

  const { data: clone, error: cloneErr } = await supabase
    .from("kw_campaigns")
    .insert({
      name: `${source.name} (copy)`,
      topic: source.topic,
      style: source.style,
      extra_instructions: source.extra_instructions,
      venue: source.venue,
      target_chat: source.target_chat,
      participant_count: source.participant_count,
      min_delay_s: source.min_delay_s,
      max_delay_s: source.max_delay_s,
      max_messages: source.max_messages,
      dry_run: source.dry_run,
      model: source.model,
      messages_sent: 0,
      status: "draft",
    })
    .select("*")
    .single();
  if (cloneErr || !clone) {
    return NextResponse.json(
      { error: cloneErr?.message || "Failed to duplicate campaign" },
      { status: 400 }
    );
  }

  const { data: participants } = await supabase
    .from("kw_campaign_participants")
    .select("*")
    .eq("campaign_id", id)
    .order("turn_order", { ascending: true });

  if (participants && participants.length > 0) {
    const rows = participants.map((p) => ({
      campaign_id: clone.id,
      account_id: p.account_id,
      persona_name: p.persona_name,
      persona_traits: p.persona_traits,
      turn_order: p.turn_order,
      language: p.language,
      emoji_level: p.emoji_level,
      formality: p.formality,
      msg_length: p.msg_length,
      humanize: p.humanize,
      no_assistant_tone: p.no_assistant_tone,
      reply_threading: p.reply_threading,
      avoid_topics: p.avoid_topics,
      objective: p.objective,
    }));
    const { error: pErr } = await supabase
      .from("kw_campaign_participants")
      .insert(rows);
    if (pErr) {
      await supabase.from("kw_campaigns").delete().eq("id", clone.id);
      return NextResponse.json({ error: pErr.message }, { status: 400 });
    }
  }

  const { data: pairs } = await supabase
    .from("kw_campaign_pairs")
    .select("*")
    .eq("campaign_id", id);

  if (pairs && pairs.length > 0) {
    const pairRows = pairs.map((p) => ({
      campaign_id: clone.id,
      account_a_id: p.account_a_id,
      account_b_id: p.account_b_id,
    }));
    const { error: pairErr } = await supabase
      .from("kw_campaign_pairs")
      .insert(pairRows);
    if (pairErr) {
      await supabase.from("kw_campaigns").delete().eq("id", clone.id);
      return NextResponse.json({ error: pairErr.message }, { status: 400 });
    }
  }

  return NextResponse.json({ campaign: clone });
};

export const POST = async (
  _request: Request,
  { params }: { params: Promise<{ id: string; action: string }> }
) => {
  const { id, action } = await params;

  if (LOCAL_ACTIONS.has(action)) {
    if (action === "reset") return resetCampaign(id);
    return duplicateCampaign(id);
  }

  if (!WORKER_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    const result = await callWorker(`/campaigns/${id}/${action}`);
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof WorkerError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status });
  }
};
