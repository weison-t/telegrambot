"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Sparkles,
  RefreshCw,
  Loader2,
  MessagesSquare,
  User,
  Users,
  Ban,
  Clock,
  StickyNote,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
  Trash2,
} from "lucide-react";
import { getBrowserClient } from "@/lib/supabase-browser";
import type { Account, AutoreplyMessage, Conversation } from "@/lib/types";
import { CONVERSATION_STATUSES, SECURITY_STATUS_LABELS } from "@/lib/types";
import { AccountStatusBadge } from "@/components/account-status-badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Props = {
  accounts: Account[];
  initialMessages: AutoreplyMessage[];
  initialConversations: Conversation[];
};

type ConversationGroup = {
  key: string;
  accountId: string;
  accountLabel: string;
  peerId: string;
  peerName: string;
  messages: AutoreplyMessage[];
  lastAt: string;
};

type AccountGroup = {
  accountId: string;
  account: Account | undefined;
  label: string;
  username: string | null;
  archived: boolean;
  conversations: ConversationGroup[];
  lastAt: string;
  messageCount: number;
};

type SummaryState = {
  loading: boolean;
  error: string | null;
};

const convKey = (accountId: string | null, peerId: string | null): string =>
  `${accountId ?? "unknown"}::${peerId ?? "unknown"}`;

// No activity for this long => the conversation is treated as completed.
const IDLE_COMPLETE_MS = 30 * 60_000;

const relativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

// Status is derived from activity unless the user has pinned it manually.
const deriveStatus = (
  meta: Conversation | undefined,
  lastAt: string
): "ongoing" | "completed" => {
  if (meta?.status_manual) {
    return meta.status === "completed" ? "completed" : "ongoing";
  }
  return Date.now() - new Date(lastAt).getTime() >= IDLE_COMPLETE_MS
    ? "completed"
    : "ongoing";
};

export const ConversationsView = ({
  accounts,
  initialMessages,
  initialConversations,
}: Props) => {
  const [messages, setMessages] = useState<AutoreplyMessage[]>(initialMessages);
  const [meta, setMeta] = useState<Record<string, Conversation>>(() =>
    Object.fromEntries(
      initialConversations.map((c) => [convKey(c.account_id, c.peer_id), c])
    )
  );
  const [search, setSearch] = useState("");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});
  const [summaries, setSummaries] = useState<Record<string, SummaryState>>({});
  const [notesDrafts, setNotesDrafts] = useState<Record<string, string>>({});
  const [notesSaving, setNotesSaving] = useState<Record<string, boolean>>({});

  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  );
  const accountLabel = (id: string | null): string =>
    (id ? accountById.get(id)?.label : undefined) ?? "Removed account";

  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel("kw_conversations_feed")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "kw_autoreply_messages" },
        (payload) => {
          setMessages((prev) => [...prev, payload.new as AutoreplyMessage]);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "kw_conversations" },
        (payload) => {
          const row = payload.new as Conversation;
          if (!row?.account_id || !row?.peer_id) return;
          setMeta((prev) => ({
            ...prev,
            [convKey(row.account_id, row.peer_id)]: row,
          }));
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const conversations = useMemo<ConversationGroup[]>(() => {
    const map = new Map<string, ConversationGroup>();
    for (const m of messages) {
      const key = convKey(m.account_id, m.peer_id);
      let conv = map.get(key);
      if (!conv) {
        conv = {
          key,
          accountId: m.account_id ?? "unknown",
          accountLabel: accountLabel(m.account_id),
          peerId: m.peer_id ?? "unknown",
          peerName: m.peer_name ?? m.peer_id ?? "Unknown",
          messages: [],
          lastAt: m.created_at,
        };
        map.set(key, conv);
      }
      conv.messages.push(m);
      if (m.created_at > conv.lastAt) conv.lastAt = m.created_at;
      if (m.peer_name) conv.peerName = m.peer_name;
    }
    const list = [...map.values()];
    list.forEach((c) =>
      c.messages.sort((a, b) => a.created_at.localeCompare(b.created_at))
    );
    list.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, accounts]);

  // Group conversations by Telegram account for the account-first navigation.
  const accountGroups = useMemo<AccountGroup[]>(() => {
    const map = new Map<string, AccountGroup>();
    for (const conv of conversations) {
      let group = map.get(conv.accountId);
      if (!group) {
        const account = accountById.get(conv.accountId);
        group = {
          accountId: conv.accountId,
          account,
          label: account?.label ?? "Removed account",
          username: account?.username ?? null,
          archived: account?.archived ?? !account,
          conversations: [],
          lastAt: conv.lastAt,
          messageCount: 0,
        };
        map.set(conv.accountId, group);
      }
      group.conversations.push(conv);
      group.messageCount += conv.messages.length;
      if (conv.lastAt > group.lastAt) group.lastAt = conv.lastAt;
    }
    const list = [...map.values()];
    list.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
    return list;
  }, [conversations, accountById]);

  const accountFiltered = useMemo<AccountGroup[]>(() => {
    const q = search.trim().toLowerCase();
    if (!q) return accountGroups;
    return accountGroups.filter(
      (g) =>
        g.label.toLowerCase().includes(q) ||
        (g.username ?? "").toLowerCase().includes(q)
    );
  }, [accountGroups, search]);

  const selectedAccount = useMemo<AccountGroup | null>(
    () => accountGroups.find((g) => g.accountId === selectedAccountId) ?? null,
    [accountGroups, selectedAccountId]
  );

  // Conversations of the selected account, filtered by the in-account search.
  const filtered = useMemo<ConversationGroup[]>(() => {
    if (!selectedAccount) return [];
    const q = search.trim().toLowerCase();
    if (!q) return selectedAccount.conversations;
    return selectedAccount.conversations.filter(
      (c) =>
        c.peerName.toLowerCase().includes(q) ||
        c.messages.some(
          (m) =>
            (m.incoming ?? "").toLowerCase().includes(q) ||
            (m.reply ?? "").toLowerCase().includes(q)
        )
    );
  }, [selectedAccount, search]);

  const selected =
    filtered.find((c) => c.key === selectedKey) ?? filtered[0] ?? null;

  const openAccount = (accountId: string): void => {
    setSelectedAccountId(accountId);
    setSelectedKey(null);
    setSearch("");
  };

  const backToAccounts = (): void => {
    setSelectedAccountId(null);
    setSelectedKey(null);
    setSearch("");
  };

  const deleteConversation = async (conv: ConversationGroup): Promise<void> => {
    const ok = window.confirm(
      `Delete the conversation with ${conv.peerName}? This permanently removes its ${conv.messages.length} logged message(s) and cannot be undone.`
    );
    if (!ok) return;
    setDeleting((prev) => ({ ...prev, [conv.key]: true }));
    try {
      const res = await fetch(
        `/api/conversations?account_id=${encodeURIComponent(
          conv.accountId
        )}&peer_id=${encodeURIComponent(conv.peerId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      // Drop this conversation's messages from local state.
      setMessages((prev) =>
        prev.filter(
          (m) =>
            !(
              (m.account_id ?? "unknown") === conv.accountId &&
              (m.peer_id ?? "unknown") === conv.peerId
            )
        )
      );
      setMeta((prev) => {
        const next = { ...prev };
        delete next[conv.key];
        return next;
      });
      if (selectedKey === conv.key) setSelectedKey(null);
    } catch {
      // Leave it; the user can retry.
    } finally {
      setDeleting((prev) => {
        const next = { ...prev };
        delete next[conv.key];
        return next;
      });
    }
  };

  const summarize = async (
    conv: ConversationGroup,
    force = false
  ): Promise<void> => {
    setSummaries((prev) => ({
      ...prev,
      [conv.key]: { loading: true, error: null },
    }));
    try {
      const res = await fetch("/api/autoreply/summarize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          account_id: conv.accountId,
          peer_id: conv.peerId,
          force,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to summarize");
      setMeta((prev) => {
        const existing = prev[conv.key];
        return {
          ...prev,
          [conv.key]: {
            ...(existing ?? ({} as Conversation)),
            account_id: conv.accountId,
            peer_id: conv.peerId,
            peer_name: conv.peerName,
            summary: data.summary,
            summary_updated_at: data.summary_updated_at ?? null,
          } as Conversation,
        };
      });
      setSummaries((prev) => ({
        ...prev,
        [conv.key]: { loading: false, error: null },
      }));
    } catch (err) {
      setSummaries((prev) => ({
        ...prev,
        [conv.key]: {
          loading: false,
          error: err instanceof Error ? err.message : "Failed",
        },
      }));
    }
  };

  const updateConversation = async (
    conv: ConversationGroup,
    patch: { disabled?: boolean; status?: string; security_status?: string }
  ): Promise<void> => {
    // Optimistic update.
    setMeta((prev) => {
      const existing = prev[conv.key];
      return {
        ...prev,
        [conv.key]: {
          ...(existing ?? ({} as Conversation)),
          account_id: conv.accountId,
          peer_id: conv.peerId,
          peer_name: conv.peerName,
          ...(patch.disabled != null ? { disabled: patch.disabled } : {}),
          ...(patch.status != null
            ? { status: patch.status, status_manual: true }
            : {}),
          ...(patch.security_status != null
            ? {
                security_status: patch.security_status,
                ...(patch.security_status === "normal"
                  ? { threat_score: 0, last_threat_reason: null }
                  : {}),
              }
            : {}),
        } as Conversation,
      };
    });
    try {
      await fetch("/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          account_id: conv.accountId,
          peer_id: conv.peerId,
          peer_name: conv.peerName,
          ...patch,
        }),
      });
    } catch {
      // Realtime will reconcile on the next sweep if this failed.
    }
  };

  const saveNotes = async (conv: ConversationGroup): Promise<void> => {
    const notes = notesDrafts[conv.key] ?? meta[conv.key]?.notes ?? "";
    setNotesSaving((prev) => ({ ...prev, [conv.key]: true }));
    try {
      await fetch("/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          account_id: conv.accountId,
          peer_id: conv.peerId,
          peer_name: conv.peerName,
          notes,
        }),
      });
      setMeta((prev) => {
        const existing = prev[conv.key];
        return {
          ...prev,
          [conv.key]: {
            ...(existing ?? ({} as Conversation)),
            account_id: conv.accountId,
            peer_id: conv.peerId,
            peer_name: conv.peerName,
            notes,
          } as Conversation,
        };
      });
      setNotesDrafts((prev) => {
        const next = { ...prev };
        delete next[conv.key];
        return next;
      });
    } catch {
      // Leave the draft so the user can retry.
    } finally {
      setNotesSaving((prev) => ({ ...prev, [conv.key]: false }));
    }
  };

  if (conversations.length === 0) {
    return (
      <Card className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
        <MessagesSquare className="h-8 w-8 opacity-50" />
        No conversations yet. Incoming messages and any auto-replies appear here,
        grouped by contact.
      </Card>
    );
  }

  const summaryState = selected ? summaries[selected.key] : undefined;
  const selectedMeta = selected ? meta[selected.key] : undefined;
  const summaryText = selectedMeta?.summary ?? null;
  const summaryUpdatedAt = selectedMeta?.summary_updated_at ?? null;
  const selectedStatus = selected
    ? deriveStatus(selectedMeta, selected.lastAt)
    : "ongoing";
  const lastRow = selected?.messages[selected.messages.length - 1];
  const lastAuthor = lastRow?.reply ? "You (auto-reply)" : selected?.peerName;
  // Sender identity comes from captured inbound rows (latest non-empty wins).
  const senderRow = selected
    ? [...selected.messages]
        .reverse()
        .find((m) => m.sender_username || m.sender_tg_id)
    : undefined;
  const senderUsername = senderRow?.sender_username ?? null;
  const senderTgId = senderRow?.sender_tg_id ?? selected?.peerId ?? null;
  const selectedStale = Boolean(
    summaryText &&
      selectedMeta?.summarized_through &&
      selected &&
      selected.lastAt > (selectedMeta.summarized_through ?? "")
  );
  const notesValue = selected
    ? notesDrafts[selected.key] ?? selectedMeta?.notes ?? ""
    : "";
  const notesDirty = selected
    ? notesValue !== (selectedMeta?.notes ?? "")
    : false;
  const notesIsSaving = selected ? Boolean(notesSaving[selected.key]) : false;

  return (
    <div className="grid h-[calc(100vh-12rem)] gap-4 lg:grid-cols-[340px_1fr]">
      {/* Left column: accounts, then that account's conversations */}
      <Card className="flex min-h-0 flex-col">
        {!selectedAccount ? (
          <>
            <div className="border-b p-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search account..."
                  aria-label="Search accounts"
                  className="pl-8"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {accountFiltered.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  No matches.
                </p>
              ) : (
                accountFiltered.map((group) => (
                  <button
                    key={group.accountId}
                    type="button"
                    onClick={() => openAccount(group.accountId)}
                    className="flex w-full items-center justify-between gap-2 border-b px-4 py-3 text-left transition-colors hover:bg-accent/50"
                  >
                    <div className="min-w-0 space-y-1">
                      <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                        <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        {group.label}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {group.username ? (
                          <span className="text-xs text-muted-foreground">
                            @{group.username}
                          </span>
                        ) : null}
                        {group.archived ? (
                          <Badge
                            variant="outline"
                            className="border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400"
                          >
                            Removed
                          </Badge>
                        ) : group.account ? (
                          <AccountStatusBadge status={group.account.status} />
                        ) : null}
                        <span className="text-[10px] text-muted-foreground">
                          {group.conversations.length} chat
                          {group.conversations.length === 1 ? "" : "s"}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span
                        className="text-[10px] text-muted-foreground"
                        title={new Date(group.lastAt).toLocaleString()}
                      >
                        {relativeTime(group.lastAt)}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                ))
              )}
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2 border-b p-3">
              <button
                type="button"
                onClick={backToAccounts}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
                Accounts
              </button>
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-semibold">
                  {selectedAccount.label}
                </span>
                {selectedAccount.archived ? (
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400"
                  >
                    Removed
                  </Badge>
                ) : null}
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search contact or message..."
                  aria-label="Search conversations"
                  className="pl-8"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  No matches.
                </p>
              ) : (
                filtered.map((conv) => {
                  const last = conv.messages[conv.messages.length - 1];
                  const isActive = selected?.key === conv.key;
                  const m = meta[conv.key];
                  const status = deriveStatus(m, conv.lastAt);
                  const stale = Boolean(
                    m?.summarized_through &&
                      conv.lastAt > (m.summarized_through ?? "")
                  );
                  return (
                    <div
                      key={conv.key}
                      className={cn(
                        "group flex items-start gap-1 border-b transition-colors",
                        {
                          "bg-accent": isActive,
                          "hover:bg-accent/50": !isActive,
                        }
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedKey(conv.key)}
                        className="flex min-w-0 flex-1 flex-col gap-1 px-4 py-3 text-left"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 truncate text-sm font-medium">
                            <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            {conv.peerName}
                          </span>
                          <span
                            className="shrink-0 text-[10px] text-muted-foreground"
                            title={new Date(conv.lastAt).toLocaleString()}
                          >
                            {relativeTime(conv.lastAt)}
                          </span>
                        </div>
                        <p className="truncate text-xs text-muted-foreground">
                          <span className="font-medium text-foreground/70">
                            {last?.reply ? "You: " : `${conv.peerName}: `}
                          </span>
                          {last?.reply ?? last?.incoming ?? ""}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            variant="outline"
                            className={cn("text-[10px] capitalize", {
                              "border-emerald-500/40 text-emerald-600 dark:text-emerald-400":
                                status === "completed",
                            })}
                          >
                            {status}
                          </Badge>
                          {m?.disabled ? (
                            <Badge
                              variant="outline"
                              className="gap-1 border-destructive/40 text-[10px] text-destructive"
                            >
                              <Ban className="h-3 w-3" />
                              Muted
                            </Badge>
                          ) : null}
                          {m?.security_status === "blocked" ||
                          m?.security_status === "suspected" ? (
                            <Badge
                              variant="outline"
                              className={cn("gap-1 text-[10px]", {
                                "border-destructive/40 text-destructive":
                                  m.security_status === "blocked",
                                "border-amber-500/40 text-amber-600 dark:text-amber-400":
                                  m.security_status === "suspected",
                              })}
                            >
                              <ShieldAlert className="h-3 w-3" />
                              {SECURITY_STATUS_LABELS[
                                m.security_status as "blocked" | "suspected"
                              ]}
                            </Badge>
                          ) : null}
                          {stale ? (
                            <Badge
                              variant="outline"
                              className="gap-1 border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400"
                            >
                              <Clock className="h-3 w-3" />
                              New since summary
                            </Badge>
                          ) : null}
                        </div>
                      </button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="mr-1 mt-2 h-7 w-7 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                        onClick={() => deleteConversation(conv)}
                        disabled={Boolean(deleting[conv.key])}
                        aria-label={`Delete conversation with ${conv.peerName}`}
                      >
                        {deleting[conv.key] ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </>
        )}
      </Card>

      {/* Conversation detail */}
      <Card className="flex min-h-0 flex-col">
        {selected ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
              <div className="space-y-0.5">
                <p className="font-medium leading-tight">{selected.peerName}</p>
                <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {senderUsername ? <span>@{senderUsername}</span> : null}
                  {senderTgId ? <span>ID: {senderTgId}</span> : null}
                </p>
                <p className="text-xs text-muted-foreground">
                  via {selected.accountLabel}
                  {selectedAccount?.archived ? " (removed)" : ""} -{" "}
                  {selected.messages.length} message
                  {selected.messages.length === 1 ? "" : "s"}
                </p>
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  Last message: {lastAuthor} -{" "}
                  <span title={new Date(selected.lastAt).toLocaleString()}>
                    {new Date(selected.lastAt).toLocaleString()} (
                    {relativeTime(selected.lastAt)})
                  </span>
                </p>
              </div>
              <div className="flex items-center gap-4">
                <Select
                  value={selectedStatus}
                  onValueChange={(value) =>
                    void updateConversation(selected, { status: value })
                  }
                >
                  <SelectTrigger
                    className="h-8 w-[130px]"
                    aria-label="Conversation status"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONVERSATION_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-2 text-xs font-medium">
                  <span
                    className={cn("transition-colors", {
                      "text-destructive": selectedMeta?.disabled,
                      "text-muted-foreground": !selectedMeta?.disabled,
                    })}
                  >
                    Auto-reply off
                  </span>
                  <Switch
                    checked={Boolean(selectedMeta?.disabled)}
                    onCheckedChange={(checked) =>
                      void updateConversation(selected, { disabled: checked })
                    }
                    aria-label="Disable auto-reply for this contact"
                  />
                </label>
              </div>
            </div>

            {selectedMeta?.disabled ? (
              <div className="border-b bg-destructive/5 px-4 py-2 text-xs text-destructive">
                Auto-reply is disabled for this contact. Incoming messages will
                be ignored, overriding the account configuration.
              </div>
            ) : null}

            {selectedMeta?.security_status === "blocked" ||
            selectedMeta?.security_status === "suspected" ? (
              <div
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2 text-xs",
                  {
                    "bg-destructive/5 text-destructive":
                      selectedMeta.security_status === "blocked",
                    "bg-amber-500/5 text-amber-700 dark:text-amber-400":
                      selectedMeta.security_status === "suspected",
                  }
                )}
              >
                <span className="flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                  {selectedMeta.security_status === "blocked"
                    ? "Auto-replies are paused: this contact may be probing or exploiting the bot."
                    : "Flagged: this contact may be testing whether you're a bot. Replies are slowed."}
                  {selectedMeta.last_threat_reason
                    ? ` (${selectedMeta.last_threat_reason})`
                    : ""}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() =>
                    void updateConversation(selected, {
                      security_status: "normal",
                    })
                  }
                >
                  Clear flag
                </Button>
              </div>
            ) : null}

            {/* Per-contact memory */}
            <div className="border-b p-4">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <StickyNote className="h-4 w-4 text-primary" />
                  Notes / memory
                </span>
                {notesDirty ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => saveNotes(selected)}
                    disabled={notesIsSaving}
                  >
                    {notesIsSaving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    Save
                  </Button>
                ) : null}
              </div>
              <Textarea
                placeholder="Facts the AI should remember about this contact (e.g. prefers evening calls, runs a cafe in PJ)..."
                value={notesValue}
                onChange={(e) =>
                  setNotesDrafts((prev) => ({
                    ...prev,
                    [selected.key]: e.target.value,
                  }))
                }
                className="min-h-[60px] text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Injected into the auto-reply prompt for this contact only.
              </p>
            </div>

            {/* AI summary (generated on demand only) */}
            <div className="border-b bg-muted/40 p-4">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Summary
                  {summaryUpdatedAt ? (
                    <span className="text-[10px] font-normal text-muted-foreground">
                      updated {relativeTime(summaryUpdatedAt)}
                    </span>
                  ) : null}
                </span>
                {summaryText ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 px-2 text-xs"
                    onClick={() => summarize(selected, true)}
                    disabled={summaryState?.loading}
                    aria-label="Regenerate summary"
                  >
                    {summaryState?.loading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    Regenerate
                  </Button>
                ) : null}
              </div>

              {selectedStale ? (
                <p className="mb-1.5 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <Clock className="h-3 w-3" />
                  New messages since this summary - regenerate to update it.
                </p>
              ) : null}

              {summaryState?.loading && !summaryText ? (
                <p className="text-sm text-muted-foreground">
                  Generating summary...
                </p>
              ) : summaryState?.error ? (
                <p className="text-sm text-destructive">{summaryState.error}</p>
              ) : summaryText ? (
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                  {summaryText}
                </p>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => summarize(selected, true)}
                  disabled={summaryState?.loading}
                >
                  {summaryState?.loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Generate summary
                </Button>
              )}
            </div>

            {/* Message thread: each row is either an incoming message, an
                auto-reply, or (for legacy rows) both. */}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {selected.messages.map((m) => (
                <div key={m.id} className="space-y-2">
                  {m.incoming ? (
                    <div className="flex flex-col items-start">
                      <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-muted px-3 py-2 text-sm">
                        {m.incoming}
                      </div>
                      <span className="mt-0.5 text-[10px] text-muted-foreground">
                        {selected.peerName} -{" "}
                        {new Date(m.created_at).toLocaleString()}
                      </span>
                    </div>
                  ) : null}
                  {m.reply ? (
                    <div className="flex flex-col items-end">
                      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-foreground">
                        {m.reply}
                      </div>
                      <span className="mt-0.5 text-[10px] text-muted-foreground">
                        Auto-reply - {new Date(m.created_at).toLocaleString()}
                      </span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Select a conversation.
          </div>
        )}
      </Card>
    </div>
  );
};
