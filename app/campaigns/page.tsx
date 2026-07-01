import Link from "next/link";
import { getServiceClient } from "@/lib/supabase";
import type { Campaign } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CampaignStatusBadge } from "@/components/campaign-status-badge";
import { formatScheduled } from "@/lib/schedule";
import { Plus } from "lucide-react";

export const dynamic = "force-dynamic";

const CampaignsPage = async () => {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("kw_campaigns")
    .select("*")
    .order("created_at", { ascending: false });
  const campaigns = (data as Campaign[]) ?? [];

  return (
    <div>
      <PageHeader
        title="Campaigns"
        description="Your configured conversations."
        action={
          <Button asChild>
            <Link href="/campaigns/new">
              <Plus className="h-4 w-4" />
              New campaign
            </Link>
          </Button>
        }
      />
      <div className="space-y-3 p-6">
        {campaigns.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No campaigns yet.
            </CardContent>
          </Card>
        ) : (
          campaigns.map((campaign) => (
            <Link key={campaign.id} href={`/campaigns/${campaign.id}`}>
              <Card className="transition-colors hover:bg-accent/40">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{campaign.name}</p>
                      <CampaignStatusBadge status={campaign.status} />
                    </div>
                    <p className="truncate text-sm text-muted-foreground">
                      {campaign.topic}
                    </p>
                    {campaign.status === "scheduled" && campaign.start_at ? (
                      <p className="truncate text-xs text-muted-foreground">
                        Launches{" "}
                        {formatScheduled(
                          campaign.start_at,
                          campaign.timezone ?? "UTC"
                        )}
                      </p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                    <p className="capitalize">{campaign.venue}</p>
                    <p>
                      {campaign.messages_sent}/{campaign.max_messages} msgs
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

export default CampaignsPage;
