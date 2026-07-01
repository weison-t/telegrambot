// Shared helpers for building the conversation-summary prompt so the Next.js
// API route and the worker sweep produce consistent summaries.

export type SummaryLine = {
  peer_name?: string | null;
  incoming?: string | null;
  reply?: string | null;
};

export const buildTranscript = (
  lines: SummaryLine[],
  peerName: string
): string =>
  lines
    .map((m) => {
      // Rows are now per-direction: an inbound row has `incoming`, an outbound
      // (auto-reply) row has `reply`. Only emit the side that is present so
      // inbound-only messages don't add blank "Me:" lines.
      const parts: string[] = [];
      if (m.incoming) parts.push(`${peerName}: ${m.incoming}`);
      if (m.reply) parts.push(`Me: ${m.reply}`);
      return parts.join("\n");
    })
    .filter(Boolean)
    .join("\n\n");

export const buildSummarySystemPrompt = (peerName: string): string =>
  [
    `Summarize this chat between the account owner ("Me") and ${peerName} so the owner can glance at what happened without reading it all.`,
    `Write 2-3 short sentences, then list any concrete outcomes (appointments/times agreed, decisions, open questions or things needing a follow-up) as short bullet points starting with "- ". If there are none, omit the bullets.`,
    `Be factual and concise. Do not invent details.`,
  ].join("\n");
