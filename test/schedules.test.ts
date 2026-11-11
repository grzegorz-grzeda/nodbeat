import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createUser,
  login,
  stateOf,
  type Browser,
} from "./helpers.js";

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// The clock starts on Thursday 2026-01-01 00:00 UTC.
async function loggedIn(timeZone = "UTC") {
  const ctx = await buildTestApp();
  await createUser(ctx.db, {
    email: "me@example.com",
    password: "correct horse",
    timeZone,
  });
  const browser = await login(ctx.app, "me@example.com", "correct horse");
  return { ...ctx, browser };
}

/** Creates a Schedule Monitor and returns its page path and Heartbeat path. */
async function createScheduled(
  browser: Browser,
  fields: Record<string, string>,
): Promise<{ page: string; hb: string }> {
  const res = await browser.submit("/monitors/new", "/monitors", {
    name: "Nightly backup",
    timing: "schedule",
    ...fields,
  });
  expect(res.statusCode).toBe(303);
  const page = res.headers.location as string;
  const body = (await browser.get(page)).body;
  const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(body)![1]!;
  return { page, hb };
}

describe("Schedule Monitors", () => {
  it("is Up after the Heartbeat for 02:00 and Down at 02:00 + Grace period the next day", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createScheduled(browser, {
      cron: "0 2 * * *",
      timeZone: "UTC",
      grace: "30",
      graceUnit: "m",
    });
    clock.advance(2 * HOUR + 1 * MIN);
    await app.inject({ method: "GET", url: m.hb });
    expect(await stateOf(browser, m.page)).toBe("Up");

    // Next scheduled time: 2026-01-02 02:00, due by 02:30.
    clock.advance(DAY + 29 * MIN - SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Up");
    clock.advance(SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Down");
    // The Incident starts at the deadline, not when the checker noticed.
    expect((await browser.get(m.page)).body).toContain("2026-01-02 02:30:00");
  });

  it("counts a Heartbeat at 01:58 for the 02:00 scheduled time", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createScheduled(browser, {
      cron: "0 2 * * *",
      timeZone: "UTC",
      grace: "30",
      graceUnit: "m",
    });
    clock.advance(1 * HOUR + 58 * MIN);
    await app.inject({ method: "GET", url: m.hb });

    // It counts for today's 02:00: the next scheduled time is tomorrow's, due by 02:30.
    expect(await nextExpectedOnPage(browser, m.page)).toBe("2026-01-02 02:30");
    clock.advance(DAY + 32 * MIN - SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Up");
    clock.advance(SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Down");
  });

  it("counts a rerun after a missed scheduled time for that one, not the next", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createScheduled(browser, {
      cron: "0 2 * * *",
      timeZone: "UTC",
      grace: "30",
      graceUnit: "m",
    });
    clock.advance(2 * HOUR);
    await app.inject({ method: "GET", url: m.hb });
    // Friday 2026-01-02 02:00 is missed: Down at 02:30.
    clock.advance(DAY + 30 * MIN);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Down");
    // Rerun by hand at 16:00: Up, and Saturday's 02:00 Heartbeat is still expected.
    clock.advance(13 * HOUR + 30 * MIN);
    await app.inject({ method: "GET", url: m.hb });
    expect(await stateOf(browser, m.page)).toBe("Up");
    expect(await nextExpectedOnPage(browser, m.page)).toBe("2026-01-03 02:30");
    clock.advance(10 * HOUR + 30 * MIN - SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Up");
    clock.advance(SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Down");
    expect((await browser.get(m.page)).body).toContain("2026-01-03 02:30:00");
  });

  it("counts a rerun hours after a scheduled time for that one", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createScheduled(browser, {
      cron: "0 2 * * *",
      timeZone: "UTC",
      grace: "30",
      graceUnit: "m",
    });
    // A rerun at 10:00 of the 02:00 job counts for 02:00.
    clock.advance(10 * HOUR);
    await app.inject({ method: "GET", url: m.hb });
    expect(await nextExpectedOnPage(browser, m.page)).toBe("2026-01-02 02:30");
  });

  it("with no Grace period, waits for the next scheduled time after an on-time Heartbeat", async () => {
    const { app, browser, clock } = await loggedIn();
    const m = await createScheduled(browser, {
      cron: "0 2 * * *",
      timeZone: "UTC",
      grace: "0",
    });
    clock.advance(2 * HOUR + 30 * SEC);
    await app.inject({ method: "GET", url: m.hb });
    expect(await nextExpectedOnPage(browser, m.page)).toBe("2026-01-02 02:00");
    clock.advance(DAY - 30 * SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Down");
  });

  it("keeps a weekday job Up over the weekend", async () => {
    const { app, browser, clock } = await loggedIn();
    // Shortest gap 1 day: the default Grace period is 12 h.
    const m = await createScheduled(browser, {
      cron: "0 8 * * 1-5",
      timeZone: "UTC",
    });
    expect((await browser.get(m.page)).body).toContain("Grace period: 12 h");
    // Friday 2026-01-02 08:05.
    clock.advance(DAY + 8 * HOUR + 5 * MIN);
    await app.inject({ method: "GET", url: m.hb });

    expect(await nextExpectedOnPage(browser, m.page)).toBe("2026-01-05 20:00");
    // Until Monday 2026-01-05 08:00 + 12 h.
    clock.advance(3 * DAY + 11 * HOUR + 55 * MIN - SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Up");
    clock.advance(SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Down");
  });

  it("fires once a day in Europe/Warsaw across both DST changes", async () => {
    const { app, browser, clock } = await loggedIn("Europe/Warsaw");
    // Logs in again after a jump of months: the session would have expired.
    const jumpTo = async (utc: number) => {
      clock.advance(utc - clock.now().getTime());
      await login(app, "me@example.com", "correct horse", browser);
    };
    // Friday 2026-03-27 12:00 UTC; DST starts on Sunday 29 March.
    await jumpTo(Date.UTC(2026, 2, 27, 12));
    expect(await preview(browser, "0 2 * * *", "Europe/Warsaw")).toEqual({
      // 02:00 doesn't exist on 29 March: that scheduled time is at 03:00.
      times: ["2026-03-28 02:00", "2026-03-29 03:00", "2026-03-30 02:00"],
    });
    const m = await createScheduled(browser, {
      cron: "0 2 * * *",
      grace: "30",
      graceUnit: "m",
    });
    // The owner's time zone by default.
    expect((await browser.get(m.page)).body).toMatch(
      /Schedule: <code>0 2 \* \* \*<\/code>\s*\(Europe\/Warsaw\)/,
    );

    // Each day's scheduled time (01:00 UTC before, 00:00 UTC after the change) is the only one: the Monitor stays Up.
    for (const runUtc of [
      Date.UTC(2026, 2, 28, 1),
      Date.UTC(2026, 2, 29, 1),
      Date.UTC(2026, 2, 30, 0),
    ]) {
      clock.advance(runUtc + MIN - clock.now().getTime());
      await app.inject({ method: "GET", url: m.hb });
      await app.tick();
      expect(await stateOf(browser, m.page)).toBe("Up");
    }
    expect(await nextExpectedOnPage(browser, m.page)).toBe("2026-03-31 02:30");

    // DST ends on Sunday 25 October: 02:00 happens once, in summer time (00:00 UTC).
    await jumpTo(Date.UTC(2026, 9, 24, 0, 1));
    await app.inject({ method: "GET", url: m.hb });
    expect(await preview(browser, "0 2 * * *", "Europe/Warsaw")).toEqual({
      times: ["2026-10-25 02:00", "2026-10-26 02:00", "2026-10-27 02:00"],
    });
    clock.advance(Date.UTC(2026, 9, 25, 0, 1) - clock.now().getTime());
    await app.inject({ method: "GET", url: m.hb });
    // The repeated 02:00 hour in winter time is no second scheduled time.
    clock.advance(Date.UTC(2026, 9, 25, 1, 31) - clock.now().getTime());
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Up");
    expect(await nextExpectedOnPage(browser, m.page)).toBe("2026-10-26 02:30");
    // The 26 October scheduled time (01:00 UTC) is missed: Down at 01:30 UTC.
    clock.advance(Date.UTC(2026, 9, 26, 1, 30) - SEC - clock.now().getTime());
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Up");
    clock.advance(SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Down");
  });

  it("goes Down in the minute shown as next expected", async () => {
    const { app, browser, clock } = await loggedIn("Europe/Warsaw");
    const m = await createScheduled(browser, {
      cron: "15 */6 * * *",
      timeZone: "UTC",
      grace: "10",
      graceUnit: "m",
    });
    // New: the first scheduled time after creation, 00:15 UTC, + 10 min = 01:25 in Warsaw.
    expect(await nextExpectedOnPage(browser, m.page)).toBe("01:25");
    clock.advance(16 * MIN);
    await app.inject({ method: "GET", url: m.hb });
    // Next scheduled time 06:15 UTC + 10 min = 07:25 in Warsaw.
    expect(await nextExpectedOnPage(browser, m.page)).toBe("07:25");
    clock.advance(6 * HOUR + 9 * MIN - SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Up");
    clock.advance(SEC);
    await app.tick();
    expect(await stateOf(browser, m.page)).toBe("Down");
  });

  it("rejects invalid and too frequent expressions with a clear error", async () => {
    const { browser } = await loggedIn();
    const cases: Array<[string, string]> = [
      ["", "Schedule must have 5 fields"],
      ["0 2 * *", "Schedule must have 5 fields"],
      ["0 0 2 * * *", "Schedule must have 5 fields"],
      ["@daily", "Schedule must have 5 fields"],
      ["@reboot", "Schedule must have 5 fields"],
      ["0 0 L * *", "invalid day of month field: L"],
      ["0 0 15W * *", "invalid day of month field: 15W"],
      ["0 0 * * 5#2", "invalid day of week field: 5#2"],
      ["0 0 * * 5L", "invalid day of week field: 5L"],
      ["0 0 ? * *", "invalid day of month field: ?"],
      ["61 * * * *", "Schedule is not a valid cron expression"],
      ["0 0 * FOO *", "Schedule is not a valid cron expression"],
      ["0 0 30 2 *", "Schedule has no scheduled times."],
      [
        "* * * * *",
        "Schedule fires too often: its scheduled times must be at least 5 min apart, and some are 1 min apart.",
      ],
      ["0,2 * * * *", "some are 2 min apart"],
    ];
    for (const [cron, error] of cases) {
      const res = await browser.submit("/monitors/new", "/monitors", {
        name: "Bad",
        timing: "schedule",
        cron,
        timeZone: "UTC",
      });
      expect(res.statusCode, cron).toBe(400);
      expect(res.body, cron).toContain(error);
    }
    const res = await browser.submit("/monitors/new", "/monitors", {
      name: "Bad",
      timing: "schedule",
      cron: "0 2 * * *",
      timeZone: "Nowhere/Zone",
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("Unknown time zone.");
    expect((await browser.get("/")).body).not.toContain("Bad");
  });

  it("accepts ranges, lists, steps and names", async () => {
    const { browser } = await loggedIn();
    expect(
      await preview(browser, "30 8-18/5 * JAN,feb MON-FRI", "UTC"),
    ).toEqual({
      times: ["2026-01-01 08:30", "2026-01-01 13:30", "2026-01-01 18:30"],
    });
    // A restricted day of month and day of week match either, as in crontab.
    expect(await preview(browser, "0 0 3 * SUN", "UTC")).toEqual({
      times: ["2026-01-03 00:00", "2026-01-04 00:00", "2026-01-11 00:00"],
    });
    expect(await preview(browser, "* * * * *", "UTC")).toEqual({
      errors: [
        "Schedule fires too often: its scheduled times must be at least 5 min apart, and some are 1 min apart.",
      ],
    });
  });

  it("previews the next three scheduled times on the form, in the owner's time zone by default", async () => {
    const { browser } = await loggedIn("Europe/Warsaw");
    const form = (await browser.get("/monitors/new")).body;
    expect(form).toContain('<option value="Europe/Warsaw" selected');
    expect(form).toContain('id="schedule-preview"');
    expect(form).toMatch(
      /<script src="\/assets\/monitor-form\.js\?v=[^"]+" defer>/,
    );
    const js = await browser.get("/assets/monitor-form.js");
    expect(js.statusCode).toBe(200);
    expect(js.body).toContain("/monitors/schedule-preview");

    // Without JS: the preview shows when the form comes back.
    const res = await browser.submit("/monitors/new", "/monitors", {
      name: "",
      timing: "schedule",
      cron: "0 2 * * *",
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(
      /<li>2026-01-01 02:00<\/li>\s*<li>2026-01-02 02:00<\/li>\s*<li>2026-01-03 02:00<\/li>/,
    );
  });

  it("only previews for a logged-in User", async () => {
    const { app } = await loggedIn();
    const res = await app.inject({
      method: "GET",
      url: "/monitors/schedule-preview?cron=0+2+*+*+*&timeZone=UTC",
    });
    expect(res.statusCode).not.toBe(200);
  });

  it("switches between Interval and Schedule, keeping Incidents and Uptime", async () => {
    const { app, browser, clock } = await loggedIn();
    const created = await browser.submit("/monitors/new", "/monitors", {
      name: "Nightly backup",
      interval: "1",
      intervalUnit: "h",
      grace: "5",
      graceUnit: "m",
    });
    const page = created.headers.location as string;
    const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(
      (await browser.get(page)).body,
    )![1]!;
    await app.inject({ method: "GET", url: hb });
    clock.advance(65 * MIN);
    await app.tick();
    clock.advance(10 * MIN);
    await app.inject({ method: "GET", url: hb });
    const before = await onlyDashboardMonitor(browser);
    expect(before.uptime7dText).not.toBe("");

    const edit = await browser.submit(`${page}/edit`, `${page}/edit`, {
      name: "Nightly backup",
      timing: "schedule",
      cron: "0 2 * * *",
      timeZone: "UTC",
      grace: "30",
      graceUnit: "m",
    });
    expect(edit.statusCode).toBe(303);
    let body = (await browser.get(page)).body;
    expect(body).toContain("Schedule: <code>0 2 * * *</code>");
    expect(body).not.toContain("Interval:");
    expect(body).toContain("01:05:00"); // The Incident from the Interval days.
    expect((await onlyDashboardMonitor(browser)).uptime7dText).toBe(
      before.uptime7dText,
    );
    // 01:15 now; the Heartbeat for 02:00 is due by 02:30.
    expect(await nextExpectedOnPage(browser, page)).toBe("02:30");
    const editForm = (await browser.get(`${page}/edit`)).body;
    expect(editForm).toMatch(/value="schedule"\s+checked/);
    expect(editForm).toContain('value="0 2 * * *"');

    await browser.submit(`${page}/edit`, `${page}/edit`, {
      name: "Nightly backup",
      timing: "interval",
      interval: "2",
      intervalUnit: "h",
      grace: "5",
      graceUnit: "m",
      cron: "0 2 * * *",
    });
    body = (await browser.get(page)).body;
    expect(body).toContain("Interval: 2 h");
    expect(body).not.toContain("Schedule:");
    expect(body).toContain("01:05:00");
    // 01:15 + 2 h 5 min.
    expect(await nextExpectedOnPage(browser, page)).toBe("03:20");
  });

  it("uses the Schedule in the Monitor page cron examples", async () => {
    const { browser } = await loggedIn();
    const m = await createScheduled(browser, {
      cron: "0  2 * * 1-5",
      timeZone: "Europe/Warsaw",
    });
    const body = (await browser.get(m.page)).body;
    expect(body).toContain("# Times in Europe/Warsaw");
    expect(body).toMatch(/\n0 2 \* \* 1-5 \/path\/to\/job\.sh &amp;&amp; curl/);
    expect(body).toMatch(/\n0 2 \* \* 1-5 curl -fsS -m 10 https:\S+\/start;/);
    expect(body).not.toContain("*/5 * * * *");
  });
});

/** The form's Schedule preview, as `assets/monitor-form.js` asks for it. */
async function preview(
  browser: Browser,
  cron: string,
  timeZone: string,
): Promise<unknown> {
  const query = new URLSearchParams({ cron, timeZone });
  const res = await browser.get(`/monitors/schedule-preview?${query}`);
  expect(res.statusCode).toBe(200);
  return res.json();
}

/** The "Next expected by" time on a Monitor page, or undefined if not shown. */
async function nextExpectedOnPage(
  browser: Browser,
  page: string,
): Promise<string | undefined> {
  const body = (await browser.get(page)).body;
  return /Next expected by:\s*([^<]+?)\s*</.exec(body)?.[1];
}

async function onlyDashboardMonitor(
  browser: Browser,
): Promise<{ uptime7dText: string }> {
  const res = await browser.get("/dashboard.json");
  const { monitors } = res.json() as {
    monitors: Array<{ uptime7dText: string }>;
  };
  expect(monitors).toHaveLength(1);
  return monitors[0]!;
}
