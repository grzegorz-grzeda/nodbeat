import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db, ObjectId } from "mongodb";
import type { Clock } from "./clock.js";
import { applyEffects } from "./effects.js";
import { instanceLimits, MAX_HEARTBEAT_MESSAGE_LENGTH } from "./limits.js";
import { transition } from "./monitor-state.js";
import type { MonitorLock } from "./monitor-lock.js";
import { monitors } from "./monitors.js";
import { SlidingWindowLimiter } from "./rate-limit.js";

/** A message is at most 200 characters; anything much bigger is not a Heartbeat. */
const BODY_LIMIT_BYTES = 8 * 1024;

export interface HeartbeatDoc {
  monitorId: ObjectId;
  receivedAt: Date;
  message: string | null;
  method: string;
  sourceIp: string;
}

const heartbeats = (db: Db) => db.collection<HeartbeatDoc>("heartbeats");

export async function ensureHeartbeatIndexes(db: Db): Promise<void> {
  await Promise.all([
    heartbeats(db).createIndex(
      { receivedAt: 1 },
      { expireAfterSeconds: instanceLimits().heartbeatRetentionSec },
    ),
    heartbeats(db).createIndex({ monitorId: 1, receivedAt: -1 }),
  ]);
}

/** The Monitor's Heartbeats received since `since`, newest first, at most `limit`. */
export function listHeartbeatsSince(
  db: Db,
  monitorId: ObjectId,
  since: Date,
  limit: number,
): Promise<HeartbeatDoc[]> {
  return heartbeats(db)
    .find({ monitorId, receivedAt: { $gte: since } })
    .sort({ receivedAt: -1 })
    .limit(limit)
    .toArray();
}

/** The message from `?msg=`, a JSON or form field `msg`, or a plain-text body; capped at 200 characters. */
function readMessage(req: FastifyRequest): string | null {
  const query = req.query as Record<string, unknown>;
  const body: unknown = req.body;
  let raw: unknown = query.msg;
  if (raw === undefined) {
    if (typeof body === "string") raw = body;
    else if (body && typeof body === "object") {
      raw = (body as Record<string, unknown>).msg;
    }
  }
  if (Array.isArray(raw)) raw = raw[0];
  if (typeof raw !== "string") return null;
  // Split by code point so an emoji isn't cut in half.
  const message = [...raw.trim()]
    .slice(0, MAX_HEARTBEAT_MESSAGE_LENGTH)
    .join("");
  return message || null;
}

export async function registerHeartbeatIntake(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; lock: MonitorLock },
): Promise<void> {
  const { db, clock, lock } = deps;
  const limiter = new SlidingWindowLimiter(clock, 1, 1000);

  const handle = async (
    req: FastifyRequest<{ Params: { token: string } }>,
    reply: FastifyReply,
  ) => {
    const text = (code: number, body: string) =>
      reply.code(code).type("text/plain").send(body);

    const monitor = await monitors(db).findOne({ token: req.params.token });
    if (!monitor) return text(404, "Not Found");
    if (!limiter.tryAcquire(monitor.token)) {
      return text(429, "Too Many Requests");
    }

    const message = readMessage(req);
    await lock.run(String(monitor._id), async () => {
      // Re-read under the lock: the Down checker may have changed the state since the lookup above.
      const current = await monitors(db).findOne({ _id: monitor._id });
      if (!current) return;
      const now = clock.now();
      const { fields, effects } = transition(
        current,
        { kind: "heartbeat", message },
        now,
      );
      await Promise.all([
        monitors(db).updateOne({ _id: current._id }, { $set: fields }),
        heartbeats(db).insertOne({
          monitorId: current._id,
          receivedAt: now,
          message,
          method: req.method,
          sourceIp: req.ip,
        }),
      ]);
      await applyEffects(db, current, effects, now);
    });
    return text(200, "OK");
  };

  // Own scope so the catch-all body parser applies only here: devices often POST without a Content-Type.
  await app.register(async (scope) => {
    scope.addContentTypeParser(
      "*",
      { parseAs: "string", bodyLimit: BODY_LIMIT_BYTES },
      (_req, body, done) => done(null, body),
    );
    // A device's broken or empty JSON must not cost it its Heartbeat: fall back to the raw text as the message.
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "string", bodyLimit: BODY_LIMIT_BYTES },
      (_req, body, done) => {
        try {
          done(null, JSON.parse(body as string));
        } catch {
          done(null, body);
        }
      },
    );
    scope.route<{ Params: { token: string } }>({
      method: ["GET", "POST"],
      url: "/hb/:token",
      bodyLimit: BODY_LIMIT_BYTES,
      config: { csrf: false },
      handler: handle,
    });
  });
}
