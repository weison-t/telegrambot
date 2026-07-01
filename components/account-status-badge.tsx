import { Badge } from "@/components/ui/badge";
import type { AccountStatus } from "@/lib/types";

const STATUS_META: Record<
  AccountStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "success" | "warning" }
> = {
  new: { label: "Not connected", variant: "secondary" },
  code_sent: { label: "Awaiting code", variant: "warning" },
  awaiting_2fa: { label: "Awaiting 2FA", variant: "warning" },
  connecting: { label: "Connecting", variant: "warning" },
  online: { label: "Online", variant: "success" },
  offline: { label: "Offline", variant: "secondary" },
  error: { label: "Error", variant: "destructive" },
};

export const AccountStatusBadge = ({ status }: { status: AccountStatus }) => {
  const meta = STATUS_META[status];
  return <Badge variant={meta.variant}>{meta.label}</Badge>;
};
