// Shared persona color palette. Lives in a non-client module so server
// components (e.g. the campaign detail page) can call buildPalette() while the
// client CampaignMonitor imports the same helpers.

export type PersonaInfo = {
  name: string;
  label: string;
  color: string;
};

const PALETTE = [
  "text-rose-500",
  "text-sky-500",
  "text-emerald-500",
  "text-amber-500",
  "text-violet-500",
  "text-fuchsia-500",
  "text-cyan-500",
  "text-orange-500",
  "text-lime-500",
  "text-indigo-500",
  "text-pink-500",
  "text-teal-500",
];

export const buildPalette = (index: number): string =>
  PALETTE[index % PALETTE.length];
