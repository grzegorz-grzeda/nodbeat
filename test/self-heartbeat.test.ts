import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startSelfHeartbeat } from "../src/self-heartbeat.js";

const URL = "https://hc-ping.com/abc";

function recordingFetch(respond: () => Promise<Response>) {
  const calls: { url: string; method: string }[] = [];
  const fetchFn = ((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    return respond();
  }) as typeof fetch;
  return { calls, fetchFn };
}

function recordingLog() {
  const errors: unknown[][] = [];
  return { errors, log: { error: (...args: unknown[]) => errors.push(args) } };
}

describe("self-Heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a GET to the URL at start and every interval", async () => {
    const { calls, fetchFn } = recordingFetch(() =>
      Promise.resolve(new Response("OK")),
    );
    const { log } = recordingLog();

    const stop = startSelfHeartbeat({
      url: URL,
      fetchFn,
      log,
      intervalMs: 60_000,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([{ url: URL, method: "GET" }]);

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(3);

    stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(calls).toHaveLength(3);
  });

  it("logs a network failure and keeps going", async () => {
    const { calls, fetchFn } = recordingFetch(() =>
      Promise.reject(new Error("ECONNREFUSED")),
    );
    const { errors, log } = recordingLog();

    const stop = startSelfHeartbeat({
      url: URL,
      fetchFn,
      log,
      intervalMs: 60_000,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    stop();

    expect(calls).toHaveLength(2);
    expect(errors).toHaveLength(2);
  });

  it("logs a non-2xx answer", async () => {
    const { fetchFn } = recordingFetch(() =>
      Promise.resolve(new Response("nope", { status: 500 })),
    );
    const { errors, log } = recordingLog();

    const stop = startSelfHeartbeat({
      url: URL,
      fetchFn,
      log,
      intervalMs: 60_000,
    });
    await vi.advanceTimersByTimeAsync(0);
    stop();

    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors[0])).toContain("500");
  });
});
