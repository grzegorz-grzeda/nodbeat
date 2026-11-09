export type MonitorState = "new" | "up" | "down" | "paused";

/** The part of a Monitor the state machine reads and changes. */
export interface MonitorStateFields {
  state: MonitorState;
  lastHeartbeatAt: Date | null;
  lastMessage: string | null;
}

export type MonitorEvent = { kind: "heartbeat"; message: string | null };

export type Effect = { kind: "close-incident"; reason: "heartbeat" };

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

/** The single place Monitor state changes are decided. Pure: no I/O, time comes in as `now`. */
export function transition(
  current: MonitorStateFields,
  event: MonitorEvent,
  now: Date,
): Transition {
  switch (event.kind) {
    case "heartbeat": {
      const seen = { lastHeartbeatAt: now, lastMessage: event.message };
      switch (current.state) {
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
  }
}
