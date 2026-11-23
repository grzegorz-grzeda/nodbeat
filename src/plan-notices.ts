import type { FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import { enqueueNotice } from "./alerts.js";
import { requireUser } from "./auth.js";
import type { Clock } from "./clock.js";
import { formatDateTime } from "./format.js";
import type { KeyedLock } from "./keyed-lock.js";
import { makeProFeaturesDormant } from "./plan-dormant.js";
import type { Plans } from "./plans.js";
import type { UserDoc } from "./users.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Pro features keep working this long after Pro ends (spec 0015); then the dormant step runs (issue 0064). */
export const PRO_GRACE_DAYS = 14;
/** The second "Pro ended" notice goes out this many days after Pro ended. */
const SECOND_NOTICE_DAY = 12;

const users = (db: Db) => db.collection<UserDoc>("users");

/** When Pro features stop for a User whose Pro ended at `proEndedAt`. */
export const proFeaturesStopAt = (proEndedAt: Date) =>
  new Date(proEndedAt.getTime() + PRO_GRACE_DAYS * DAY_MS);

/** What the banner and both notices say: Pro ended, and what stops when. */
function endedText(user: Pick<UserDoc, "timeZone">, proEndedAt: Date) {
  const day = formatDateTime(proFeaturesStopAt(proEndedAt), user.timeZone);
  return `Your Pro has ended. Webhooks, Reminders and 30 s Intervals keep working until ${day.slice(0, 10)}; then Webhooks stop, Reminders turn off and 30 s Intervals become 1 min. Your Monitors keep running.`;
}

/** Sends one "Pro ended" notice to all the User's Alert channels. */
function sendNotice(
  db: Db,
  user: UserDoc,
  proEndedAt: Date,
  second: boolean,
  now: Date,
  publicBaseUrl: string,
) {
  const stop = formatDateTime(proFeaturesStopAt(proEndedAt), user.timeZone);
  return enqueueNotice(
    db,
    user._id,
    {
      title: second
        ? `nodbeat Pro features stop on ${stop.slice(0, 10)}`
        : "Your nodbeat Pro has ended",
      lines: [endedText(user, proEndedAt)],
      url: `${publicBaseUrl}/settings`,
      linkText: "Open Settings",
    },
    now,
  );
}

/**
 * On each tick: a User whose Pro ended gets `proEndedAt` and the first "Pro ended" notice; 12 days later the second;
 * 14 days later Pro-only features go dormant. Each is claimed by an update before it's sent, so it goes out once. Nothing with Plans off.
 */
export function createPlanNotices(deps: {
  db: Db;
  clock: Clock;
  plans: Plans;
  lock: KeyedLock;
  publicBaseUrl: string;
}): () => Promise<void> {
  const { db, clock, plans, lock, publicBaseUrl } = deps;
  return async () => {
    if (!plans.enabled) return;
    const now = clock.now();

    const ended = await users(db)
      .find({ "plan.proUntil": { $lte: now }, "plan.proEndedAt": null })
      .toArray();
    for (const user of ended) {
      const claimed = await users(db).updateOne(
        {
          _id: user._id,
          "plan.proUntil": { $lte: now },
          "plan.proEndedAt": null,
        },
        {
          $set: {
            "plan.proEndedAt": now,
            "plan.endNotices": 1,
            "plan.bannerDismissed": false,
          },
        },
      );
      if (claimed.modifiedCount === 1) {
        await sendNotice(db, user, now, false, now, publicBaseUrl);
      }
    }

    const secondDue = new Date(now.getTime() - SECOND_NOTICE_DAY * DAY_MS);
    const due = await users(db)
      .find({
        "plan.proEndedAt": { $lte: secondDue },
        "plan.endNotices": 1,
        "plan.proUntil": { $lte: now },
      })
      .toArray();
    for (const user of due) {
      const claimed = await users(db).updateOne(
        { _id: user._id, "plan.endNotices": 1 },
        { $set: { "plan.endNotices": 2, "plan.bannerDismissed": false } },
      );
      if (claimed.modifiedCount === 1 && user.plan?.proEndedAt) {
        await sendNotice(
          db,
          user,
          user.plan.proEndedAt,
          true,
          now,
          publicBaseUrl,
        );
      }
    }

    // Day 14: Pro-only features go dormant, once.
    const stopDue = new Date(now.getTime() - PRO_GRACE_DAYS * DAY_MS);
    const dormant = await users(db)
      .find({
        "plan.proEndedAt": { $lte: stopDue },
        "plan.dormantAt": { $exists: false },
        "plan.proUntil": { $lte: now },
      })
      .toArray();
    for (const user of dormant) {
      const claimed = await users(db).updateOne(
        { _id: user._id, "plan.dormantAt": { $exists: false } },
        { $set: { "plan.dormantAt": now } },
      );
      if (claimed.modifiedCount === 1) {
        await makeProFeaturesDormant(db, lock, user._id, now, publicBaseUrl);
      }
    }
  };
}

/** The Pro-ended banner's text for this User, or null: only on Free after Pro ended, until dismissed. */
export function proEndedBanner(
  user: Pick<UserDoc, "plan" | "timeZone">,
  plans: Plans,
  now: Date,
): string | null {
  const plan = user.plan;
  if (plans.planOf(user, now) !== "free" || !plan?.proEndedAt) return null;
  if (plan.bannerDismissed) return null;
  if (now.getTime() >= proFeaturesStopAt(plan.proEndedAt).getTime()) {
    return null;
  }
  return endedText(user, plan.proEndedAt);
}

/** Only same-site paths, so the form can't be turned into an open redirect. */
const localPath = (value: unknown): string =>
  typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : "/";

/** Dismissing the banner hides it until the next notice. */
export function registerPlanNotices(app: FastifyInstance, deps: { db: Db }) {
  const { db } = deps;
  app.post<{ Body: { back?: string } }>(
    "/plan/banner/dismiss",
    { preHandler: requireUser },
    async (req, reply) => {
      await users(db).updateOne(
        { _id: req.user!._id, plan: { $exists: true } },
        { $set: { "plan.bannerDismissed": true } },
      );
      return reply.redirect(localPath(req.body?.back), 303);
    },
  );
}
