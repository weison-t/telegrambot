import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import type { ConversationInsert } from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  account_id?: string;
  peer_id?: string;
  peer_name?: string;
  // Per-contact auto-reply override.
  disabled?: boolean;
  // Manual status tag ("ongoing" | "completed"); pins the status so the
  // background sweeper stops auto-changing it.
  status?: string;
  // Per-contact memory injected into the reply prompt.
  notes?: string;
  // Security tag from the exploitation guard ("normal" clears the flag and
  // resumes auto-replies).
  security_status?: string;
};

// Upserts per-contact conversation settings (disable override + status tag).
export const POST = async (request: Request) => {
  const body = (await request.json()) as Body;
  const {
    account_id,
    peer_id,
    peer_name,
    disabled,
    status,
    notes,
    security_status,
  } = body;

  if (!account_id || !peer_id) {
    return NextResponse.json(
      { error: "account_id and peer_id are required." },
      { status: 400 }
    );
  }

  const update: ConversationInsert = {
    account_id,
    peer_id,
    updated_at: new Date().toISOString(),
  };
  if (peer_name != null) update.peer_name = peer_name;
  if (typeof disabled === "boolean") update.disabled = disabled;
  if (status === "ongoing" || status === "completed") {
    update.status = status;
    update.status_manual = true;
  }
  if (notes != null) update.notes = notes.trim() || null;
  if (
    security_status === "normal" ||
    security_status === "suspected" ||
    security_status === "blocked"
  ) {
    update.security_status = security_status;
    // Clearing the flag resets the accumulated threat state.
    if (security_status === "normal") {
      update.threat_score = 0;
      update.last_threat_reason = null;
      update.flagged_at = null;
    }
  }

  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("kw_conversations")
    .upsert(update, { onConflict: "account_id,peer_id" })
    .select()
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ conversation: data });
};

// Permanently deletes a single contact's conversation: its logged messages and
// its metadata row. Used by the manual "delete conversation" action.
export const DELETE = async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const account_id = searchParams.get("account_id");
  const peer_id = searchParams.get("peer_id");

  if (!account_id || !peer_id) {
    return NextResponse.json(
      { error: "account_id and peer_id are required." },
      { status: 400 }
    );
  }

  const supabase = getServiceClient();
  const { error: msgError } = await supabase
    .from("kw_autoreply_messages")
    .delete()
    .eq("account_id", account_id)
    .eq("peer_id", peer_id);
  if (msgError) {
    return NextResponse.json({ error: msgError.message }, { status: 400 });
  }

  const { error: metaError } = await supabase
    .from("kw_conversations")
    .delete()
    .eq("account_id", account_id)
    .eq("peer_id", peer_id);
  if (metaError) {
    return NextResponse.json({ error: metaError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
};
