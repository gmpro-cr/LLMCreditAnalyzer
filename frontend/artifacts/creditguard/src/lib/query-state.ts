/**
 * True when a read has settled but produced no data — i.e. we cannot show the
 * real answer and must not invent one.
 *
 * Why this is not just `isError`: when the backend is unreachable, React Query
 * does not necessarily reach `status: "error"`. It parks the query at
 * `status: "pending"` with `fetchStatus: "paused"` while it retries, which
 * surfaces as `isLoading === false`, `isError === false`, `data === undefined`.
 * Observed directly against a 503 backend. A page keyed only on `isError` sails
 * straight past that into its empty branch and reports "no cases" or a KPI of 0.
 *
 * `data === undefined` is the load-bearing part: a genuinely empty result is
 * `[]` or an object of zeros, both defined, so real emptiness still renders the
 * normal empty state. Only "we never got an answer" trips this.
 */
export function isDataUnavailable(
  isError: boolean,
  isLoading: boolean,
  data: unknown,
): boolean {
  return isError || (!isLoading && data === undefined);
}
