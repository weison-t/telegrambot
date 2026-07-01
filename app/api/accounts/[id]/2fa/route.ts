import { NextResponse } from "next/server";
import { callWorker, WorkerError } from "@/lib/worker-client";

export const runtime = "nodejs";

export const POST = async (
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const body = (await request.json()) as { password?: string };
  try {
    const result = await callWorker(`/accounts/${id}/login/2fa`, {
      password: body.password,
    });
    return NextResponse.json(result);
  } catch (err) {
    const status = err instanceof WorkerError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Failed";
    return NextResponse.json({ error: message }, { status });
  }
};
