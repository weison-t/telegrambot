import { getServiceClient } from "@/lib/supabase";
import type { Account } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { AutoreplyManager } from "@/components/autoreply-manager";

export const dynamic = "force-dynamic";

const AutoreplyPage = async () => {
  const supabase = getServiceClient();

  const [{ data: accounts }, { data: whitelistRows }] = await Promise.all([
    supabase
      .from("kw_accounts")
      .select("*")
      .order("created_at", { ascending: true }),
    supabase.from("kw_autoreply_whitelist").select("account_id, peer"),
  ]);

  const whitelists: Record<string, string[]> = {};
  (whitelistRows ?? []).forEach((row) => {
    (whitelists[row.account_id] ??= []).push(row.peer);
  });

  return (
    <div>
      <PageHeader
        title="Auto-reply"
        description="Let connected accounts automatically reply to incoming messages with AI."
      />
      <div className="p-6">
        <AutoreplyManager
          accounts={(accounts as Account[]) ?? []}
          whitelists={whitelists}
        />
      </div>
    </div>
  );
};

export default AutoreplyPage;
