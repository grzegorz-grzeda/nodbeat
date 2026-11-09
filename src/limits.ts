import type { UserDoc } from "./users.js";

/** Per-User limits. Constants for now; Plans will feed them later. */
export interface Limits {
  maxMonitors: number;
  minIntervalSec: number;
  maxIntervalSec: number;
  minGraceSec: number;
  maxGraceSec: number;
  heartbeatRetentionSec: number;
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
};

export function limitsFor(user: UserDoc): Limits {
  void user; // Same for everyone until Plans exist.
  return DEFAULT_LIMITS;
}

/** Limits that apply instance-wide (e.g. the Heartbeat TTL index, which can't vary per User). */
export function instanceLimits(): Limits {
  return DEFAULT_LIMITS;
}
