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
