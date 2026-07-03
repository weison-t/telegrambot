"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Account } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  BroadcastSettingsFields,
  emptyBroadcastForm,
  scheduleToPayload,
  targetsForForm,
  validateBroadcastForm,
  type BroadcastFormValue,
} from "@/components/broadcast-settings-fields";

export const BroadcastBuilder = ({ accounts }: { accounts: Account[] }) => {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<BroadcastFormValue>(emptyBroadcastForm);

  const patch = (next: Partial<BroadcastFormValue>) =>
    setForm((prev) => ({ ...prev, ...next }));

  const submit = async (startNow: boolean) => {
    const error = validateBroadcastForm(form);
    if (error) {
      toast.error(error);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/broadcasts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          message: form.message,
          account_ids: form.accountIds,
          targets: targetsForForm(form),
          min_delay_s: form.minDelay,
          max_delay_s: form.maxDelay,
          per_account_daily_limit: form.perAccountDailyLimit,
          dry_run: form.dryRun,
          model: form.model,
          reply_ai_enabled: form.replyAiEnabled,
          reply_knowledge: form.replyKnowledge,
          reply_persona: form.replyPersona,
          reply_instructions: form.replyInstructions,
          reply_link: form.replyLink,
          start_now: startNow,
          ...scheduleToPayload(form),
        }),
      });
      const data = await res.json();
      if (!res.ok && !data.broadcast) {
        throw new Error(data.error || "Failed");
      }
      if (data.warning) {
        toast.warning(data.warning);
      } else if (form.scheduleEnabled) {
        toast.success("Broadcast scheduled.");
      } else if (startNow) {
        toast.success("Broadcast started.");
      } else {
        toast.success("Broadcast saved as draft.");
      }
      if (data.invalid && data.invalid.length > 0) {
        toast.warning(
          `Skipped ${data.invalid.length} invalid recipient(s): ${data.invalid
            .slice(0, 3)
            .join(", ")}${data.invalid.length > 3 ? "..." : ""}`
        );
      }
      router.push(`/broadcasts/${data.broadcast.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <BroadcastSettingsFields
      value={form}
      onChange={patch}
      accounts={accounts}
      footer={
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            className="flex-1"
            size="lg"
            onClick={() => submit(false)}
            disabled={submitting}
          >
            {submitting ? "Saving..." : "Save as draft"}
          </Button>
          <Button
            className="flex-1"
            size="lg"
            onClick={() => submit(true)}
            disabled={submitting}
          >
            {form.scheduleEnabled
              ? "Schedule broadcast"
              : submitting
                ? "Starting..."
                : "Start broadcast"}
          </Button>
        </div>
      }
    />
  );
};
