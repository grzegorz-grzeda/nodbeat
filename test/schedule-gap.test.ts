import { describe, expect, it } from "vitest";
import {
  nextScheduledTime,
  shortestGapSec,
  type Schedule,
} from "../src/schedule.js";

const FROM = new Date("2026-01-01T00:00:00Z");
const YEAR_MS = 366 * 24 * 60 * 60 * 1000;

/** Every scheduled time in the year, one by one: slow, but obviously right. */
function walkedShortestGapSec(schedule: Schedule): number | null {
  let shortest: number | null = null;
  let previous = nextScheduledTime(schedule, new Date(FROM.getTime() - 1));
  while (previous) {
    const next = nextScheduledTime(schedule, previous);
    if (!next || next.getTime() > FROM.getTime() + YEAR_MS) break;
    const gap = (next.getTime() - previous.getTime()) / 1000;
    if (shortest === null || gap < shortest) shortest = gap;
    previous = next;
  }
  return shortest;
}

describe("shortestGapSec", () => {
  it.each<[string, string, number | null]>([
    ["*/5 * * * *", "Europe/Warsaw", 5 * 60],
    ["0 9 * * 1-5", "UTC", 24 * 60 * 60],
    // DST starts on 29 March: that day's 02:00 is at 03:00, 23 h after the one before.
    ["0 2 * * *", "Europe/Warsaw", 23 * 60 * 60],
    // 01:00 to 03:00 is 1 h on 29 March.
    ["0 1,3 * * *", "Europe/Warsaw", 60 * 60],
    ["0 2 * * *", "UTC", 24 * 60 * 60],
    ["0 0 1 1 *", "UTC", null],
  ])("%s in %s is %s s", (cron, timeZone, expected) => {
    expect(shortestGapSec({ cron, timeZone }, FROM)).toBe(expected);
  });

  it.each<[string, string]>([
    ["*/30 2 * * *", "Europe/Warsaw"],
    ["0,55 1,2 * * *", "Europe/Warsaw"],
    ["15 */7 * * *", "America/New_York"],
    ["0 0 * * 0", "Australia/Lord_Howe"],
    ["30 8-18/5 * JAN,feb MON-FRI", "Europe/London"],
    ["0 0 3 * SUN", "UTC"],
  ])("%s in %s matches walking every scheduled time", (cron, timeZone) => {
    const schedule = { cron, timeZone };
    expect(shortestGapSec(schedule, FROM)).toBe(walkedShortestGapSec(schedule));
  });

  it("is quick for a Schedule every 5 minutes", () => {
    const started = performance.now();
    shortestGapSec(
      { cron: "*/5 9-17 * * 1-5", timeZone: "Europe/Warsaw" },
      FROM,
    );
    expect(performance.now() - started).toBeLessThan(500);
  });
});
