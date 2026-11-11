import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  acceptTerms,
  acceptTermsFields,
  Browser,
  buildTestApp,
  createUser,
  login,
  restartApp,
  type TestContext,
} from "./helpers.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url));
const LEGAL_V1 = fixture("legal");
/** Terms bumped to 2027-01-15; the Privacy policy is unchanged. */
const LEGAL_V2 = fixture("legal-v2");
const PASSWORD = "correct horse";

/** A CLI-created User, who has accepted nothing, logged in. */
async function cliUser(
  options: { legalDir?: string } = { legalDir: LEGAL_V1 },
) {
  const ctx = await buildTestApp(options);
  await createUser(ctx.db, { email: "me@example.com", password: PASSWORD });
  const browser = await login(ctx.app, "me@example.com", PASSWORD);
  return { ...ctx, browser };
}

/** Submits the acceptance form on the last page `browser` loaded, after loading `page` for its CSRF token. */
const submitAcceptance = (browser: Browser, page: string) =>
  browser.submit(
    page,
    "/accept-terms",
    acceptTermsFields(browser.lastResponse.body),
  );

const fieldsOf = acceptTermsFields;

/** Restarts nodbeat with the Operator's files from `legalDir`. */
async function restartWith(ctx: TestContext, legalDir: string) {
  ctx.config.legalDir = legalDir;
  return restartApp(ctx);
}

async function createMonitor(
  browser: Browser,
): Promise<{ page: string; hb: string }> {
  const res = await browser.submit("/monitors/new", "/monitors", {
    name: "Nightly backup",
    interval: "60",
    intervalUnit: "s",
    grace: "30",
    graceUnit: "s",
  });
  const page = res.headers.location as string;
  const body = (await browser.get(page)).body;
  const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(body)![1]!;
  return { page, hb };
}

describe("re-accepting the Terms", () => {
  it("sends a User who accepted nothing to /accept-terms on their next page load", async () => {
    const { browser } = await cliUser();

    const res = await browser.get("/settings");

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/accept-terms?next=%2Fsettings");
  });

  it("shows each document's version and what changed, with a form to accept", async () => {
    const { browser } = await cliUser();

    const res = await browser.get("/accept-terms?next=%2Fsettings");

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("First fixture Terms.");
    expect(res.body).toContain("First fixture Privacy policy.");
    expect(res.body).toContain("2026-12-01");
    expect(res.body).toContain("2026-12-02");
    expect(res.body).toContain('href="/terms"');
    expect(res.body).toContain('href="/privacy"');
    expect(res.body).toMatch(/<form method="post" action="\/accept-terms">/);
    expect(res.body).toContain('name="_csrf"');
  });

  it("accepting records the versions and goes back to the original page", async () => {
    const { browser } = await cliUser();
    const first = await browser.get("/settings");
    await browser.get(first.headers.location as string);

    const res = await submitAcceptance(
      browser,
      first.headers.location as string,
    );

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/settings");
    expect((await browser.get("/settings")).statusCode).toBe(200);
  });

  it("accepting without the CSRF token changes nothing", async () => {
    const { browser } = await cliUser();
    await browser.get("/accept-terms");

    const res = await browser.submit(
      "/accept-terms",
      "/accept-terms",
      fieldsOf(browser.lastResponse.body),
      { csrf: null },
    );

    expect(res.statusCode).toBe(403);
    expect((await browser.get("/settings")).statusCode).toBe(303);
  });

  it("a bumped version sends the User back once, showing only what changed; Heartbeats still 200", async () => {
    const ctx = await cliUser();
    await acceptTerms(ctx.browser);
    const { page, hb } = await createMonitor(ctx.browser);

    const app = await restartWith(ctx, LEGAL_V2);
    const browser = new Browser(app);
    for (const [k, v] of ctx.browser.cookies) browser.cookies.set(k, v);

    const res = await browser.get(page);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(
      `/accept-terms?next=${encodeURIComponent(page)}`,
    );

    const heartbeat = await app.inject({ method: "GET", url: hb });
    expect(heartbeat.statusCode).toBe(200);

    const form = await browser.get(res.headers.location as string);
    expect(form.body).toContain(
      "Second fixture Terms, refunds within 14 days.",
    );
    expect(form.body).toContain("2027-01-15");
    expect(form.body).not.toContain("First fixture Privacy policy.");

    const accepted = await submitAcceptance(
      browser,
      res.headers.location as string,
    );
    expect(accepted.headers.location).toBe(page);
    const back = await browser.get(page);
    expect(back.statusCode).toBe(200);
    expect(back.body).toContain("Nightly backup");
  });

  it("Alerts still go out while the User has Terms to accept", async () => {
    const ctx = await cliUser();
    await acceptTerms(ctx.browser);
    await ctx.browser.submit("/settings", "/settings/webhooks", {
      name: "",
      url: "https://hooks.example/nodbeat",
      secret: "",
    });
    const { hb } = await createMonitor(ctx.browser);

    const app = await restartWith(ctx, LEGAL_V2);
    expect((await app.inject({ method: "GET", url: hb })).statusCode).toBe(200);
    ctx.clock.advance(91_000);
    await app.tick();

    const kinds = ctx.http.requests.map(
      (r) => (JSON.parse(r.body) as { kind: string }).kind,
    );
    expect(kinds).toEqual(["down"]);
  });

  it("records each accepted version and when, keeping an unchanged document's time", async () => {
    const ctx = await cliUser();
    await acceptTerms(ctx.browser);
    const firstAt = ctx.clock.now();
    ctx.clock.advance(60_000);

    const app = await restartWith(ctx, LEGAL_V2);
    const browser = new Browser(app);
    for (const [k, v] of ctx.browser.cookies) browser.cookies.set(k, v);
    await browser.get("/accept-terms");
    await submitAcceptance(browser, "/accept-terms");

    const user = await ctx.db
      .collection("users")
      .findOne({ email: "me@example.com" });
    expect(user!.accepted).toEqual({
      terms: { version: "2027-01-15", at: ctx.clock.now() },
      privacy: { version: "2026-12-02", at: firstAt },
    });
  });

  it("doesn't record a version the User wasn't shown", async () => {
    const ctx = await cliUser();
    await ctx.browser.get("/accept-terms");
    const shown = fieldsOf(ctx.browser.lastResponse.body);

    const app = await restartWith(ctx, LEGAL_V2);
    const browser = new Browser(app);
    for (const [k, v] of ctx.browser.cookies) browser.cookies.set(k, v);
    await browser.get("/terms"); // a CSRF token from the new instance
    const res = await browser.submit("/terms", "/accept-terms", shown);

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toMatch(/^\/accept-terms/);
    const user = await ctx.db
      .collection("users")
      .findOne({ email: "me@example.com" });
    expect(user!.accepted?.terms).toBeUndefined();
    expect(user!.accepted?.privacy.version).toBe("2026-12-02");
  });

  it("first login after this ships goes through /accept-terms and then to the Dashboard", async () => {
    const ctx = await buildTestApp({ legalDir: LEGAL_V1 });
    await createUser(ctx.db, { email: "me@example.com", password: PASSWORD });
    const browser = await login(ctx.app, "me@example.com", PASSWORD);
    expect(browser.lastResponse.headers.location).toBe("/");

    const dashboard = await browser.get("/");
    expect(dashboard.statusCode).toBe(303);
    expect(dashboard.headers.location).toBe("/accept-terms");

    await browser.get("/accept-terms");
    const res = await submitAcceptance(browser, "/accept-terms");
    expect(res.headers.location).toBe("/");
    expect((await browser.get("/")).body).toContain("me@example.com");
  });

  it("never blocks the Terms, Privacy policy, JSON, assets, docs, health or logout", async () => {
    const { browser, app } = await cliUser();

    for (const url of [
      "/terms",
      "/privacy",
      "/accept-terms",
      "/dashboard.json",
      "/assets/app.css",
      "/openapi.yaml",
      "/docs",
      "/health",
      "/monitors/schedule-preview?cron=0+2+*+*+*",
    ]) {
      const res = await browser.get(url);
      expect(res.statusCode, url).toBe(200);
    }
    expect((await browser.get("/no-such-page")).statusCode).toBe(404);

    const logout = await browser.submit("/accept-terms", "/logout");
    expect(logout.headers.location).toBe("/login");
    expect((await new Browser(app).get("/")).statusCode).toBe(200);
  });

  it("never blocks the Telegram webhook", async () => {
    const { app } = await cliUser();

    const res = await app.inject({
      method: "POST",
      url: "/telegram/webhook",
      headers: {
        "x-telegram-bot-api-secret-token": "test-webhook-secret",
        "content-type": "application/json",
      },
      payload: { update_id: 1 },
    });

    expect(res.statusCode).toBe(200);
  });

  it("goes back only to a path on this site", async () => {
    const { browser } = await cliUser();

    for (const next of [
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example/",
      "/\t/evil.example",
      "javascript:alert(1)",
    ]) {
      await browser.get(`/accept-terms?next=${encodeURIComponent(next)}`);
      const fields = fieldsOf(browser.lastResponse.body);
      expect(fields.next ?? "/", next).toBe("/");
    }
    // Even a hand-made POST can't redirect away.
    await browser.get("/accept-terms");
    const res = await browser.submit("/accept-terms", "/accept-terms", {
      ...fieldsOf(browser.lastResponse.body),
      next: "//evil.example/",
    });
    expect(res.headers.location).toBe("/");
  });

  it("anonymous visitors are sent to log in", async () => {
    const { app } = await buildTestApp({ legalDir: LEGAL_V1 });

    const res = await new Browser(app).get("/accept-terms");

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/login");
  });

  it("without the legal files nothing changes and /accept-terms doesn't exist", async () => {
    const { browser } = await cliUser({});

    expect((await browser.get("/settings")).statusCode).toBe(200);
    expect((await browser.get("/accept-terms")).statusCode).toBe(404);
  });
});
