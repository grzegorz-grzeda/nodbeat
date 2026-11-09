export type MonitorState = "new" | "up" | "down" | "paused";

/** The part of a Monitor the state machine reads and changes. */
export interface MonitorStateFields {
  state: MonitorState;
  lastHeartbeatAt: Date | null;
  lastMessage: string | null;
  /** When the current pause started; null unless Paused. */
  pausedAt: Date | null;
  /**
   * When the Monitor was last unpaused or had its Interval or Grace period edited: its deadline counts from here at
   * the earliest. Null if never; absent on Monitors stored before pausing existed.
   */
  watchedSince?: Date | null;
}

/** What the state machine reads besides the state fields. */
export interface MonitorTiming {
  intervalSec: number;
  graceSec: number;
}

export type MonitorEvent =
  | { kind: "heartbeat"; message: string | null }
  /** The Down checker's look at the Monitor. `startedAt` is when this nodbeat process started (startup grace). */
  | { kind: "deadline-check"; startedAt: Date }
  | { kind: "pause" }
  | { kind: "unpause" }
  /** New settings saved. Only the timing matters to the state machine. */
  | { kind: "edit"; timing: MonitorTiming };

export type Effect =
  /** The Incident starts at the deadline, not when the checker noticed. */
  | { kind: "open-incident"; startedAt: Date }
  | { kind: "close-incident"; reason: "heartbeat" | "paused" }
  /** Pause periods are left out of Uptime. */
  | { kind: "start-pause-period" }
  | { kind: "end-pause-period" };

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

/** The single place Monitor state changes are decided. Pure: no I/O, time comes in as `now`. */
export function transition(
  current: MonitorStateFields & MonitorTiming,
  event: MonitorEvent,
  now: Date,
): Transition {
  switch (event.kind) {
    case "heartbeat":
      return onHeartbeat(current, event.message, now);
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

function stateFields(current: MonitorStateFields): MonitorStateFields {
  const { state, lastHeartbeatAt, lastMessage, pausedAt, watchedSince } =
    current;
  return {
    state,
    lastHeartbeatAt,
    lastMessage,
    pausedAt,
    watchedSince: watchedSince ?? null,
  };
}

function onHeartbeat(
  current: MonitorStateFields,
  message: string | null,
  now: Date,
): Transition {
  const seen = {
    ...stateFields(current),
    lastHeartbeatAt: now,
    lastMessage: message,
  };
  const { state } = current;
  switch (state) {
    case "new":
    case "up":
      return { fields: { ...seen, state: "up" }, effects: [] };
    case "down":
      return {
        fields: { ...seen, state: "up" },
        effects: [{ kind: "close-incident", reason: "heartbeat" }],
      };
    case "paused":
      return { fields: { ...seen, state: "paused" }, effects: [] };
  }
}

function onDeadlineCheck(
  current: MonitorStateFields & MonitorTiming,
  startedAt: Date,
  now: Date,
): Transition {
  const fields = stateFields(current);
  if (fields.state !== "up") return { fields, effects: [] };
  const deadline = downDeadline(current, startedAt);
  if (!deadline || now < deadline) return { fields, effects: [] };
  return {
    fields: { ...fields, state: "down" },
    effects: [{ kind: "open-incident", startedAt: deadline }],
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
      { kind: "start-pause-period" },
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
    effects: [{ kind: "end-pause-period" }],
  };
}

/** A changed Interval or Grace period counts from the edit, so a shorter one can't backdate an Incident. */
function onEdit(
  current: MonitorStateFields & MonitorTiming,
  timing: MonitorTiming,
  now: Date,
): Transition {
  const fields = stateFields(current);
  const changed =
    timing.intervalSec !== current.intervalSec ||
    timing.graceSec !== current.graceSec;
  return {
    fields: changed ? { ...fields, watchedSince: now } : fields,
    effects: [],
  };
}
