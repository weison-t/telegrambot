import { getServiceClient } from "@/lib/supabase";
import type { Account, AutoreplyMessage, Conversation } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { ConversationsView } from "@/components/conversations-view";

export const dynamic = "force-dynamic";

const ConversationsPage = async () => {
  const supabase = getServiceClient();

  const [{ data: accounts }, { data: messages }, { data: conversations }] =
    await Promise.all([
      supabase
        .from("kw_accounts")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("kw_autoreply_messages")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000),
      supabase.from("kw_conversations").select("*"),
    ]);

  return (
    <div>
      <PageHeader
        title="Conversations"
        description="Auto-reply chats grouped by contact, with search and AI summaries."
      />
      <div className="p-6">
        <ConversationsView
          accounts={(accounts as Account[]) ?? []}
          initialMessages={(messages as AutoreplyMessage[]) ?? []}
          initialConversations={(conversations as Conversation[]) ?? []}
        />
      </div>
    </div>
  );
};

export default ConversationsPage;
