import { getServiceClient } from "@/lib/supabase";
import type { Account, PhoneLookupBatch, PhoneLookupResult } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { TelegramIdSearchView } from "@/components/telegram-id-search-view";

export const dynamic = "force-dynamic";

const TelegramIdSearchPage = async () => {
  const supabase = getServiceClient();

  const [{ data: accounts }, { data: batches }, { data: results }] =
    await Promise.all([
      supabase
        .from("kw_accounts")
        .select("*")
        .eq("archived", false)
        .order("created_at", { ascending: true }),
      supabase
        .from("kw_phone_lookup_batches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("kw_phone_lookup_results")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(2000),
    ]);

  return (
    <div>
      <PageHeader
        title="Telegram ID Search"
        description="Resolve phone numbers to Telegram ID, username and profile via a connected account."
      />
      <div className="p-6">
        <TelegramIdSearchView
          accounts={(accounts as Account[]) ?? []}
          initialBatches={(batches as PhoneLookupBatch[]) ?? []}
          initialResults={(results as PhoneLookupResult[]) ?? []}
        />
      </div>
    </div>
  );
};

export default TelegramIdSearchPage;
