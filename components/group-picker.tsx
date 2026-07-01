"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, Loader2, Hash, Copy } from "lucide-react";
import type { Account, GroupInfo } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Props = {
  accounts: Account[];
  onSelect: (target: string) => void;
};

export const GroupPicker = ({ accounts, onSelect }: Props) => {
  const onlineAccounts = useMemo(
    () => accounts.filter((a) => a.status === "online"),
    [accounts]
  );

  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<GroupInfo[]>([]);
  const [query, setQuery] = useState("");

  const loadGroups = async (id: string) => {
    setAccountId(id);
    setLoading(true);
    setGroups([]);
    try {
      const res = await fetch(`/api/accounts/${id}/groups`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load groups");
      setGroups(data.groups as GroupInfo[]);
      if ((data.groups as GroupInfo[]).length === 0) {
        toast.info("This account is not in any groups.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next && onlineAccounts.length > 0 && !accountId) {
      void loadGroups(onlineAccounts[0].id);
    }
  };

  const pick = (group: GroupInfo) => {
    const value = group.username ? `@${group.username}` : group.id;
    onSelect(value);
    toast.success(`Target set to ${value}`);
    setOpen(false);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.title.toLowerCase().includes(q) ||
        g.username?.toLowerCase().includes(q) ||
        g.id.includes(q)
    );
  }, [groups, query]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Search className="h-4 w-4" />
          Browse groups
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Find a group</DialogTitle>
          <DialogDescription>
            Lists the groups a connected account belongs to. Pick one to use as
            the target chat.
          </DialogDescription>
        </DialogHeader>

        {onlineAccounts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No online accounts. Connect an account first to look up its groups.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Select value={accountId} onValueChange={loadGroups}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Account" />
                </SelectTrigger>
                <SelectContent>
                  {onlineAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Search by name or id..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
              {loading ? (
                <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Loading groups...
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No groups to show.
                </p>
              ) : (
                filtered.map((group) => (
                  <div
                    key={group.id}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium">
                          {group.title}
                        </p>
                        <Badge variant="secondary" className="text-[10px]">
                          {group.type}
                        </Badge>
                      </div>
                      <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <Hash className="h-3 w-3" />
                        {group.username ? `@${group.username} · ` : ""}
                        {group.id}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="Copy id"
                        onClick={() => {
                          void navigator.clipboard.writeText(group.id);
                          toast.success("Group id copied");
                        }}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button type="button" size="sm" onClick={() => pick(group)}>
                        Use
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
