import { ObjectId, type Db } from "mongodb";

export interface IncidentDoc {
  _id: ObjectId;
  monitorId: ObjectId;
  ownerId: ObjectId;
  startedAt: Date;
  endedAt: Date | null;
  endReason: "heartbeat" | "paused" | null;
}

const incidents = (db: Db) => db.collection<IncidentDoc>("incidents");

export async function ensureIncidentIndexes(db: Db): Promise<void> {
  await incidents(db).createIndex({ monitorId: 1, startedAt: -1 });
}

export async function openIncident(
  db: Db,
  monitor: { _id: ObjectId; ownerId: ObjectId },
  startedAt: Date,
): Promise<void> {
  await incidents(db).insertOne({
    _id: new ObjectId(),
    monitorId: monitor._id,
    ownerId: monitor.ownerId,
    startedAt,
    endedAt: null,
    endReason: null,
  });
}

/** Ends the Monitor's open Incident, if it has one. */
export async function closeOpenIncident(
  db: Db,
  monitorId: ObjectId,
  endedAt: Date,
  endReason: "heartbeat" | "paused",
): Promise<void> {
  await incidents(db).updateOne(
    { monitorId, endedAt: null },
    { $set: { endedAt, endReason } },
  );
}

/** The Monitor's Incidents, newest first. */
export function listIncidents(
  db: Db,
  monitorId: ObjectId,
  limit: number,
): Promise<IncidentDoc[]> {
  return incidents(db)
    .find({ monitorId })
    .sort({ startedAt: -1 })
    .limit(limit)
    .toArray();
}
