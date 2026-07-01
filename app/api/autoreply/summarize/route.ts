import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getServiceClient } from "@/lib/supabase";
import { buildSummarySystemPrompt, buildTranscript } from "@/lib/summary";
import type { ConversationInsert } from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  account_id?: string;
  peer_id?: string;
  // Force regeneration even if a fresh cached summary exists.
  force?: boolean;
};

export const POST = async (request: Request) => {
  const { account_id, peer_id, force } = (await request.json()) as Body;
  if (!account_id || !peer_id) {
    return NextResponse.json(
      { error: "account_id and peer_id are required." },
      { status: 400 }
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured." },
      { status: 500 }
    );
  }

  const supabase = getServiceClient();
  const { data: messages, error } = await supabase
    .from("kw_autoreply_messages")
    .select("peer_name, incoming, reply, created_at")
    .eq("account_id", account_id)
    .eq("peer_id", peer_id)
    .order("created_at", { ascending: true })
    .limit(60);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  if (!messages || messages.length === 0) {
    return NextResponse.json({ summary: "No messages to summarize yet." });
  }

  const lastAt = messages[messages.length - 1]?.created_at;

  // Read the cached row; serve it unless forced or there are newer messages.
  const { data: existing } = await supabase
    .from("kw_conversations")
    .select("*")
    .eq("account_id", account_id)
    .eq("peer_id", peer_id)
    .maybeSingle();

  const hasNew =
    !existing?.summarized_through ||
    (lastAt &&
      new Date(lastAt).getTime() >
        new Date(existing.summarized_through).getTime());

  if (!force && existing?.summary && !hasNew) {
    return NextResponse.json({
      summary: existing.summary,
      cached: true,
      summary_updated_at: existing.summary_updated_at,
    });
  }

  const peerName = messages[0]?.peer_name ?? "the contact";
  const transcript = buildTranscript(messages, peerName);

  const openai = new OpenAI({ apiKey });
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.3,
      max_tokens: 220,
      messages: [
        { role: "system", content: buildSummarySystemPrompt(peerName) },
        { role: "user", content: transcript },
      ],
    });
    const summary = completion.choices[0]?.message?.content?.trim() ?? "";
    const nowIso = new Date().toISOString();

    const update: ConversationInsert = {
      account_id,
      peer_id,
      peer_name: peerName,
      last_message_at: lastAt,
      summary,
      summary_updated_at: nowIso,
      summarized_through: lastAt,
      updated_at: nowIso,
    };
    await supabase
      .from("kw_conversations")
      .upsert(update, { onConflict: "account_id,peer_id" });

    return NextResponse.json({
      summary,
      count: messages.length,
      summary_updated_at: nowIso,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to summarize.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
};
