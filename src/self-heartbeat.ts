/** The slice of a logger the self-Heartbeat needs (Fastify's logger fits). */
export interface SelfHeartbeatLog {
  error(obj: unknown, msg?: string): void;
}

export interface SelfHeartbeatOptions {
  url: string;
  fetchFn?: typeof fetch;
  log: SelfHeartbeatLog;
  intervalMs?: number;
}

export const SELF_HEARTBEAT_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Sends a GET to an external dead-man's-switch URL now and every interval.
 * Failures are only logged. Returns a function that stops the timer.
 */
export function startSelfHeartbeat({
  url,
  fetchFn = fetch,
  log,
  intervalMs = SELF_HEARTBEAT_INTERVAL_MS,
}: SelfHeartbeatOptions): () => void {
  const send = async (): Promise<void> => {
    try {
      const res = await fetchFn(url, {
        method: "GET",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      await res.body?.cancel();
      if (!res.ok) {
        log.error({ status: res.status }, "self-heartbeat got non-2xx answer");
      }
    } catch (err) {
      log.error({ err }, "self-heartbeat failed");
    }
  };

  void send();
  const timer = setInterval(() => void send(), intervalMs);
  return () => clearInterval(timer);
}
