import { describe, expect, it } from "vitest";
import {
  Browser,
  buildTestApp,
  createUser,
  login,
  type TestContext,
} from "./helpers.js";

const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = "correct horse";
const THANKS = "Thanks! If there&#39;s room, an Invite will reach";

async function withAdmin(options: { inviteRequests?: boolean } = {}) {
  const ctx = await buildTestApp({ inviteRequests: true, ...options });
  await createUser(ctx.db, {
    email: "admin@example.com",
    password: PASSWORD,
    admin: true,
  });
  const admin = await login(ctx.app, "admin@example.com", PASSWORD);
  return { ...ctx, admin };
}

let nextIp = 1;
/** A visitor from an IP of its own, so the per-IP limit doesn't carry over between requests. */
const visitor = (ctx: TestContext) =>
  new Browser(ctx.app, `198.51.100.${String(nextIp++ % 250)}`);

async function request(
  browser: Browser,
  fields: Record<string, string>,
): Promise<Awaited<ReturnType<Browser["submit"]>>> {
  return browser.submit("/", "/invite-requests", fields);
}

const invitesPage = async (admin: Browser) =>
  (await admin.get("/admin/invites")).body;

describe("Invite requests", () => {
  it("are off by default: no form, no route", async () => {
    const ctx = await buildTestApp();

    const landing = (await ctx.app.inject({ method: "GET", url: "/" })).body;
    const res = await request(visitor(ctx), { email: "a@example.com" });

    expect(landing).toContain("invite-only");
    expect(landing).not.toContain('action="/invite-requests"');
    expect(res.statusCode).toBe(404);
  });

  it("shows a form on the landing page that says how the email is used", async () => {
    const ctx = await withAdmin();

    const body = (await visitor(ctx).get("/")).body;

    expect(body).toContain('action="/invite-requests"');
    expect(body).toContain("Request an Invite");
    expect(body).toMatch(/deleted once it's\s+handled or after 30\s+days/);
  });

  it("lists a request on the Admin's Invites page", async () => {
    const ctx = await withAdmin();

    const res = await request(visitor(ctx), {
      email: " Ola@Example.com ",
      note: "home lab, 5 Raspberry Pis",
    });

    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/");
    const landing = await visitor(ctx).get("/");
    expect(landing.body).not.toContain(THANKS);
    const page = await invitesPage(ctx.admin);
    expect(page).toContain("Invite requests");
    expect(page).toContain("ola@example.com");
    expect(page).toContain("home lab, 5 Raspberry Pis");
    expect((await ctx.admin.get("/admin")).body).toContain(
      "Invites (1 request)",
    );
  });

  it("thanks the visitor after a request", async () => {
    const ctx = await withAdmin();
    const browser = visitor(ctx);

    await request(browser, { email: "ola@example.com" });
    const res = await browser.get("/");

    expect(res.body).toContain(THANKS);
  });

  it("keeps one request per email, with the newest note", async () => {
    const ctx = await withAdmin();

    await request(visitor(ctx), { email: "ola@example.com", note: "first" });
    await request(visitor(ctx), { email: "OLA@example.com", note: "second" });

    const page = await invitesPage(ctx.admin);
    expect(page.match(/ola@example\.com/g)).toHaveLength(1);
    expect(page).toContain("second");
    expect(page).not.toContain(">first<");
  });

  it("stores nothing for an existing User's email or a filled honeypot, but says the same", async () => {
    const ctx = await withAdmin();
    await createUser(ctx.db, { email: "user@example.com", password: PASSWORD });

    const known = visitor(ctx);
    const bot = visitor(ctx);
    const r1 = await request(known, { email: "user@example.com" });
    const r2 = await request(bot, {
      email: "bot@example.com",
      website: "http://spam.example",
    });

    expect(r1.statusCode).toBe(303);
    expect(r2.statusCode).toBe(303);
    expect((await known.get("/")).body).toContain(THANKS);
    expect((await bot.get("/")).body).toContain(THANKS);
    expect(await ctx.db.collection("inviteRequests").countDocuments()).toBe(0);
  });

  it("refuses an invalid email or a too-long note with the form again", async () => {
    const ctx = await withAdmin();

    const bad = await request(visitor(ctx), { email: "not-an-email" });
    const long = await request(visitor(ctx), {
      email: "ola@example.com",
      note: "x".repeat(501),
    });

    expect(bad.statusCode).toBe(400);
    expect(bad.body).toContain("Enter a valid email");
    expect(bad.body).toContain('action="/invite-requests"');
    expect(long.statusCode).toBe(400);
    expect(await ctx.db.collection("inviteRequests").countDocuments()).toBe(0);
  });

  it("refuses a request without a CSRF token", async () => {
    const ctx = await withAdmin();

    const res = await visitor(ctx).submit(
      "/",
      "/invite-requests",
      { email: "ola@example.com" },
      { csrf: null },
    );

    expect(res.statusCode).toBe(403);
  });

  it("allows 3 requests per IP per hour", async () => {
    const ctx = await withAdmin();
    const browser = visitor(ctx);

    for (const n of [1, 2, 3]) {
      const res = await request(browser, {
        email: `p${String(n)}@example.com`,
      });
      expect(res.statusCode).toBe(303);
    }
    const fourth = await request(browser, { email: "p4@example.com" });
    ctx.clock.advance(60 * 60 * 1000 + 1);
    const later = await request(browser, { email: "p5@example.com" });

    expect(fourth.statusCode).toBe(429);
    expect(later.statusCode).toBe(303);
  });

  it("stops taking requests at 200 pending", async () => {
    const ctx = await withAdmin();
    const now = ctx.clock.now();
    await ctx.db.collection("inviteRequests").insertMany(
      Array.from({ length: 200 }, (_, i) => ({
        email: `seed${String(i)}@example.com`,
        note: "",
        createdAt: now,
        expiresAt: new Date(now.getTime() + 30 * DAY),
      })),
    );

    const res = await request(visitor(ctx), { email: "ola@example.com" });

    expect(res.statusCode).toBe(503);
    expect(res.body).toContain("not taking Invite requests right now");
  });

  it("creates an Invite for a request, offers it by email and removes the request", async () => {
    const ctx = await withAdmin();
    await request(visitor(ctx), { email: "ola@example.com" });
    await invitesPage(ctx.admin);
    const id = /\/admin\/invite-requests\/([0-9a-f]{24})\/invite/.exec(
      ctx.admin.lastResponse.body,
    )![1]!;

    const res = await ctx.admin.submit(
      "/admin/invites",
      `/admin/invite-requests/${id}/invite`,
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Invite created");
    const link = /https:\/\/nodbeat\.test(\/invite\/[A-Za-z0-9_-]{43})/.exec(
      res.body,
    )![1]!;
    expect(res.body).toContain('href="mailto:ola@example.com?subject=');
    expect(res.body).toContain(
      encodeURIComponent(`https://nodbeat.test${link}`),
    );
    expect((await visitor(ctx).get(link)).statusCode).toBe(200);
    const page = await invitesPage(ctx.admin);
    expect(page).not.toContain(`/admin/invite-requests/${id}/`);
    // The Invite itself is noted with the email.
    expect(page).toContain("ola@example.com");
  });

  it("dismisses a request", async () => {
    const ctx = await withAdmin();
    await request(visitor(ctx), { email: "ola@example.com" });
    await invitesPage(ctx.admin);
    const id = /\/admin\/invite-requests\/([0-9a-f]{24})\/dismiss/.exec(
      ctx.admin.lastResponse.body,
    )![1]!;

    const res = await ctx.admin.submit(
      "/admin/invites",
      `/admin/invite-requests/${id}/dismiss`,
    );

    expect(res.statusCode).toBe(303);
    const page = await invitesPage(ctx.admin);
    expect(page).toContain("Invite request dismissed.");
    expect(page).not.toContain("ola@example.com");
  });

  it("drops a request after 30 days", async () => {
    const ctx = await withAdmin();
    await request(visitor(ctx), { email: "ola@example.com" });

    ctx.clock.advance(30 * DAY + 1);

    expect(await invitesPage(ctx.admin)).not.toContain("ola@example.com");
  });

  it("keeps the Admin routes for Admins", async () => {
    const ctx = await withAdmin();
    await request(visitor(ctx), { email: "ola@example.com" });
    const doc = await ctx.db.collection("inviteRequests").findOne();
    await createUser(ctx.db, { email: "user@example.com", password: PASSWORD });
    const user = await login(ctx.app, "user@example.com", PASSWORD);

    const res = await user.submit(
      "/",
      `/admin/invite-requests/${String(doc!._id)}/dismiss`,
    );

    expect(res.statusCode).toBe(404);
    expect(await ctx.db.collection("inviteRequests").countDocuments()).toBe(1);
  });
});
