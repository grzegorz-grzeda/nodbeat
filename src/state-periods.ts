import { ObjectId, type Db } from "mongodb";
import type { UncountedState } from "./monitor-state.js";

/** A stretch of time a Monitor spent New or Paused. */
export interface StatePeriodDoc {
  _id: ObjectId;
  monitorId: ObjectId;
  ownerId: ObjectId;
  startedAt: Date;
  /** Null while the Monitor is still in that state. */
  endedAt: Date | null;
}

const COLLECTIONS: Record<UncountedState, string> = {
  new: "newPeriods",
  paused: "pausePeriods",
};

const periods = (db: Db, state: UncountedState) =>
  db.collection<StatePeriodDoc>(COLLECTIONS[state]);

const STATES = Object.keys(COLLECTIONS) as UncountedState[];

export async function ensureStatePeriodIndexes(db: Db): Promise<void> {
  await Promise.all(
    STATES.map((state) =>
      periods(db, state).createIndex({ monitorId: 1, startedAt: -1 }),
    ),
  );
}

export async function startPeriod(
  db: Db,
  state: UncountedState,
  monitor: { _id: ObjectId; ownerId: ObjectId },
  startedAt: Date,
): Promise<void> {
  await periods(db, state).insertOne({
    _id: new ObjectId(),
    monitorId: monitor._id,
    ownerId: monitor.ownerId,
    startedAt,
    endedAt: null,
  });
}

/** Ends the Monitor's open period of that state, if it has one. */
export async function endPeriod(
  db: Db,
  state: UncountedState,
  monitorId: ObjectId,
  endedAt: Date,
): Promise<void> {
  await periods(db, state).updateOne(
    { monitorId, endedAt: null },
    { $set: { endedAt } },
  );
}

/** The Monitor's periods of that state that were still going at or after `since`, oldest first. */
export function listPeriodsSince(
  db: Db,
  state: UncountedState,
  monitorId: ObjectId,
  since: Date,
): Promise<StatePeriodDoc[]> {
  return periods(db, state)
    .find({ monitorId, $or: [{ endedAt: null }, { endedAt: { $gt: since } }] })
    .sort({ startedAt: 1 })
    .toArray();
}

/** Removes all of the Monitor's New and pause periods (when the Monitor is deleted). */
export async function deleteStatePeriodsOf(
  db: Db,
  monitorId: ObjectId,
): Promise<void> {
  await Promise.all(
    STATES.map((state) => periods(db, state).deleteMany({ monitorId })),
  );
}
