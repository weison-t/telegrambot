import { getServiceClient } from "@/lib/supabase";
import type { Account } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { BroadcastBuilder } from "@/components/broadcast-builder";

export const dynamic = "force-dynamic";

const NewBroadcastPage = async () => {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("kw_accounts")
    .select("*")
    .order("created_at", { ascending: true });

  return (
    <div>
      <PageHeader
        title="New broadcast"
        description="Compose a message, pick recipients and sending accounts, and configure reply automation."
      />
      <div className="p-6">
        <BroadcastBuilder accounts={(data as Account[]) ?? []} />
      </div>
    </div>
  );
};

export default NewBroadcastPage;
