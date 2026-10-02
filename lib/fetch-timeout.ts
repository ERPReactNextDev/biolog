/* ============================================================================
   fetchWithTimeout
   ----------------------------------------------------------------------------
   A bare `await fetch(...)` never rejects when a request stalls — it sits
   there forever. Any `catch` downstream is dead code, so a single hung request
   leaves a `loading` flag true and the user is stuck on a splash screen with
   no way out. That is not hypothetical: the session check had no timeout and
   would hang indefinitely whenever /api/check-session was slow to compile.

   This wraps fetch with an AbortController so every network call in a loading
   path has a bounded lifetime. Default 10s: long enough for a cold compile or
   a slow mobile connection, short enough that nobody thinks the app is dead.
   ========================================================================== */

export const DEFAULT_TIMEOUT_MS = 10_000;

export class TimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(ms: number) {
    super(`Request timed out after ${ms}ms`);
    this.name = "TimeoutError";
    this.timeoutMs = ms;
  }
}

export type TimeoutInit = RequestInit & {
  /** Overrides DEFAULT_TIMEOUT_MS for this call. */
  timeoutMs?: number;
};

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: TimeoutInit = {},
  /** Positional override; takes precedence over init.timeoutMs. */
  timeoutOverride?: number
): Promise<Response> {
  const { timeoutMs: initTimeout, signal: callerSignal, ...rest } = init;
  const timeoutMs = timeoutOverride ?? initTimeout ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // If the caller passed their own signal, honour it as well.
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }

  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } catch (err) {
    // Distinguish "we gave up" from "the server refused".
    if (controller.signal.aborted && !callerSignal?.aborted) {
      throw new TimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

/** True when the failure was our timeout rather than a real network error. */
export function isTimeout(err: unknown): boolean {
  return err instanceof TimeoutError || (err as { name?: string })?.name === "TimeoutError";
}