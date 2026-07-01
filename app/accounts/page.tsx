import { getServiceClient } from "@/lib/supabase";
import type { Account } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { AccountsManager } from "@/components/accounts-manager";

export const dynamic = "force-dynamic";

const AccountsPage = async () => {
  const supabase = getServiceClient();
  const { data } = await supabase
    .from("kw_accounts")
    .select("*")
    .eq("archived", false)
    .order("created_at", { ascending: true });

  return (
    <div>
      <PageHeader
        title="Accounts"
        description="Connect up to 12 real Telegram accounts to use as keyboard warriors."
      />
      <div className="p-6">
        <AccountsManager initial={(data as Account[]) ?? []} />
      </div>
    </div>
  );
};

export default AccountsPage;
