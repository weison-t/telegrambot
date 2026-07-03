"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BadgeCheck,
  Bot,
  Crown,
  Download,
  Loader2,
  ShieldCheck,
  Trash2,
  UsersRound,
} from "lucide-react";
import { getBrowserClient } from "@/lib/supabase-browser";
import type { Account, GroupScrapeJob, GroupScrapeMember } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GroupPicker } from "@/components/group-picker";

type Props = {
  accounts: Account[];
  initialJobs: GroupScrapeJob[];
  initialMembers: GroupScrapeMember[];
};

const statusBadge = (job: GroupScrapeJob) => {
  if (job.status === "completed")
    return <Badge variant="success">Done · {job.total_count}</Badge>;
  if (job.status === "failed") return <Badge variant="destructive">Failed</Badge>;
  if (job.status === "processing")
    return <Badge variant="secondary">Scraping · {job.total_count}</Badge>;
  return <Badge variant="secondary">Pending</Badge>;
};

const fullName = (m: GroupScrapeMember): string =>
  [m.first_name, m.last_name].filter(Boolean).join(" ").trim();

export const GroupScrapeView = ({
  accounts,
  initialJobs,
  initialMembers,
}: Props) => {
  const connectedAccounts = useMemo(
    () => accounts.filter((a) => Boolean(a.session_enc)),
    [accounts]
  );

  const [accountId, setAccountId] = useState<string>(
    connectedAccounts[0]?.id ?? ""
  );
  const [groupInput, setGroupInput] = useState("");
  const [maxMembers, setMaxMembers] = useState(10000);
  const [submitting, setSubmitting] = useState(false);

  const [jobs, setJobs] = useState<GroupScrapeJob[]>(initialJobs);
  const [members, setMembers] = useState<GroupScrapeMember[]>(initialMembers);
  const [selectedJobId, setSelectedJobId] = useState<string>(
    initialJobs[0]?.id ?? ""
  );

  const refresh = useCallback(async () => {
    const supabase = getBrowserClient();
    const [{ data: j }, { data: m }] = await Promise.all([
      supabase
        .from("kw_group_scrape_jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("kw_group_scrape_members")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(5000),
    ]);
    if (j) setJobs(j as GroupScrapeJob[]);
    if (m) setMembers(m as GroupScrapeMember[]);
  }, []);

  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel("kw_group_scrape_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "kw_group_scrape_jobs" },
        () => void refresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "kw_group_scrape_members" },
        () => void refresh()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) ?? jobs[0] ?? null,
    [jobs, selectedJobId]
  );

  const selectedMembers = useMemo(
    () => (selectedJob ? members.filter((m) => m.job_id === selectedJob.id) : []),
    [members, selectedJob]
  );

  const handleSubmit = async () => {
    if (!accountId) {
      toast.error("Select a connected account to run the scrape.");
      return;
    }
    if (!groupInput.trim()) {
      toast.error("Enter a group @username or id.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/group-scrape", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          input: groupInput.trim(),
          maxMembers,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        jobId?: string;
        warning?: string;
        error?: string;
      };
      if (!res.ok && !data.jobId) {
        throw new Error(data.error || "Scrape failed to start.");
      }
      if (data.jobId) setSelectedJobId(data.jobId);
      if (data.warning) {
        toast.warning(data.warning);
      } else {
        toast.success("Scrape started. Members will appear below live.");
      }
      setGroupInput("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Scrape failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteJob = async (jobId: string) => {
    try {
      const res = await fetch(
        `/api/group-scrape?job_id=${encodeURIComponent(jobId)}`,
        { method: "DELETE" }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Delete failed.");
      toast.success("Scrape deleted.");
      if (selectedJobId === jobId) setSelectedJobId("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  const handleExport = () => {
    if (!selectedJob || selectedMembers.length === 0) {
      toast.error("Nothing to export yet.");
      return;
    }
    const header = [
      "telegram_user_id",
      "username",
      "first_name",
      "last_name",
      "is_premium",
      "is_bot",
      "is_verified",
      "is_admin",
      "source",
    ];
    const escape = (value: unknown): string => {
      const str = value == null ? "" : String(value);
      return `"${str.replace(/"/g, '""')}"`;
    };
    const rows = selectedMembers.map((m) =>
      [
        m.telegram_user_id,
        m.username,
        m.first_name,
        m.last_name,
        m.is_premium,
        m.is_bot,
        m.is_verified,
        m.is_admin,
        m.source,
      ]
        .map(escape)
        .join(",")
    );
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `group-scrape-${selectedJob.id.slice(0, 8)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const noAccounts = connectedAccounts.length === 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UsersRound className="h-4 w-4" />
              New scrape
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {noAccounts ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                No connected accounts. Log in an account under Accounts first -
                the scrape reads the group from that account.
              </p>
            ) : null}

            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
              Scraping group members is against Telegram&apos;s terms and can
              get an account banned. Use a dedicated throwaway account that is
              already a member of the group. This module is read-only: it never
              joins groups or adds/messages the scraped users.
            </div>

            <div className="space-y-2">
              <Label>Scrape account</Label>
              <Select
                value={accountId}
                onValueChange={setAccountId}
                disabled={noAccounts}
              >
                <SelectTrigger aria-label="Scrape account">
                  <SelectValue placeholder="Select a connected account" />
                </SelectTrigger>
                <SelectContent>
                  {connectedAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                      {a.phone ? ` (${a.phone})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="group-input">Group</Label>
                <GroupPicker
                  accounts={accounts}
                  onSelect={(target) => setGroupInput(target)}
                />
              </div>
              <Input
                id="group-input"
                value={groupInput}
                onChange={(e) => setGroupInput(e.target.value)}
                placeholder="@mygroup or -1001234567890"
              />
              <p className="text-xs text-muted-foreground">
                The selected account must already be a member. Use Browse groups
                to pick one from that account.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-members">Max members</Label>
              <Input
                id="max-members"
                type="number"
                min={1}
                max={50000}
                value={maxMembers}
                onChange={(e) => setMaxMembers(Number(e.target.value))}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                Non-admins can typically read up to ~10,000 members. Hidden
                member lists fall back to recent active senders.
              </p>
            </div>

            <Button
              onClick={handleSubmit}
              disabled={submitting || noAccounts}
              className="w-full"
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <UsersRound className="mr-2 h-4 w-4" />
              )}
              {submitting ? "Starting..." : "Scrape members"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent scrapes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No scrapes yet.</p>
            ) : (
              jobs.map((j) => {
                const active = selectedJob?.id === j.id;
                return (
                  <button
                    key={j.id}
                    type="button"
                    onClick={() => setSelectedJobId(j.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors data-[active=true]:border-primary data-[active=true]:bg-muted"
                    data-active={active}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {j.group_title || j.group_input}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {new Date(j.created_at).toLocaleString()}
                        {j.used_fallback ? " · via history" : ""}
                      </span>
                    </span>
                    <span className="shrink-0">{statusBadge(j)}</span>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="min-h-[300px]">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">
            {selectedJob
              ? `${selectedJob.group_title || selectedJob.group_input} · ${
                  selectedMembers.length
                } members`
              : "Members"}
          </CardTitle>
          {selectedJob ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={selectedMembers.length === 0}
              >
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleDeleteJob(selectedJob.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          {!selectedJob ? (
            <p className="text-sm text-muted-foreground">
              Run a scrape to see group members here.
            </p>
          ) : selectedJob.status === "failed" ? (
            <p className="text-sm text-destructive">
              {selectedJob.error ?? "Scrape failed."}
            </p>
          ) : selectedMembers.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {selectedJob.status === "processing"
                ? "Scraping members..."
                : "Preparing scrape..."}
            </p>
          ) : (
            <div className="max-h-[65vh] space-y-2 overflow-y-auto">
              {selectedMembers.map((m) => (
                <div key={m.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {fullName(m) ? (
                      <span className="font-medium">{fullName(m)}</span>
                    ) : null}
                    {m.username ? (
                      <span className="text-muted-foreground">
                        @{m.username}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        no username
                      </span>
                    )}
                    {m.is_admin ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                        <ShieldCheck className="h-3.5 w-3.5" /> Admin
                      </span>
                    ) : null}
                    {m.is_premium ? (
                      <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                        <Crown className="h-3.5 w-3.5" /> Premium
                      </span>
                    ) : null}
                    {m.is_verified ? (
                      <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400">
                        <BadgeCheck className="h-3.5 w-3.5" /> Verified
                      </span>
                    ) : null}
                    {m.is_bot ? (
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Bot className="h-3.5 w-3.5" /> Bot
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    {m.telegram_user_id}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
