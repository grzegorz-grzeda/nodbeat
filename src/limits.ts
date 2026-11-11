import type { UserDoc } from "./users.js";

/** Per-User limits. Constants for now; Plans will feed them later. */
export interface Limits {
  maxMonitors: number;
  minIntervalSec: number;
  maxIntervalSec: number;
  minGraceSec: number;
  maxGraceSec: number;
  heartbeatRetentionSec: number;
  /** Heartbeats and Incidents kept per Monitor; older ones are dropped. */
  maxLogRowsPerMonitor: number;
}

/** Longest Heartbeat message kept, in characters. Instance-wide. */
export const MAX_HEARTBEAT_MESSAGE_LENGTH = 200;

const DAY_SEC = 24 * 60 * 60;

const DEFAULT_LIMITS: Limits = {
  maxMonitors: 50,
  minIntervalSec: 30,
  maxIntervalSec: 7 * DAY_SEC,
  minGraceSec: 0,
  maxGraceSec: DAY_SEC,
  heartbeatRetentionSec: 7 * DAY_SEC,
  maxLogRowsPerMonitor: 100,
};

export function limitsFor(user: UserDoc): Limits {
  void user; // Same for everyone until Plans exist.
  return DEFAULT_LIMITS;
}

/** Limits that apply instance-wide (e.g. the Heartbeat TTL index and log pruning, which don't vary per User yet). */
export function instanceLimits(): Limits {
  return DEFAULT_LIMITS;
}

/**
 * The Grace period a Monitor gets when none is given: half its Interval, clamped to the Grace bounds. Half of a long
 * Interval can exceed the bound (7 d → 3.5 d > 1 d); clamping beats blaming a field left blank.
 */
export function defaultGraceSec(intervalSec: number, limits: Limits): number {
  return Math.min(
    Math.max(Math.floor(intervalSec / 2), limits.minGraceSec),
    limits.maxGraceSec,
  );
}
