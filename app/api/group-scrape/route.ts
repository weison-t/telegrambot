import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { callWorker, WorkerError } from "@/lib/worker-client";

export const runtime = "nodejs";

type Body = {
  accountId?: string;
  input?: string;
  maxMembers?: number;
};

export const POST = async (request: Request) => {
  const body = (await request.json()) as Body;
  const accountId = body.accountId?.trim();
  const input = body.input?.trim();

  if (!accountId) {
    return NextResponse.json({ error: "accountId is required." }, { status: 400 });
  }
  if (!input) {
    return NextResponse.json(
      { error: "Enter a group @username or id." },
      { status: 400 }
    );
  }

  // Clamp the cap to a sane, ban-conscious range.
  const maxMembers = Math.max(1, Math.min(body.maxMembers || 10000, 50000));

  const supabase = getServiceClient();

  const { data: job, error: jobErr } = await supabase
    .from("kw_group_scrape_jobs")
    .insert({
      account_id: accountId,
      group_input: input,
      status: "pending",
      max_members: maxMembers,
    })
    .select()
    .single();
  if (jobErr || !job) {
    return NextResponse.json(
      { error: jobErr?.message ?? "Failed to create scrape job." },
      { status: 500 }
    );
  }

  try {
    await callWorker("/scrape/group", {
      jobId: job.id,
      accountId,
      input,
      maxMembers,
    });
  } catch (err) {
    await supabase
      .from("kw_group_scrape_jobs")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", job.id);
    const status = err instanceof WorkerError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Failed to start scrape.";
    return NextResponse.json({ jobId: job.id, warning: message }, { status });
  }

  return NextResponse.json({ jobId: job.id });
};

// Deletes a job (members cascade) to clear history.
export const DELETE = async (request: Request) => {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get("job_id");
  if (!jobId) {
    return NextResponse.json({ error: "job_id is required." }, { status: 400 });
  }

  const supabase = getServiceClient();
  const { error } = await supabase
    .from("kw_group_scrape_jobs")
    .delete()
    .eq("id", jobId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
};
