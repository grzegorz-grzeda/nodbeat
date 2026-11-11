import type { Db, Filter } from "mongodb";
import type { Clock } from "./clock.js";
import { enqueueAlert } from "./alerts.js";
import { applyEffects } from "./effects.js";
import {
  claimReminder,
  countReminder,
  listDueReminders,
  setNextReminder,
  unclaimReminder,
} from "./incidents.js";
import { reminderAfter } from "./reminders.js";
import type { LogPruner } from "./log-pruner.js";
import type { KeyedLock } from "./keyed-lock.js";
import { nextDueAt, runDeadline, transition } from "./monitor-state.js";
import { monitors, type MonitorDoc } from "./monitors.js";

/**
 * Up Monitors that may be overdue: Interval Monitors past nextDueAt() or with a Run past runDeadline(), the same
 * rules written as a query, and every Schedule Monitor (scheduled times can't be worked out in a query).
 */
export function maybeOverdueQuery(
  startedAt: Date,
  now: Date,
): Filter<MonitorDoc> {
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
  return {
    state: "up",
    $or: [
      { schedule: { $ne: null } },
      {
        intervalSec: { $ne: null },
        ...passed("$lastHeartbeatAt", { $add: ["$intervalSec", "$graceSec"] }),
      },
      {
        runStartedAt: { $ne: null },
        maxRunTimeSec: { $ne: null },
        ...passed("$runStartedAt", "$maxRunTimeSec"),
      },
    ],
  } as Filter<MonitorDoc>;
}

/**
 * Enqueues a Reminder for each open Incident whose next one is due, and moves the next one on by the cadence in the
 * same update (see claimReminder), skipping times missed while nodbeat wasn't running.
 */
async function sendDueReminders(
  db: Db,
  lock: KeyedLock,
  now: Date,
  publicBaseUrl: string,
): Promise<void> {
  for (const incident of await listDueReminders(db, now)) {
    const due = incident.nextReminderAt!;
    await lock.run(String(incident.monitorId), async () => {
      const monitor = await monitors(db).findOne({ _id: incident.monitorId });
      if (!monitor) return;
      const everySec = monitor.reminderEverySec;
      // Up, pause, Alerts off and Never clear nextReminderAt; this only guards against a stray one.
      if (monitor.state !== "down" || !monitor.alertsEnabled || !everySec) {
        await setNextReminder(db, monitor._id, null);
        return;
      }
      const next = reminderAfter(due, everySec, now);
      const claimed = await claimReminder(db, incident._id, due, next);
      if (!claimed) return;
      let enqueued: boolean;
      try {
        enqueued = await enqueueAlert(
          db,
          monitor,
          "reminder",
          claimed,
          now,
          publicBaseUrl,
        );
      } catch (err) {
        // Not sent: the next tick tries again.
        await unclaimReminder(db, incident._id, due, next);
        throw err;
      }
      // No Alert channel: the slot passes, but nothing was sent to count.
      if (enqueued) await countReminder(db, incident._id);
    });
  }
}

/**
 * Moves Up Monitors past their deadline, or with a Run past their Max run time, to Down. `startedAt` is when this
 * nodbeat process started: no Monitor goes Down before a full Interval (or its next scheduled time) + Grace period
 * after it, or before startedAt + Max run time.
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
    const candidates = await monitors(db)
      .find(maybeOverdueQuery(startedAt, now), {
        projection: {
          state: 1,
          lastHeartbeatAt: 1,
          watchedSince: 1,
          createdAt: 1,
          intervalSec: 1,
          schedule: 1,
          graceSec: 1,
          runStartedAt: 1,
          maxRunTimeSec: 1,
        },
      })
      .toArray();
    // The query picked the overdue Interval Monitors; Schedule Monitors are checked here. transition() decides.
    const overdue = candidates.filter(
      (m) =>
        !m.schedule ||
        [nextDueAt(m, startedAt), runDeadline(m, startedAt)].some(
          (d) => d !== null && d <= now,
        ),
    );

    await sendDueReminders(db, lock, now, publicBaseUrl);

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
