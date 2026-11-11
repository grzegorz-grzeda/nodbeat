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
    runStartedAt: null,
    lastRunDurationSec: null,
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

const START_AT = new Date("2026-01-01T00:00:10Z");

describe("transition: start", () => {
  it.each(["new", "up", "down"] as const)(
    "records when a Run began on a %s Monitor, without changing its state, last Heartbeat or deadline",
    (state) => {
      const before = monitor({ state });
      const { fields, effects } = transition(before, { kind: "start" }, NOW);
      expect(fields).toMatchObject({
        state,
        lastHeartbeatAt: T0,
        lastMessage: "ok",
        watchedSince: null,
        runStartedAt: NOW,
      });
      expect(effects).toEqual([]);
    },
  );

  it("replaces the start of a Run already open", () => {
    const { fields } = transition(
      monitor({ runStartedAt: START_AT }),
      { kind: "start" },
      NOW,
    );
    expect(fields.runStartedAt).toEqual(NOW);
  });

  it("only records a Start signal to a Paused Monitor", () => {
    const { fields, effects } = transition(
      monitor({ state: "paused", pausedAt: T0 }),
      { kind: "start" },
      NOW,
    );
    expect(fields).toMatchObject({ state: "paused", runStartedAt: null });
    expect(effects).toEqual([]);
  });
});

describe("transition: ending a Run", () => {
  it("a Heartbeat ends an open Run and records its duration", () => {
    const { fields } = transition(
      monitor({ runStartedAt: START_AT, lastRunDurationSec: 5 }),
      { kind: "heartbeat", message: null },
      NOW,
    );
    expect(fields).toMatchObject({
      state: "up",
      runStartedAt: null,
      lastRunDurationSec: 30,
    });
  });

  it("a Fail signal ends an open Run and records its duration", () => {
    const { fields } = transition(
      monitor({ runStartedAt: START_AT }),
      fail,
      NOW,
    );
    expect(fields).toMatchObject({
      state: "down",
      runStartedAt: null,
      lastRunDurationSec: 30,
    });
  });

  it("a Heartbeat with no open Run keeps the last Run duration", () => {
    const { fields } = transition(
      monitor({ runStartedAt: null, lastRunDurationSec: 7 }),
      { kind: "heartbeat", message: null },
      NOW,
    );
    expect(fields).toMatchObject({ runStartedAt: null, lastRunDurationSec: 7 });
  });
});
