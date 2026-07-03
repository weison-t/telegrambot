import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import type { Broadcast, BroadcastStatus } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { BroadcastStatusBadge } from "@/components/broadcast-status-badge";
import { formatScheduled } from "@/lib/schedule";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

const pct = (part: number, whole: number): string =>
  whole <= 0 ? "0%" : `${Math.round((part / whole) * 100)}%`;

const BroadcastsPage = async () => {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("kw_broadcasts")
    .select("*")
    .order("created_at", { ascending: false });
  const broadcasts = (data as Broadcast[]) ?? [];

  return (
    <div>
      <PageHeader
        title="Broadcasts"
        description="Send a message to many Telegram users and track engagement."
        action={
          <Button asChild>
            <Link href="/broadcasts/new">
              <Plus className="h-4 w-4" />
              New broadcast
            </Link>
          </Button>
        }
      />
      <div className="space-y-3 p-6">
        {broadcasts.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No broadcasts yet.
            </CardContent>
          </Card>
        ) : (
          broadcasts.map((broadcast) => (
            <Link key={broadcast.id} href={`/broadcasts/${broadcast.id}`}>
              <Card className="transition-colors hover:bg-accent/40">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{broadcast.name}</p>
                      <BroadcastStatusBadge
                        status={broadcast.status as BroadcastStatus}
                      />
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {broadcast.message}
                    </p>
                    {broadcast.status === "scheduled" && broadcast.start_at ? (
                      <p className="truncate text-xs text-muted-foreground">
                        Launches{" "}
                        {formatScheduled(
                          broadcast.start_at,
                          broadcast.timezone ?? "UTC"
                        )}
                      </p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                    <p>
                      {broadcast.sent_count}/{broadcast.total_count} sent
                    </p>
                    <p>
                      {pct(broadcast.read_count, broadcast.sent_count)} read ·{" "}
                      {pct(broadcast.replied_count, broadcast.sent_count)} reply
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
};

export default BroadcastsPage;
