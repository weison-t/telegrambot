"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Play,
  Pause,
  Square,
  Pencil,
  RotateCcw,
  Copy,
  Trash2,
  Loader2,
} from "lucide-react";
import { getBrowserClient } from "@/lib/supabase-browser";
import type {
  Account,
  Broadcast,
  BroadcastStatus,
  BroadcastTarget,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BroadcastStatusBadge } from "@/components/broadcast-status-badge";
import {
  BroadcastSettingsFields,
  scheduleToPayload,
  targetsForForm,
  validateBroadcastForm,
  type BroadcastFormValue,
} from "@/components/broadcast-settings-fields";
import {
  detectTimezone,
  formatScheduled,
  utcIsoToLocalInput,
} from "@/lib/schedule";

type Props = {
  broadcast: Broadcast;
  accountIds: string[];
  initialTargets: BroadcastTarget[];
  accounts: Account[];
};

const buildForm = (
  broadcast: Broadcast,
  accountIds: string[],
  targets: BroadcastTarget[]
): BroadcastFormValue => {
  const tz = broadcast.timezone ?? detectTimezone();
  const scheduled = broadcast.status === "scheduled" && !!broadcast.start_at;
  return {
    name: broadcast.name,
    message: broadcast.message,
    accountIds,
    targetTab: "multiple",
    single: "",
    multiple: targets.map((t) => t.input).join("\n"),
    csvTargets: [],
    csvFileName: "",
    minDelay: broadcast.min_delay_s,
    maxDelay: broadcast.max_delay_s,
    perAccountDailyLimit: broadcast.per_account_daily_limit,
    dryRun: broadcast.dry_run,
    model: broadcast.model,
    replyAiEnabled: broadcast.reply_ai_enabled,
    replyKnowledge: broadcast.reply_knowledge ?? "",
    replyPersona: broadcast.reply_persona ?? "",
    replyInstructions: broadcast.reply_instructions ?? "",
    replyLink: broadcast.reply_link ?? "",
    scheduleEnabled: scheduled,
    scheduleLocal: broadcast.start_at
      ? utcIsoToLocalInput(broadcast.start_at, tz)
      : "",
    timezone: tz,
  };
};

const pct = (part: number, whole: number): string => {
  if (whole <= 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
};

const targetStatusBadge = (status: string) => {
  if (status === "sent") return <Badge variant="success">Sent</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  if (status === "skipped") return <Badge variant="warning">Skipped</Badge>;
  return <Badge variant="secondary">Pending</Badge>;
};

export const BroadcastMonitor = ({
  broadcast: initialBroadcast,
  accountIds,
  initialTargets,
  accounts,
}: Props) => {
  const router = useRouter();
  const [broadcast, setBroadcast] = useState<Broadcast>(initialBroadcast);
  const [targets, setTargets] = useState<BroadcastTarget[]>(initialTargets);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState<BroadcastFormValue>(() =>
    buildForm(initialBroadcast, accountIds, initialTargets)
  );

  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel(`kw_broadcast_${broadcast.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "kw_broadcast_targets",
          filter: `broadcast_id=eq.${broadcast.id}`,
        },
        () => {
          void (async () => {
            const { data } = await supabase
              .from("kw_broadcast_targets")
              .select("*")
              .eq("broadcast_id", broadcast.id)
              .order("created_at", { ascending: true });
            if (data) setTargets(data as BroadcastTarget[]);
          })();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "kw_broadcasts",
          filter: `id=eq.${broadcast.id}`,
        },
        (payload) => setBroadcast(payload.new as Broadcast)
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [broadcast.id]);

  const isLive = broadcast.status === "running" || broadcast.status === "paused";
  const hasProgress =
    broadcast.sent_count > 0 || broadcast.failed_count > 0;

  const stats = useMemo(
    () => [
      { label: "Total", value: String(broadcast.total_count) },
      { label: "Sent", value: String(broadcast.sent_count) },
      { label: "Failed", value: String(broadcast.failed_count) },
      {
        label: "Read rate",
        value: pct(broadcast.read_count, broadcast.sent_count),
        hint: `${broadcast.read_count}/${broadcast.sent_count}`,
      },
      {
        label: "Respond rate",
        value: pct(broadcast.replied_count, broadcast.sent_count),
        hint: `${broadcast.replied_count}/${broadcast.sent_count}`,
      },
    ],
    [broadcast]
  );

  const control = async (action: "start" | "pause" | "stop") => {
    setBusy(true);
    try {
      const res = await fetch(`/api/broadcasts/${broadcast.id}/${action}`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(`Broadcast ${action}${action === "stop" ? "ped" : action === "start" ? "ed" : "d"}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const openEdit = () => {
    setForm(buildForm(broadcast, accountIds, targets));
    setEditOpen(true);
  };

  const saveEdit = async () => {
    const error = validateBroadcastForm(form);
    if (error) {
      toast.error(error);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/broadcasts/${broadcast.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          message: form.message,
          account_ids: form.accountIds,
          targets: targetsForForm(form),
          min_delay_s: form.minDelay,
          max_delay_s: form.maxDelay,
          per_account_daily_limit: form.perAccountDailyLimit,
          dry_run: form.dryRun,
          model: form.model,
          reply_ai_enabled: form.replyAiEnabled,
          reply_knowledge: form.replyKnowledge,
          reply_persona: form.replyPersona,
          reply_instructions: form.replyInstructions,
          reply_link: form.replyLink,
          ...scheduleToPayload(form),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setBroadcast(data.broadcast as Broadcast);
      toast.success("Broadcast updated. Reloading...");
      setEditOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (
      !window.confirm(
        "Reset this broadcast? All per-recipient send/read/reply state and counters will be cleared."
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/broadcasts/${broadcast.id}/reset`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setBroadcast(data.broadcast as Broadcast);
      toast.success("Broadcast reset.");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/broadcasts/${broadcast.id}/duplicate`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success("Broadcast duplicated.");
      router.push(`/broadcasts/${data.broadcast.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !window.confirm(
        "Delete this broadcast and all its recipients? This cannot be undone."
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/broadcasts/${broadcast.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success("Broadcast deleted.");
      router.push("/broadcasts");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
      setBusy(false);
    }
  };

  const canStart =
    broadcast.status === "draft" ||
    broadcast.status === "scheduled" ||
    broadcast.status === "paused" ||
    broadcast.status === "stopped" ||
    broadcast.status === "done";

  const startLabel =
    broadcast.status === "paused"
      ? "Resume"
      : broadcast.status === "scheduled"
        ? "Start now"
        : "Start";

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="text-2xl font-semibold">{s.value}</p>
                {s.hint ? (
                  <p className="text-[10px] text-muted-foreground">{s.hint}</p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="flex h-[60vh] flex-col">
          <CardHeader className="flex-row items-center justify-between space-y-0 border-b">
            <CardTitle className="text-base">Recipients</CardTitle>
            <span className="text-xs text-muted-foreground">
              {targets.length} total
            </span>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            <div className="h-full overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="p-3 font-medium">Recipient</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Read</th>
                    <th className="p-3 font-medium">Replied</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="p-6 text-center text-muted-foreground"
                      >
                        No recipients.
                      </td>
                    </tr>
                  ) : (
                    targets.map((t) => (
                      <tr key={t.id} className="border-b align-top">
                        <td className="p-3">
                          <div className="font-medium">{t.input}</div>
                          {t.username ? (
                            <div className="text-xs text-muted-foreground">
                              @{t.username}
                            </div>
                          ) : null}
                          {t.telegram_user_id ? (
                            <div className="font-mono text-[10px] text-muted-foreground">
                              {t.telegram_user_id}
                            </div>
                          ) : null}
                          {t.error ? (
                            <div className="text-xs text-destructive">
                              {t.error}
                            </div>
                          ) : null}
                        </td>
                        <td className="p-3">{targetStatusBadge(t.status)}</td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {t.read_at
                            ? new Date(t.read_at).toLocaleTimeString()
                            : "—"}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {t.replied_at
                            ? new Date(t.replied_at).toLocaleTimeString()
                            : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              Controls
              <BroadcastStatusBadge
                status={broadcast.status as BroadcastStatus}
              />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => control("start")}
                disabled={busy || !canStart}
              >
                <Play className="h-4 w-4" />
                {startLabel}
              </Button>
              <Button
                variant="outline"
                onClick={() => control("pause")}
                disabled={busy || broadcast.status !== "running"}
              >
                <Pause className="h-4 w-4" />
              </Button>
              <Button
                variant="destructive"
                onClick={() => control("stop")}
                disabled={
                  busy ||
                  (broadcast.status !== "running" &&
                    broadcast.status !== "paused")
                }
              >
                <Square className="h-4 w-4" />
              </Button>
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
                onClick={reset}
                disabled={busy || isLive || !hasProgress}
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
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Delete
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Accounts" value={String(accountIds.length)} />
            <Row
              label="Delay"
              value={`${broadcast.min_delay_s}s – ${broadcast.max_delay_s}s`}
            />
            <Row
              label="Daily cap"
              value={`${broadcast.per_account_daily_limit}/account`}
            />
            <Row label="Mode" value={broadcast.dry_run ? "Dry run" : "Live"} />
            <Row
              label="AI reply"
              value={broadcast.reply_ai_enabled ? "On" : "Off"}
            />
            {broadcast.status === "scheduled" && broadcast.start_at ? (
              <Row
                label="Scheduled"
                value={formatScheduled(
                  broadcast.start_at,
                  broadcast.timezone ?? detectTimezone()
                )}
              />
            ) : null}
            <Row label="Model" value={broadcast.model} />
          </CardContent>
        </Card>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit broadcast</DialogTitle>
          </DialogHeader>
          <BroadcastSettingsFields
            value={form}
            onChange={(p) => setForm((prev) => ({ ...prev, ...p }))}
            accounts={accounts}
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
