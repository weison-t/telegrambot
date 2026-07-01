import { Badge } from "@/components/ui/badge";
import type { CampaignStatus } from "@/lib/types";

const META: Record<
  CampaignStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" }
> = {
  draft: { label: "Draft", variant: "secondary" },
  scheduled: { label: "Scheduled", variant: "warning" },
  running: { label: "Running", variant: "success" },
  paused: { label: "Paused", variant: "warning" },
  stopped: { label: "Stopped", variant: "destructive" },
  done: { label: "Done", variant: "default" },
};

export const CampaignStatusBadge = ({ status }: { status: CampaignStatus }) => {
  const meta = META[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
};
