import { describe, expect, it } from "vitest";
import {
  transition,
  type MonitorSettings,
  type MonitorStateFields,
} from "../src/monitor-state.js";

const T0 = new Date("2026-01-01T00:00:00Z");
const NOW = new Date("2026-01-01T00:00:40Z");

function monitor(
  fields: Partial<MonitorStateFields> = {},
  settings: Partial<MonitorSettings> = {},
): MonitorStateFields & MonitorSettings {
  return {
    state: "up",
    lastHeartbeatAt: T0,
    lastMessage: "ok",
    pausedAt: null,
    watchedSince: null,
    intervalSec: 60,
    graceSec: 30,
    alertsEnabled: true,
    ...fields,
    ...settings,
  };
}

const fail = { kind: "fail", message: "disk full" } as const;

describe("transition: fail", () => {
  it("makes an Up Monitor Down at once, opening an Incident now with a failure Down Alert", () => {
    const { fields, effects } = transition(monitor(), fail, NOW);
    expect(fields).toMatchObject({
      state: "down",
      lastHeartbeatAt: NOW,
      lastMessage: "disk full",
    });
    expect(effects).toEqual([
      { kind: "open-incident", startedAt: NOW, cause: "failed" },
      { kind: "enqueue-alert", alert: "down" },
    ]);
  });

  it("makes a New Monitor Down and ends its New period", () => {
    const { fields, effects } = transition(
      monitor({ state: "new", lastHeartbeatAt: null, lastMessage: null }),
      fail,
      NOW,
    );
    expect(fields).toMatchObject({
      state: "down",
      lastHeartbeatAt: NOW,
      lastMessage: "disk full",
    });
    expect(effects).toEqual([
      { kind: "end-period", state: "new" },
      { kind: "open-incident", startedAt: NOW, cause: "failed" },
      { kind: "enqueue-alert", alert: "down" },
    ]);
  });

  it("enqueues no Alert when Alerts are off", () => {
    const { fields, effects } = transition(
      monitor({}, { alertsEnabled: false }),
      fail,
      NOW,
    );
    expect(fields.state).toBe("down");
    expect(effects).toEqual([
      { kind: "open-incident", startedAt: NOW, cause: "failed" },
    ]);
  });

  it("only records a Fail signal to a Down Monitor", () => {
    const { fields, effects } = transition(
      monitor({ state: "down" }),
      { kind: "fail", message: null },
      NOW,
    );
    expect(fields).toMatchObject({
      state: "down",
      lastHeartbeatAt: NOW,
      lastMessage: null,
    });
    expect(effects).toEqual([]);
  });

  it("only records a Fail signal to a Paused Monitor", () => {
    const { fields, effects } = transition(
      monitor({ state: "paused", pausedAt: T0 }),
      fail,
      NOW,
    );
    expect(fields).toMatchObject({
      state: "paused",
      pausedAt: T0,
      lastHeartbeatAt: NOW,
      lastMessage: "disk full",
    });
    expect(effects).toEqual([]);
  });
});
