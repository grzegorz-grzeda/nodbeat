import { ObjectId, type Db } from "mongodb";

/** A stretch of time a Monitor spent Paused; Uptime leaves it out. */
export interface PausePeriodDoc {
  _id: ObjectId;
  monitorId: ObjectId;
  ownerId: ObjectId;
  startedAt: Date;
  /** Null while the Monitor is still Paused. */
  endedAt: Date | null;
}

export const pausePeriods = (db: Db) =>
  db.collection<PausePeriodDoc>("pausePeriods");

export async function ensurePausePeriodIndexes(db: Db): Promise<void> {
  await pausePeriods(db).createIndex({ monitorId: 1, startedAt: -1 });
}

export async function startPausePeriod(
  db: Db,
  monitor: { _id: ObjectId; ownerId: ObjectId },
  startedAt: Date,
): Promise<void> {
  await pausePeriods(db).insertOne({
    _id: new ObjectId(),
    monitorId: monitor._id,
    ownerId: monitor.ownerId,
    startedAt,
    endedAt: null,
  });
}

/** Ends the Monitor's open pause period, if it has one. */
export async function endPausePeriod(
  db: Db,
  monitorId: ObjectId,
  endedAt: Date,
): Promise<void> {
  await pausePeriods(db).updateOne(
    { monitorId, endedAt: null },
    { $set: { endedAt } },
  );
}

/** The Monitor's pause periods, oldest first. */
export function listPausePeriods(
  db: Db,
  monitorId: ObjectId,
): Promise<PausePeriodDoc[]> {
  return pausePeriods(db).find({ monitorId }).sort({ startedAt: 1 }).toArray();
}

/** Removes all of the Monitor's pause periods (when the Monitor is deleted). */
export async function deletePausePeriodsOf(
  db: Db,
  monitorId: ObjectId,
): Promise<void> {
  await pausePeriods(db).deleteMany({ monitorId });
}
