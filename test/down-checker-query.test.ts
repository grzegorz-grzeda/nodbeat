import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { maybeOverdueQuery } from "../src/down-checker.js";
import { nextDueAt, runDeadline } from "../src/monitor-state.js";
import { monitors, type MonitorDoc } from "../src/monitors.js";
import { buildTestApp } from "./helpers.js";

const T0 = new Date("2026-01-01T00:00:00Z").getTime();
const at = (sec: number) => new Date(T0 + sec * 1000);

/** Interval Monitors around their deadlines: lastHeartbeatAt, watchedSince and the Run each before or after. */
function intervalMonitors(): MonitorDoc[] {
  const docs: MonitorDoc[] = [];
  for (const heardSec of [0, 50, 89, 90, 91]) {
    for (const watchedSince of [undefined, null, at(10), at(80)]) {
      for (const run of [
        null,
        { runStartedAt: at(0), maxRunTimeSec: 60 },
        { runStartedAt: at(100), maxRunTimeSec: 60 },
        { runStartedAt: at(0), maxRunTimeSec: null },
      ]) {
        docs.push({
          _id: new ObjectId(),
          ownerId: new ObjectId(),
          name: "m",
          notes: "",
          state: "up",
          intervalSec: 60,
          graceSec: 30,
          lastHeartbeatAt: at(-heardSec),
          lastMessage: null,
          pausedAt: null,
          ...(watchedSince !== undefined && { watchedSince }),
          runStartedAt: run?.runStartedAt ?? null,
          ...(run && { maxRunTimeSec: run.maxRunTimeSec }),
          lastRunDurationSec: null,
          token: new ObjectId().toHexString(),
          alertsEnabled: true,
          createdAt: at(-1000),
        });
      }
    }
  }
  return docs;
}

describe("the Down checker's query", () => {
  it("picks exactly the Interval Monitors nextDueAt() and runDeadline() say are overdue", async () => {
    const { db } = await buildTestApp();
    const docs = intervalMonitors();
    await monitors(db).insertMany(docs);
    const overdueCounts: number[] = [];
    for (const startedSec of [-1000, -20, 0]) {
      const startedAt = at(startedSec);
      const now = at(0);
      const picked = new Set(
        (
          await monitors(db)
            .find(maybeOverdueQuery(startedAt, now), { projection: { _id: 1 } })
            .toArray()
        ).map((m) => String(m._id)),
      );
      const overdue = docs
        .filter((m) =>
          [nextDueAt(m, startedAt), runDeadline(m, startedAt)].some(
            (d) => d !== null && d <= now,
          ),
        )
        .map((m) => String(m._id));
      overdueCounts.push(overdue.length);
      expect([...picked].sort()).toEqual(overdue.sort());
    }
    // Some overdue, some not, and nodbeat's start pushes deadlines back.
    expect(overdueCounts[0]).toBeGreaterThan(overdueCounts[1]!);
    expect(overdueCounts[0]).toBeLessThan(docs.length);
    expect(overdueCounts[2]).toBe(0);
  });

  it("leaves every Up Schedule Monitor to be checked in code", async () => {
    const { db } = await buildTestApp();
    const [doc] = intervalMonitors();
    await monitors(db).insertOne({
      ...doc!,
      intervalSec: null,
      schedule: { cron: "0 2 * * *", timeZone: "UTC", shortestGapSec: 86400 },
      lastHeartbeatAt: at(0),
    });
    const found = await monitors(db)
      .find(maybeOverdueQuery(at(0), at(0)))
      .toArray();
    expect(found).toHaveLength(1);
  });
});
