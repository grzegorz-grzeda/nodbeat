import type { AlertKind } from "./alerts.js";
import { MAX_EARLY_HEARTBEAT_SEC } from "./limits.js";
import {
  nextScheduledTime,
  previousScheduledTime,
  shortestGapSec,
  type Schedule,
} from "./schedule.js";

export type MonitorState = "new" | "up" | "down" | "paused";

/** States whose time Uptime leaves out. Each is recorded as periods, from entering the state to leaving it. */
export type UncountedState = Extract<MonitorState, "new" | "paused">;

/** The part of a Monitor the state machine reads and changes. */
export interface MonitorStateFields {
  state: MonitorState;
  lastHeartbeatAt: Date | null;
  lastMessage: string | null;
  /** When the current pause started; null unless Paused. */
  pausedAt: Date | null;
  /**
   * When the Monitor was last unpaused or had its Interval, Schedule, Grace period or Max run time edited: its deadlines count
   * from here at the earliest. Null if never; absent on Monitors stored before pausing existed.
   */
  watchedSince?: Date | null;
  /** When the open Run began (its Start signal); null if none. Absent on Monitors stored before Start signals existed. */
  runStartedAt?: Date | null;
  /** The last finished Run's duration in seconds; null if none. Absent on Monitors stored before Start signals existed. */
  lastRunDurationSec?: number | null;
}

/** A Monitor's Interval or its Schedule: exactly one is set. */
export type MonitorPeriod =
  | {
      intervalSec: number;
      /** Absent on Monitors stored before Schedules existed. */
      schedule?: null;
    }
  | { intervalSec: null; schedule: Schedule };

/** A Monitor's Interval or Schedule, Grace period and Max run time. */
export type MonitorTiming = MonitorPeriod & {
  graceSec: number;
  /** Longest a Run may last before the Monitor goes Down; null for none. Absent on Monitors stored before it existed. */
  maxRunTimeSec?: number | null;
};

/** What the state machine reads besides the state fields. */
export type MonitorSettings = MonitorTiming & {
  /** Off: state and Incidents are still tracked, but no Alerts are enqueued. */
  alertsEnabled: boolean;
};

/**
 * A Monitor's period in seconds: its Interval, or the shortest gap between its Schedule's scheduled times (as stored
 * on save; worked out for Monitors stored before it was). Null for a Schedule with fewer than two scheduled times a
 * year.
 */
export function periodSec(period: MonitorPeriod, now: Date): number | null {
  if (!period.schedule) return period.intervalSec;
  const stored = period.schedule.shortestGapSec;
  return stored !== undefined ? stored : shortestGapSec(period.schedule, now);
}

export type MonitorEvent =
  | { kind: "heartbeat"; message: string | null }
  /** A Fail signal: the job reported a failure. */
  | { kind: "fail"; message: string | null }
  /** A Start signal: a job began. Not a Heartbeat. */
  | { kind: "start" }
  /** The Down checker's look at the Monitor. `startedAt` is when this nodbeat process started (startup grace). */
  | { kind: "deadline-check"; startedAt: Date }
  | { kind: "pause" }
  | { kind: "unpause" }
  /** New settings saved. Only the timing matters to the state machine. */
  | { kind: "edit"; timing: MonitorTiming };

/** Why an Incident opened: a missed deadline, a Fail signal or a Run longer than the Max run time. */
export type IncidentCause = "missed" | "failed" | "run-too-long";

export type Effect =
  /** A missed deadline's or too long Run's Incident starts at that deadline, not when the checker noticed. */
  | {
      kind: "open-incident";
      startedAt: Date;
      cause: IncidentCause;
      /** For a too long Run: the Max run time it passed, kept so later edits don't change what the Incident says. */
      maxRunTimeSec?: number;
    }
  | { kind: "close-incident"; reason: "heartbeat" | "paused" }
  /** New and pause periods are left out of Uptime. */
  | { kind: "start-period"; state: UncountedState }
  | { kind: "end-period"; state: UncountedState }
  /** Down: about the Incident just opened. Up: about the Incident just closed. */
  | { kind: "enqueue-alert"; alert: AlertKind };

export const STATE_LABELS: Record<MonitorState, string> = {
  new: "New",
  up: "Up",
  down: "Down",
  paused: "Paused",
};

export interface Transition {
  fields: MonitorStateFields;
  effects: Effect[];
  /** The duration in seconds of the Run this event ended; absent if it ended none. */
  endedRunDurationSec?: number;
}

/** What nextDueAt() reads: the state, when the Monitor was last heard from or created, and its timing. */
export type DueFields = Pick<
  MonitorStateFields,
  "state" | "lastHeartbeatAt" | "watchedSince"
> &
  MonitorTiming & {
    /** Needed for a New Monitor's due time; without it a New Monitor has none. */
    createdAt?: Date;
  };

/**
 * The one rule for when a Monitor's next Heartbeat is due. An Up Monitor past it goes Down (a New one waits for its
 * first Heartbeat); "next expected by" shows it. Null for Paused and Down Monitors. A Run's Max run time is a separate
 * deadline: see runDeadline().
 *
 * It counts from the last Heartbeat (Up) or creation (New), the last unpause or edit, or nodbeat's start, whichever is
 * latest. An Interval Monitor is due Interval + Grace period after that. A Schedule Monitor is due Grace period after
 * the scheduled time it waits for: the first one after that point, except that a Heartbeat counts for a scheduled
 * time (the coming one if it is at most the early window before it, otherwise the one before it), so the Monitor then
 * waits for the scheduled time after that one. A Heartbeat from before the last unpause or edit counts for none.
 */
export function nextDueAt(monitor: DueFields, startedAt: Date): Date | null {
  const heard =
    monitor.state === "up"
      ? monitor.lastHeartbeatAt
      : monitor.state === "new"
        ? (monitor.createdAt ?? null)
        : null;
  if (!heard) return null;
  const from = new Date(
    Math.max(
      heard.getTime(),
      // Absent on Monitors stored before pausing existed.
      monitor.watchedSince?.getTime() ?? 0,
      startedAt.getTime(),
    ),
  );
  const graceMs = monitor.graceSec * 1000;
  if (!monitor.schedule) {
    return new Date(from.getTime() + monitor.intervalSec * 1000 + graceMs);
  }
  const { schedule } = monitor;
  const waitsFor = [nextScheduledTime(schedule, from)];
  // A Heartbeat from before the last unpause or edit counts for no scheduled time: the Monitor waits for the next one.
  const watchedSince = monitor.watchedSince?.getTime() ?? 0;
  if (monitor.state === "up" && heard.getTime() > watchedSince) {
    waitsFor.push(scheduledTimeAfterHeartbeat(schedule, heard));
  }
  if (waitsFor.some((t) => t === null)) return null;
  return new Date(Math.max(...waitsFor.map((t) => t!.getTime())) + graceMs);
}

/**
 * The scheduled time a Heartbeat at `at` counts for: the coming one if the Heartbeat is at most the early window
 * before it (MAX_EARLY_HEARTBEAT_SEC, or half the gap from the scheduled time before if that is shorter), otherwise
 * the one before it. Null if there is none.
 */
function scheduledTimeOfHeartbeat(schedule: Schedule, at: Date): Date | null {
  const before = previousScheduledTime(schedule, at);
  const coming = nextScheduledTime(schedule, at);
  if (!coming) return before;
  const windowMs = Math.min(
    MAX_EARLY_HEARTBEAT_SEC * 1000,
    before ? (coming.getTime() - before.getTime()) / 2 : Infinity,
  );
  return coming.getTime() - at.getTime() <= windowMs ? coming : before;
}

/** The scheduled time after the one a Heartbeat at `at` counts for (the first after `at` if it counts for none). */
function scheduledTimeAfterHeartbeat(
  schedule: Schedule,
  at: Date,
): Date | null {
  return nextScheduledTime(
    schedule,
    scheduledTimeOfHeartbeat(schedule, at) ?? at,
  );
}

/**
 * When an Up Monitor's open Run makes it Down: Max run time after its Start signal, its last unpause or edit, or
 * nodbeat's start, whichever is latest. Null without an open Run or a Max run time.
 */
export function runDeadline(
  monitor: Pick<MonitorStateFields, "runStartedAt" | "watchedSince"> &
    Pick<MonitorTiming, "maxRunTimeSec">,
  startedAt: Date,
): Date | null {
  if (!monitor.runStartedAt || monitor.maxRunTimeSec == null) return null;
  const from = Math.max(
    monitor.runStartedAt.getTime(),
    monitor.watchedSince?.getTime() ?? 0,
    startedAt.getTime(),
  );
  return new Date(from + monitor.maxRunTimeSec * 1000);
}

/** The single place Monitor state changes are decided. Pure: no I/O, time comes in as `now`. */
export function transition(
  current: MonitorStateFields & MonitorSettings,
  event: MonitorEvent,
  now: Date,
): Transition {
  switch (event.kind) {
    case "heartbeat":
      return onHeartbeat(current, event.message, now);
    case "fail":
      return onFail(current, event.message, now);
    case "start":
      return onStart(current, now);
    case "deadline-check":
      return onDeadlineCheck(current, event.startedAt, now);
    case "pause":
      return onPause(current, now);
    case "unpause":
      return onUnpause(current, now);
    case "edit":
      return onEdit(current, event.timing, now);
  }
}

function alertEffects(current: MonitorSettings, kind: AlertKind): Effect[] {
  return current.alertsEnabled ? [{ kind: "enqueue-alert", alert: kind }] : [];
}

function stateFields(current: MonitorStateFields): MonitorStateFields {
  const {
    state,
    lastHeartbeatAt,
    lastMessage,
    pausedAt,
    watchedSince,
    runStartedAt,
    lastRunDurationSec,
  } = current;
  return {
    state,
    lastHeartbeatAt,
    lastMessage,
    pausedAt,
    watchedSince: watchedSince ?? null,
    runStartedAt: runStartedAt ?? null,
    lastRunDurationSec: lastRunDurationSec ?? null,
  };
}

/** After a Heartbeat or Fail signal: the Monitor was heard from, and an open Run ends. */
function heardFrom(
  current: MonitorStateFields,
  message: string | null,
  now: Date,
): Pick<Transition, "fields" | "endedRunDurationSec"> {
  const fields = {
    ...stateFields(current),
    lastHeartbeatAt: now,
    lastMessage: message,
  };
  if (!fields.runStartedAt) return { fields };
  const endedRunDurationSec = runDurationSec(fields.runStartedAt, now);
  return {
    fields: {
      ...fields,
      runStartedAt: null,
      lastRunDurationSec: endedRunDurationSec,
    },
    endedRunDurationSec,
  };
}

/** Whole seconds from a Run's Start signal to its end. */
export function runDurationSec(runStartedAt: Date, endedAt: Date): number {
  return Math.max(
    0,
    Math.round((endedAt.getTime() - runStartedAt.getTime()) / 1000),
  );
}

/** Begins a Run (replacing any open one). No state change and no deadline move: a Start signal is not a Heartbeat. */
function onStart(current: MonitorStateFields, now: Date): Transition {
  const fields = stateFields(current);
  if (fields.state === "paused") return { fields, effects: [] };
  return { fields: { ...fields, runStartedAt: now }, effects: [] };
}

function onHeartbeat(
  current: MonitorStateFields & MonitorSettings,
  message: string | null,
  now: Date,
): Transition {
  const { fields: seen, ...ended } = heardFrom(current, message, now);
  switch (current.state) {
    case "new":
      return {
        fields: { ...seen, state: "up" },
        effects: [{ kind: "end-period", state: "new" }],
        ...ended,
      };
    case "up":
      return { fields: { ...seen, state: "up" }, effects: [], ...ended };
    case "down":
      return {
        fields: { ...seen, state: "up" },
        effects: [
          { kind: "close-incident", reason: "heartbeat" },
          ...alertEffects(current, "up"),
        ],
        ...ended,
      };
    case "paused":
      return { fields: { ...seen, state: "paused" }, effects: [], ...ended };
  }
}

/**
 * New or Up goes Down at once; Down only records it, as heard from. Paused only records it, like a Start signal:
 * pausing means silence, so it neither counts as heard from nor ends a Run.
 */
function onFail(
  current: MonitorStateFields & MonitorSettings,
  message: string | null,
  now: Date,
): Transition {
  const { state } = current;
  if (state === "paused") return { fields: stateFields(current), effects: [] };
  const { fields: seen, ...ended } = heardFrom(current, message, now);
  if (state === "down") return { fields: seen, effects: [], ...ended };
  return {
    ...ended,
    fields: { ...seen, state: "down" },
    effects: [
      ...(state === "new"
        ? [{ kind: "end-period", state: "new" } as const]
        : []),
      { kind: "open-incident", startedAt: now, cause: "failed" },
      ...alertEffects(current, "down"),
    ],
  };
}

function onDeadlineCheck(
  current: MonitorStateFields & MonitorSettings,
  startedAt: Date,
  now: Date,
): Transition {
  const fields = stateFields(current);
  if (fields.state !== "up") return { fields, effects: [] };
  // The earliest passed deadline decides when the Incident started and why.
  const deadlines: Array<[Date | null, IncidentCause]> = [
    [nextDueAt(current, startedAt), "missed"],
    [runDeadline(current, startedAt), "run-too-long"],
  ];
  const first = deadlines
    .filter((d): d is [Date, IncidentCause] => d[0] !== null && d[0] <= now)
    .sort((a, b) => a[0].getTime() - b[0].getTime())[0];
  if (!first) return { fields, effects: [] };
  const [deadline, cause] = first;
  // runDeadline() is null without a Max run time, so it is set here.
  const limit =
    cause === "run-too-long" ? { maxRunTimeSec: current.maxRunTimeSec! } : {};
  return {
    fields: { ...fields, state: "down" },
    effects: [
      { kind: "open-incident", startedAt: deadline, cause, ...limit },
      ...alertEffects(current, "down"),
    ],
  };
}

function onPause(current: MonitorStateFields, now: Date): Transition {
  const fields = stateFields(current);
  if (fields.state === "paused") return { fields, effects: [] };
  return {
    fields: { ...fields, state: "paused", pausedAt: now },
    effects: [
      ...(fields.state === "down"
        ? [{ kind: "close-incident", reason: "paused" } as const]
        : []),
      ...(fields.state === "new"
        ? [{ kind: "end-period", state: "new" } as const]
        : []),
      { kind: "start-period", state: "paused" },
    ],
  };
}

/** Resumes as Up if a Heartbeat arrived during the pause, otherwise New; either way with a fresh deadline from now. */
function onUnpause(current: MonitorStateFields, now: Date): Transition {
  const fields = stateFields(current);
  if (fields.state !== "paused") return { fields, effects: [] };
  const heardDuringPause =
    fields.lastHeartbeatAt !== null &&
    (fields.pausedAt === null || fields.lastHeartbeatAt >= fields.pausedAt);
  return {
    fields: {
      ...fields,
      state: heardDuringPause ? "up" : "new",
      pausedAt: null,
      watchedSince: now,
    },
    effects: [
      { kind: "end-period", state: "paused" },
      ...(heardDuringPause
        ? []
        : [{ kind: "start-period", state: "new" } as const]),
    ],
  };
}

function sameSchedule(
  a: Schedule | null | undefined,
  b: Schedule | null | undefined,
): boolean {
  return (
    (a?.cron ?? null) === (b?.cron ?? null) &&
    (a?.timeZone ?? null) === (b?.timeZone ?? null)
  );
}

/** A changed Interval, Schedule, Grace period or Max run time counts from the edit, so a shorter one can't backdate an Incident. */
function onEdit(
  current: MonitorStateFields & MonitorTiming,
  timing: MonitorTiming,
  now: Date,
): Transition {
  const fields = stateFields(current);
  const changed =
    timing.intervalSec !== current.intervalSec ||
    !sameSchedule(timing.schedule, current.schedule) ||
    timing.graceSec !== current.graceSec ||
    (timing.maxRunTimeSec ?? null) !== (current.maxRunTimeSec ?? null);
  return {
    fields: changed ? { ...fields, watchedSince: now } : fields,
    effects: [],
  };
}
