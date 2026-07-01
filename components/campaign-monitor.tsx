"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Play,
  Pause,
  Square,
  FlaskConical,
  Pencil,
  Plus,
  RotateCcw,
  Copy,
  Trash2,
  Loader2,
} from "lucide-react";
import { getBrowserClient } from "@/lib/supabase-browser";
import type { Account, Campaign, Message, Participant } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CampaignStatusBadge } from "@/components/campaign-status-badge";
import {
  CampaignSettingsFields,
  scheduleToPayload,
  validateCampaignForm,
  type CampaignFormValue,
  type Selection,
} from "@/components/campaign-settings-fields";
import {
  detectTimezone,
  formatScheduled,
  utcIsoToLocalInput,
} from "@/lib/schedule";
import type { PersonaInfo } from "@/lib/persona-palette";

export type { PersonaInfo };

type Props = {
  campaign: Campaign;
  personas: Record<string, PersonaInfo>;
  initialMessages: Message[];
  accounts: Account[];
  participants: Participant[];
};

const RUN_MORE_STEP = 20;

const buildForm = (
  campaign: Campaign,
  participants: Participant[]
): CampaignFormValue => {
  const selection: Selection = {};
  for (const p of participants) {
    selection[p.account_id] = {
      account_id: p.account_id,
      persona_name: p.persona_name ?? "",
      persona_traits: p.persona_traits ?? "",
      language: p.language ?? "mirror",
      emoji_level: p.emoji_level ?? "sometimes",
      formality: p.formality ?? "casual",
      msg_length: p.msg_length ?? "normal",
      humanize: p.humanize ?? true,
      no_assistant_tone: p.no_assistant_tone ?? false,
      reply_threading: p.reply_threading ?? false,
      avoid_topics: p.avoid_topics ?? null,
      objective: p.objective ?? null,
    };
  }
  const tz = campaign.timezone ?? detectTimezone();
  const scheduled = campaign.status === "scheduled" && !!campaign.start_at;
  return {
    name: campaign.name,
    topic: campaign.topic,
    style: campaign.style,
    extra: campaign.extra_instructions ?? "",
    venue: campaign.venue,
    targetChat: campaign.target_chat ?? "",
    minDelay: campaign.min_delay_s,
    maxDelay: campaign.max_delay_s,
    maxMessages: campaign.max_messages,
    dryRun: campaign.dry_run,
    model: campaign.model,
    selection,
    scheduleEnabled: scheduled,
    scheduleLocal: campaign.start_at
      ? utcIsoToLocalInput(campaign.start_at, tz)
      : "",
    timezone: tz,
  };
};

export const CampaignMonitor = ({
  campaign: initialCampaign,
  personas,
  initialMessages,
  accounts,
  participants,
}: Props) => {
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign>(initialCampaign);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<CampaignFormValue>(() =>
    buildForm(initialCampaign, participants)
  );
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel(`kw_campaign_${campaign.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "kw_messages",
          filter: `campaign_id=eq.${campaign.id}`,
        },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as Message]);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "kw_campaigns",
          filter: `id=eq.${campaign.id}`,
        },
        (payload) => {
          setCampaign(payload.new as Campaign);
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [campaign.id]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [messages]);

  const isLive = campaign.status === "running" || campaign.status === "paused";
  const hasHistory = campaign.messages_sent > 0;
  const reachedCap = campaign.messages_sent >= campaign.max_messages;

  const control = async (action: "start" | "pause" | "stop") => {
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/${action}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(`Campaign ${action}ed.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const patchCampaign = async (
    body: Record<string, unknown>,
    successMessage: string
  ): Promise<boolean> => {
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setCampaign(data.campaign as Campaign);
      toast.success(successMessage);
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const setDryRun = (nextDryRun: boolean) =>
    void patchCampaign(
      { dry_run: nextDryRun },
      nextDryRun ? "Switched to dry run." : "Switched to live sending."
    );

  const runMore = () =>
    void patchCampaign(
      {
        max_messages:
          Math.max(campaign.messages_sent, campaign.max_messages) +
          RUN_MORE_STEP,
      },
      `Added ${RUN_MORE_STEP} more messages. Start to continue.`
    );

  const openEdit = () => {
    setForm(buildForm(campaign, participants));
    setEditOpen(true);
  };

  const saveEdit = async () => {
    const error = validateCampaignForm(form);
    if (error) {
      toast.error(error);
      return;
    }
    const ok = await patchCampaign(
      {
        name: form.name,
        topic: form.topic,
        style: form.style,
        extra_instructions: form.extra,
        venue: form.venue,
        target_chat: form.targetChat,
        min_delay_s: form.minDelay,
        max_delay_s: form.maxDelay,
        max_messages: form.maxMessages,
        dry_run: form.dryRun,
        model: form.model,
        participants: Object.values(form.selection),
        ...scheduleToPayload(form),
      },
      "Campaign updated. Reloading..."
    );
    if (ok) {
      setEditOpen(false);
      router.refresh();
    }
  };

  const reset = async () => {
    if (
      !window.confirm(
        "Reset this campaign? All logged messages will be deleted and progress set to 0."
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/reset`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setCampaign(data.campaign as Campaign);
      setMessages([]);
      toast.success("Campaign reset.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/duplicate`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success("Campaign duplicated.");
      router.push(`/campaigns/${data.campaign.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !window.confirm(
        "Delete this campaign and all its logged messages? This cannot be undone."
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success("Campaign deleted.");
      router.push("/campaigns");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
      setBusy(false);
    }
  };

  const personaFor = (accountId: string | null): PersonaInfo =>
    (accountId && personas[accountId]) || {
      name: "system",
      label: "system",
      color: "text-muted-foreground",
    };

  const canStart =
    campaign.status === "draft" ||
    campaign.status === "scheduled" ||
    campaign.status === "paused" ||
    campaign.status === "stopped" ||
    campaign.status === "done";

  const startLabel =
    campaign.status === "paused"
      ? "Resume"
      : campaign.status === "scheduled"
        ? "Start now"
        : "Start";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="flex h-[70vh] flex-col">
        <CardHeader className="flex-row items-center justify-between space-y-0 border-b">
          <CardTitle className="text-base">Live conversation</CardTitle>
          <span className="text-xs text-muted-foreground">
            {messages.length} messages
          </span>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden p-0">
          <div ref={feedRef} className="h-full space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">
                No messages yet. Start the campaign to begin.
              </p>
            ) : (
              messages.map((message) => {
                const persona = personaFor(message.account_id);
                return (
                  <div key={message.id} className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm font-semibold ${persona.color}`}
                      >
                        {persona.name}
                      </span>
                      {message.dry_run ? (
                        <Badge variant="outline" className="text-[10px]">
                          dry run
                        </Badge>
                      ) : null}
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(message.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <p className="text-sm">{message.content}</p>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              Controls
              <CampaignStatusBadge status={campaign.status} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => control("start")}
                disabled={
                  busy ||
                  !canStart ||
                  (reachedCap && campaign.status !== "paused")
                }
                title={
                  reachedCap && campaign.status !== "paused"
                    ? "Message cap reached. Use Run more or Reset first."
                    : undefined
                }
              >
                <Play className="h-4 w-4" />
                {startLabel}
              </Button>
              <Button
                variant="outline"
                onClick={() => control("pause")}
                disabled={busy || campaign.status !== "running"}
              >
                <Pause className="h-4 w-4" />
              </Button>
              <Button
                variant="destructive"
                onClick={() => control("stop")}
                disabled={
                  busy ||
                  (campaign.status !== "running" && campaign.status !== "paused")
                }
              >
                <Square className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-2 rounded-md bg-muted p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <Label htmlFor="dry-run-toggle" className="text-sm">
                    Dry run
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {campaign.dry_run
                      ? "Messages are generated and logged but not sent to Telegram."
                      : "Live: messages are sent to Telegram."}
                  </p>
                </div>
                <Switch
                  id="dry-run-toggle"
                  checked={campaign.dry_run}
                  disabled={busy || isLive}
                  onCheckedChange={(checked) => setDryRun(checked)}
                />
              </div>
              {isLive ? (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FlaskConical className="h-3.5 w-3.5" />
                  Stop the campaign to edit or switch between dry run and live.
                </p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={openEdit}
                disabled={busy || isLive}
              >
                <Pencil className="h-4 w-4" />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={runMore}
                disabled={busy || isLive || !reachedCap}
                title={
                  reachedCap
                    ? undefined
                    : "Available once the message cap is reached."
                }
              >
                <Plus className="h-4 w-4" />
                Run more
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={reset}
                disabled={busy || isLive || !hasHistory}
              >
                <RotateCcw className="h-4 w-4" />
                Reset
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={duplicate}
                disabled={busy}
              >
                <Copy className="h-4 w-4" />
                Duplicate
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={remove}
                disabled={busy || isLive}
                className="col-span-2"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Delete campaign
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Topic" value={campaign.topic} />
            <Row label="Style" value={campaign.style} />
            <Row label="Venue" value={campaign.venue} />
            {campaign.target_chat ? (
              <Row label="Target" value={campaign.target_chat} />
            ) : null}
            {campaign.status === "scheduled" && campaign.start_at ? (
              <Row
                label="Scheduled"
                value={formatScheduled(
                  campaign.start_at,
                  campaign.timezone ?? detectTimezone()
                )}
              />
            ) : null}
            <Row
              label="Progress"
              value={`${campaign.messages_sent}/${campaign.max_messages}`}
            />
            <Row
              label="Delay"
              value={`${campaign.min_delay_s}s – ${campaign.max_delay_s}s`}
            />
            <Row label="Model" value={campaign.model} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Participants</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {Object.entries(personas).map(([id, persona]) => (
              <div key={id} className="flex items-center justify-between text-sm">
                <span className={`font-medium ${persona.color}`}>
                  {persona.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {persona.label}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit campaign</DialogTitle>
          </DialogHeader>
          <CampaignSettingsFields
            value={form}
            onChange={(p) => setForm((prev) => ({ ...prev, ...p }))}
            accounts={accounts}
            lockVenue={hasHistory}
          />
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-start justify-between gap-3">
    <span className="text-muted-foreground">{label}</span>
    <span className="text-right capitalize">{value}</span>
  </div>
);
