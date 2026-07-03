"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BadgeCheck,
  Crown,
  Download,
  Loader2,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { getBrowserClient } from "@/lib/supabase-browser";
import type {
  Account,
  PhoneLookupBatch,
  PhoneLookupResult,
  PhoneLookupSource,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = {
  accounts: Account[];
  initialBatches: PhoneLookupBatch[];
  initialResults: PhoneLookupResult[];
};

const TEMPLATE_CSV =
  "phone\n+14155550123\n+60123456789\n+442071838750\n";

// Splits raw pasted/uploaded text into individual phone entries.
const parseLines = (raw: string): string[] =>
  raw
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.toLowerCase() !== "phone");

const statusBadge = (status: string) => {
  if (status === "found")
    return <Badge variant="success">Found</Badge>;
  if (status === "not_found")
    return <Badge variant="warning">Not found</Badge>;
  if (status === "error")
    return <Badge variant="destructive">Error</Badge>;
  return <Badge variant="secondary">Pending</Badge>;
};

const fullName = (r: PhoneLookupResult): string =>
  [r.first_name, r.last_name].filter(Boolean).join(" ").trim();

export const TelegramIdSearchView = ({
  accounts,
  initialBatches,
  initialResults,
}: Props) => {
  const connectedAccounts = useMemo(
    () => accounts.filter((a) => Boolean(a.session_enc)),
    [accounts]
  );

  const [accountId, setAccountId] = useState<string>(
    connectedAccounts[0]?.id ?? ""
  );
  const [countryCode, setCountryCode] = useState("");
  const [tab, setTab] = useState<PhoneLookupSource>("single");
  const [single, setSingle] = useState("");
  const [multiple, setMultiple] = useState("");
  const [batchPhones, setBatchPhones] = useState<string[]>([]);
  const [fileName, setFileName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [batches, setBatches] = useState<PhoneLookupBatch[]>(initialBatches);
  const [results, setResults] = useState<PhoneLookupResult[]>(initialResults);
  const [selectedBatchId, setSelectedBatchId] = useState<string>(
    initialBatches[0]?.id ?? ""
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const supabase = getBrowserClient();
    const [{ data: b }, { data: r }] = await Promise.all([
      supabase
        .from("kw_phone_lookup_batches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("kw_phone_lookup_results")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(2000),
    ]);
    if (b) setBatches(b as PhoneLookupBatch[]);
    if (r) setResults(r as PhoneLookupResult[]);
  }, []);

  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel("kw_phone_lookup_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "kw_phone_lookup_batches" },
        () => void refresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "kw_phone_lookup_results" },
        () => void refresh()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  const selectedBatch = useMemo(
    () => batches.find((b) => b.id === selectedBatchId) ?? batches[0] ?? null,
    [batches, selectedBatchId]
  );

  const selectedResults = useMemo(
    () =>
      selectedBatch
        ? results.filter((r) => r.batch_id === selectedBatch.id)
        : [],
    [results, selectedBatch]
  );

  const handleTemplateDownload = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "telegram-id-search-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const phones = parseLines(text);
    setBatchPhones(phones);
    setFileName(file.name);
    if (phones.length === 0) {
      toast.error("No phone numbers found in that file.");
    } else {
      toast.success(`Loaded ${phones.length} numbers from ${file.name}.`);
    }
  };

  const phonesForTab = (): string[] => {
    if (tab === "single") return parseLines(single).slice(0, 1);
    if (tab === "multiple") return parseLines(multiple);
    return batchPhones;
  };

  const handleSubmit = async () => {
    if (!accountId) {
      toast.error("Select a connected account to run the lookup.");
      return;
    }
    const phones = phonesForTab();
    if (phones.length === 0) {
      toast.error("Enter at least one phone number.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/telegram-id-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          accountId,
          phones,
          source: tab,
          defaultCountryCode: countryCode.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        batchId?: string;
        invalid?: string[];
        warning?: string;
        error?: string;
      };
      if (!res.ok && !data.batchId) {
        throw new Error(data.error || "Lookup failed to start.");
      }

      if (data.batchId) setSelectedBatchId(data.batchId);
      if (data.warning) {
        toast.warning(data.warning);
      } else {
        toast.success("Lookup started. Results will appear below live.");
      }
      if (data.invalid && data.invalid.length > 0) {
        toast.warning(
          `Skipped ${data.invalid.length} invalid entr${
            data.invalid.length === 1 ? "y" : "ies"
          }: ${data.invalid.slice(0, 3).join(", ")}${
            data.invalid.length > 3 ? "..." : ""
          }`
        );
      }

      setSingle("");
      setMultiple("");
      setBatchPhones([]);
      setFileName("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteBatch = async (batchId: string) => {
    try {
      const res = await fetch(
        `/api/telegram-id-search?batch_id=${encodeURIComponent(batchId)}`,
        { method: "DELETE" }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || "Delete failed.");
      toast.success("Batch deleted.");
      if (selectedBatchId === batchId) setSelectedBatchId("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  const handleExport = () => {
    if (!selectedBatch || selectedResults.length === 0) {
      toast.error("Nothing to export yet.");
      return;
    }
    const header = [
      "phone",
      "status",
      "telegram_user_id",
      "username",
      "first_name",
      "last_name",
      "phone_visible",
      "is_premium",
      "is_verified",
      "bio",
      "reason",
    ];
    const escape = (value: unknown): string => {
      const str = value == null ? "" : String(value);
      return `"${str.replace(/"/g, '""')}"`;
    };
    const rows = selectedResults.map((r) =>
      [
        r.phone,
        r.status,
        r.telegram_user_id,
        r.username,
        r.first_name,
        r.last_name,
        r.phone_visible,
        r.is_premium,
        r.is_verified,
        r.bio,
        r.reason,
      ]
        .map(escape)
        .join(",")
    );
    const csv = [header.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `telegram-id-search-${selectedBatch.id.slice(0, 8)}.csv`;
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
              <Search className="h-4 w-4" />
              New lookup
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {noAccounts ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                No connected accounts. Log in an account under Accounts first -
                the lookup imports each phone as a contact on that account.
              </p>
            ) : null}

            <div className="space-y-2">
              <Label>Lookup account</Label>
              <Select
                value={accountId}
                onValueChange={setAccountId}
                disabled={noAccounts}
              >
                <SelectTrigger aria-label="Lookup account">
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
              <p className="text-xs text-muted-foreground">
                This account imports each number as a contact to resolve it.
                Heavy use can trigger Telegram rate limits.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="country-code">Default country code (optional)</Label>
              <Input
                id="country-code"
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                placeholder="e.g. +60"
              />
              <p className="text-xs text-muted-foreground">
                Prepended to numbers entered without a leading &quot;+&quot;.
                Best practice: enter full international format like
                &quot;+14155550123&quot;.
              </p>
            </div>

            <Tabs
              value={tab}
              onValueChange={(v) => setTab(v as PhoneLookupSource)}
            >
              <TabsList className="w-full">
                <TabsTrigger value="single" className="flex-1">
                  Single
                </TabsTrigger>
                <TabsTrigger value="multiple" className="flex-1">
                  Multiple
                </TabsTrigger>
                <TabsTrigger value="batch" className="flex-1">
                  Batch upload
                </TabsTrigger>
              </TabsList>

              <TabsContent value="single" className="space-y-2">
                <Label htmlFor="single-phone">Phone number</Label>
                <Input
                  id="single-phone"
                  value={single}
                  onChange={(e) => setSingle(e.target.value)}
                  placeholder="+14155550123"
                />
              </TabsContent>

              <TabsContent value="multiple" className="space-y-2">
                <Label htmlFor="multiple-phones">
                  Phone numbers (one per line)
                </Label>
                <Textarea
                  id="multiple-phones"
                  value={multiple}
                  onChange={(e) => setMultiple(e.target.value)}
                  placeholder={"+14155550123\n+60123456789"}
                  rows={6}
                />
                <p className="text-xs text-muted-foreground">
                  {parseLines(multiple).length} number(s) ready.
                </p>
              </TabsContent>

              <TabsContent value="batch" className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleTemplateDownload}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download template
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Upload CSV
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  CSV with a single &quot;phone&quot; column in full
                  international format.
                  {fileName
                    ? ` Loaded ${batchPhones.length} from ${fileName}.`
                    : ""}
                </p>
              </TabsContent>
            </Tabs>

            <Button
              onClick={handleSubmit}
              disabled={submitting || noAccounts}
              className="w-full"
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-2 h-4 w-4" />
              )}
              {submitting ? "Starting..." : "Search"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent lookups</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {batches.length === 0 ? (
              <p className="text-sm text-muted-foreground">No lookups yet.</p>
            ) : (
              batches.map((b) => {
                const active = selectedBatch?.id === b.id;
                const done = b.status === "completed" || b.status === "failed";
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelectedBatchId(b.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors data-[active=true]:border-primary data-[active=true]:bg-muted"
                    data-active={active}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium capitalize">
                        {b.source} lookup
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {new Date(b.created_at).toLocaleString()}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      {done ? (
                        <Badge
                          variant={
                            b.status === "failed" ? "destructive" : "success"
                          }
                        >
                          {b.found_count}/{b.total_count} found
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          {b.completed_count}/{b.total_count}
                        </Badge>
                      )}
                    </span>
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
            {selectedBatch ? (
              <span className="capitalize">
                {selectedBatch.source} lookup results
              </span>
            ) : (
              "Results"
            )}
          </CardTitle>
          {selectedBatch ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={selectedResults.length === 0}
              >
                <Download className="mr-2 h-4 w-4" />
                Export CSV
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleDeleteBatch(selectedBatch.id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          {!selectedBatch ? (
            <p className="text-sm text-muted-foreground">
              Run a lookup to see resolved Telegram IDs here.
            </p>
          ) : selectedResults.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Preparing lookup...
            </p>
          ) : (
            <div className="space-y-2">
              {selectedResults.map((r) => (
                <div
                  key={r.id}
                  className="rounded-md border p-3 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{r.phone}</span>
                    {statusBadge(r.status)}
                  </div>
                  {r.status === "found" ? (
                    <div className="mt-2 grid gap-1 text-sm">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {fullName(r) ? (
                          <span className="font-medium">{fullName(r)}</span>
                        ) : null}
                        {r.username ? (
                          <span className="text-muted-foreground">
                            @{r.username}
                          </span>
                        ) : null}
                        {r.is_premium ? (
                          <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                            <Crown className="h-3.5 w-3.5" /> Premium
                          </span>
                        ) : null}
                        {r.is_verified ? (
                          <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400">
                            <BadgeCheck className="h-3.5 w-3.5" /> Verified
                          </span>
                        ) : null}
                      </div>
                      <div className="text-muted-foreground">
                        Telegram ID:{" "}
                        <span className="font-mono text-foreground">
                          {r.telegram_user_id}
                        </span>
                      </div>
                      {r.phone_visible ? (
                        <div className="text-muted-foreground">
                          Visible phone: {r.phone_visible}
                        </div>
                      ) : null}
                      {r.bio ? (
                        <div className="text-muted-foreground">
                          Bio: {r.bio}
                        </div>
                      ) : null}
                    </div>
                  ) : r.status === "pending" ? (
                    <p className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Looking
                      up...
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {r.reason ?? "No result."}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
