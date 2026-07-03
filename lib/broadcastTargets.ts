import type { BroadcastTargetInput } from "./types";

// Classify a single raw recipient entry as a @username or a numeric Telegram id.
// Returns null for entries that are neither a plausible username nor an id.
const classifyTarget = (raw: string): BroadcastTargetInput | null => {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Numeric id (Telegram user ids are positive integers).
  if (/^\d{5,}$/.test(trimmed)) {
    return { input: trimmed, kind: "id" };
  }

  // Username: strip a leading @ and validate Telegram's 5-32 char rule.
  const handle = trimmed.replace(/^@/, "");
  if (/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(handle)) {
    return { input: `@${handle}`, kind: "username" };
  }

  return null;
};

// Normalize + dedupe a list of raw recipient lines (pasted or CSV rows).
// Returns the valid targets plus any lines that couldn't be classified.
export const normalizeTargets = (
  raw: string[]
): { valid: BroadcastTargetInput[]; invalid: string[] } => {
  const seen = new Set<string>();
  const valid: BroadcastTargetInput[] = [];
  const invalid: string[] = [];

  for (const line of raw) {
    const target = classifyTarget(line);
    if (!target) {
      if (line.trim()) invalid.push(line.trim());
      continue;
    }
    const key = target.input.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(target);
  }

  return { valid, invalid };
};
