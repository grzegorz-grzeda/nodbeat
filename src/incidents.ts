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
): Promise<IncidentDoc> {
  const incident: IncidentDoc = {
    _id: new ObjectId(),
    monitorId: monitor._id,
    ownerId: monitor.ownerId,
    startedAt,
    endedAt: null,
    endReason: null,
  };
  await incidents(db).insertOne(incident);
  return incident;
}

/** Ends the Monitor's open Incident, if it has one, and returns it as closed. */
export function closeOpenIncident(
  db: Db,
  monitorId: ObjectId,
  endedAt: Date,
  endReason: "heartbeat" | "paused",
): Promise<IncidentDoc | null> {
  return incidents(db).findOneAndUpdate(
    { monitorId, endedAt: null },
    { $set: { endedAt, endReason } },
    { returnDocument: "after" },
  );
}

/** The Monitor's Incidents, newest first: at most `limit`, after skipping the newest `skip`. */
export function listIncidents(
  db: Db,
  monitorId: ObjectId,
  limit: number,
  skip = 0,
): Promise<IncidentDoc[]> {
  return incidents(db)
    .find({ monitorId })
    .sort({ startedAt: -1, _id: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();
}

/** How many Incidents the Monitor has. */
export function countIncidents(db: Db, monitorId: ObjectId): Promise<number> {
  return incidents(db).countDocuments({ monitorId });
}

/** Removes all of the Monitor's Incidents (when the Monitor is deleted). */
export async function deleteIncidentsOf(
  db: Db,
  monitorId: ObjectId,
): Promise<void> {
  await incidents(db).deleteMany({ monitorId });
}

/** The Monitor's Incidents that were still open at or after `since`, oldest first. */
export function listIncidentsSince(
  db: Db,
  monitorId: ObjectId,
  since: Date,
): Promise<IncidentDoc[]> {
  return incidents(db)
    .find({ monitorId, $or: [{ endedAt: null }, { endedAt: { $gt: since } }] })
    .sort({ startedAt: 1 })
    .toArray();
}

/** How many Incidents opened since `since`, across the whole instance (the Admin page). */
export function countIncidentsSince(db: Db, since: Date): Promise<number> {
  return incidents(db).countDocuments({ startedAt: { $gte: since } });
}
