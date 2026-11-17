import { describe, expect, it } from "vitest";
import { buildTestApp, createUser, login } from "./helpers.js";

describe("landing page", () => {
  it("is shown at / to a visitor without a session", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: "/" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("A heartbeat for every service and device");
    expect(res.body).toMatch(/<a href="\/login"[^>]*>Log in<\/a>/);
    expect(res.body).toContain('data-theme="system"');
  });

  it("explains how it works with a curl example of the instance's Heartbeat URL", async () => {
    const { app } = await buildTestApp();

    const body = (await app.inject({ method: "GET", url: "/" })).body;

    expect(body).toContain(
      "curl -fsS -m 10 --retry 3 https://nodbeat.test/hb/",
    );
    expect(body).toContain("Telegram");
  });

  it("previews the Dashboard, Incidents and a Telegram Alert, out of the tab order", async () => {
    const { app } = await buildTestApp();

    const body = (await app.inject({ method: "GET", url: "/" })).body;

    expect(body).toContain("What it looks like");
    expect(body.match(/class="preview-frame" inert/g)).toHaveLength(3);
    expect(body).toContain("Nightly database backup");
    expect(body).toContain('class="badge badge-down"');
    expect(body).toContain("Reminders");
    expect(body).toContain("reported a failure");
  });

  it("shows usage examples with the instance's Heartbeat URL and current features", async () => {
    const { app } = await buildTestApp();

    const body = (await app.inject({ method: "GET", url: "/" })).body;

    for (const example of [
      "cron",
      "systemd",
      "ESP32",
      "Start and Fail signals",
    ]) {
      expect(body).toContain(example);
    }
    expect(body).toContain("https://nodbeat.test/hb/&lt;token&gt;/fail");
    for (const feature of [
      "Schedule",
      "Max run time",
      "Reminders",
      "Webhooks",
      "ntfy",
    ]) {
      expect(body).toContain(feature);
    }
  });

  it("offers no sign-up", async () => {
    const { app } = await buildTestApp();

    const body = (await app.inject({ method: "GET", url: "/" })).body;

    expect(body).not.toMatch(/sign[ -]?up|register/i);
  });

  it("is replaced by the Dashboard for a logged-in User", async () => {
    const { app, db } = await buildTestApp();
    await createUser(db, {
      email: "me@example.com",
      password: "correct horse",
    });
    const browser = await login(app, "me@example.com", "correct horse");

    const res = await browser.get("/");

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<h1>Dashboard</h1>");
    expect(res.body).not.toContain("A heartbeat for every service and device");
  });
});
