// Deterministic emoji helpers for the auto-responder: detect emoji-only
// messages and reply with a similar/related emoji (no AI call needed).

// Matches a single emoji sequence: optional base pictographic + modifiers,
// ZWJ-joined sequences, variation selectors, and flag pairs.
const EMOJI_SEQUENCE =
  /(?:\p{Regional_Indicator}\p{Regional_Indicator})|(?:\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|[\u{1F3FB}-\u{1F3FF}])?)*)/gu;

// Anything that is allowed to appear alongside emojis without counting as text
// (whitespace and stray modifier/joiner code points).
const NON_TEXT = /[\s\uFE0F\u200D\u{1F3FB}-\u{1F3FF}]/gu;

// Returns true if the message is made up only of emojis (at least one) and
// contains no real words/characters.
export const isEmojiOnly = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const emojis = trimmed.match(EMOJI_SEQUENCE);
  if (!emojis || emojis.length === 0) return false;
  const stripped = trimmed.replace(EMOJI_SEQUENCE, "").replace(NON_TEXT, "");
  return stripped.length === 0;
};

// Groups of related emojis. A reply is picked from the same group as the
// incoming emoji so the reaction feels natural and varied.
const EMOJI_GROUPS: string[][] = [
  ["😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "🙂", "😊", "☺️", "😉", "😸"],
  [
    "❤️", "🧡", "💛", "💚", "💙", "💜", "🤎", "🖤", "🤍", "💕", "💖", "💗",
    "💓", "💞", "💝", "😍", "🥰", "😘", "😻",
  ],
  ["😢", "😭", "😞", "😔", "🙁", "☹️", "😟", "😥", "😿", "💔"],
  ["😠", "😡", "🤬", "👿", "😤", "💢"],
  ["😎", "🤙", "🔥", "✨", "🤩", "😏", "💯"],
  ["👍", "👌", "🙌", "👏", "💪", "✅", "🤝", "🆗"],
  ["👎", "❌", "🙅", "🚫", "🙅‍♂️"],
  ["😮", "😯", "😲", "😱", "🤯", "😳", "😦", "😧"],
  ["🤔", "🧐", "🤨", "🙄"],
  ["👋", "🙋", "🤚", "✋", "🖐️"],
  ["🎉", "🥳", "🎊", "🎈", "🍻", "🥂"],
  ["😴", "😪", "🥱", "💤"],
  ["😋", "😛", "😜", "🤪", "😝"],
  ["🙏", "🛐", "🤲"],
  ["🤗", "🫂"],
];

// Extract the first emoji sequence from a string.
const firstEmoji = (text: string): string | null => {
  const match = text.match(EMOJI_SEQUENCE);
  return match && match[0] ? match[0] : null;
};

const pickRandom = <T>(items: T[]): T =>
  items[Math.floor(Math.random() * items.length)];

// Given an emoji-only message, return a single similar/related emoji to reply
// with. Falls back to echoing the same emoji when it has no known group.
export const pickSimilarEmoji = (text: string): string => {
  const emoji = firstEmoji(text) ?? text.trim();
  const group = EMOJI_GROUPS.find((g) => g.includes(emoji));
  if (!group) return emoji;

  // Prefer a different emoji from the same group so it doesn't just mirror.
  const others = group.filter((e) => e !== emoji);
  return others.length > 0 ? pickRandom(others) : emoji;
};
