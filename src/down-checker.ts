import type { Db } from "mongodb";
import type { Clock } from "./clock.js";
import { applyEffects } from "./effects.js";
import type { MonitorLock } from "./monitor-lock.js";
import { transition } from "./monitor-state.js";
import { monitors } from "./monitors.js";

/**
 * Moves Up Monitors past their deadline to Down. `startedAt` is when this nodbeat process started:
 * no Monitor goes Down before startedAt + Interval + Grace period.
 */
export function createDownChecker(deps: {
  db: Db;
  clock: Clock;
  startedAt: Date;
  lock: MonitorLock;
}): () => Promise<void> {
  const { db, clock, startedAt, lock } = deps;
  return async () => {
    const now = clock.now();
    // Pre-filter with the same rule as downDeadline(), so only overdue Monitors are loaded; transition() decides.
    const overdue = await monitors(db)
      .find(
        {
          state: "up",
          $expr: {
            $lte: [
              {
                $dateAdd: {
                  startDate: {
                    $max: ["$lastHeartbeatAt", "$watchedSince", startedAt],
                  },
                  unit: "second",
                  amount: { $add: ["$intervalSec", "$graceSec"] },
                },
              },
              now,
            ],
          },
        },
        { projection: { _id: 1 } },
      )
      .toArray();

    for (const { _id } of overdue) {
      await lock.run(String(_id), async () => {
        // Re-read under the lock: a Heartbeat may have arrived since the query above.
        const monitor = await monitors(db).findOne({ _id });
        if (!monitor) return;
        const { fields, effects } = transition(
          monitor,
          { kind: "deadline-check", startedAt },
          now,
        );
        if (effects.length === 0) return;
        await monitors(db).updateOne({ _id }, { $set: fields });
        await applyEffects(db, monitor, effects, now);
      });
    }
  };
}
