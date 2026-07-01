import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { callWorker, WorkerError } from "@/lib/worker-client";
import type { AutoreplyConfig } from "@/lib/types";

export const runtime = "nodejs";

export const POST = async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const body = (await request.json()) as Partial<AutoreplyConfig>;
  const supabase = getServiceClient();

  const minDelay = Math.max(1, body.autoreply_min_delay_s ?? 4);
  const maxDelay = Math.max(minDelay, body.autoreply_max_delay_s ?? 20);

  const { error } = await supabase
    .from("kw_accounts")
    .update({
      autoreply_enabled: Boolean(body.autoreply_enabled),
      autoreply_name: body.autoreply_name?.trim() || null,
      autoreply_persona: body.autoreply_persona ?? null,
      autoreply_instructions: body.autoreply_instructions ?? null,
      autoreply_scope: body.autoreply_scope ?? "dm_mention",
      autoreply_audience: body.autoreply_audience ?? "contacts",
      autoreply_min_delay_s: minDelay,
      autoreply_max_delay_s: maxDelay,
      autoreply_daily_limit: Math.max(1, body.autoreply_daily_limit ?? 50),
      autoreply_appointment_enabled: Boolean(body.autoreply_appointment_enabled),
      autoreply_receiver: body.autoreply_receiver?.trim() || null,
      autoreply_timezone:
        body.autoreply_timezone?.trim() || "Asia/Kuala_Lumpur",
      autoreply_reminder_recipient:
        body.autoreply_reminder_recipient?.trim() || null,
      autoreply_reminder_offsets:
        body.autoreply_reminder_offsets?.trim() || "1440,30",
      autoreply_tone: body.autoreply_tone?.trim() || "friendly",
      autoreply_emoji_level: body.autoreply_emoji_level ?? "sometimes",
      autoreply_length: body.autoreply_length ?? "normal",
      autoreply_formality: body.autoreply_formality ?? "casual",
      autoreply_language: body.autoreply_language?.trim() || "mirror",
      autoreply_examples: body.autoreply_examples?.trim() || null,
      autoreply_faq: body.autoreply_faq?.trim() || null,
      autoreply_hours_enabled: Boolean(body.autoreply_hours_enabled),
      autoreply_active_start: body.autoreply_active_start?.trim() || "09:00",
      autoreply_active_end: body.autoreply_active_end?.trim() || "23:00",
      autoreply_offhours_behavior: body.autoreply_offhours_behavior ?? "silent",
      autoreply_away_message: body.autoreply_away_message?.trim() || null,
      autoreply_scale_delay: body.autoreply_scale_delay ?? true,
      autoreply_ask_questions: Boolean(body.autoreply_ask_questions),
      autoreply_match_mood: body.autoreply_match_mood ?? true,
      autoreply_avoid: body.autoreply_avoid?.trim() || null,
      autoreply_signoff: body.autoreply_signoff?.trim() || null,
      autoreply_guard_enabled: body.autoreply_guard_enabled ?? true,
      autoreply_alert_recipient: body.autoreply_alert_recipient?.trim() || null,
      autoreply_no_assistant_tone: body.autoreply_no_assistant_tone ?? true,
      autoreply_media_relay: Boolean(body.autoreply_media_relay),
      autoreply_media_receiver: body.autoreply_media_receiver?.trim() || null,
      autoreply_pricing_relay: Boolean(body.autoreply_pricing_relay),
    })
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  // Replace whitelist entries.
  if (Array.isArray(body.whitelist)) {
    await supabase.from("kw_autoreply_whitelist").delete().eq("account_id", id);
    const rows = body.whitelist
      .map((peer) => peer.trim())
      .filter(Boolean)
      .map((peer) => ({ account_id: id, peer }));
    if (rows.length > 0) {
      await supabase.from("kw_autoreply_whitelist").insert(rows);
    }
  }

  // Start or stop the live listener in the worker.
  const action = body.autoreply_enabled ? "start" : "stop";
  try {
    await callWorker(`/accounts/${id}/autoreply/${action}`);
  } catch (err) {
    const status = err instanceof WorkerError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Worker error";
    return NextResponse.json(
      { ok: true, warning: message },
      { status: status === 503 ? 200 : status }
    );
  }

  return NextResponse.json({ ok: true, status: action });
};
