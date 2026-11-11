import type { Db } from "mongodb";
import type { Clock } from "./clock.js";
import { applyEffects } from "./effects.js";
import type { LogPruner } from "./log-pruner.js";
import type { KeyedLock } from "./keyed-lock.js";
import { nextDueAt, runDeadline, transition } from "./monitor-state.js";
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
    // Up Monitors with just the fields the deadlines read. nextDueAt() and runDeadline() pick the overdue ones here,
    // in code, so the rule lives in one place (a Schedule can't be computed in a query); transition() decides.
    const up = await monitors(db)
      .find(
        { state: "up" },
        {
          projection: {
            state: 1,
            lastHeartbeatAt: 1,
            watchedSince: 1,
            createdAt: 1,
            intervalSec: 1,
            graceSec: 1,
            runStartedAt: 1,
            maxRunTimeSec: 1,
          },
        },
      )
      .toArray();
    const overdue = up.filter((m) =>
      [nextDueAt(m, startedAt), runDeadline(m, startedAt)].some(
        (d) => d !== null && d <= now,
      ),
    );

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
