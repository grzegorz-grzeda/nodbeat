/** Features a Plan may leave out. */
export interface PlanFeatures {
  webhooks: boolean;
  reminders: boolean;
  /** Setting a Parent, and a kept one counting (spec 0022). */
  parents: boolean;
}

/** Per-owner limits: from the owner's Plan, or DEFAULT_LIMITS with Plans off. Looked up through `Plans.limitsFor`. */
export interface Limits {
  maxMonitors: number;
  /** Alert channels of every kind together. */
  maxAlertChannels: number;
  minIntervalSec: number;
  maxIntervalSec: number;
  /** Closest two scheduled times of a Schedule may be. */
  minScheduleGapSec: number;
  minGraceSec: number;
  maxGraceSec: number;
  /** Bounds of a Monitor's Max run time (which is optional). */
  minMaxRunTimeSec: number;
  maxMaxRunTimeSec: number;
  heartbeatRetentionSec: number;
  /** Heartbeats kept per Monitor; older ones are dropped. */
  maxHeartbeatsPerMonitor: number;
  /** Incidents kept per Monitor; older ones are dropped once 7-day Uptime no longer needs them. */
  maxIncidentsPerMonitor: number;
  features: PlanFeatures;
}

/** Longest Heartbeat message kept, in characters. Instance-wide. */
export const MAX_HEARTBEAT_MESSAGE_LENGTH = 200;

/** Longest Heartbeat User-Agent kept, in characters. Instance-wide. */
export const MAX_USER_AGENT_LENGTH = 200;

/**
 * Longest a Heartbeat may come before a Schedule's scheduled time and still count for it (e.g. a 02:00 job that sends
 * at 01:58). Shorter when scheduled times are closer: at most half the gap to the scheduled time before. Instance-wide.
 */
export const MAX_EARLY_HEARTBEAT_SEC = 60 * 60;

const DAY_SEC = 24 * 60 * 60;

/** Limits with Plans off (self-hosted, no billing): what every User had before Plans. */
export const DEFAULT_LIMITS: Limits = {
  maxMonitors: 50,
  maxAlertChannels: 10,
  minIntervalSec: 30,
  maxIntervalSec: 7 * DAY_SEC,
  minScheduleGapSec: 5 * 60,
  minGraceSec: 0,
  maxGraceSec: DAY_SEC,
  minMaxRunTimeSec: 60,
  maxMaxRunTimeSec: DAY_SEC,
  heartbeatRetentionSec: 7 * DAY_SEC,
  maxHeartbeatsPerMonitor: 100,
  maxIncidentsPerMonitor: 100,
  features: { webhooks: true, reminders: true, parents: true },
};

/** The shortest Interval anyone may have (Pro's); a Free User asking for one below their own gets "needs Pro". */
export const SHORTEST_INTERVAL_SEC = DEFAULT_LIMITS.minIntervalSec;

/** Each Plan's limits (spec 0015). Log caps follow the Plan in issue 0062. */
export const PLAN_LIMITS = {
  free: {
    ...DEFAULT_LIMITS,
    maxMonitors: 10,
    minIntervalSec: 60,
    features: { webhooks: false, reminders: false, parents: false },
  },
  pro: {
    ...DEFAULT_LIMITS,
    maxMonitors: 100,
    minIntervalSec: SHORTEST_INTERVAL_SEC,
  },
} as const satisfies Record<string, Limits>;

/** Limits that apply instance-wide (e.g. the Heartbeat TTL index, which doesn't vary per owner yet). */
export function instanceLimits(): Limits {
  return DEFAULT_LIMITS;
}

/**
 * The Grace period a Monitor gets when none is given: half its Interval (for a Schedule: half the shortest gap between
 * its scheduled times), clamped to the Grace bounds. Half of a long
 * Interval can exceed the bound (7 d → 3.5 d > 1 d); clamping beats blaming a field left blank.
 */
export function defaultGraceSec(periodSec: number, limits: Limits): number {
  return Math.min(
    Math.max(Math.floor(periodSec / 2), limits.minGraceSec),
    limits.maxGraceSec,
  );
}
