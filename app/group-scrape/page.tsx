import { getServiceClient } from "@/lib/supabase";
import type { Account, GroupScrapeJob, GroupScrapeMember } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { GroupScrapeView } from "@/components/group-scrape-view";

export const dynamic = "force-dynamic";

const GroupScrapePage = async () => {
  const supabase = getServiceClient();

  const [{ data: accounts }, { data: jobs }, { data: members }] =
    await Promise.all([
      supabase
        .from("kw_accounts")
        .select("*")
        .eq("archived", false)
        .order("created_at", { ascending: true }),
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

  return (
    <div>
      <PageHeader
        title="Group Scraper"
        description="Extract member usernames and Telegram IDs from a group a connected account belongs to."
      />
      <div className="p-6">
        <GroupScrapeView
          accounts={(accounts as Account[]) ?? []}
          initialJobs={(jobs as GroupScrapeJob[]) ?? []}
          initialMembers={(members as GroupScrapeMember[]) ?? []}
        />
      </div>
    </div>
  );
};

export default GroupScrapePage;
