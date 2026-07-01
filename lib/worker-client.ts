// Server-side helper to call the worker control API.
// Never import this into a client component.

const workerUrl = (): string =>
  process.env.WORKER_URL || "http://127.0.0.1:8787";

const workerSecret = (): string => process.env.WORKER_SECRET || "change-me";

export class WorkerError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const callWorker = async <T = unknown>(
  path: string,
  body?: Record<string, unknown>
): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(`${workerUrl()}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-worker-secret": workerSecret(),
      },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
    });
  } catch {
    throw new WorkerError(
      "Cannot reach the worker. Is it running? (npm run worker)",
      503
    );
  }

  const data = (await res.json().catch(() => ({}))) as
    | T
    | { error?: string };
  if (!res.ok) {
    const message =
      (data as { error?: string }).error || `Worker error (${res.status})`;
    throw new WorkerError(message, res.status);
  }
  return data as T;
};
