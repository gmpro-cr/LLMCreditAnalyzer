/** Internal Python analysis engine — URL + shared-secret auth. */

export const PYTHON_URL = (): string =>
  process.env.PYTHON_SERVICE_URL || "http://127.0.0.1:8000";

/**
 * Headers for calls to the internal Python engine. When INTERNAL_API_TOKEN is
 * set (production), every call carries it so the engine can reject the public.
 * Merge in any extra headers (e.g. Content-Type) via the argument.
 */
export function internalHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const token = process.env.INTERNAL_API_TOKEN;
  if (token) headers["x-internal-token"] = token;
  return headers;
}

/**
 * Wake the Render free-tier engine and return once it answers /health.
 *
 * One wake attempt is shared by every caller in this process. The case page,
 * the Data Room and the client's own retries each used to run a wake loop at
 * once; against a sleeping service that flood drew "429 Too Many Requests"
 * from Render and the instance never came up (Hindustan Unilever, 2026-10-12).
 *
 * Each ping is held open long (Render holds the request during spin-up and
 * answers once ready). A 429 means "back off": wait, then try again.
 */
let inflight: Promise<boolean> | null = null;

export function wakePython(maxMs = 150_000): Promise<boolean> {
  if (!inflight) {
    inflight = doWake(maxMs).finally(() => { inflight = null; });
  }
  return inflight;
}

async function doWake(maxMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  let backoff = 3_000;
  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    try {
      const ping = await fetch(`${PYTHON_URL()}/health`, {
        signal: AbortSignal.timeout(Math.max(5_000, Math.min(remaining - 1_000, 90_000))),
      });
      if (ping.ok) return true;
      if (ping.status === 429) backoff = Math.min(backoff * 2, 20_000);
    } catch {
      /* timed out / connection failed — retry if budget remains */
    }
    await new Promise((r) => setTimeout(r, Math.min(backoff, Math.max(0, deadline - Date.now()))));
  }
  return false;
}
