import { describe, expect, it } from "vitest";
import { Browser, buildTestApp, createUser, login } from "./helpers.js";

/** The heading and message of the shared error page, or null when the body isn't one. */
function errorPage(body: string): { status: string; title: string } | null {
  const match =
    /<p class="muted">Error (\d+)<\/p>\s*<h1>([^<]+)<\/h1>\s*<p class="error">/.exec(
      body,
    );
  return match ? { status: match[1]!, title: match[2]! } : null;
}

describe("error pages", () => {
  it("answers an unknown URL with the 404 page in the app shell", async () => {
    const { app } = await buildTestApp();

    const res = await new Browser(app).get("/no/such/page");

    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(errorPage(res.body)).toEqual({
      status: "404",
      title: "Page not found",
    });
    expect(res.body).toContain("Go to the home page");
    expect(res.headers["content-security-policy"]).toBeDefined();
  });

  it("shows the logged-in User the nav and a way back to the Dashboard", async () => {
    const { app, db } = await buildTestApp();
    await createUser(db, {
      email: "me@example.com",
      password: "correct horse",
    });
    const browser = await login(app, "me@example.com", "correct horse");

    const res = await browser.get("/no/such/page");

    expect(res.statusCode).toBe(404);
    expect(res.body).toContain("me@example.com");
    expect(res.body).toContain("Back to the Dashboard");
  });

  it("uses the same page for a missing Monitor, asset and docs file", async () => {
    const { app, db } = await buildTestApp();
    await createUser(db, {
      email: "me@example.com",
      password: "correct horse",
    });
    const browser = await login(app, "me@example.com", "correct horse");

    for (const url of [
      "/monitors/000000000000000000000000",
      "/assets/nope.css",
      "/docs/nope.js",
    ]) {
      const res = await browser.get(url);
      expect(res.statusCode, url).toBe(404);
      expect(errorPage(res.body)?.status, url).toBe("404");
    }
    expect(
      (await browser.get("/monitors/000000000000000000000000")).body,
    ).toContain("No such Monitor.");
  });

  it("uses the same page for a bad form value and an expired form", async () => {
    const { app, db } = await buildTestApp();
    await createUser(db, {
      email: "me@example.com",
      password: "correct horse",
    });
    const browser = await login(app, "me@example.com", "correct horse");

    const bad = await browser.submit("/settings", "/settings/time-zone", {
      timeZone: "Mars/Olympus",
    });
    expect(bad.statusCode).toBe(400);
    expect(errorPage(bad.body)?.title).toBe("Bad request");
    expect(bad.body).toContain("Unknown time zone.");

    const expired = await browser.submit(
      "/settings",
      "/settings/time-zone",
      { timeZone: "Europe/Warsaw" },
      { csrf: "forged" },
    );
    expect(expired.statusCode).toBe(403);
    expect(errorPage(expired.body)?.title).toBe("Expired form");
  });

  it("answers JSON to a request that asks for JSON", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({
      method: "GET",
      url: "/no/such/page",
      headers: { accept: "application/json" },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "There's nothing at this address." });
  });

  it("keeps plain text on Heartbeat URLs", async () => {
    const { app } = await buildTestApp();

    const unknownToken = await app.inject({ method: "GET", url: "/hb/nope" });
    const wrongMethod = await app.inject({ method: "PUT", url: "/hb/nope" });

    for (const res of [unknownToken, wrongMethod]) {
      expect(res.statusCode).toBe(404);
      expect(res.headers["content-type"]).toContain("text/plain");
      expect(res.body).toBe("Not Found");
    }
  });
});
