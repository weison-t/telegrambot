import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import {
  MAX_PARTICIPANTS,
  MIN_PARTICIPANTS,
  type CampaignUpdate,
  type CampaignVenue,
  type ParticipantConfig,
} from "@/lib/types";

export const runtime = "nodejs";

type UpdateCampaignPayload = {
  name?: string;
  topic?: string;
  style?: string;
  extra_instructions?: string | null;
  venue?: CampaignVenue;
  target_chat?: string | null;
  min_delay_s?: number;
  max_delay_s?: number;
  max_messages?: number;
  model?: string;
  dry_run?: boolean;
  participants?: ParticipantConfig[];
  start_at?: string | null;
  timezone?: string | null;
};

const isRunningState = (status: string): boolean =>
  status === "running" || status === "paused";

export const PATCH = async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const body = (await request.json()) as UpdateCampaignPayload;

  const supabase = getServiceClient();

  const { data: current, error: readErr } = await supabase
    .from("kw_campaigns")
    .select("status, venue, messages_sent")
    .eq("id", id)
    .single();
  if (readErr || !current) {
    return NextResponse.json(
      { error: readErr?.message || "Campaign not found" },
      { status: 404 }
    );
  }

  // The engine snapshots config when a run starts, so editing mid-run would be
  // ignored or inconsistent. Require a stop first.
  if (isRunningState(current.status)) {
    return NextResponse.json(
      { error: "Stop the campaign before editing it." },
      { status: 409 }
    );
  }

  const update: CampaignUpdate = {};
  if (typeof body.name === "string") update.name = body.name.trim();
  if (typeof body.topic === "string") update.topic = body.topic.trim();
  if (typeof body.style === "string") update.style = body.style;
  if (body.extra_instructions !== undefined)
    update.extra_instructions = body.extra_instructions || null;
  if (typeof body.min_delay_s === "number") update.min_delay_s = body.min_delay_s;
  if (typeof body.max_delay_s === "number") update.max_delay_s = body.max_delay_s;
  if (typeof body.max_messages === "number")
    update.max_messages = body.max_messages;
  if (typeof body.model === "string") update.model = body.model;
  if (typeof body.dry_run === "boolean") update.dry_run = body.dry_run;

  // Venue can only change before a campaign has any history.
  const hasHistory = (current.messages_sent ?? 0) > 0;
  let effectiveVenue: CampaignVenue = current.venue;
  if (body.venue && body.venue !== current.venue) {
    if (hasHistory) {
      return NextResponse.json(
        { error: "Venue cannot change after the campaign has run." },
        { status: 409 }
      );
    }
    effectiveVenue = body.venue;
    update.venue = body.venue;
  }

  if (body.target_chat !== undefined) {
    update.target_chat =
      effectiveVenue === "group" ? body.target_chat || null : null;
  } else if (update.venue === "pair") {
    update.target_chat = null;
  }

  // Validate the resulting config.
  if (update.name !== undefined && !update.name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (update.topic !== undefined && !update.topic) {
    return NextResponse.json({ error: "Topic is required." }, { status: 400 });
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
  if (
    effectiveVenue === "group" &&
    update.target_chat !== undefined &&
    !update.target_chat
  ) {
    return NextResponse.json(
      { error: "Group campaigns require a target chat." },
      { status: 400 }
    );
  }

  // Scheduling: a provided start_at (string) schedules the launch; null clears
  // it. Undefined leaves scheduling untouched (e.g. dry-run-only patches).
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

  const participants = body.participants;
  if (participants !== undefined) {
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
    update.participant_count = participants.length;
  }

  if (Object.keys(update).length > 0) {
    const { error: updErr } = await supabase
      .from("kw_campaigns")
      .update(update)
      .eq("id", id);
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 400 });
    }
  }

  // Replace participants (and rebuild pairings) when supplied.
  if (participants !== undefined) {
    await supabase.from("kw_campaign_pairs").delete().eq("campaign_id", id);
    await supabase
      .from("kw_campaign_participants")
      .delete()
      .eq("campaign_id", id);

    const participantRows = participants.map((p, index) => ({
      campaign_id: id,
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
      return NextResponse.json({ error: pErr.message }, { status: 400 });
    }

    if (effectiveVenue === "pair") {
      const pairRows: {
        campaign_id: string;
        account_a_id: string;
        account_b_id: string;
      }[] = [];
      for (let i = 0; i + 1 < participants.length; i += 2) {
        pairRows.push({
          campaign_id: id,
          account_a_id: participants[i].account_id,
          account_b_id: participants[i + 1].account_id,
        });
      }
      if (pairRows.length > 0) {
        const { error: pairErr } = await supabase
          .from("kw_campaign_pairs")
          .insert(pairRows);
        if (pairErr) {
          return NextResponse.json({ error: pairErr.message }, { status: 400 });
        }
      }
    }
  }

  const { data, error } = await supabase
    .from("kw_campaigns")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message || "Failed to load campaign" },
      { status: 400 }
    );
  }

  return NextResponse.json({ campaign: data });
};

export const DELETE = async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
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
      { error: "Stop the campaign before deleting it." },
      { status: 409 }
    );
  }

  // Remove children explicitly so we don't depend on cascade rules.
  await supabase.from("kw_messages").delete().eq("campaign_id", id);
  await supabase.from("kw_campaign_pairs").delete().eq("campaign_id", id);
  await supabase.from("kw_campaign_participants").delete().eq("campaign_id", id);

  const { error } = await supabase.from("kw_campaigns").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
};
