import Link from "next/link";
import { Users, Swords, Radio, MessageSquare } from "lucide-react";
import { getServiceClient } from "@/lib/supabase";
import type { Account, Campaign } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const StatCard = ({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number | string;
}) => (
  <Card>
    <CardContent className="flex items-center gap-4 p-5">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-2xl font-semibold leading-none">{value}</p>
        <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      </div>
    </CardContent>
  </Card>
);

const HomePage = async () => {
  const supabase = getServiceClient();
  const [{ data: accounts }, { data: campaigns }] = await Promise.all([
    supabase.from("kw_accounts").select("*"),
    supabase.from("kw_campaigns").select("*"),
  ]);

  const accountList = (accounts as Account[]) ?? [];
  const campaignList = (campaigns as Campaign[]) ?? [];
  const online = accountList.filter((a) => a.status === "online").length;
  const running = campaignList.filter((c) => c.status === "running").length;
  const totalMessages = campaignList.reduce(
    (sum, c) => sum + (c.messages_sent ?? 0),
    0
  );

  return (
    <div>
      <PageHeader
        title="Overview"
        description="Orchestrate AI-driven conversations across real Telegram accounts."
        action={
          <Button asChild>
            <Link href="/campaigns/new">New campaign</Link>
          </Button>
        }
      />
      <div className="space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={Users} label="Accounts" value={accountList.length} />
          <StatCard icon={Radio} label="Online" value={online} />
          <StatCard icon={Swords} label="Running campaigns" value={running} />
          <StatCard
            icon={MessageSquare}
            label="Messages sent"
            value={totalMessages}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Get started</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                1. Connect real Telegram accounts on the{" "}
                <Link href="/accounts" className="font-medium text-foreground underline">
                  Accounts
                </Link>{" "}
                page (up to 12).
              </p>
              <p>
                2. Create a campaign: pick a topic, style, how many accounts
                talk, and where.
              </p>
              <p>
                3. Start it and watch the conversation unfold live. Use dry run
                first to preview without sending.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent campaigns</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {campaignList.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No campaigns yet.
                </p>
              ) : (
                campaignList.slice(0, 5).map((campaign) => (
                  <Link
                    key={campaign.id}
                    href={`/campaigns/${campaign.id}`}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                  >
                    <span className="truncate">{campaign.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground capitalize">
                      {campaign.status}
                    </span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default HomePage;
