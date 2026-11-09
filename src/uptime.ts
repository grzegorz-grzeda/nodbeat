import type { Db } from "mongodb";
import { listIncidentsSince } from "./incidents.js";
import type { MonitorDoc } from "./monitors.js";
import { listPeriodsSince } from "./state-periods.js";

export const UPTIME_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** A time span in ms since the epoch; `end` is exclusive. */
interface Span {
  start: number;
  end: number;
}

/** Total length of the spans' union, counting only what lies inside `window`. */
function coveredMs(spans: Span[], window: Span): number {
  const clipped = spans
    .map((s) => ({
      start: Math.max(s.start, window.start),
      end: Math.min(s.end, window.end),
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let reach = -Infinity;
  for (const s of clipped) {
    if (s.end <= reach) continue;
    total += s.end - Math.max(s.start, reach);
    reach = s.end;
  }
  return total;
}

/**
 * Uptime = time Up ÷ (time Up + time Down) over `window`. Time in `uncounted` (New, Paused) is left out, also where it
 * overlaps `down`. Null when there was no Up or Down time.
 */
export function uptimeOver(
  window: Span,
  down: Span[],
  uncounted: Span[],
): number | null {
  const uncountedMs = coveredMs(uncounted, window);
  const counted = window.end - window.start - uncountedMs;
  if (counted <= 0) return null;
  const downMs = coveredMs([...down, ...uncounted], window) - uncountedMs;
  return (counted - downMs) / counted;
}

type UptimeMonitor = Pick<MonitorDoc, "_id" | "state" | "createdAt">;

/** The Monitor's Uptime over the last 7 days, or null when it was neither Up nor Down in that time. */
export async function sevenDayUptime(
  db: Db,
  monitor: UptimeMonitor,
  now: Date,
): Promise<number | null> {
  const nowMs = now.getTime();
  const window = {
    start: Math.max(nowMs - UPTIME_WINDOW_MS, monitor.createdAt.getTime()),
    end: nowMs,
  };
  const since = new Date(window.start);
  const [incidents, newPeriods, pausePeriods] = await Promise.all([
    listIncidentsSince(db, monitor._id, since),
    listPeriodsSince(db, "new", monitor._id, since),
    listPeriodsSince(db, "paused", monitor._id, since),
  ]);
  const toSpan = (p: { startedAt: Date; endedAt: Date | null }): Span => ({
    start: p.startedAt.getTime(),
    end: (p.endedAt ?? now).getTime(),
  });
  const uncounted = [...newPeriods, ...pausePeriods].map(toSpan);
  // Monitors stored before New periods were recorded have none open while New. They have been New since their last
  // unpause, or since creation if never paused in the window (an older pause lies outside it anyway).
  if (monitor.state === "new" && !newPeriods.some((p) => !p.endedAt)) {
    const from = pausePeriods.at(-1)?.endedAt ?? monitor.createdAt;
    uncounted.push({ start: from.getTime(), end: nowMs });
  }
  return uptimeOver(window, incidents.map(toSpan), uncounted);
}

/** "99.95%", rounded down so any Down time shows below 100%; "—" for no Uptime. */
export function formatUptime(uptime: number | null): string {
  if (uptime === null) return "—";
  // The epsilon undoes float error (0.845 * 10000 = 8449.999…); real Down time is never that small a share.
  return `${(Math.floor(uptime * 10000 + 1e-6) / 100).toFixed(2)}%`;
}
