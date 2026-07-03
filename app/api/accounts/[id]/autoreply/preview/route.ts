import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getServiceClient } from "@/lib/supabase";
import {
  buildAutoReplyMessages,
  isSmallTalk,
  lengthBudget,
  sanitizeReply,
  splitIntoMessages,
} from "@/lib/autoreplyPrompt";
import type { AutoreplyConfig } from "@/lib/types";

export const runtime = "nodejs";

type Body = {
  sample?: string;
  settings?: Partial<AutoreplyConfig>;
};

// Generates a sample auto-reply from the (possibly unsaved) form settings so the
// user can tune persona/style before going live. Uses the exact same prompt
// builder as the worker.
export const POST = async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const { sample, settings } = (await request.json()) as Body;

  const text = (sample ?? "").trim();
  if (!text) {
    return NextResponse.json(
      { error: "Enter a sample message to preview." },
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

  const s = settings ?? {};

  const supabase = getServiceClient();
  const { data: account } = await supabase
    .from("kw_accounts")
    .select("first_name, username, label")
    .eq("id", id)
    .maybeSingle();

  const personaName =
    s.autoreply_name?.trim() ||
    account?.first_name ||
    account?.username ||
    account?.label ||
    "Me";

  // Greetings/small-talk collapse to one short casual line, mirroring the worker.
  const brief = isSmallTalk(text);

  const { system, user, maxTokens } = buildAutoReplyMessages({
    personaName,
    persona: s.autoreply_persona ?? null,
    instructions: s.autoreply_instructions ?? null,
    isGroup: false,
    history: [],
    incomingText: text,
    tone: s.autoreply_tone ?? null,
    emojiLevel: s.autoreply_emoji_level ?? null,
    length: s.autoreply_length ?? null,
    formality: s.autoreply_formality ?? null,
    language: s.autoreply_language ?? null,
    examples: s.autoreply_examples ?? null,
    faq: s.autoreply_faq ?? null,
    askQuestions: s.autoreply_ask_questions,
    matchMood: s.autoreply_match_mood,
    avoid: s.autoreply_avoid ?? null,
    signoff: s.autoreply_signoff ?? null,
    noAssistantTone: s.autoreply_no_assistant_tone ?? true,
    brief,
  });

  const openai = new OpenAI({ apiKey });
  try {
    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.9,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const reply = sanitizeReply(
      completion.choices[0]?.message?.content ?? "",
      personaName
    );
    const chunks = splitIntoMessages(
      reply,
      brief ? 1 : lengthBudget(s.autoreply_length ?? null).maxSentences
    );
    return NextResponse.json({ reply, chunks });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to preview.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
};
