import type { Db } from "mongodb";
import type { Clock } from "./clock.js";
import { applyEffects } from "./effects.js";
import type { LogPruner } from "./log-pruner.js";
import type { KeyedLock } from "./keyed-lock.js";
import { transition } from "./monitor-state.js";
import { monitors } from "./monitors.js";

/**
 * Moves Up Monitors past their deadline, or with a Run past their Max run time, to Down. `startedAt` is when this
 * nodbeat process started: no Monitor goes Down before startedAt + Interval + Grace period (or + Max run time).
 */
export function createDownChecker(deps: {
  db: Db;
  clock: Clock;
  startedAt: Date;
  lock: KeyedLock;
  pruner: LogPruner;
  publicBaseUrl: string;
}): () => Promise<void> {
  const { db, clock, startedAt, lock, pruner, publicBaseUrl } = deps;
  return async () => {
    const now = clock.now();
    /** Whether `amount` seconds after the latest of `from`, the last unpause or edit, and startedAt have passed. */
    const passed = (from: string, amount: unknown) => ({
      $expr: {
        $lte: [
          {
            $dateAdd: {
              startDate: { $max: [from, "$watchedSince", startedAt] },
              unit: "second",
              amount,
            },
          },
          now,
        ],
      },
    });
    // Pre-filter with the same rules as downDeadline() and runDeadline(), so only overdue Monitors are loaded;
    // transition() decides.
    const overdue = await monitors(db)
      .find(
        {
          state: "up",
          $or: [
            passed("$lastHeartbeatAt", { $add: ["$intervalSec", "$graceSec"] }),
            {
              runStartedAt: { $ne: null },
              maxRunTimeSec: { $ne: null },
              ...passed("$runStartedAt", "$maxRunTimeSec"),
            },
          ],
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
        await applyEffects(db, monitor, effects, now, publicBaseUrl);
        pruner.mark(_id);
      });
    }
  };
}
