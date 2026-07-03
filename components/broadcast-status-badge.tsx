import { Badge } from "@/components/ui/badge";
import type { BroadcastStatus } from "@/lib/types";

const META: Record<
  BroadcastStatus,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "success" | "warning";
  }
> = {
  draft: { label: "Draft", variant: "secondary" },
  scheduled: { label: "Scheduled", variant: "warning" },
  running: { label: "Running", variant: "success" },
  paused: { label: "Paused", variant: "warning" },
  stopped: { label: "Stopped", variant: "destructive" },
  done: { label: "Done", variant: "default" },
};

export const BroadcastStatusBadge = ({
  status,
}: {
  status: BroadcastStatus;
}) => {
  const meta = META[status] ?? META.draft;
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
};
