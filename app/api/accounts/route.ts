import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { callWorker, WorkerError } from "@/lib/worker-client";
import { MAX_ACCOUNTS } from "@/lib/types";

export const runtime = "nodejs";

export const GET = async () => {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("kw_accounts")
    .select("*")
    .eq("archived", false)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ accounts: data });
};

export const POST = async (request: Request) => {
  const supabase = getServiceClient();
  const body = (await request.json()) as { label?: string; phone?: string };
  const label = body.label?.trim();
  const phone = body.phone?.trim();

  if (!label || !phone) {
    return NextResponse.json(
      { error: "label and phone are required" },
      { status: 400 }
    );
  }

  const { count } = await supabase
    .from("kw_accounts")
    .select("id", { count: "exact", head: true })
    .eq("archived", false);
  if ((count ?? 0) >= MAX_ACCOUNTS) {
    return NextResponse.json(
      { error: `Maximum of ${MAX_ACCOUNTS} accounts reached.` },
      { status: 400 }
    );
  }

  const { data: account, error } = await supabase
    .from("kw_accounts")
    .insert({ label, phone, status: "new" })
    .select("*")
    .single();
  if (error || !account) {
    return NextResponse.json(
      { error: error?.message || "Failed to create account" },
      { status: 400 }
    );
  }

  try {
    await callWorker(`/accounts/${account.id}/login/start`);
  } catch (err) {
    const status = err instanceof WorkerError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Login failed";
    return NextResponse.json(
      { account, warning: message },
      { status: status === 503 ? 200 : status }
    );
  }

  return NextResponse.json({ account, status: "code_sent" });
};
