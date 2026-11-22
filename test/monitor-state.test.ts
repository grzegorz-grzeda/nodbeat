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
  settings: Partial<Omit<MonitorSettings, "schedule">> & {
    intervalSec?: number;
  } = {},
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

  it("only records a Fail signal to a Paused Monitor: no last Heartbeat, message or Run change", () => {
    const { fields, effects } = transition(
      monitor({ state: "paused", pausedAt: T0, runStartedAt: T0 }),
      fail,
      NOW,
    );
    expect(fields).toMatchObject({
      state: "paused",
      pausedAt: T0,
      lastHeartbeatAt: T0,
      lastMessage: "ok",
      runStartedAt: T0,
      lastRunDurationSec: null,
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

describe("transition: Max run time", () => {
  const check = (startedAt = T0) =>
    ({ kind: "deadline-check", startedAt }) as const;
  const RUN_AT = new Date("2026-01-01T00:00:10Z");
  const long = { intervalSec: 3600, graceSec: 60, maxRunTimeSec: 300 };

  it("makes an Up Monitor Down once its Run passes the Max run time, the Incident starting then", () => {
    const { fields, effects } = transition(
      monitor({ runStartedAt: RUN_AT }, long),
      check(),
      new Date("2026-01-01T00:07:00Z"),
    );
    expect(fields.state).toBe("down");
    expect(effects).toEqual([
      {
        kind: "open-incident",
        startedAt: new Date("2026-01-01T00:05:10Z"),
        cause: "run-too-long",
        maxRunTimeSec: 300,
      },
      { kind: "enqueue-alert", alert: "down" },
    ]);
  });

  it("stays Up before the Max run time has passed", () => {
    const { fields, effects } = transition(
      monitor({ runStartedAt: RUN_AT }, long),
      check(),
      new Date("2026-01-01T00:05:09Z"),
    );
    expect(fields.state).toBe("up");
    expect(effects).toEqual([]);
  });

  it("counts from nodbeat's start when that is later than the Start signal", () => {
    const restarted = new Date("2026-01-01T00:03:00Z");
    const at = (iso: string) =>
      transition(
        monitor({ runStartedAt: RUN_AT }, long),
        check(restarted),
        new Date(iso),
      ).effects;
    expect(at("2026-01-01T00:07:59Z")).toEqual([]);
    expect(at("2026-01-01T00:08:00Z")[0]).toEqual({
      kind: "open-incident",
      startedAt: new Date("2026-01-01T00:08:00Z"),
      cause: "run-too-long",
      maxRunTimeSec: 300,
    });
  });

  it("ignores a Run when there is no Max run time", () => {
    const { effects } = transition(
      monitor({ runStartedAt: RUN_AT }, { ...long, maxRunTimeSec: null }),
      check(),
      new Date("2026-01-01T00:30:00Z"),
    );
    expect(effects).toEqual([]);
  });

  it("uses the missed deadline when it came first", () => {
    const { effects } = transition(
      monitor(
        { runStartedAt: RUN_AT },
        { intervalSec: 60, graceSec: 30, maxRunTimeSec: 300 },
      ),
      check(),
      new Date("2026-01-01T00:10:00Z"),
    );
    expect(effects[0]).toEqual({
      kind: "open-incident",
      startedAt: new Date("2026-01-01T00:01:30Z"),
      cause: "missed",
    });
  });

  it("counts a changed Max run time from the edit, so it can't backdate an Incident", () => {
    const edited = new Date("2026-01-01T00:04:00Z");
    const shorter = { ...long, maxRunTimeSec: 120 };
    const { fields } = transition(
      monitor({ runStartedAt: RUN_AT }, long),
      { kind: "edit", timing: shorter },
      edited,
    );
    expect(fields.watchedSince).toEqual(edited);
    const check1 = (iso: string) =>
      transition(monitor(fields, shorter), check(), new Date(iso)).effects;
    expect(check1("2026-01-01T00:05:59Z")).toEqual([]);
    expect(check1("2026-01-01T00:06:00Z")[0]).toMatchObject({
      startedAt: new Date("2026-01-01T00:06:00Z"),
      cause: "run-too-long",
      maxRunTimeSec: 120,
    });
  });
});

describe("transition: Unreachable", () => {
  const LATE = new Date("2026-01-01T00:01:31Z");
  const check = (down: boolean) =>
    ({
      kind: "deadline-check",
      startedAt: T0,
      ...(down && { parent: "down" as const }),
    }) as const;

  it("makes a silent Up Monitor Unreachable when its Parent is Down: no Incident, no Alert", () => {
    const { fields, effects } = transition(monitor(), check(true), LATE);
    expect(fields).toMatchObject({ state: "unreachable", parentUpAt: null });
    expect(effects).toEqual([{ kind: "start-period", state: "unreachable" }]);
  });

  it("does nothing before the deadline, Parent Down or not", () => {
    expect(transition(monitor(), check(true), NOW).effects).toEqual([]);
    expect(transition(monitor(), check(true), NOW).fields.state).toBe("up");
  });

  it("waits while the Parent stays Down", () => {
    const later = new Date(LATE.getTime() + 3600_000);
    const { fields, effects } = transition(
      monitor({ state: "unreachable" }),
      check(true),
      later,
    );
    expect(fields.state).toBe("unreachable");
    expect(effects).toEqual([]);
  });

  it("starts a fresh deadline once the Parent isn't Down, then goes Down when it passes", () => {
    const back = new Date(LATE.getTime() + 600_000);
    const released = transition(
      monitor({ state: "unreachable" }),
      check(false),
      back,
    );
    expect(released.fields).toMatchObject({
      state: "unreachable",
      parentUpAt: back,
    });
    expect(released.effects).toEqual([]);

    const due = new Date(back.getTime() + 90_000);
    const stillWaiting = transition(
      monitor({ state: "unreachable", parentUpAt: back }),
      check(false),
      new Date(due.getTime() - 1),
    );
    expect(stillWaiting.effects).toEqual([]);

    const { fields, effects } = transition(
      monitor({ state: "unreachable", parentUpAt: back }),
      check(false),
      due,
    );
    expect(fields).toMatchObject({ state: "down", parentUpAt: null });
    expect(effects).toEqual([
      { kind: "end-period", state: "unreachable" },
      { kind: "open-incident", startedAt: due, cause: "missed" },
      { kind: "enqueue-alert", alert: "down" },
    ]);
  });

  it("forgets the Parent's return if the Parent goes Down again", () => {
    const { fields } = transition(
      monitor({ state: "unreachable", parentUpAt: LATE }),
      check(true),
      new Date(LATE.getTime() + 10_000),
    );
    expect(fields).toMatchObject({ state: "unreachable", parentUpAt: null });
  });

  it("goes Up on a Heartbeat without an Up Alert", () => {
    const { fields, effects } = transition(
      monitor({ state: "unreachable" }),
      { kind: "heartbeat", message: null },
      LATE,
    );
    expect(fields).toMatchObject({ state: "up", parentUpAt: null });
    expect(effects).toEqual([{ kind: "end-period", state: "unreachable" }]);
  });

  it("goes Down at once on a Fail signal", () => {
    const { fields, effects } = transition(
      monitor({ state: "unreachable" }),
      fail,
      LATE,
    );
    expect(fields.state).toBe("down");
    expect(effects).toEqual([
      { kind: "end-period", state: "unreachable" },
      { kind: "open-incident", startedAt: LATE, cause: "failed" },
      { kind: "enqueue-alert", alert: "down" },
    ]);
  });

  it("holds a silent Up Monitor while its Parent is silent too", () => {
    const { fields, effects } = transition(
      monitor(),
      { kind: "deadline-check", startedAt: T0, parent: "silent" },
      LATE,
    );
    expect(fields.state).toBe("up");
    expect(effects).toEqual([]);
  });

  it("goes Down as usual when its Parent is alive", () => {
    const { fields, effects } = transition(
      monitor(),
      { kind: "deadline-check", startedAt: T0, parent: "alive" },
      LATE,
    );
    expect(fields.state).toBe("down");
    expect(effects).toContainEqual({ kind: "enqueue-alert", alert: "down" });
  });

  it("ends the Unreachable period on pause", () => {
    const { fields, effects } = transition(
      monitor({ state: "unreachable" }),
      { kind: "pause" },
      LATE,
    );
    expect(fields.state).toBe("paused");
    expect(effects).toEqual([
      { kind: "end-period", state: "unreachable" },
      { kind: "start-period", state: "paused" },
    ]);
  });
});
