import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { callWorker } from "@/lib/worker-client";

export const runtime = "nodejs";

export const DELETE = async (
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  // Stop the live listener, then disconnect the client - best effort.
  try {
    await callWorker(`/accounts/${id}/autoreply/stop`);
  } catch {
    // Worker may be down; continue.
  }
  try {
    await callWorker(`/accounts/${id}/disconnect`);
  } catch {
    // Worker may be down; continue with DB cleanup.
  }
  // Archive instead of hard-deleting so the account's conversation history is
  // preserved (kw_autoreply_messages / kw_conversations cascade on real delete).
  const supabase = getServiceClient();
  const { error } = await supabase
    .from("kw_accounts")
    .update({
      archived: true,
      autoreply_enabled: false,
      session_enc: null,
      status: "offline",
    })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
};
