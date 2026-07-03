"use client";

import type { ReactNode } from "react";
import { useMemo, useRef } from "react";
import { toast } from "sonner";
import { Check, Download, Upload } from "lucide-react";
import type { Account } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  detectTimezone,
  listTimezones,
  localToUtcIso,
} from "@/lib/schedule";

export type TargetTab = "single" | "multiple" | "csv";

export type BroadcastFormValue = {
  name: string;
  message: string;
  accountIds: string[];
  targetTab: TargetTab;
  single: string;
  multiple: string;
  csvTargets: string[];
  csvFileName: string;
  minDelay: number;
  maxDelay: number;
  perAccountDailyLimit: number;
  dryRun: boolean;
  model: string;
  replyAiEnabled: boolean;
  replyKnowledge: string;
  replyPersona: string;
  replyInstructions: string;
  replyLink: string;
  scheduleEnabled: boolean;
  scheduleLocal: string;
  timezone: string;
};

const TEMPLATE_CSV = "target\n@johndoe\n@janedoe\n123456789\n";

// Splits pasted/uploaded text into individual recipient entries.
export const parseTargetLines = (raw: string): string[] =>
  raw
    .split(/[\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.toLowerCase() !== "target");

export const emptyBroadcastForm = (): BroadcastFormValue => ({
  name: "",
  message: "",
  accountIds: [],
  targetTab: "multiple",
  single: "",
  multiple: "",
  csvTargets: [],
  csvFileName: "",
  minDelay: 45,
  maxDelay: 90,
  perAccountDailyLimit: 30,
  dryRun: true,
  model: "gpt-4o-mini",
  replyAiEnabled: true,
  replyKnowledge: "",
  replyPersona: "",
  replyInstructions: "",
  replyLink: "",
  scheduleEnabled: false,
  scheduleLocal: "",
  timezone: detectTimezone(),
});

// The recipient list for the currently active input tab.
export const targetsForForm = (value: BroadcastFormValue): string[] => {
  if (value.targetTab === "single") return parseTargetLines(value.single).slice(0, 1);
  if (value.targetTab === "multiple") return parseTargetLines(value.multiple);
  return value.csvTargets;
};

export const validateBroadcastForm = (
  value: BroadcastFormValue
): string | null => {
  if (!value.name.trim()) return "Broadcast name is required.";
  if (!value.message.trim()) return "Message is required.";
  if (value.accountIds.length === 0) {
    return "Select at least one sending account.";
  }
  if (targetsForForm(value).length === 0) {
    return "Add at least one recipient (@username or numeric id).";
  }
  if (value.minDelay > value.maxDelay) {
    return "Min delay cannot exceed max delay.";
  }
  if (value.scheduleEnabled) {
    if (!value.scheduleLocal) return "Pick a date and time for the launch.";
    const iso = localToUtcIso(value.scheduleLocal, value.timezone);
    if (!iso) return "The scheduled date/time is invalid.";
    if (new Date(iso).getTime() <= Date.now()) {
      return "The scheduled time must be in the future.";
    }
  }
  return null;
};

export const scheduleToPayload = (
  value: BroadcastFormValue
): { start_at: string | null; timezone: string | null } => {
  if (!value.scheduleEnabled) return { start_at: null, timezone: null };
  return {
    start_at: localToUtcIso(value.scheduleLocal, value.timezone),
    timezone: value.timezone,
  };
};

type Props = {
  value: BroadcastFormValue;
  onChange: (patch: Partial<BroadcastFormValue>) => void;
  accounts: Account[];
  // When editing, hide the recipient editor unless the operator opts in.
  footer?: ReactNode;
};

export const BroadcastSettingsFields = ({
  value,
  onChange,
  accounts,
  footer,
}: Props) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timezones = useMemo(() => listTimezones(), []);

  const connectedAccounts = useMemo(
    () => accounts.filter((a) => Boolean(a.session_enc)),
    [accounts]
  );

  const toggleAccount = (id: string) => {
    const set = new Set(value.accountIds);
    if (set.has(id)) {
      set.delete(id);
    } else {
      set.add(id);
    }
    onChange({ accountIds: Array.from(set) });
  };

  const handleTemplateDownload = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "broadcast-recipients-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleFileChange = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const targets = parseTargetLines(text);
    onChange({ csvTargets: targets, csvFileName: file.name });
    if (targets.length === 0) {
      toast.error("No recipients found in that file.");
    } else {
      toast.success(`Loaded ${targets.length} recipients from ${file.name}.`);
    }
  };

  const targetCount = targetsForForm(value).length;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Message</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bc-name">Broadcast name</Label>
              <Input
                id="bc-name"
                placeholder="July product launch"
                value={value.name}
                onChange={(e) => onChange({ name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bc-message">Message</Label>
              <Textarea
                id="bc-message"
                placeholder="Hey {name}, we just launched..."
                rows={6}
                value={value.message}
                onChange={(e) => onChange({ message: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">
                Use <code>{"{name}"}</code> or <code>{"{username}"}</code> to
                personalize per recipient.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recipients</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Tabs
              value={value.targetTab}
              onValueChange={(v) => onChange({ targetTab: v as TargetTab })}
            >
              <TabsList className="w-full">
                <TabsTrigger value="single" className="flex-1">
                  Single
                </TabsTrigger>
                <TabsTrigger value="multiple" className="flex-1">
                  Multiple
                </TabsTrigger>
                <TabsTrigger value="csv" className="flex-1">
                  CSV upload
                </TabsTrigger>
              </TabsList>

              <TabsContent value="single" className="space-y-2">
                <Label htmlFor="bc-single">Recipient</Label>
                <Input
                  id="bc-single"
                  placeholder="@username or 123456789"
                  value={value.single}
                  onChange={(e) => onChange({ single: e.target.value })}
                />
              </TabsContent>

              <TabsContent value="multiple" className="space-y-2">
                <Label htmlFor="bc-multiple">Recipients (one per line)</Label>
                <Textarea
                  id="bc-multiple"
                  placeholder={"@johndoe\n@janedoe\n123456789"}
                  rows={6}
                  value={value.multiple}
                  onChange={(e) => onChange({ multiple: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  {parseTargetLines(value.multiple).length} recipient(s) ready.
                  Paste @usernames or numeric ids (from Telegram ID Search).
                </p>
              </TabsContent>

              <TabsContent value="csv" className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleTemplateDownload}
                    className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download template
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Upload CSV
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  CSV with a single &quot;target&quot; column of @usernames or
                  numeric ids.
                  {value.csvFileName
                    ? ` Loaded ${value.csvTargets.length} from ${value.csvFileName}.`
                    : ""}
                </p>
              </TabsContent>
            </Tabs>

            <Badge variant={targetCount > 0 ? "success" : "secondary"}>
              {targetCount} recipient(s)
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sending & safety</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Delay between sends</Label>
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
                  className="w-24"
                  aria-label="Minimum delay seconds"
                />
                <span className="text-muted-foreground">to</span>
                <Input
                  type="number"
                  min={1}
                  value={value.maxDelay}
                  onChange={(e) => onChange({ maxDelay: Number(e.target.value) })}
                  className="w-24"
                  aria-label="Maximum delay seconds"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Cold-DMing non-contacts is ban-risky. Longer, randomized delays
                are safer.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bc-cap">Per-account daily limit</Label>
              <Input
                id="bc-cap"
                type="number"
                min={1}
                value={value.perAccountDailyLimit}
                onChange={(e) =>
                  onChange({ perAccountDailyLimit: Number(e.target.value) })
                }
                className="w-24"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bc-model">OpenAI model (for replies)</Label>
              <Input
                id="bc-model"
                value={value.model}
                onChange={(e) => onChange({ model: e.target.value })}
              />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="bc-dry">Dry run (test mode)</Label>
                <p className="text-xs text-muted-foreground">
                  Log targets as sent without messaging Telegram.
                </p>
              </div>
              <Switch
                id="bc-dry"
                checked={value.dryRun}
                onCheckedChange={(dryRun) => onChange({ dryRun })}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Sending accounts
              <Badge
                variant={value.accountIds.length > 0 ? "success" : "secondary"}
              >
                {value.accountIds.length} selected
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Messages are sent round-robin across the selected accounts to
              spread load.
            </p>
            {connectedAccounts.length === 0 ? (
              <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                No connected accounts. Log in an account under Accounts first.
              </p>
            ) : null}
            {connectedAccounts.map((account) => {
              const isSelected = value.accountIds.includes(account.id);
              return (
                <button
                  key={account.id}
                  type="button"
                  onClick={() => toggleAccount(account.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors",
                    { "border-primary bg-accent/40": isSelected }
                  )}
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
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reply automation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="bc-reply">AI reply on response</Label>
                <p className="text-xs text-muted-foreground">
                  When a recipient replies, answer them with the product
                  knowledge below.
                </p>
              </div>
              <Switch
                id="bc-reply"
                checked={value.replyAiEnabled}
                onCheckedChange={(replyAiEnabled) => onChange({ replyAiEnabled })}
              />
            </div>

            {value.replyAiEnabled ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="bc-persona">Persona (optional)</Label>
                  <Input
                    id="bc-persona"
                    placeholder="Alex from the sales team"
                    value={value.replyPersona}
                    onChange={(e) => onChange({ replyPersona: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bc-knowledge">Product knowledge / FAQ</Label>
                  <Textarea
                    id="bc-knowledge"
                    placeholder="What the product does, pricing, common questions..."
                    rows={5}
                    value={value.replyKnowledge}
                    onChange={(e) =>
                      onChange({ replyKnowledge: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bc-instructions">
                    Reply instructions (optional)
                  </Label>
                  <Textarea
                    id="bc-instructions"
                    placeholder="Be concise, friendly; steer toward booking a demo..."
                    rows={3}
                    value={value.replyInstructions}
                    onChange={(e) =>
                      onChange({ replyInstructions: e.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bc-link">Follow-up link (optional)</Label>
                  <Input
                    id="bc-link"
                    placeholder="https://example.com/demo"
                    value={value.replyLink}
                    onChange={(e) => onChange({ replyLink: e.target.value })}
                  />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label htmlFor="bc-schedule">Schedule for later</Label>
                <p className="text-xs text-muted-foreground">
                  Launch the broadcast automatically at a set time.
                </p>
              </div>
              <Switch
                id="bc-schedule"
                checked={value.scheduleEnabled}
                onCheckedChange={(scheduleEnabled) =>
                  onChange({ scheduleEnabled })
                }
              />
            </div>

            {value.scheduleEnabled ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="bc-schedule-at">Launch date & time</Label>
                  <Input
                    id="bc-schedule-at"
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
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {footer}
      </div>
    </div>
  );
};
