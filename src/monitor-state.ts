import type { AlertKind } from "./alerts.js";

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
   * When the Monitor was last unpaused or had its Interval, Grace period or Max run time edited: its deadlines count
   * from here at the earliest. Null if never; absent on Monitors stored before pausing existed.
   */
  watchedSince?: Date | null;
  /** When the open Run began (its Start signal); null if none. Absent on Monitors stored before Start signals existed. */
  runStartedAt?: Date | null;
  /** The last finished Run's duration in seconds; null if none. Absent on Monitors stored before Start signals existed. */
  lastRunDurationSec?: number | null;
}

/** A Monitor's Interval, Grace period and Max run time. */
export interface MonitorTiming {
  intervalSec: number;
  graceSec: number;
  /** Longest a Run may last before the Monitor goes Down; null for none. Absent on Monitors stored before it existed. */
  maxRunTimeSec?: number | null;
}

/** What the state machine reads besides the state fields. */
export interface MonitorSettings extends MonitorTiming {
  /** Off: state and Incidents are still tracked, but no Alerts are enqueued. */
  alertsEnabled: boolean;
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
  | { kind: "open-incident"; startedAt: Date; cause: IncidentCause }
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
}

/**
 * When an Up Monitor goes Down: Interval + Grace period after its last Heartbeat, its last unpause or nodbeat's start,
 * whichever is latest. Null for a Monitor that has never sent a Heartbeat.
 */
export function downDeadline(
  monitor: Pick<MonitorStateFields, "lastHeartbeatAt" | "watchedSince"> &
    MonitorTiming,
  startedAt: Date,
): Date | null {
  if (!monitor.lastHeartbeatAt) return null;
  const from = Math.max(
    monitor.lastHeartbeatAt.getTime(),
    // Absent on Monitors stored before pausing existed.
    monitor.watchedSince?.getTime() ?? 0,
    startedAt.getTime(),
  );
  return new Date(from + (monitor.intervalSec + monitor.graceSec) * 1000);
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

/** The fields after a Heartbeat or Fail signal: the device was heard from, and an open Run ends. */
function heardFrom(
  current: MonitorStateFields,
  message: string | null,
  now: Date,
): MonitorStateFields {
  const fields = {
    ...stateFields(current),
    lastHeartbeatAt: now,
    lastMessage: message,
  };
  if (!fields.runStartedAt) return fields;
  return {
    ...fields,
    runStartedAt: null,
    lastRunDurationSec: runDurationSec(fields.runStartedAt, now),
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
  const seen = heardFrom(current, message, now);
  const { state } = current;
  switch (state) {
    case "new":
      return {
        fields: { ...seen, state: "up" },
        effects: [{ kind: "end-period", state: "new" }],
      };
    case "up":
      return { fields: { ...seen, state: "up" }, effects: [] };
    case "down":
      return {
        fields: { ...seen, state: "up" },
        effects: [
          { kind: "close-incident", reason: "heartbeat" },
          ...alertEffects(current, "up"),
        ],
      };
    case "paused":
      return { fields: { ...seen, state: "paused" }, effects: [] };
  }
}

/** New or Up goes Down at once; Down and Paused only record it. Either way the device was heard from. */
function onFail(
  current: MonitorStateFields & MonitorSettings,
  message: string | null,
  now: Date,
): Transition {
  const seen = heardFrom(current, message, now);
  const { state } = current;
  if (state === "down" || state === "paused") {
    return { fields: seen, effects: [] };
  }
  return {
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
    [downDeadline(current, startedAt), "missed"],
    [runDeadline(current, startedAt), "run-too-long"],
  ];
  const first = deadlines
    .filter((d): d is [Date, IncidentCause] => d[0] !== null && d[0] <= now)
    .sort((a, b) => a[0].getTime() - b[0].getTime())[0];
  if (!first) return { fields, effects: [] };
  const [deadline, cause] = first;
  return {
    fields: { ...fields, state: "down" },
    effects: [
      { kind: "open-incident", startedAt: deadline, cause },
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

/** A changed Interval, Grace period or Max run time counts from the edit, so a shorter one can't backdate an Incident. */
function onEdit(
  current: MonitorStateFields & MonitorTiming,
  timing: MonitorTiming,
  now: Date,
): Transition {
  const fields = stateFields(current);
  const changed =
    timing.intervalSec !== current.intervalSec ||
    timing.graceSec !== current.graceSec ||
    (timing.maxRunTimeSec ?? null) !== (current.maxRunTimeSec ?? null);
  return {
    fields: changed ? { ...fields, watchedSince: now } : fields,
    effects: [],
  };
}
