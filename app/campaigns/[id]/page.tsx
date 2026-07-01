import { notFound } from "next/navigation";
import { getServiceClient } from "@/lib/supabase";
import type { Account, Campaign, Message, Participant } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { CampaignMonitor } from "@/components/campaign-monitor";
import { buildPalette, type PersonaInfo } from "@/lib/persona-palette";

export const dynamic = "force-dynamic";

const CampaignDetailPage = async ({
  params,
}: {
  params: Promise<{ id: string }>;
}) => {
  const { id } = await params;
  const supabase = getServiceClient();

  const { data: campaign } = await supabase
    .from("kw_campaigns")
    .select("*")
    .eq("id", id)
    .single();
  if (!campaign) notFound();

  const { data: participants } = await supabase
    .from("kw_campaign_participants")
    .select("*")
    .eq("campaign_id", id)
    .order("turn_order", { ascending: true });

  // Load all active accounts so participants can be edited/added from the
  // monitor, not just the ones already in the campaign.
  const { data: accounts } = await supabase
    .from("kw_accounts")
    .select("*")
    .eq("archived", false)
    .order("created_at", { ascending: true });

  const accountById = new Map(
    ((accounts as Account[] | null) ?? []).map((a) => [a.id, a])
  );

  const personas: Record<string, PersonaInfo> = {};
  (participants as Participant[] | null)?.forEach((p, index) => {
    const account = accountById.get(p.account_id);
    personas[p.account_id] = {
      name:
        p.persona_name ||
        account?.first_name ||
        account?.label ||
        "Unknown",
      label: account?.label ?? "",
      color: buildPalette(index),
    };
  });

  const { data: messages } = await supabase
    .from("kw_messages")
    .select("*")
    .eq("campaign_id", id)
    .order("created_at", { ascending: true });

  return (
    <div>
      <PageHeader title={campaign.name} description={campaign.topic} />
      <div className="p-6">
        <CampaignMonitor
          campaign={campaign as Campaign}
          personas={personas}
          initialMessages={(messages as Message[]) ?? []}
          accounts={(accounts as Account[] | null) ?? []}
          participants={(participants as Participant[] | null) ?? []}
        />
      </div>
    </div>
  );
};

export default CampaignDetailPage;
