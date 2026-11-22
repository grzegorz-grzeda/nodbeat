import type { Db, ObjectId } from "mongodb";
import type { Clock } from "./clock.js";
import { pruneHeartbeats } from "./heartbeats.js";
import { pruneIncidents } from "./incidents.js";
import { limitsFor } from "./limits.js";
import { monitors } from "./monitors.js";
import { findUserById } from "./users.js";
import { UPTIME_WINDOW_MS } from "./uptime.js";

export interface LogPruner {
  /** Notes that the Monitor got a new Heartbeat or Incident. Cheap: no I/O. */
  mark(monitorId: ObjectId): void;
  /** Cuts every marked Monitor's logs down to its owner's caps. Runs on `tick()`. */
  prune(): Promise<void>;
}

/**
 * Keeps each Monitor's Heartbeats and Incidents to the newest its owner's limits allow
 * (`maxHeartbeatsPerMonitor`, `maxIncidentsPerMonitor`). The work happens on `tick()`,
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
      const now = clock.now();
      const stillNeededSince = new Date(now.getTime() - UPTIME_WINDOW_MS);
      for (const [key, monitorId] of [...marked]) {
        marked.delete(key);
        const monitor = await monitors(db).findOne(
          { _id: monitorId },
          { projection: { ownerId: 1 } },
        );
        const owner = monitor && (await findUserById(db, monitor.ownerId));
        // A deleted Monitor or owner has its logs removed with it.
        if (!owner) continue;
        const limits = limitsFor(owner, now);
        await Promise.all([
          pruneHeartbeats(db, monitorId, limits.maxHeartbeatsPerMonitor),
          pruneIncidents(
            db,
            monitorId,
            limits.maxIncidentsPerMonitor,
            stillNeededSince,
          ),
        ]);
      }
    },
  };
}
