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
 * IMPORTANT: each ping uses a long timeout. When the service is asleep Render
 * holds the inbound request open while the instance cold-starts (~30-50s) and
 * only then returns 200. A short per-ping timeout aborts before the wake
 * completes, so the service never finishes spinning up and the caller 503s.
 */
export async function wakePython(maxMs = 120_000): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const ping = await fetch(`${PYTHON_URL()}/health`, {
        signal: AbortSignal.timeout(60_000),
      });
      if (ping.ok) return true;
    } catch {
      /* aborted or connection failed mid cold-start — retry */
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  return false;
}
