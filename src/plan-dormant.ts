import type { Db, ObjectId } from "mongodb";
import { alertChannels } from "./alert-channels.js";
import { applyEffects } from "./effects.js";
import type { KeyedLock } from "./keyed-lock.js";
import { PLAN_LIMITS } from "./limits.js";
import { transition, type MonitorTiming } from "./monitor-state.js";
import { monitors } from "./monitors.js";
import { rescheduleReminder } from "./reminders.js";

/** The shortest Interval a Free Monitor keeps after the dormant step. */
const FREE_MIN_INTERVAL_SEC = PLAN_LIMITS.free.minIntervalSec;

/**
 * Pro-only features of a User whose Pro ended 14 days ago go dormant, nothing deleted: Webhooks are flagged `needsPro`
 * (the dispatcher skips them), Reminders are turned off and Intervals under 1 min become 1 min. Monitors change the way
 * an edit changes them (under their lock, through the state machine), so deadlines count from now.
 */
export async function makeProFeaturesDormant(
  db: Db,
  lock: KeyedLock,
  ownerId: ObjectId,
  now: Date,
  publicBaseUrl: string,
): Promise<void> {
  await alertChannels(db).updateMany(
    { ownerId, kind: "webhook" },
    { $set: { needsPro: true } },
  );
  const affected = await monitors(db)
    .find(
      {
        ownerId,
        $or: [
          { reminderEverySec: { $ne: null, $exists: true } },
          { intervalSec: { $lt: FREE_MIN_INTERVAL_SEC } },
        ],
      },
      { projection: { _id: 1 } },
    )
    .toArray();
  for (const { _id } of affected) {
    await lock.run(String(_id), async () => {
      const current = await monitors(db).findOne({ _id });
      if (!current) return;
      const raise =
        current.intervalSec !== null &&
        current.intervalSec < FREE_MIN_INTERVAL_SEC;
      const settings = {
        reminderEverySec: null,
        ...(raise && { intervalSec: FREE_MIN_INTERVAL_SEC }),
      };
      const timing: MonitorTiming = raise
        ? {
            intervalSec: FREE_MIN_INTERVAL_SEC,
            schedule: null,
            graceSec: current.graceSec,
            maxRunTimeSec: current.maxRunTimeSec ?? null,
          }
        : current;
      const { fields, effects } = transition(
        current,
        { kind: "edit", timing },
        now,
      );
      const updated = { ...current, ...fields, ...settings };
      await monitors(db).updateOne(
        { _id },
        { $set: { ...fields, ...settings } },
      );
      await applyEffects(db, updated, effects, now, publicBaseUrl);
      await rescheduleReminder(db, _id, current, updated, now);
    });
  }
}

/** Getting Pro back wakes the User's Webhooks. Reminders and Intervals stay as the dormant step left them. */
export async function wakeProFeatures(
  db: Db,
  ownerId: ObjectId,
): Promise<void> {
  await alertChannels(db).updateMany(
    { ownerId, needsPro: true },
    { $unset: { needsPro: "" } },
  );
}
