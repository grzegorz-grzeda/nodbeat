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
  /** When the next Reminder is due; null when none is (no Reminders, Alerts off, or closed). Absent on Incidents
   * stored before Reminders existed. */
  nextReminderAt?: Date | null;
  /** Reminders sent so far. Absent on Incidents stored before Reminders existed: none. */
  remindersSent?: number;
}

const incidents = (db: Db) => db.collection<IncidentDoc>("incidents");

export async function ensureIncidentIndexes(db: Db): Promise<void> {
  await Promise.all([
    incidents(db).createIndex({ monitorId: 1, startedAt: -1 }),
    // The Down checker's look for due Reminders: only open Incidents with one due have a date here.
    incidents(db).createIndex(
      { nextReminderAt: 1 },
      { partialFilterExpression: { nextReminderAt: { $type: "date" } } },
    ),
  ]);
}

export async function openIncident(
  db: Db,
  monitor: { _id: ObjectId; ownerId: ObjectId },
  startedAt: Date,
  why: Pick<IncidentDoc, "cause" | "maxRunTimeSec">,
  nextReminderAt: Date | null,
): Promise<IncidentDoc> {
  const incident: IncidentDoc = {
    _id: new ObjectId(),
    monitorId: monitor._id,
    ownerId: monitor.ownerId,
    startedAt,
    ...why,
    endedAt: null,
    endReason: null,
    nextReminderAt,
    remindersSent: 0,
  };
  await incidents(db).insertOne(incident);
  return incident;
}

/** Sets when the Monitor's open Incident, if it has one, sends its next Reminder; null: none. */
export async function setNextReminder(
  db: Db,
  monitorId: ObjectId,
  nextReminderAt: Date | null,
): Promise<void> {
  await incidents(db).updateOne(
    { monitorId, endedAt: null },
    { $set: { nextReminderAt } },
  );
}

/** Open Incidents whose next Reminder is due at `now`. */
export function listDueReminders(db: Db, now: Date): Promise<IncidentDoc[]> {
  return incidents(db)
    .find({ endedAt: null, nextReminderAt: { $type: "date", $lte: now } })
    .toArray();
}

/**
 * Takes the Reminder due at `due` by moving the next one to `next`, in one update: a second tick that read the same due
 * time gets null and sends nothing. Returns the Incident as updated. Not counted as sent: see countReminder.
 */
export function claimReminder(
  db: Db,
  incidentId: ObjectId,
  due: Date,
  next: Date,
): Promise<IncidentDoc | null> {
  return incidents(db).findOneAndUpdate(
    { _id: incidentId, endedAt: null, nextReminderAt: due },
    { $set: { nextReminderAt: next } },
    { returnDocument: "after" },
  );
}

/** Gives back a Reminder claimed as `due` → `next` that couldn't be enqueued, so the next tick tries it again. */
export async function unclaimReminder(
  db: Db,
  incidentId: ObjectId,
  due: Date,
  next: Date,
): Promise<void> {
  await incidents(db).updateOne(
    { _id: incidentId, endedAt: null, nextReminderAt: next },
    { $set: { nextReminderAt: due } },
  );
}

/** Counts a Reminder as sent: it was enqueued to at least one Alert channel. */
export async function countReminder(
  db: Db,
  incidentId: ObjectId,
): Promise<void> {
  await incidents(db).updateOne(
    { _id: incidentId },
    { $inc: { remindersSent: 1 } },
  );
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
    { $set: { endedAt, endReason, nextReminderAt: null } },
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
