export type MonitorState = "new" | "up" | "down" | "paused";

/** The part of a Monitor the state machine reads and changes. */
export interface MonitorStateFields {
  state: MonitorState;
  lastHeartbeatAt: Date | null;
  lastMessage: string | null;
}

/** What the state machine reads besides the state fields. */
export interface MonitorTiming {
  intervalSec: number;
  graceSec: number;
}

export type MonitorEvent =
  | { kind: "heartbeat"; message: string | null }
  /** The Down checker's look at the Monitor. `startedAt` is when this nodbeat process started (startup grace). */
  | { kind: "deadline-check"; startedAt: Date };

export type Effect =
  /** The Incident starts at the deadline, not when the checker noticed. */
  | { kind: "open-incident"; startedAt: Date }
  | { kind: "close-incident"; reason: "heartbeat" };

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
 * When an Up Monitor goes Down: Interval + Grace period after its last Heartbeat or after nodbeat started, whichever is later.
 * Null for a Monitor that has never sent a Heartbeat.
 */
export function downDeadline(
  monitor: Pick<MonitorStateFields, "lastHeartbeatAt"> & MonitorTiming,
  startedAt: Date,
): Date | null {
  if (!monitor.lastHeartbeatAt) return null;
  const from = Math.max(monitor.lastHeartbeatAt.getTime(), startedAt.getTime());
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
      return onHeartbeat(current.state, event.message, now);
    case "deadline-check":
      return onDeadlineCheck(current, event.startedAt, now);
  }
}

function onHeartbeat(
  state: MonitorState,
  message: string | null,
  now: Date,
): Transition {
  const seen = { lastHeartbeatAt: now, lastMessage: message };
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
  const { state, lastHeartbeatAt, lastMessage } = current;
  const fields = { state, lastHeartbeatAt, lastMessage };
  if (state !== "up") return { fields, effects: [] };
  const deadline = downDeadline(current, startedAt);
  if (!deadline || now < deadline) return { fields, effects: [] };
  return {
    fields: { ...fields, state: "down" },
    effects: [{ kind: "open-incident", startedAt: deadline }],
  };
}
