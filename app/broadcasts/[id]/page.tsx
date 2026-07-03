import { notFound } from "next/navigation";
import { getServiceClient } from "@/lib/supabase";
import type { Account, Broadcast, BroadcastTarget } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { BroadcastMonitor } from "@/components/broadcast-monitor";

export const dynamic = "force-dynamic";

const BroadcastDetailPage = async ({
  params,
}: {
  params: Promise<{ id: string }>;
}) => {
  const { id } = await params;
  const supabase = getServiceClient();

  const { data: broadcast } = await supabase
    .from("kw_broadcasts")
    .select("*")
    .eq("id", id)
    .single();
  if (!broadcast) notFound();

  const { data: accountLinks } = await supabase
    .from("kw_broadcast_accounts")
    .select("account_id")
    .eq("broadcast_id", id);

  const { data: targets } = await supabase
    .from("kw_broadcast_targets")
    .select("*")
    .eq("broadcast_id", id)
    .order("created_at", { ascending: true });

  const { data: accounts } = await supabase
    .from("kw_accounts")
    .select("*")
    .order("created_at", { ascending: true });

  return (
    <div>
      <PageHeader title={broadcast.name} description={broadcast.message} />
      <div className="p-6">
        <BroadcastMonitor
          broadcast={broadcast as Broadcast}
          accountIds={(accountLinks ?? []).map((a) => a.account_id)}
          initialTargets={(targets as BroadcastTarget[] | null) ?? []}
          accounts={(accounts as Account[] | null) ?? []}
        />
      </div>
    </div>
  );
};

export default BroadcastDetailPage;
