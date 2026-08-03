/**
 * Classifies transport-level failures so the API can answer 503 with a usable
 * reason instead of an opaque 500.
 *
 * Motivation (2026-08-03): the Supabase project auto-paused on the free tier,
 * its hostname stopped resolving, and every DB call failed with
 * `getaddrinfo ENOTFOUND`. The browser only ever saw
 * `{"error":"Internal server error"}`, which is indistinguishable from a bug
 * in our own code — the real cause was only visible in the Render logs.
 */

const NETWORK_ERROR_CODES: readonly string[] = [
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function looksLikeNetworkFailure(err: Record<string, unknown>): boolean {
  // Node puts the code on the error itself; undici buries it one level down
  // under `cause` and surfaces only a bare "fetch failed" at the top.
  for (const node of [err, asRecord(err["cause"])]) {
    const code = node?.["code"];
    if (typeof code === "string" && NETWORK_ERROR_CODES.includes(code)) return true;
  }

  const text = [err["message"], err["details"]]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

  if (/fetch failed/i.test(text)) return true;
  return NETWORK_ERROR_CODES.some((code) => text.includes(code));
}

/**
 * True when the failure came from a Supabase call that never reached the
 * server. supabase-js swallows the underlying TypeError and normalises it into
 * a plain object carrying `details`/`hint` next to the message — that shape is
 * what lets us attribute the failure to the database rather than to some other
 * upstream (the Python engine also talks over `fetch`).
 */
export function isDatabaseUnavailable(err: unknown): boolean {
  const record = asRecord(err);
  if (!record) return false;
  const hasSupabaseErrorShape = "details" in record && "hint" in record;
  return hasSupabaseErrorShape && looksLikeNetworkFailure(record);
}

/** True for any transport failure reaching an upstream we depend on. */
export function isUpstreamUnavailable(err: unknown): boolean {
  const record = asRecord(err);
  return record ? looksLikeNetworkFailure(record) : false;
}
