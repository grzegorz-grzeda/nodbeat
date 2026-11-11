import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { Db, ObjectId } from "mongodb";
import type { Clock } from "./clock.js";
import { applyEffects } from "./effects.js";
import {
  instanceLimits,
  MAX_HEARTBEAT_MESSAGE_LENGTH,
  MAX_USER_AGENT_LENGTH,
} from "./limits.js";
import { transition } from "./monitor-state.js";
import type { LogPruner } from "./log-pruner.js";
import type { KeyedLock } from "./keyed-lock.js";
import { monitors } from "./monitors.js";
import { SlidingWindowLimiter } from "./rate-limit.js";

const UNKNOWN_TOKENS_PER_IP = 30;
const UNKNOWN_TOKEN_WINDOW_MS = 60 * 1000;

/** A message is at most 200 characters; anything much bigger is not a Heartbeat. */
const BODY_LIMIT_BYTES = 8 * 1024;

/** Which request to the Heartbeat URL: a plain Heartbeat (success), a Start signal or a Fail signal. */
export type SignalKind = "success" | "start" | "fail";

export interface HeartbeatDoc {
  monitorId: ObjectId;
  /** Missing on Heartbeats stored before signals existed: those are successes. */
  kind?: SignalKind;
  receivedAt: Date;
  message: string | null;
  /** The Run this signal ended, in seconds; null if it ended none. Missing on Heartbeats stored before Runs existed. */
  runDurationSec?: number | null;
  method: string;
  sourceIp: string;
  /** The `User-Agent` header, trimmed to 200 characters. Missing on Heartbeats stored before it was recorded. */
  userAgent?: string | null;
}

/** Client groups on the Admin page, in display order. */
export const HEARTBEAT_CLIENTS = [
  "curl",
  "wget",
  "Python",
  "ESP32/Arduino",
  "Browser",
  "Other",
  "None",
] as const;
export type HeartbeatClient = (typeof HEARTBEAT_CLIENTS)[number];

const CLIENT_RULES: Array<[HeartbeatClient, string[]]> = [
  ["curl", ["curl/"]],
  ["wget", ["wget/"]],
  ["Python", ["python-requests", "aiohttp", "urllib"]],
  ["ESP32/Arduino", ["esp32httpclient", "arduino", "esp-idf"]],
  ["Browser", ["mozilla/"]],
];

/** Which kind of client sent a Heartbeat, by case-insensitive substrings of its User-Agent. */
export function heartbeatClient(
  userAgent: string | null | undefined,
): HeartbeatClient {
  if (!userAgent) return "None";
  const ua = userAgent.toLowerCase();
  const rule = CLIENT_RULES.find(([, needles]) =>
    needles.some((n) => ua.includes(n)),
  );
  return rule ? rule[0] : "Other";
}

/** The first `max` characters, split by code point so an emoji isn't cut in half. */
function truncate(text: string, max: number): string {
  return [...text].slice(0, max).join("");
}

function readUserAgent(req: FastifyRequest): string | null {
  const ua = req.headers["user-agent"]?.trim();
  return ua ? truncate(ua, MAX_USER_AGENT_LENGTH) : null;
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

/** The Monitor's Heartbeats received since `since`, newest first: at most `limit`, after skipping the newest `skip`. */
export function listHeartbeatsSince(
  db: Db,
  monitorId: ObjectId,
  since: Date,
  limit: number,
  skip = 0,
): Promise<HeartbeatDoc[]> {
  return heartbeats(db)
    .find({ monitorId, receivedAt: { $gte: since } })
    .sort({ receivedAt: -1, _id: -1 })
    .skip(skip)
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
  const message = truncate(raw.trim(), MAX_HEARTBEAT_MESSAGE_LENGTH);
  return message || null;
}

export async function registerHeartbeatIntake(
  app: FastifyInstance,
  deps: {
    db: Db;
    clock: Clock;
    lock: KeyedLock;
    pruner: LogPruner;
    publicBaseUrl: string;
  },
): Promise<void> {
  const { db, clock, lock, pruner, publicBaseUrl } = deps;
  const perMonitor = new SlidingWindowLimiter(clock, 1, 1000);
  // Scanning for Heartbeat URLs: an IP over this many unknown tokens is refused before any database lookup.
  const unknownTokens = new SlidingWindowLimiter(
    clock,
    UNKNOWN_TOKENS_PER_IP,
    UNKNOWN_TOKEN_WINDOW_MS,
  );

  const handle = async (
    kind: SignalKind,
    req: FastifyRequest<{ Params: { token: string } }>,
    reply: FastifyReply,
  ) => {
    const text = (code: number, body: string) =>
      reply.code(code).type("text/plain").send(body);

    // Taken before the lookup and given back for a known token, so parallel scans can't all slip past the check.
    if (!unknownTokens.tryAcquire(req.ip)) {
      return text(429, "Too Many Requests");
    }
    const monitor = await monitors(db).findOne({ token: req.params.token });
    if (!monitor) return text(404, "Not Found");
    unknownTokens.release(req.ip);
    // Per signal kind, so a short job's Start and success (or a Fail and a retry's success) both get through.
    if (!perMonitor.tryAcquire(`${kind}:${monitor.token}`)) {
      return text(429, "Too Many Requests");
    }

    const message = readMessage(req);
    const accepted = await lock.run(String(monitor._id), async () => {
      // Re-read under the lock: the Down checker may have changed the state since the lookup above, and the
      // Monitor may have been deleted or had its Heartbeat URL regenerated.
      const current = await monitors(db).findOne({
        _id: monitor._id,
        token: monitor.token,
      });
      if (!current) return false;
      const now = clock.now();
      const { fields, effects } = transition(
        current,
        kind === "success"
          ? { kind: "heartbeat", message }
          : kind === "fail"
            ? { kind: "fail", message }
            : { kind: "start" },
        now,
      );
      // A Heartbeat or Fail signal that ended an open Run carries the Run duration the transition just recorded.
      const endedRun = kind !== "start" && Boolean(current.runStartedAt);
      await Promise.all([
        monitors(db).updateOne({ _id: current._id }, { $set: fields }),
        heartbeats(db).insertOne({
          monitorId: current._id,
          kind,
          receivedAt: now,
          message,
          runDurationSec: endedRun ? (fields.lastRunDurationSec ?? null) : null,
          method: req.method,
          sourceIp: req.ip,
          userAgent: readUserAgent(req),
        }),
      ]);
      // The updated fields, so a Fail signal's Down Alert carries its own message.
      await applyEffects(
        db,
        { ...current, ...fields },
        effects,
        now,
        publicBaseUrl,
      );
      pruner.mark(current._id);
      return true;
    });
    return accepted ? text(200, "OK") : text(404, "Not Found");
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
    // Every Heartbeat URL answer is plain text, the oversized body too (Fastify's default is JSON).
    scope.setErrorHandler<FastifyError>((error, _req, reply) => {
      if (error.statusCode === 413) {
        return reply.code(413).type("text/plain").send("Payload Too Large");
      }
      throw error;
    });
    const signals: Array<[string, SignalKind]> = [
      ["/hb/:token", "success"],
      ["/hb/:token/start", "start"],
      ["/hb/:token/fail", "fail"],
    ];
    for (const [url, kind] of signals) {
      scope.route<{ Params: { token: string } }>({
        method: ["GET", "POST"],
        url,
        // GET and POST only: link previewers send HEAD on their own, which must not count as a Heartbeat.
        exposeHeadRoute: false,
        bodyLimit: BODY_LIMIT_BYTES,
        config: { csrf: false },
        handler: (req, reply) => handle(kind, req, reply),
      });
    }
  });
}

/** Removes all of the Monitor's Heartbeats (when the Monitor is deleted). */
export async function deleteHeartbeatsOf(
  db: Db,
  monitorId: ObjectId,
): Promise<void> {
  await heartbeats(db).deleteMany({ monitorId });
}

/** How many Heartbeats each Monitor has received since `since`, keyed by Monitor id (the Admin page). */
export async function countHeartbeatsByMonitorSince(
  db: Db,
  since: Date,
): Promise<Map<string, number>> {
  const groups = await heartbeats(db)
    .aggregate<{ _id: ObjectId; count: number }>([
      { $match: { receivedAt: { $gte: since } } },
      { $group: { _id: "$monitorId", count: { $sum: 1 } } },
    ])
    .toArray();
  return new Map(groups.map((g) => [String(g._id), g.count]));
}

export interface HeartbeatTraffic {
  total: number;
  get: number;
  post: number;
  withMessage: number;
  /** In `HEARTBEAT_CLIENTS` order. */
  byClient: Array<{ label: HeartbeatClient; count: number }>;
}

/** How the whole instance's Heartbeats since `since` arrived (the Admin page). Messages are only tested for presence. */
export async function summarizeHeartbeatTraffic(
  db: Db,
  since: Date,
): Promise<HeartbeatTraffic> {
  const groups = await heartbeats(db)
    .aggregate<{
      _id: { method: string; hasMessage: boolean; userAgent: string | null };
      count: number;
    }>([
      { $match: { receivedAt: { $gte: since } } },
      {
        $group: {
          _id: {
            method: "$method",
            hasMessage: { $ne: [{ $ifNull: ["$message", null] }, null] },
            userAgent: { $ifNull: ["$userAgent", null] },
          },
          count: { $sum: 1 },
        },
      },
    ])
    .toArray();
  const byClient = Object.fromEntries(
    HEARTBEAT_CLIENTS.map((c) => [c, 0]),
  ) as Record<HeartbeatClient, number>;
  const traffic: HeartbeatTraffic = {
    total: 0,
    get: 0,
    post: 0,
    withMessage: 0,
    byClient: [],
  };
  for (const { _id, count } of groups) {
    traffic.total += count;
    if (_id.method === "GET") traffic.get += count;
    if (_id.method === "POST") traffic.post += count;
    if (_id.hasMessage) traffic.withMessage += count;
    byClient[heartbeatClient(_id.userAgent)] += count;
  }
  traffic.byClient = HEARTBEAT_CLIENTS.map((label) => ({
    label,
    count: byClient[label],
  }));
  return traffic;
}

/** Drops the Monitor's Heartbeats beyond its newest `keep`. */
export async function pruneHeartbeats(
  db: Db,
  monitorId: ObjectId,
  keep: number,
): Promise<void> {
  const [oldestKept] = await heartbeats(db)
    .find({ monitorId }, { projection: { receivedAt: 1 } })
    .sort({ receivedAt: -1, _id: -1 })
    .skip(keep - 1)
    .limit(1)
    .toArray();
  if (!oldestKept) return;
  await heartbeats(db).deleteMany({
    monitorId,
    $or: [
      { receivedAt: { $lt: oldestKept.receivedAt } },
      { receivedAt: oldestKept.receivedAt, _id: { $lt: oldestKept._id } },
    ],
  });
}
