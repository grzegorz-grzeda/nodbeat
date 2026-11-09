import type { Db, ObjectId } from "mongodb";

export interface IncidentDoc {
  _id: ObjectId;
  monitorId: ObjectId;
  ownerId: ObjectId;
  startedAt: Date;
  endedAt: Date | null;
  endReason: "heartbeat" | "paused" | null;
}

const incidents = (db: Db) => db.collection<IncidentDoc>("incidents");

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
