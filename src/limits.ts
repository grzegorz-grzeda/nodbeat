import type { UserDoc } from "./users.js";

/** Features a Plan may leave out. */
export interface PlanFeatures {
  webhooks: boolean;
  reminders: boolean;
}

/** Per-owner limits. The same for everyone until Plans feed them (spec 0015). */
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

const DEFAULT_LIMITS: Limits = {
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
  features: { webhooks: true, reminders: true },
};

/**
 * The one lookup for what an owner may do: every limit check goes through it, keyed by the owner of the Monitors or
 * Alert channels involved. `now` decides the owner's effective Plan once Plans exist.
 */
export function limitsFor(owner: UserDoc, now: Date): Limits {
  void owner; // Same for everyone until Plans exist.
  void now;
  return DEFAULT_LIMITS;
}

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
