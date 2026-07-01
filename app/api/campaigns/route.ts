import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import {
  MAX_PARTICIPANTS,
  MIN_PARTICIPANTS,
  type CreateCampaignPayload,
} from "@/lib/types";

export const runtime = "nodejs";

export const GET = async () => {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("kw_campaigns")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ campaigns: data });
};

export const POST = async (request: Request) => {
  const supabase = getServiceClient();
  const payload = (await request.json()) as CreateCampaignPayload;

  const participants = payload.participants ?? [];
  if (
    participants.length < MIN_PARTICIPANTS ||
    participants.length > MAX_PARTICIPANTS
  ) {
    return NextResponse.json(
      {
        error: `Select between ${MIN_PARTICIPANTS} and ${MAX_PARTICIPANTS} participants.`,
      },
      { status: 400 }
    );
  }
  if (!payload.name?.trim() || !payload.topic?.trim()) {
    return NextResponse.json(
      { error: "name and topic are required" },
      { status: 400 }
    );
  }
  if (payload.venue === "group" && !payload.target_chat?.trim()) {
    return NextResponse.json(
      { error: "Group campaigns require a target chat (e.g. @mygroup)." },
      { status: 400 }
    );
  }

  const startAt = payload.start_at ?? null;
  const scheduled = !!startAt && new Date(startAt).getTime() > Date.now();

  const { data: campaign, error } = await supabase
    .from("kw_campaigns")
    .insert({
      name: payload.name.trim(),
      topic: payload.topic.trim(),
      style: payload.style,
      extra_instructions: payload.extra_instructions || null,
      venue: payload.venue,
      target_chat: payload.venue === "group" ? payload.target_chat : null,
      participant_count: participants.length,
      min_delay_s: payload.min_delay_s,
      max_delay_s: payload.max_delay_s,
      max_messages: payload.max_messages,
      dry_run: payload.dry_run,
      model: payload.model,
      start_at: scheduled ? startAt : null,
      timezone: scheduled ? payload.timezone ?? null : null,
      status: scheduled ? "scheduled" : "draft",
    })
    .select("*")
    .single();
  if (error || !campaign) {
    return NextResponse.json(
      { error: error?.message || "Failed to create campaign" },
      { status: 400 }
    );
  }

  const participantRows = participants.map((p, index) => ({
    campaign_id: campaign.id,
    account_id: p.account_id,
    persona_name: p.persona_name || null,
    persona_traits: p.persona_traits || null,
    turn_order: index,
    language: p.language ?? "mirror",
    emoji_level: p.emoji_level ?? "sometimes",
    formality: p.formality ?? "casual",
    msg_length: p.msg_length ?? "normal",
    humanize: p.humanize ?? true,
    no_assistant_tone: p.no_assistant_tone ?? false,
    reply_threading: p.reply_threading ?? false,
    avoid_topics: p.avoid_topics ?? null,
    objective: p.objective ?? null,
  }));
  const { error: pErr } = await supabase
    .from("kw_campaign_participants")
    .insert(participantRows);
  if (pErr) {
    await supabase.from("kw_campaigns").delete().eq("id", campaign.id);
    return NextResponse.json({ error: pErr.message }, { status: 400 });
  }

  // Pair venue: pair consecutive participants (1-2, 3-4, ...).
  if (payload.venue === "pair") {
    const pairRows: {
      campaign_id: string;
      account_a_id: string;
      account_b_id: string;
    }[] = [];
    for (let i = 0; i + 1 < participants.length; i += 2) {
      pairRows.push({
        campaign_id: campaign.id,
        account_a_id: participants[i].account_id,
        account_b_id: participants[i + 1].account_id,
      });
    }
    if (pairRows.length > 0) {
      const { error: pairErr } = await supabase
        .from("kw_campaign_pairs")
        .insert(pairRows);
      if (pairErr) {
        await supabase.from("kw_campaigns").delete().eq("id", campaign.id);
        return NextResponse.json({ error: pairErr.message }, { status: 400 });
      }
    }
  }

  return NextResponse.json({ campaign });
};
