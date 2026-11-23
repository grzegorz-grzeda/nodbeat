import { Readable } from "node:stream";
import type { Db, ObjectId } from "mongodb";
import { alertChannels, type AlertChannelDoc } from "./alert-channels.js";
import type { HeartbeatDoc } from "./heartbeats.js";
import type { IncidentDoc } from "./incidents.js";
import { monitors, type MonitorDoc } from "./monitors.js";
import type { UserDoc } from "./users.js";

/** At most one export per User within this long (spec 0018). */
export const EXPORT_EVERY_MS = 60 * 60 * 1000;

const users = (db: Db) => db.collection<UserDoc>("users");

/** A copy of `doc` without `keys`. */
function without<T extends object, K extends keyof T>(
  doc: T,
  ...keys: K[]
): Omit<T, K> {
  const copy = { ...doc };
  for (const key of keys) delete copy[key];
  return copy;
}

/**
 * Takes the User's export for now, or returns when the next one is possible. The claim is one conditional update, so
 * parallel requests can't both pass, and it survives restarts.
 */
export async function claimExport(
  db: Db,
  userId: ObjectId,
  now: Date,
): Promise<{ ok: true } | { ok: false; nextAt: Date }> {
  const since = new Date(now.getTime() - EXPORT_EVERY_MS);
  const claimed = await users(db).updateOne(
    {
      _id: userId,
      $or: [
        { lastExportAt: { $exists: false } },
        { lastExportAt: { $lte: since } },
      ],
    },
    { $set: { lastExportAt: now } },
  );
  if (claimed.modifiedCount === 1) return { ok: true };
  const user = await users(db).findOne(
    { _id: userId },
    { projection: { lastExportAt: 1 } },
  );
  const last = user?.lastExportAt ?? now;
  return { ok: false, nextAt: new Date(last.getTime() + EXPORT_EVERY_MS) };
}

/** The User as exported: an allow-list, so a field added later (a hash, a Stripe id) stays out until chosen. */
function exportedUser(user: UserDoc) {
  return {
    _id: user._id,
    email: user.email,
    isAdmin: user.isAdmin,
    timeZone: user.timeZone,
    theme: user.theme ?? "system",
    createdAt: user.createdAt,
    acceptedTerms: user.accepted ?? {},
    plan: user.plan
      ? {
          proUntil: user.plan.proUntil,
          source: user.plan.source,
          proEndedAt: user.plan.proEndedAt,
        }
      : null,
  };
}

/** A Monitor's settings and state, with the Heartbeat URL instead of its bare token. */
function exportedMonitor(monitor: MonitorDoc, publicBaseUrl: string) {
  return {
    ...without(monitor, "token", "ownerId"),
    heartbeatUrl: `${publicBaseUrl}/hb/${monitor.token}`,
  };
}

/** An Alert channel without its secret: `secretSet` tells whether one is stored. */
export function exportedChannel(channel: AlertChannelDoc) {
  switch (channel.kind) {
    case "webhook":
      return {
        ...without(channel, "ownerId", "secret"),
        secretSet: Boolean(channel.secret),
      };
    case "ntfy":
      return {
        ...without(channel, "ownerId", "token"),
        secretSet: Boolean(channel.token),
      };
    case "telegram":
      return without(channel, "ownerId");
  }
}

const json = (value: unknown) => JSON.stringify(value);

/**
 * The User's data as one JSON document, streamed piece by piece: Monitors one at a time, each with its Incidents and
 * Heartbeats read by cursor, so a large account never sits in memory whole. Dates are ISO strings, ids hex strings.
 */
export function exportStream(
  db: Db,
  user: UserDoc,
  now: Date,
  publicBaseUrl: string,
): Readable {
  async function* parts(): AsyncGenerator<string> {
    yield `{"version":1,"exportedAt":${json(now)},"user":${json(exportedUser(user))},"monitors":[`;
    let firstMonitor = true;
    const monitorCursor = monitors(db)
      .find({ ownerId: user._id })
      .sort({ createdAt: 1, _id: 1 });
    for await (const monitor of monitorCursor) {
      const settings = json(exportedMonitor(monitor, publicBaseUrl));
      yield `${firstMonitor ? "" : ","}${settings.slice(0, -1)},"incidents":[`;
      firstMonitor = false;
      yield* jsonArrayItems(
        db
          .collection<IncidentDoc>("incidents")
          .find({ monitorId: monitor._id, ownerId: user._id })
          .sort({ startedAt: -1 }),
        (incident) => without(incident, "monitorId", "ownerId"),
      );
      yield `],"heartbeats":[`;
      yield* jsonArrayItems(
        db
          .collection<HeartbeatDoc>("heartbeats")
          .find({ monitorId: monitor._id })
          .sort({ receivedAt: -1 }),
        (heartbeat) => without(heartbeat, "monitorId", "expiresAt"),
      );
      yield `]}`;
    }
    yield `],"alertChannels":[`;
    yield* jsonArrayItems(
      alertChannels(db)
        .find({ ownerId: user._id })
        .sort({ createdAt: 1, _id: 1 }),
      exportedChannel,
    );
    yield `]}\n`;
  }
  return Readable.from(parts());
}

async function* jsonArrayItems<T>(
  cursor: AsyncIterable<T>,
  shape: (doc: T) => unknown,
): AsyncGenerator<string> {
  let first = true;
  for await (const doc of cursor) {
    yield `${first ? "" : ","}${json(shape(doc))}`;
    first = false;
  }
}
