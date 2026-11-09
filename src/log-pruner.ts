import type { Db, ObjectId } from "mongodb";
import type { Clock } from "./clock.js";
import { pruneHeartbeats } from "./heartbeats.js";
import { pruneIncidents } from "./incidents.js";
import { instanceLimits } from "./limits.js";
import { UPTIME_WINDOW_MS } from "./uptime.js";

export interface LogPruner {
  /** Notes that the Monitor got a new Heartbeat or Incident. Cheap: no I/O. */
  mark(monitorId: ObjectId): void;
  /** Cuts every marked Monitor's logs down to the newest `maxLogRowsPerMonitor`. Runs on `tick()`. */
  prune(): Promise<void>;
}

/**
 * Keeps each Monitor's Heartbeats and Incidents to the newest `maxLogRowsPerMonitor`. The work happens on `tick()`,
 * not in Heartbeat intake, so a Heartbeat stays one update plus one insert (ADR 0003). Marks live in memory: after a
 * restart, a Monitor is pruned at its next Heartbeat or Incident.
 */
export function createLogPruner(deps: { db: Db; clock: Clock }): LogPruner {
  const { db, clock } = deps;
  const marked = new Map<string, ObjectId>();

  return {
    mark(monitorId) {
      marked.set(String(monitorId), monitorId);
    },
    async prune() {
      const keep = instanceLimits().maxLogRowsPerMonitor;
      const stillNeededSince = new Date(
        clock.now().getTime() - UPTIME_WINDOW_MS,
      );
      for (const [key, monitorId] of [...marked]) {
        marked.delete(key);
        await Promise.all([
          pruneHeartbeats(db, monitorId, keep),
          pruneIncidents(db, monitorId, keep, stillNeededSince),
        ]);
      }
    },
  };
}
