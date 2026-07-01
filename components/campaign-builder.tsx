"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Account, ParticipantConfig } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  CampaignSettingsFields,
  emptyCampaignForm,
  scheduleToPayload,
  validateCampaignForm,
  type CampaignFormValue,
} from "@/components/campaign-settings-fields";

export const CampaignBuilder = ({ accounts }: { accounts: Account[] }) => {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState<CampaignFormValue>(emptyCampaignForm);

  const patch = (next: Partial<CampaignFormValue>) =>
    setForm((prev) => ({ ...prev, ...next }));

  const handleSubmit = async () => {
    const error = validateCampaignForm(form);
    if (error) {
      toast.error(error);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          topic: form.topic,
          style: form.style,
          extra_instructions: form.extra,
          venue: form.venue,
          target_chat: form.targetChat,
          min_delay_s: form.minDelay,
          max_delay_s: form.maxDelay,
          max_messages: form.maxMessages,
          dry_run: form.dryRun,
          model: form.model,
          participants: Object.values(form.selection) as ParticipantConfig[],
          ...scheduleToPayload(form),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(
        form.scheduleEnabled ? "Campaign scheduled." : "Campaign created."
      );
      router.push(`/campaigns/${data.campaign.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CampaignSettingsFields
      value={form}
      onChange={patch}
      accounts={accounts}
      footer={
        <Button
          className="w-full"
          size="lg"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? "Creating..." : "Create campaign"}
        </Button>
      }
    />
  );
};
