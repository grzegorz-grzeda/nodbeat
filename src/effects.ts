import type { Db, ObjectId } from "mongodb";
import { closeOpenIncident, openIncident } from "./incidents.js";
import type { Effect } from "./monitor-state.js";
import { endPausePeriod, startPausePeriod } from "./pause-periods.js";

/** Carries out the effects a state transition asked for. */
export async function applyEffects(
  db: Db,
  monitor: { _id: ObjectId; ownerId: ObjectId },
  effects: Effect[],
  now: Date,
): Promise<void> {
  for (const effect of effects) {
    switch (effect.kind) {
      case "open-incident":
        await openIncident(db, monitor, effect.startedAt);
        break;
      case "close-incident":
        await closeOpenIncident(db, monitor._id, now, effect.reason);
        break;
      case "start-pause-period":
        await startPausePeriod(db, monitor, now);
        break;
      case "end-pause-period":
        await endPausePeriod(db, monitor._id, now);
        break;
    }
  }
}
