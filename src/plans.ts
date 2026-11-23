import type { Db, ObjectId } from "mongodb";
import { wakeProFeatures } from "./plan-dormant.js";
import { DEFAULT_LIMITS, PLAN_LIMITS, type Limits } from "./limits.js";
import type { UserDoc } from "./users.js";

export type PlanName = keyof typeof PLAN_LIMITS;

export const PLAN_LABELS: Record<PlanName, string> = {
  free: "Free",
  pro: "Pro",
};

/** What a User's Plan is made of. Missing on a User means Free (no Pro). */
export interface UserPlan {
  /** Pro until then; null or past: Free. */
  proUntil: Date | null;
  /** Where the Pro came from: the Admin (`comp`) or a subscription (`stripe`, spec 0016). */
  source: "comp" | "stripe" | null;
  /** When the last Pro ended, for the downgrade steps (issue 0063); null while Pro or never Pro. */
  proEndedAt: Date | null;
  /** "Pro ended" notices sent since `proEndedAt` (0–2, issue 0063). Missing: none. */
  endNotices?: number;
  /** The User dismissed the Pro-ended banner; a new notice shows it again. */
  bannerDismissed?: boolean;
  /** When Pro-only features went dormant, 14 days after `proEndedAt` (issue 0064). Missing: not yet. */
  dormantAt?: Date;
}

/** The User's Plan at `now`: Pro while `proUntil` is ahead, else Free. */
export function effectivePlan(
  owner: Pick<UserDoc, "plan">,
  now: Date,
): PlanName {
  const until = owner.plan?.proUntil;
  return until && until.getTime() > now.getTime() ? "pro" : "free";
}

/** Whether Plans apply on this instance, and the one lookup for what an owner may do. */
export interface Plans {
  /** Off: everyone gets DEFAULT_LIMITS with every feature, and no Plan shows anywhere. */
  enabled: boolean;
  /** The owner's effective Plan; null with Plans off. */
  planOf(owner: Pick<UserDoc, "plan">, now: Date): PlanName | null;
  /** Every limit check goes through this, keyed by the owner of the Monitors or Alert channels involved. */
  limitsFor(owner: Pick<UserDoc, "plan">, now: Date): Limits;
}

export function createPlans(enabled: boolean): Plans {
  const planOf = (owner: Pick<UserDoc, "plan">, now: Date) =>
    enabled ? effectivePlan(owner, now) : null;
  return {
    enabled,
    planOf,
    limitsFor: (owner, now) => {
      const plan = planOf(owner, now);
      return plan ? PLAN_LIMITS[plan] : DEFAULT_LIMITS;
    },
  };
}

/** How long the Pro given to every existing User when Plans first start lasts. */
const LAUNCH_PRO_MONTHS = 6;

/**
 * On the first start with Plans enabled, every User there is gets Pro (`comp`) for 6 months, so nothing they have
 * breaks. Runs once per instance (a marker in `migrations`); Users created later start Free.
 */
export async function grantLaunchPro(db: Db, now: Date): Promise<void> {
  const migrations = db.collection<{ _id: string; at: Date }>("migrations");
  const claimed = await migrations
    .insertOne({ _id: "plans-launch-pro", at: now })
    .then(() => true)
    .catch((err: unknown) => {
      if ((err as { code?: number }).code === 11000) return false;
      throw err;
    });
  if (!claimed) return;
  const proUntil = new Date(now);
  proUntil.setUTCMonth(proUntil.getUTCMonth() + LAUNCH_PRO_MONTHS);
  await db
    .collection<UserDoc>("users")
    .updateMany(
      { "plan.proUntil": { $not: { $gt: now } } },
      { $set: { plan: { proUntil, source: "comp", proEndedAt: null } } },
    );
}

const users = (db: Db) => db.collection<UserDoc>("users");

/** The Admin gives the User Pro (a comp) until `proUntil`, replacing any Pro end date they had. */
export async function giveComp(
  db: Db,
  userId: ObjectId,
  proUntil: Date,
): Promise<boolean> {
  const res = await users(db).updateOne(
    { _id: userId },
    { $set: { plan: { proUntil, source: "comp", proEndedAt: null } } },
  );
  if (res.matchedCount === 1) await wakeProFeatures(db, userId);
  return res.matchedCount === 1;
}

/** The Admin ends the User's Pro now; false when they weren't on Pro. */
export async function endPro(
  db: Db,
  userId: ObjectId,
  now: Date,
): Promise<boolean> {
  const res = await users(db).updateOne(
    { _id: userId, "plan.proUntil": { $gt: now } },
    { $set: { "plan.proUntil": now } },
  );
  return res.modifiedCount === 1;
}
