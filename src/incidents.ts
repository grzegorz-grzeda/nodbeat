import { ObjectId, type Db } from "mongodb";
import type { IncidentCause } from "./monitor-state.js";

export interface IncidentDoc {
  _id: ObjectId;
  monitorId: ObjectId;
  ownerId: ObjectId;
  startedAt: Date;
  /** Missing on Incidents stored before Fail signals existed: those are missed deadlines. */
  cause?: IncidentCause;
  /** For a too long Run (`run-too-long`): the Max run time it passed, as it was then. */
  maxRunTimeSec?: number;
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
  why: Pick<IncidentDoc, "cause" | "maxRunTimeSec">,
): Promise<IncidentDoc> {
  const incident: IncidentDoc = {
    _id: new ObjectId(),
    monitorId: monitor._id,
    ownerId: monitor.ownerId,
    startedAt,
    ...why,
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

/**
 * Drops the Monitor's Incidents beyond its newest `keep`, except ones that ended after `stillNeededSince` (or are
 * open): Uptime reads those.
 */
export async function pruneIncidents(
  db: Db,
  monitorId: ObjectId,
  keep: number,
  stillNeededSince: Date,
): Promise<void> {
  const [oldestKept] = await incidents(db)
    .find({ monitorId }, { projection: { startedAt: 1 } })
    .sort({ startedAt: -1, _id: -1 })
    .skip(keep - 1)
    .limit(1)
    .toArray();
  if (!oldestKept) return;
  await incidents(db).deleteMany({
    monitorId,
    endedAt: { $ne: null, $lte: stillNeededSince },
    $or: [
      { startedAt: { $lt: oldestKept.startedAt } },
      { startedAt: oldestKept.startedAt, _id: { $lt: oldestKept._id } },
    ],
  });
}
