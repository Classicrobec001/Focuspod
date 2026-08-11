/**
 * Fetch reports "no connection" as a plain TypeError whose message differs per
 * engine — "Failed to fetch" (Chromium), "NetworkError when attempting to fetch
 * a resource" (Firefox), "Load failed" (Safari), "Network request failed"
 * (React Native). None of them is worth showing a user, and more importantly a
 * lost connection is a temporary condition to retry rather than a failure to
 * report.
 */
export function isNetworkError(e: unknown): boolean {
  const message = (e as Error)?.message ?? '';
  // Node/undici words it the other way round ("fetch failed") from browsers
  // ("Failed to fetch"), and wraps the real cause, so both orders are matched.
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed|connection|timeout|err_internet|err_network/i.test(
    message,
  );
}

/** AbortError, from either a request timeout or a deliberate cancellation. */
export function isAbortError(e: unknown): boolean {
  return (e as Error)?.name === 'AbortError';
}
