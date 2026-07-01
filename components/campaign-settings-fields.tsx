"use client";

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type { Account, CampaignVenue, ParticipantConfig } from "@/lib/types";
import {
  AUTOREPLY_EMOJI_LEVELS,
  AUTOREPLY_FORMALITIES,
  AUTOREPLY_LANGUAGES,
  AUTOREPLY_LENGTHS,
  CONVERSATION_STYLES,
  MAX_PARTICIPANTS,
  MIN_PARTICIPANTS,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { GroupPicker } from "@/components/group-picker";
import {
  detectTimezone,
  listTimezones,
  localToUtcIso,
} from "@/lib/schedule";

export type Selection = Record<string, ParticipantConfig>;

export type CampaignFormValue = {
  name: string;
  topic: string;
  style: string;
  extra: string;
  venue: CampaignVenue;
  targetChat: string;
  minDelay: number;
  maxDelay: number;
  maxMessages: number;
  dryRun: boolean;
  model: string;
  selection: Selection;
  scheduleEnabled: boolean;
  scheduleLocal: string;
  timezone: string;
};

// Per-participant voice & realism defaults applied when an account is selected.
export const defaultParticipantVoice = (): Pick<
  ParticipantConfig,
  | "language"
  | "emoji_level"
  | "formality"
  | "msg_length"
  | "humanize"
  | "no_assistant_tone"
  | "reply_threading"
  | "avoid_topics"
  | "objective"
> => ({
  language: "mirror",
  emoji_level: "sometimes",
  formality: "casual",
  msg_length: "normal",
  humanize: true,
  no_assistant_tone: false,
  reply_threading: false,
  avoid_topics: null,
  objective: null,
});

export const emptyCampaignForm = (): CampaignFormValue => ({
  name: "",
  topic: "",
  style: CONVERSATION_STYLES[0],
  extra: "",
  venue: "group",
  targetChat: "",
  minDelay: 8,
  maxDelay: 30,
  maxMessages: 40,
  dryRun: true,
  model: "gpt-4o-mini",
  selection: {},
  scheduleEnabled: false,
  scheduleLocal: "",
  timezone: detectTimezone(),
});

// Shared validation for both the builder and the edit dialog.
export const validateCampaignForm = (value: CampaignFormValue): string | null => {
  if (!value.name.trim() || !value.topic.trim()) {
    return "Name and topic are required.";
  }
  const count = Object.keys(value.selection).length;
  if (count < MIN_PARTICIPANTS) {
    return `Select at least ${MIN_PARTICIPANTS} participants.`;
  }
  if (count > MAX_PARTICIPANTS) {
    return `Maximum ${MAX_PARTICIPANTS} participants.`;
  }
  if (value.venue === "group" && !value.targetChat.trim()) {
    return "Group campaigns need a target chat (e.g. @mygroup).";
  }
  if (value.minDelay > value.maxDelay) {
    return "Min delay cannot exceed max delay.";
  }
  if (value.scheduleEnabled) {
    if (!value.scheduleLocal) {
      return "Pick a date and time for the scheduled launch.";
    }
    const iso = localToUtcIso(value.scheduleLocal, value.timezone);
    if (!iso) return "The scheduled date/time is invalid.";
    if (new Date(iso).getTime() <= Date.now()) {
      return "The scheduled time must be in the future.";
    }
  }
  return null;
};

// Resolve the form's schedule fields into the API payload shape.
export const scheduleToPayload = (
  value: CampaignFormValue
): { start_at: string | null; timezone: string | null } => {
  if (!value.scheduleEnabled) return { start_at: null, timezone: null };
  return {
    start_at: localToUtcIso(value.scheduleLocal, value.timezone),
    timezone: value.timezone,
  };
};

type Props = {
  value: CampaignFormValue;
  onChange: (patch: Partial<CampaignFormValue>) => void;
  accounts: Account[];
  // When editing an existing campaign that already has history, the venue and
  // target are locked because switching them mid-conversation is incoherent.
  lockVenue?: boolean;
  // Rendered under the participants card (e.g. submit button).
  footer?: ReactNode;
};

export const CampaignSettingsFields = ({
  value,
  onChange,
  accounts,
  lockVenue = false,
  footer,
}: Props) => {
  const count = Object.keys(value.selection).length;

  const [expandedVoice, setExpandedVoice] = useState<Set<string>>(new Set());
  const toggleVoice = (id: string) =>
    setExpandedVoice((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const timezones = useMemo(() => listTimezones(), []);

  const onlineAccounts = useMemo(
    () => accounts.filter((a) => a.status === "online" || value.dryRun),
    [accounts, value.dryRun]
  );

  const toggleAccount = (account: Account) => {
    const next = { ...value.selection };
    if (next[account.id]) {
      delete next[account.id];
      onChange({ selection: next });
      return;
    }
    if (Object.keys(next).length >= MAX_PARTICIPANTS) return;
    next[account.id] = {
      account_id: account.id,
      persona_name: account.first_name || account.label,
      persona_traits: "",
      ...defaultParticipantVoice(),
    };
    onChange({ selection: next });
  };

  const updateParticipant = (
    id: string,
    patch: Partial<ParticipantConfig>
  ) => {
    onChange({
      selection: {
        ...value.selection,
        [id]: { ...value.selection[id], ...patch },
      },
    });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Conversation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Campaign name</Label>
              <Input
                id="name"
                placeholder="Crypto bros vs skeptics"
                value={value.name}
                onChange={(e) => onChange({ name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="topic">Topic</Label>
              <Textarea
                id="topic"
                placeholder="Is Bitcoin going to replace fiat currency?"
                value={value.topic}
                onChange={(e) => onChange({ topic: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Style</Label>
              <Select
                value={value.style}
                onValueChange={(style) => onChange({ style })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONVERSATION_STYLES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="extra">Extra instructions (optional)</Label>
              <Textarea
                id="extra"
                placeholder="Keep it civil, no profanity, reference recent news..."
                value={value.extra}
                onChange={(e) => onChange({ extra: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Venue & timing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label>Venue</Label>
              <Tabs
                value={value.venue}
                onValueChange={(v) => {
                  if (lockVenue) return;
                  onChange({ venue: v as CampaignVenue });
                }}
              >
                <TabsList>
                  <TabsTrigger value="group" disabled={lockVenue}>
                    Group chat
                  </TabsTrigger>
                  <TabsTrigger value="pair" disabled={lockVenue}>
                    1-on-1 pairs
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {lockVenue ? (
                <p className="text-xs text-muted-foreground">
                  Venue is locked once a campaign has run. Duplicate it to start
                  a fresh one with a different venue.
                </p>
              ) : null}
            </div>

            {value.venue === "group" ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="target">Target group</Label>
                  {!lockVenue ? (
                    <GroupPicker
                      accounts={accounts}
                      onSelect={(targetChat) => onChange({ targetChat })}
                    />
                  ) : null}
                </div>
                <Input
                  id="target"
                  placeholder="@mygroup or -1001234567890"
                  value={value.targetChat}
                  disabled={lockVenue}
                  onChange={(e) => onChange({ targetChat: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  All selected accounts must already be members of this group.
                  Use Browse groups to look up the ID from a connected account.
                </p>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                Participants are paired consecutively (1-2, 3-4, ...). Each
                account needs a public @username (or to be in the other&apos;s
                contacts) to start a 1-on-1 chat.
              </p>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Delay between messages</Label>
                <span className="text-sm text-muted-foreground">
                  {value.minDelay}s – {value.maxDelay}s
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Input
                  type="number"
                  min={1}
                  value={value.minDelay}
                  onChange={(e) => onChange({ minDelay: Number(e.target.value) })}
                  className="w-20"
                  aria-label="Minimum delay seconds"
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="number"
                  min={1}
                  value={value.maxDelay}
                  onChange={(e) => onChange({ maxDelay: Number(e.target.value) })}
                  className="w-20"
                  aria-label="Maximum delay seconds"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Total messages</Label>
                <span className="text-sm text-muted-foreground">
                  {value.maxMessages}
                </span>
              </div>
              <Slider
                value={[value.maxMessages]}
                min={2}
                max={500}
                step={1}
                onValueChange={(v) => onChange({ maxMessages: v[0] })}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="model">OpenAI model</Label>
              <Input
                id="model"
                value={value.model}
                onChange={(e) => onChange({ model: e.target.value })}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="dry">Dry run (test mode)</Label>
                <p className="text-xs text-muted-foreground">
                  Generate & log replies without sending to Telegram.
                </p>
              </div>
              <Switch
                id="dry"
                checked={value.dryRun}
                onCheckedChange={(dryRun) => onChange({ dryRun })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="schedule">Schedule for later</Label>
                <p className="text-xs text-muted-foreground">
                  Launch the conversation automatically at a set time.
                </p>
              </div>
              <Switch
                id="schedule"
                checked={value.scheduleEnabled}
                onCheckedChange={(scheduleEnabled) =>
                  onChange({ scheduleEnabled })
                }
              />
            </div>

            {value.scheduleEnabled ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="schedule-at">Launch date & time</Label>
                  <Input
                    id="schedule-at"
                    type="datetime-local"
                    value={value.scheduleLocal}
                    onChange={(e) =>
                      onChange({ scheduleLocal: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Timezone</Label>
                  <Select
                    value={value.timezone}
                    onValueChange={(timezone) => onChange({ timezone })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select timezone" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {timezones.map((tz) => (
                        <SelectItem key={tz} value={tz}>
                          {tz}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    The launch time is interpreted in this timezone.
                  </p>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Participants
              <Badge variant={count >= MIN_PARTICIPANTS ? "success" : "secondary"}>
                {count} selected
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {accounts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No accounts yet. Connect accounts first.
              </p>
            ) : null}
            {!value.dryRun && onlineAccounts.length === 0 && accounts.length > 0 ? (
              <p className="text-sm text-muted-foreground">
                No online accounts. Connect accounts or enable dry run.
              </p>
            ) : null}

            {accounts.map((account) => {
              const isSelected = Boolean(value.selection[account.id]);
              const selectable = value.dryRun || account.status === "online";
              return (
                <div
                  key={account.id}
                  className={cn("rounded-lg border p-3 transition-colors", {
                    "border-primary bg-accent/40": isSelected,
                    "opacity-50": !selectable && !isSelected,
                  })}
                >
                  <button
                    type="button"
                    className="flex w-full items-center justify-between text-left"
                    onClick={() => toggleAccount(account)}
                    disabled={!selectable && !isSelected}
                    aria-pressed={isSelected}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {account.label}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {account.username
                          ? `@${account.username}`
                          : account.phone}{" "}
                        · {account.status}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full border",
                        { "bg-primary text-primary-foreground": isSelected }
                      )}
                    >
                      {isSelected ? <Check className="h-3 w-3" /> : null}
                    </span>
                  </button>

                  {isSelected ? (
                    <div className="mt-3 space-y-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input
                          placeholder="Persona name"
                          value={value.selection[account.id].persona_name}
                          onChange={(e) =>
                            updateParticipant(account.id, {
                              persona_name: e.target.value,
                            })
                          }
                        />
                        <Input
                          placeholder="Traits / stance (e.g. angry bitcoin maxi)"
                          value={value.selection[account.id].persona_traits}
                          onChange={(e) =>
                            updateParticipant(account.id, {
                              persona_traits: e.target.value,
                            })
                          }
                        />
                      </div>

                      <button
                        type="button"
                        className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm font-medium"
                        onClick={() => toggleVoice(account.id)}
                        aria-expanded={expandedVoice.has(account.id)}
                      >
                        Voice & realism
                        {expandedVoice.has(account.id) ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>

                      {expandedVoice.has(account.id) ? (
                        <div className="space-y-3 rounded-md border p-3">
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label className="text-xs">Language</Label>
                              <Select
                                value={value.selection[account.id].language}
                                onValueChange={(language) =>
                                  updateParticipant(account.id, { language })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {AUTOREPLY_LANGUAGES.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>
                                      {o.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Emoji usage</Label>
                              <Select
                                value={value.selection[account.id].emoji_level}
                                onValueChange={(emoji_level) =>
                                  updateParticipant(account.id, { emoji_level })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {AUTOREPLY_EMOJI_LEVELS.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>
                                      {o.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Formality</Label>
                              <Select
                                value={value.selection[account.id].formality}
                                onValueChange={(formality) =>
                                  updateParticipant(account.id, { formality })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {AUTOREPLY_FORMALITIES.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>
                                      {o.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Message length</Label>
                              <Select
                                value={value.selection[account.id].msg_length}
                                onValueChange={(msg_length) =>
                                  updateParticipant(account.id, { msg_length })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {AUTOREPLY_LENGTHS.map((o) => (
                                    <SelectItem key={o.value} value={o.value}>
                                      {o.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-3">
                            <Label className="text-xs">Humanize</Label>
                            <Switch
                              checked={value.selection[account.id].humanize}
                              onCheckedChange={(humanize) =>
                                updateParticipant(account.id, { humanize })
                              }
                            />
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <Label className="text-xs">No assistant tone</Label>
                            <Switch
                              checked={
                                value.selection[account.id].no_assistant_tone
                              }
                              onCheckedChange={(no_assistant_tone) =>
                                updateParticipant(account.id, {
                                  no_assistant_tone,
                                })
                              }
                            />
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <Label className="text-xs">
                              Reply-threading (groups)
                            </Label>
                            <Switch
                              checked={
                                value.selection[account.id].reply_threading
                              }
                              onCheckedChange={(reply_threading) =>
                                updateParticipant(account.id, {
                                  reply_threading,
                                })
                              }
                            />
                          </div>

                          <div className="space-y-1.5">
                            <Label className="text-xs">
                              Avoid topics / words
                            </Label>
                            <Textarea
                              placeholder="politics, competitor names..."
                              value={
                                value.selection[account.id].avoid_topics ?? ""
                              }
                              onChange={(e) =>
                                updateParticipant(account.id, {
                                  avoid_topics: e.target.value || null,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Objective / CTA</Label>
                            <Textarea
                              placeholder="Naturally steer toward sharing a link..."
                              value={
                                value.selection[account.id].objective ?? ""
                              }
                              onChange={(e) =>
                                updateParticipant(account.id, {
                                  objective: e.target.value || null,
                                })
                              }
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {footer}
      </div>
    </div>
  );
};
