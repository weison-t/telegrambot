"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  ChevronRight,
  Loader2,
  ShieldAlert,
  Sparkles,
  Wand2,
} from "lucide-react";
import type {
  Account,
  AutoreplyAudience,
  AutoreplyScope,
  AutoreplyEmojiLevel,
  AutoreplyLength,
  AutoreplyFormality,
  AutoreplyOffhoursBehavior,
} from "@/lib/types";
import {
  AUTOREPLY_AUDIENCES,
  AUTOREPLY_SCOPES,
  AUTOREPLY_EMOJI_LEVELS,
  AUTOREPLY_LENGTHS,
  AUTOREPLY_FORMALITIES,
  AUTOREPLY_LANGUAGES,
  AUTOREPLY_OFFHOURS_BEHAVIORS,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccountStatusBadge } from "@/components/account-status-badge";
import { cn } from "@/lib/utils";

type AccountState = {
  enabled: boolean;
  name: string;
  persona: string;
  instructions: string;
  scope: AutoreplyScope;
  audience: AutoreplyAudience;
  minDelay: number;
  maxDelay: number;
  dailyLimit: number;
  whitelist: string;
  appointmentEnabled: boolean;
  mediaRelay: boolean;
  mediaReceiver: string;
  pricingRelay: boolean;
  receiver: string;
  timezone: string;
  reminderRecipient: string;
  reminderOffsets: string;
  // Voice & style
  tone: string;
  emojiLevel: AutoreplyEmojiLevel;
  length: AutoreplyLength;
  formality: AutoreplyFormality;
  language: string;
  // Knowledge
  examples: string;
  faq: string;
  // Behavior
  hoursEnabled: boolean;
  activeStart: string;
  activeEnd: string;
  offhoursBehavior: AutoreplyOffhoursBehavior;
  awayMessage: string;
  scaleDelay: boolean;
  askQuestions: boolean;
  matchMood: boolean;
  avoid: string;
  signoff: string;
  guardEnabled: boolean;
  alertRecipient: string;
  noAssistantTone: boolean;
  saving: boolean;
  // Preview panel (transient)
  previewSample: string;
  previewLoading: boolean;
  previewChunks: string[] | null;
  previewError: string | null;
};

const initialState = (
  account: Account,
  whitelist: string[]
): AccountState => ({
  enabled: account.autoreply_enabled,
  name: account.autoreply_name ?? "",
  persona: account.autoreply_persona ?? "",
  instructions: account.autoreply_instructions ?? "",
  scope: account.autoreply_scope as AutoreplyScope,
  audience: account.autoreply_audience as AutoreplyAudience,
  minDelay: account.autoreply_min_delay_s,
  maxDelay: account.autoreply_max_delay_s,
  dailyLimit: account.autoreply_daily_limit,
  whitelist: whitelist.join("\n"),
  appointmentEnabled: account.autoreply_appointment_enabled,
  mediaRelay: account.autoreply_media_relay ?? false,
  mediaReceiver: account.autoreply_media_receiver ?? "",
  pricingRelay: account.autoreply_pricing_relay ?? false,
  receiver: account.autoreply_receiver ?? "",
  timezone: account.autoreply_timezone ?? "Asia/Kuala_Lumpur",
  reminderRecipient: account.autoreply_reminder_recipient ?? "",
  reminderOffsets: account.autoreply_reminder_offsets ?? "1440,30",
  tone: account.autoreply_tone ?? "friendly",
  emojiLevel: (account.autoreply_emoji_level ?? "sometimes") as AutoreplyEmojiLevel,
  length: (account.autoreply_length ?? "normal") as AutoreplyLength,
  formality: (account.autoreply_formality ?? "casual") as AutoreplyFormality,
  language: account.autoreply_language ?? "mirror",
  examples: account.autoreply_examples ?? "",
  faq: account.autoreply_faq ?? "",
  hoursEnabled: account.autoreply_hours_enabled,
  activeStart: account.autoreply_active_start ?? "09:00",
  activeEnd: account.autoreply_active_end ?? "23:00",
  offhoursBehavior: (account.autoreply_offhours_behavior ??
    "silent") as AutoreplyOffhoursBehavior,
  awayMessage: account.autoreply_away_message ?? "",
  scaleDelay: account.autoreply_scale_delay ?? true,
  askQuestions: account.autoreply_ask_questions,
  matchMood: account.autoreply_match_mood ?? true,
  avoid: account.autoreply_avoid ?? "",
  signoff: account.autoreply_signoff ?? "",
  guardEnabled: account.autoreply_guard_enabled ?? true,
  alertRecipient: account.autoreply_alert_recipient ?? "",
  noAssistantTone: account.autoreply_no_assistant_tone ?? true,
  saving: false,
  previewSample: "",
  previewLoading: false,
  previewChunks: null,
  previewError: null,
});

type Props = {
  accounts: Account[];
  whitelists: Record<string, string[]>;
};

export const AutoreplyManager = ({ accounts, whitelists }: Props) => {
  const [states, setStates] = useState<Record<string, AccountState>>(() =>
    Object.fromEntries(
      accounts.map((a) => [a.id, initialState(a, whitelists[a.id] ?? [])])
    )
  );

  const update = (id: string, patch: Partial<AccountState>) =>
    setStates((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  // Cards are collapsed by default; expand one to reveal its settings.
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggleExpand = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  // The settings object shared by the save and preview endpoints.
  const buildSettings = (s: AccountState) => ({
    autoreply_enabled: s.enabled,
    autoreply_name: s.name,
    autoreply_persona: s.persona,
    autoreply_instructions: s.instructions,
    autoreply_scope: s.scope,
    autoreply_audience: s.audience,
    autoreply_min_delay_s: s.minDelay,
    autoreply_max_delay_s: s.maxDelay,
    autoreply_daily_limit: s.dailyLimit,
    autoreply_appointment_enabled: s.appointmentEnabled,
    autoreply_media_relay: s.mediaRelay,
    autoreply_media_receiver: s.mediaReceiver,
    autoreply_pricing_relay: s.pricingRelay,
    autoreply_receiver: s.receiver,
    autoreply_timezone: s.timezone,
    autoreply_reminder_recipient: s.reminderRecipient,
    autoreply_reminder_offsets: s.reminderOffsets,
    autoreply_tone: s.tone,
    autoreply_emoji_level: s.emojiLevel,
    autoreply_length: s.length,
    autoreply_formality: s.formality,
    autoreply_language: s.language,
    autoreply_examples: s.examples,
    autoreply_faq: s.faq,
    autoreply_hours_enabled: s.hoursEnabled,
    autoreply_active_start: s.activeStart,
    autoreply_active_end: s.activeEnd,
    autoreply_offhours_behavior: s.offhoursBehavior,
    autoreply_away_message: s.awayMessage,
    autoreply_scale_delay: s.scaleDelay,
    autoreply_ask_questions: s.askQuestions,
    autoreply_match_mood: s.matchMood,
    autoreply_avoid: s.avoid,
    autoreply_signoff: s.signoff,
    autoreply_guard_enabled: s.guardEnabled,
    autoreply_alert_recipient: s.alertRecipient,
    autoreply_no_assistant_tone: s.noAssistantTone,
  });

  const save = async (account: Account) => {
    const s = states[account.id];
    update(account.id, { saving: true });
    try {
      const res = await fetch(`/api/accounts/${account.id}/autoreply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...buildSettings(s),
          whitelist: s.whitelist
            .split(/[\n,]/)
            .map((p) => p.trim())
            .filter(Boolean),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      if (data.warning) {
        toast.warning(data.warning);
      } else {
        toast.success(
          s.enabled ? "Auto-reply enabled." : "Auto-reply saved (off)."
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      update(account.id, { saving: false });
    }
  };

  const preview = async (account: Account) => {
    const s = states[account.id];
    if (!s.previewSample.trim()) {
      toast.error("Enter a sample message to preview.");
      return;
    }
    update(account.id, {
      previewLoading: true,
      previewError: null,
    });
    try {
      const res = await fetch(
        `/api/accounts/${account.id}/autoreply/preview`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sample: s.previewSample,
            settings: buildSettings(s),
          }),
        }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      update(account.id, {
        previewLoading: false,
        previewChunks: (data.chunks as string[]) ?? [data.reply],
      });
    } catch (err) {
      update(account.id, {
        previewLoading: false,
        previewError: err instanceof Error ? err.message : "Failed",
      });
    }
  };

  if (accounts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No accounts yet. Connect an account first to enable auto-reply.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {accounts.map((account) => {
          const s = states[account.id];
          const isOpen = Boolean(expanded[account.id]);
          return (
            <Card key={account.id}>
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <button
                  type="button"
                  onClick={() => toggleExpand(account.id)}
                  aria-expanded={isOpen}
                  aria-label={`Toggle settings for ${account.label}`}
                  className="flex flex-1 items-center gap-3 text-left"
                >
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                      { "rotate-90": isOpen }
                    )}
                  />
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-base">
                      {account.label}
                      <AccountStatusBadge status={account.status} />
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-medium",
                          {
                            "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400":
                              s.enabled,
                            "bg-muted text-muted-foreground": !s.enabled,
                          }
                        )}
                      >
                        {s.enabled ? "Auto-reply on" : "Auto-reply off"}
                      </span>
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {account.username
                        ? `@${account.username}`
                        : account.phone}
                    </p>
                  </div>
                </button>
                <Switch
                  checked={s.enabled}
                  onCheckedChange={(v) => update(account.id, { enabled: v })}
                  aria-label="Enable auto-reply"
                />
              </CardHeader>
              {isOpen ? (
              <CardContent className="space-y-4">
                {account.status !== "online" ? (
                  <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
                    This account must be connected (online) for auto-reply to run.
                  </p>
                ) : null}

                <div className="space-y-2">
                  <Label>Display name</Label>
                  <Input
                    placeholder="e.g. DavidG (name used when someone asks)"
                    value={s.name}
                    onChange={(e) =>
                      update(account.id, { name: e.target.value })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    The name the AI uses for itself. Leave blank to use the
                    account&apos;s real Telegram name.
                  </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Personality</Label>
                    <Input
                      placeholder="friendly, witty, helpful"
                      value={s.persona}
                      onChange={(e) =>
                        update(account.id, { persona: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Daily reply limit</Label>
                    <Input
                      type="number"
                      min={1}
                      value={s.dailyLimit}
                      onChange={(e) =>
                        update(account.id, {
                          dailyLimit: Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Instructions</Label>
                  <Textarea
                    placeholder="Answer questions about my schedule, keep it short and polite..."
                    value={s.instructions}
                    onChange={(e) =>
                      update(account.id, { instructions: e.target.value })
                    }
                  />
                </div>

                {/* Voice & style */}
                <div className="space-y-3 rounded-lg border p-3">
                  <Label className="text-sm font-semibold">Voice &amp; style</Label>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Tone
                      </Label>
                      <Input
                        placeholder="friendly, witty, sarcastic..."
                        value={s.tone}
                        onChange={(e) =>
                          update(account.id, { tone: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Emoji usage
                      </Label>
                      <Select
                        value={s.emojiLevel}
                        onValueChange={(v) =>
                          update(account.id, {
                            emojiLevel: v as AutoreplyEmojiLevel,
                          })
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
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Reply length
                      </Label>
                      <Select
                        value={s.length}
                        onValueChange={(v) =>
                          update(account.id, { length: v as AutoreplyLength })
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
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Formality
                      </Label>
                      <Select
                        value={s.formality}
                        onValueChange={(v) =>
                          update(account.id, {
                            formality: v as AutoreplyFormality,
                          })
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
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Language
                      </Label>
                      <Select
                        value={s.language}
                        onValueChange={(v) =>
                          update(account.id, { language: v })
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
                  </div>
                  <div className="flex flex-wrap gap-4 pt-1">
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={s.askQuestions}
                        onCheckedChange={(v) =>
                          update(account.id, { askQuestions: v })
                        }
                        aria-label="Ask follow-up questions"
                      />
                      Ask follow-up questions
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={s.matchMood}
                        onCheckedChange={(v) =>
                          update(account.id, { matchMood: v })
                        }
                        aria-label="Match their mood"
                      />
                      Match their mood
                    </label>
                    <label className="flex items-center gap-2 text-xs">
                      <Switch
                        checked={s.noAssistantTone}
                        onCheckedChange={(v) =>
                          update(account.id, { noAssistantTone: v })
                        }
                        aria-label="Avoid assistant / customer-service tone"
                      />
                      No assistant / customer-service tone
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    &quot;No assistant tone&quot; stops chirpy support-style
                    replies like &quot;happy to help!&quot; or &quot;what can I
                    do for you?&quot; so it sounds like a normal person texting.
                  </p>
                </div>

                {/* Knowledge & examples */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Knowledge / FAQ</Label>
                    <Textarea
                      placeholder={
                        "Facts the AI can use, e.g.\nPricing: starts at RM500, share after a quick call\nServices: web apps, automation"
                      }
                      value={s.faq}
                      onChange={(e) =>
                        update(account.id, { faq: e.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Used only when relevant; the AI won&apos;t invent beyond
                      this.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Style examples</Label>
                    <Textarea
                      placeholder={
                        "Them: how much?\nYou: depends on scope - lemme understand first, can we hop on a quick call?"
                      }
                      value={s.examples}
                      onChange={(e) =>
                        update(account.id, { examples: e.target.value })
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      Sample replies the AI mimics for voice (not exact words).
                    </p>
                  </div>
                </div>

                {/* Active hours & guardrails */}
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <Label>Active hours</Label>
                      <p className="text-xs text-muted-foreground">
                        Only reply during these hours (in the account timezone).
                      </p>
                    </div>
                    <Switch
                      checked={s.hoursEnabled}
                      onCheckedChange={(v) =>
                        update(account.id, { hoursEnabled: v })
                      }
                      aria-label="Enable active hours"
                    />
                  </div>
                  {s.hoursEnabled ? (
                    <div className="space-y-4">
                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">
                            From
                          </Label>
                          <Input
                            type="time"
                            value={s.activeStart}
                            onChange={(e) =>
                              update(account.id, { activeStart: e.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">
                            To
                          </Label>
                          <Input
                            type="time"
                            value={s.activeEnd}
                            onChange={(e) =>
                              update(account.id, { activeEnd: e.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">
                            Off hours
                          </Label>
                          <Select
                            value={s.offhoursBehavior}
                            onValueChange={(v) =>
                              update(account.id, {
                                offhoursBehavior: v as AutoreplyOffhoursBehavior,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {AUTOREPLY_OFFHOURS_BEHAVIORS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>
                                  {o.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {s.offhoursBehavior === "away_note" ? (
                        <div className="space-y-2">
                          <Label className="text-xs text-muted-foreground">
                            Away message
                          </Label>
                          <Input
                            placeholder="Hey! I'm away right now, will get back to you soon."
                            value={s.awayMessage}
                            onChange={(e) =>
                              update(account.id, { awayMessage: e.target.value })
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <label className="flex items-center gap-2 text-xs">
                    <Switch
                      checked={s.scaleDelay}
                      onCheckedChange={(v) =>
                        update(account.id, { scaleDelay: v })
                      }
                      aria-label="Scale typing delay by length"
                    />
                    Scale typing time by reply length
                  </label>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Topics/words to avoid
                      </Label>
                      <Input
                        placeholder="politics, competitor names"
                        value={s.avoid}
                        onChange={(e) =>
                          update(account.id, { avoid: e.target.value })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Sign-off (optional)
                      </Label>
                      <Input
                        placeholder="- David"
                        value={s.signoff}
                        onChange={(e) =>
                          update(account.id, { signoff: e.target.value })
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900/40 dark:bg-amber-950/20">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <Switch
                        checked={s.guardEnabled}
                        onCheckedChange={(v) =>
                          update(account.id, { guardEnabled: v })
                        }
                        aria-label="Exploitation / AI-detection guard"
                      />
                      Exploitation / AI-detection guard
                    </label>
                    <p className="text-xs text-muted-foreground">
                      If a sender probes whether you&apos;re a bot or tries to
                      manipulate the chat, replies slow down and the alert
                      recipient is notified. Repeated or serious attempts pause
                      auto-replies and flag the conversation until you clear it.
                    </p>
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        Alert recipient (optional)
                      </Label>
                      <Input
                        placeholder="@username or chat id (defaults to reminder recipient)"
                        value={s.alertRecipient}
                        disabled={!s.guardEnabled}
                        onChange={(e) =>
                          update(account.id, { alertRecipient: e.target.value })
                        }
                      />
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>When to reply</Label>
                    <Select
                      value={s.scope}
                      onValueChange={(v) =>
                        update(account.id, { scope: v as AutoreplyScope })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AUTOREPLY_SCOPES.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Who to reply to</Label>
                    <Select
                      value={s.audience}
                      onValueChange={(v) =>
                        update(account.id, { audience: v as AutoreplyAudience })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {AUTOREPLY_AUDIENCES.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {s.audience === "whitelist" ? (
                  <div className="space-y-2">
                    <Label>Whitelist (one @username or id per line)</Label>
                    <Textarea
                      placeholder={"@alice\n123456789"}
                      value={s.whitelist}
                      onChange={(e) =>
                        update(account.id, { whitelist: e.target.value })
                      }
                    />
                  </div>
                ) : null}

                {s.audience === "everyone" ? (
                  <p className="flex items-center gap-2 rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
                    <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                    Replying to strangers in DMs is the highest ban-risk setting.
                  </p>
                ) : null}

                <div className="space-y-3 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <Label>Relay appointments to a receiver</Label>
                      <p className="text-xs text-muted-foreground">
                        When someone asks about a meeting/appointment, message a
                        preset person first and reply only after they confirm.
                      </p>
                    </div>
                    <Switch
                      checked={s.appointmentEnabled}
                      onCheckedChange={(v) =>
                        update(account.id, { appointmentEnabled: v })
                      }
                      aria-label="Enable appointment relay"
                    />
                  </div>
                  {s.appointmentEnabled ? (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label>Receiver (@username or numeric id)</Label>
                        <Input
                          placeholder="@my_assistant"
                          value={s.receiver}
                          onChange={(e) =>
                            update(account.id, { receiver: e.target.value })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          The receiver must reply by quoting the forwarded
                          message to confirm or suggest another time. Plain
                          (non-quoted) replies are ignored. Must be reachable
                          from this account.
                        </p>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>Timezone</Label>
                          <Input
                            placeholder="Asia/Kuala_Lumpur"
                            value={s.timezone}
                            onChange={(e) =>
                              update(account.id, { timezone: e.target.value })
                            }
                          />
                          <p className="text-xs text-muted-foreground">
                            IANA name, e.g. Asia/Kuala_Lumpur, used to read
                            meeting times.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <Label>Reminder lead times (minutes)</Label>
                          <Input
                            placeholder="1440,30"
                            value={s.reminderOffsets}
                            onChange={(e) =>
                              update(account.id, {
                                reminderOffsets: e.target.value,
                              })
                            }
                          />
                          <p className="text-xs text-muted-foreground">
                            Comma-separated. 1440 = 1 day, 30 = 30 minutes.
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <Label>Reminder recipient (optional)</Label>
                        <Input
                          placeholder="Defaults to the receiver"
                          value={s.reminderRecipient}
                          onChange={(e) =>
                            update(account.id, {
                              reminderRecipient: e.target.value,
                            })
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          @username or id to send reminders to. Leave blank to
                          remind the receiver.
                        </p>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Media relay */}
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <Label>Relay media to the receiver</Label>
                      <p className="text-xs text-muted-foreground">
                        When a sender sends a photo, file, or voice/video, forward
                        it to the receiver. The receiver replies by quoting the
                        forwarded message and that answer is relayed back to the
                        right sender. Non-quoted replies are ignored.
                      </p>
                    </div>
                    <Switch
                      checked={s.mediaRelay}
                      onCheckedChange={(v) =>
                        update(account.id, { mediaRelay: v })
                      }
                      aria-label="Enable media relay"
                    />
                  </div>
                  {s.mediaRelay ? (
                    <div className="space-y-2">
                      <Label>Media receiver (@username or numeric id)</Label>
                      <Input
                        placeholder="@weison_t"
                        value={s.mediaReceiver}
                        onChange={(e) =>
                          update(account.id, { mediaReceiver: e.target.value })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Where media gets forwarded. Leave blank to use the
                        appointment receiver
                        {s.receiver ? ` (${s.receiver})` : ""}.
                      </p>
                      {!s.mediaReceiver && !s.receiver ? (
                        <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                          No receiver set - add one here or under appointment
                          relay so media has somewhere to go.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {/* Pricing relay */}
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <Label>Relay pricing questions to the receiver</Label>
                      <p className="text-xs text-muted-foreground">
                        When a sender asks about pricing, cost, or a quote,
                        forward the question to the receiver instead of replying.
                        The receiver replies by quoting it and that answer is
                        relayed back. Uses the media receiver
                        {s.mediaReceiver
                          ? ` (${s.mediaReceiver})`
                          : s.receiver
                            ? ` (${s.receiver})`
                            : ""}
                        .
                      </p>
                    </div>
                    <Switch
                      checked={s.pricingRelay}
                      onCheckedChange={(v) =>
                        update(account.id, { pricingRelay: v })
                      }
                      aria-label="Enable pricing relay"
                    />
                  </div>
                  {s.pricingRelay && !s.mediaReceiver && !s.receiver ? (
                    <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
                      No receiver set - add a media receiver above or an
                      appointment receiver so pricing questions have somewhere to
                      go.
                    </p>
                  ) : null}
                </div>

                {/* Live preview */}
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <Label className="flex items-center gap-1.5 text-sm font-semibold">
                    <Sparkles className="h-4 w-4 text-primary" />
                    Preview a reply
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Type a sample incoming message..."
                      value={s.previewSample}
                      onChange={(e) =>
                        update(account.id, { previewSample: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") preview(account);
                      }}
                    />
                    <Button
                      variant="secondary"
                      onClick={() => preview(account)}
                      disabled={s.previewLoading}
                    >
                      {s.previewLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Wand2 className="h-4 w-4" />
                      )}
                      Test
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Uses the current settings above (no need to save first).
                  </p>
                  {s.previewError ? (
                    <p className="text-sm text-destructive">{s.previewError}</p>
                  ) : null}
                  {s.previewChunks ? (
                    <div className="space-y-2">
                      {s.previewChunks.map((chunk, i) => (
                        <div
                          key={i}
                          className="ml-auto max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                        >
                          {chunk}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground">Delay</Label>
                    <Input
                      type="number"
                      min={1}
                      className="w-16"
                      value={s.minDelay}
                      onChange={(e) =>
                        update(account.id, { minDelay: Number(e.target.value) })
                      }
                      aria-label="Min delay seconds"
                    />
                    <span className="text-xs text-muted-foreground">to</span>
                    <Input
                      type="number"
                      min={1}
                      className="w-16"
                      value={s.maxDelay}
                      onChange={(e) =>
                        update(account.id, { maxDelay: Number(e.target.value) })
                      }
                      aria-label="Max delay seconds"
                    />
                    <span className="text-xs text-muted-foreground">sec</span>
                  </div>
                  <Button
                    className="ml-auto"
                    onClick={() => save(account)}
                    disabled={s.saving}
                  >
                    {s.saving ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Save
                  </Button>
                </div>
              </CardContent>
              ) : null}
            </Card>
          );
      })}
    </div>
  );
};
