import { getServiceClient } from "@/lib/supabase";
import type { Account } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { CampaignBuilder } from "@/components/campaign-builder";

export const dynamic = "force-dynamic";

const NewCampaignPage = async () => {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("kw_accounts")
    .select("*")
    .order("created_at", { ascending: true });

  return (
    <div>
      <PageHeader
        title="New campaign"
        description="Configure the topic, style, participants and timing for a conversation."
      />
      <div className="p-6">
        <CampaignBuilder accounts={(data as Account[]) ?? []} />
      </div>
    </div>
  );
};

export default NewCampaignPage;
