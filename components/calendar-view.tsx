"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  BellRing,
  BellOff,
  CalendarDays,
  Users,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Loader2,
} from "lucide-react";
import { getBrowserClient } from "@/lib/supabase-browser";
import type { Account, CalendarEvent, CalendarReminder } from "@/lib/types";
import { AccountStatusBadge } from "@/components/account-status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Props = {
  accounts: Account[];
  initialEvents: CalendarEvent[];
  reminders: CalendarReminder[];
};

type AccountGroup = {
  accountId: string;
  account: Account | undefined;
  label: string;
  username: string | null;
  archived: boolean;
  events: CalendarEvent[];
  upcomingCount: number;
  totalCount: number;
  nextUpcoming: string | null;
};

const formatInTz = (iso: string, tz: string): string => {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: tz,
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString();
  }
};

const isUpcoming = (e: CalendarEvent, now: number): boolean =>
  new Date(e.scheduled_for).getTime() >= now && e.status !== "cancelled";

export const CalendarView = ({
  accounts,
  initialEvents,
  reminders,
}: Props) => {
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null
  );
  const [deleting, setDeleting] = useState<Record<string, boolean>>({});

  const accountById = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  );

  const accountLabel = (id: string | null): string =>
    (id ? accountById.get(id)?.label : undefined) ?? "Removed account";

  const remindersByEvent = useMemo(() => {
    const map = new Map<string, CalendarReminder[]>();
    reminders.forEach((r) => {
      if (!r.event_id) return;
      const list = map.get(r.event_id) ?? [];
      list.push(r);
      map.set(r.event_id, list);
    });
    return map;
  }, [reminders]);

  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase
      .channel("kw_calendar_events_feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "kw_calendar_events" },
        (payload) => {
          setEvents((prev) => {
            const next = payload.new as CalendarEvent;
            if (payload.eventType === "DELETE") {
              return prev.filter(
                (e) => e.id !== (payload.old as CalendarEvent).id
              );
            }
            const without = prev.filter((e) => e.id !== next.id);
            return [...without, next].sort((a, b) =>
              a.scheduled_for.localeCompare(b.scheduled_for)
            );
          });
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  const now = Date.now();

  // Group appointments by Telegram account for the account-first navigation.
  const accountGroups = useMemo<AccountGroup[]>(() => {
    const map = new Map<string, AccountGroup>();
    for (const e of events) {
      const accountId = e.account_id ?? "unknown";
      let group = map.get(accountId);
      if (!group) {
        const account = e.account_id
          ? accountById.get(e.account_id)
          : undefined;
        group = {
          accountId,
          account,
          label: account?.label ?? "Removed account",
          username: account?.username ?? null,
          archived: account?.archived ?? !account,
          events: [],
          upcomingCount: 0,
          totalCount: 0,
          nextUpcoming: null,
        };
        map.set(accountId, group);
      }
      group.events.push(e);
      group.totalCount += 1;
      if (isUpcoming(e, now)) {
        group.upcomingCount += 1;
        if (!group.nextUpcoming || e.scheduled_for < group.nextUpcoming) {
          group.nextUpcoming = e.scheduled_for;
        }
      }
    }
    const list = [...map.values()];
    // Accounts with upcoming appointments first, then by soonest/most recent.
    list.sort((a, b) => {
      if ((b.upcomingCount > 0 ? 1 : 0) !== (a.upcomingCount > 0 ? 1 : 0)) {
        return (b.upcomingCount > 0 ? 1 : 0) - (a.upcomingCount > 0 ? 1 : 0);
      }
      return b.totalCount - a.totalCount;
    });
    return list;
  }, [events, accountById, now]);

  const selectedAccount = useMemo<AccountGroup | null>(
    () =>
      accountGroups.find((g) => g.accountId === selectedAccountId) ?? null,
    [accountGroups, selectedAccountId]
  );

  const deleteEvent = async (event: CalendarEvent): Promise<void> => {
    const ok = window.confirm(
      `Delete the appointment "${event.title}"? This permanently removes it and its reminders.`
    );
    if (!ok) return;
    setDeleting((prev) => ({ ...prev, [event.id]: true }));
    try {
      const res = await fetch(
        `/api/calendar?id=${encodeURIComponent(event.id)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error((await res.json()).error || "Failed");
      setEvents((prev) => prev.filter((e) => e.id !== event.id));
    } catch {
      // Leave it; the user can retry.
    } finally {
      setDeleting((prev) => {
        const next = { ...prev };
        delete next[event.id];
        return next;
      });
    }
  };

  const renderEvent = (event: CalendarEvent) => {
    const eventReminders = remindersByEvent.get(event.id) ?? [];
    return (
      <div key={event.id} className="space-y-2 rounded-lg border p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="font-medium leading-tight">{event.title}</p>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              {formatInTz(event.scheduled_for, event.timezone)}
              <span className="text-xs">({event.timezone})</span>
            </p>
            {event.sender_name ? (
              <p className="text-xs text-muted-foreground">
                with {event.sender_name}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge
              variant={event.status === "cancelled" ? "destructive" : "default"}
              className="text-[10px] capitalize"
            >
              {event.status}
            </Badge>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={() => deleteEvent(event)}
              disabled={Boolean(deleting[event.id])}
              aria-label={`Delete appointment ${event.title}`}
            >
              {deleting[event.id] ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        {eventReminders.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-t pt-2">
            {eventReminders.map((r) => (
              <span
                key={r.id}
                className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {r.sent ? (
                  <BellOff className="h-3 w-3" />
                ) : (
                  <BellRing className="h-3 w-3" />
                )}
                {r.label ?? `${r.offset_minutes} min before`}
                {r.sent ? " - sent" : ""}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    );
  };

  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted-foreground">
          <CalendarDays className="h-8 w-8 opacity-50" />
          No appointments yet. Confirmed appointments from auto-reply will appear
          here.
        </CardContent>
      </Card>
    );
  }

  // Account-first list view.
  if (!selectedAccount) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {accountGroups.map((group) => (
          <button
            key={group.accountId}
            type="button"
            onClick={() => setSelectedAccountId(group.accountId)}
            className="flex items-center justify-between gap-2 rounded-lg border p-4 text-left transition-colors hover:bg-accent/50"
          >
            <div className="min-w-0 space-y-1.5">
              <span className="flex items-center gap-1.5 truncate font-medium">
                <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
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
              </div>
              <p className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground/70">
                  {group.upcomingCount} upcoming
                </span>{" "}
                / {group.totalCount} total
              </p>
              {group.nextUpcoming ? (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <CalendarClock className="h-3 w-3" />
                  Next:{" "}
                  {formatInTz(
                    group.nextUpcoming,
                    group.account?.autoreply_timezone ??
                      group.events[0]?.timezone ??
                      "Asia/Kuala_Lumpur"
                  )}
                </p>
              ) : null}
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        ))}
      </div>
    );
  }

  // Selected-account detail view: Upcoming + Past.
  const upcoming = selectedAccount.events
    .filter((e) => isUpcoming(e, now))
    .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for));
  const past = selectedAccount.events
    .filter((e) => !isUpcoming(e, now))
    .sort((a, b) => b.scheduled_for.localeCompare(a.scheduled_for));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setSelectedAccountId(null)}
          className="flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
          Accounts
        </button>
        <span className="text-sm text-muted-foreground">/</span>
        <span className="font-semibold">{accountLabel(selectedAccount.accountId)}</span>
        {selectedAccount.archived ? (
          <Badge
            variant="outline"
            className="border-amber-500/40 text-[10px] text-amber-600 dark:text-amber-400"
          >
            Removed
          </Badge>
        ) : null}
        <Badge variant="secondary" className="text-[10px]">
          {selectedAccount.totalCount} appointment
          {selectedAccount.totalCount === 1 ? "" : "s"}
        </Badge>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upcoming</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {upcoming.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No upcoming appointments.
              </p>
            ) : (
              upcoming.map(renderEvent)
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Past</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {past.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No past appointments.
              </p>
            ) : (
              past.map(renderEvent)
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
