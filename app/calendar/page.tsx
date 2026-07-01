import { getServiceClient } from "@/lib/supabase";
import type { Account, CalendarEvent, CalendarReminder } from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { CalendarView } from "@/components/calendar-view";

export const dynamic = "force-dynamic";

const CalendarPage = async () => {
  const supabase = getServiceClient();

  const [{ data: accounts }, { data: events }, { data: reminders }] =
    await Promise.all([
      supabase
        .from("kw_accounts")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("kw_calendar_events")
        .select("*")
        .order("scheduled_for", { ascending: true }),
      supabase
        .from("kw_calendar_reminders")
        .select("*")
        .order("remind_at", { ascending: true }),
    ]);

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Confirmed appointments and their reminders, recorded automatically from auto-reply."
      />
      <div className="p-6">
        <CalendarView
          accounts={(accounts as Account[]) ?? []}
          initialEvents={(events as CalendarEvent[]) ?? []}
          reminders={(reminders as CalendarReminder[]) ?? []}
        />
      </div>
    </div>
  );
};

export default CalendarPage;
