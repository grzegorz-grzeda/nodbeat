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
const CANT_BE_USED = "This Invite can&#39;t be used";

async function withAdmin() {
  const ctx = await buildTestApp();
  await createUser(ctx.db, {
    email: "admin@example.com",
    password: PASSWORD,
    admin: true,
  });
  const admin = await login(ctx.app, "admin@example.com", PASSWORD);
  return { ...ctx, admin };
}

/** Creates an Invite as the Admin and returns its path, `/invite/<code>`. */
async function createInvite(admin: Browser, note = ""): Promise<string> {
  const res = await admin.submit("/admin/invites", "/admin/invites", { note });
  expect(res.statusCode).toBe(200);
  return /https:\/\/nodbeat\.test(\/invite\/[A-Za-z0-9_-]{43})/.exec(
    res.body,
  )![1]!;
}

let nextIp = 1;
/** A fresh visitor from its own IP, so the per-IP limit doesn't carry over between steps. */
const visitor = (ctx: TestContext) =>
  new Browser(ctx.app, `198.51.100.${nextIp++}`);

const accept = (
  browser: Browser,
  invite: string,
  fields: Partial<Record<"email" | "password" | "timeZone", string>> = {},
) =>
  browser.submit(invite, invite, {
    email: "new@example.com",
    password: "new password",
    timeZone: "America/New_York",
    ...fields,
  });

describe("Invites", () => {
  it("let an invited person create a User, log in and start using nodbeat", async () => {
    const ctx = await withAdmin();
    const invite = await createInvite(ctx.admin, "for Marek");

    const browser = visitor(ctx);
    const form = await browser.get(invite);
    expect(form.statusCode).toBe(200);
    expect(form.body).toContain('name="email"');
    expect(form.body).toContain('name="timeZone"');

    const res = await accept(browser, invite);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe("/");

    const dashboard = await browser.get("/");
    expect(dashboard.body).toContain("new@example.com");
    expect(dashboard.body).toContain('action="/logout"');
    const created = await browser.submit("/monitors/new", "/monitors", {
      name: "Garden sensor",
      interval: "60",
      intervalUnit: "s",
      grace: "",
      graceUnit: "s",
    });
    expect(created.statusCode).toBe(303);
    expect((await browser.get("/admin")).statusCode).toBe(404);
    expect((await browser.get("/settings")).body).toContain(
      'value="America/New_York" selected',
    );

    // The new User can log in with the password they chose.
    const again = await login(ctx.app, "new@example.com", "new password");
    expect((await again.get("/")).body).toContain("new@example.com");
  });

  it("work only once", async () => {
    const ctx = await withAdmin();
    const invite = await createInvite(ctx.admin);
    const other = visitor(ctx);
    await other.get(invite); // Has the form open while the first person accepts.
    await accept(visitor(ctx), invite);

    const page = await other.get(invite);
    expect(page.body).toContain(CANT_BE_USED);
    expect(page.body).not.toContain('name="password"');
    // Posts with the CSRF token from the form opened earlier.
    const res = await accept(other, invite, { email: "second@example.com" });
    expect(res.body).toContain(CANT_BE_USED);
    expect(
      (await login(ctx.app, "second@example.com", "new password")).cookies.has(
        "nb_session",
      ),
    ).toBe(false);
  });

  it("expire after 7 days", async () => {
    const ctx = await withAdmin();
    const invite = await createInvite(ctx.admin);
    ctx.clock.advance(7 * DAY);

    const browser = visitor(ctx);
    expect((await browser.get(invite)).body).toContain(CANT_BE_USED);
  });

  it("show 'can't be used' for an unknown code", async () => {
    const ctx = await withAdmin();
    const page = await visitor(ctx).get(`/invite/${"A".repeat(43)}`);
    expect(page.body).toContain(CANT_BE_USED);
  });

  it("keep working after a failed attempt", async () => {
    const ctx = await withAdmin();
    const invite = await createInvite(ctx.admin);
    const browser = visitor(ctx);

    const taken = await accept(browser, invite, {
      email: "admin@example.com",
    });
    expect(taken.statusCode).toBe(400);
    expect(taken.body).toContain("already exists");
    expect(taken.body).toContain('name="password"');

    const short = await accept(browser, invite, { password: "short" });
    expect(short.statusCode).toBe(400);
    expect(short.body).toContain("at least 8 characters");

    const res = await accept(browser, invite);
    expect(res.statusCode).toBe(303);
  });

  it("create only one User from parallel accepts", async () => {
    const ctx = await withAdmin();
    const invite = await createInvite(ctx.admin);
    const a = visitor(ctx);
    const b = visitor(ctx);
    await Promise.all([a.get(invite), b.get(invite)]);

    const results = await Promise.all([
      accept(a, invite, { email: "a@example.com" }),
      accept(b, invite, { email: "b@example.com" }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([303, 404]);
    const users = await ctx.db
      .collection("users")
      .countDocuments({ email: { $in: ["a@example.com", "b@example.com"] } });
    expect(users).toBe(1);
  });

  it("can't be created or listed by anyone but the Admin", async () => {
    const ctx = await withAdmin();
    await createUser(ctx.db, { email: "you@example.com", password: PASSWORD });
    const user = await login(ctx.app, "you@example.com", PASSWORD);

    expect((await user.get("/admin/invites")).statusCode).toBe(404);
    expect((await visitor(ctx).get("/admin/invites")).statusCode).toBe(404);
    const res = await user.submit("/", "/admin/invites", { note: "x" });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("/invite/");
  });

  it("are linked from the Admin page", async () => {
    const ctx = await withAdmin();
    expect((await ctx.admin.get("/admin")).body).toContain(
      'href="/admin/invites"',
    );
  });

  it("limit each IP to 10 requests per 15 minutes", async () => {
    const ctx = await withAdmin();
    const invite = await createInvite(ctx.admin);
    const browser = visitor(ctx);

    for (let i = 0; i < 10; i++) {
      expect((await browser.get(invite)).statusCode).toBe(200);
    }
    expect((await browser.get(invite)).statusCode).toBe(429);
    const post = await accept(browser, invite);
    expect(post.statusCode).toBe(429);
    expect((await visitor(ctx).get(invite)).statusCode).toBe(200);
  });

  it("need the form's CSRF token", async () => {
    const ctx = await withAdmin();
    const invite = await createInvite(ctx.admin);
    const res = await visitor(ctx).submit(
      invite,
      invite,
      { email: "new@example.com", password: "new password" },
      { csrf: null },
    );
    expect(res.statusCode).toBe(403);
  });

  it("are mentioned on the landing page, with no sign-up link", async () => {
    const ctx = await withAdmin();
    const landing = await visitor(ctx).get("/");
    expect(landing.body).toContain("nodbeat is invite-only for now");
    expect(landing.body).not.toMatch(/sign[ -]?up|register/i);
  });

  describe("list", () => {
    /** The Invite list's rows as [note, created, expires, status]. */
    async function rows(admin: Browser): Promise<string[][]> {
      const body = (await admin.get("/admin/invites")).body;
      const table = /<table[\s\S]*?<\/table>/.exec(body)?.[0] ?? "";
      return [...table.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
        .slice(1) // Header row.
        .map((r) =>
          [...r[1]!.matchAll(/<td>([\s\S]*?)<\/td>/g)].slice(0, 4).map((c) =>
            c[1]!
              .replace(/<[^>]+>/g, "")
              .replace(/\s+/g, " ")
              .trim(),
          ),
        );
    }

    /** The revoke path of the Invite whose row has this note. */
    async function revokePath(admin: Browser, note: string): Promise<string> {
      const body = (await admin.get("/admin/invites")).body;
      const row = [...body.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].find((r) =>
        r[1]!.includes(note),
      )![1]!;
      return /href="(\/admin\/invites\/[0-9a-f]{64}\/revoke)"/.exec(row)![1]!;
    }

    it("shows every Invite's status, newest first, in the Admin's time zone", async () => {
      const ctx = await withAdmin(); // Europe/Warsaw: UTC+1 in January.
      await createInvite(ctx.admin, "expired one");
      ctx.clock.advance(8 * DAY);
      const used = await createInvite(ctx.admin, "used one");
      ctx.clock.advance(1000);
      await createInvite(ctx.admin, "revoked one");
      ctx.clock.advance(1000);
      await createInvite(ctx.admin, "pending one");
      ctx.clock.advance(1000);
      await accept(visitor(ctx), used);
      const revoke = await revokePath(ctx.admin, "revoked one");
      await ctx.admin.submit(revoke, revoke);

      expect(await rows(ctx.admin)).toEqual([
        [
          "pending one",
          "2026-01-09 01:00:02",
          "2026-01-16 01:00:02",
          "pending",
        ],
        [
          "revoked one",
          "2026-01-09 01:00:01",
          "2026-01-16 01:00:01",
          "revoked",
        ],
        [
          "used one",
          "2026-01-09 01:00:00",
          "2026-01-16 01:00:00",
          "used by new@example.com at 2026-01-09 01:00:03",
        ],
        [
          "expired one",
          "2026-01-01 01:00:00",
          "2026-01-08 01:00:00",
          "expired",
        ],
      ]);
    });

    it("lets the Admin revoke a pending Invite after confirming", async () => {
      const ctx = await withAdmin();
      const invite = await createInvite(ctx.admin, "for Marek");
      const revoke = await revokePath(ctx.admin, "for Marek");

      const confirm = await ctx.admin.get(revoke);
      expect(confirm.statusCode).toBe(200);
      expect(confirm.body).toContain(`action="${revoke}"`);
      expect((await rows(ctx.admin))[0]![3]).toBe("pending");

      const res = await ctx.admin.submit(revoke, revoke);
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe("/admin/invites");
      const list = await ctx.admin.get("/admin/invites");
      expect(list.body).toContain("Invite revoked.");
      expect((await rows(ctx.admin))[0]![3]).toBe("revoked");
      expect((await visitor(ctx).get(invite)).body).toContain(CANT_BE_USED);
    });

    it("leaves a used Invite unchanged when asked to revoke it", async () => {
      const ctx = await withAdmin();
      const invite = await createInvite(ctx.admin, "for Marek");
      const revoke = await revokePath(ctx.admin, "for Marek");
      await ctx.admin.get(revoke); // The Admin opens the confirmation...
      await accept(visitor(ctx), invite); // ...while the Invite gets used.

      const res = await ctx.admin.submit(revoke, revoke);
      expect(res.statusCode).toBe(303);
      expect(res.headers.location).toBe("/admin/invites");
      const status = (await rows(ctx.admin))[0]![3]!;
      expect(status).toMatch(/^used by new@example\.com at /);
      expect((await ctx.admin.get(revoke)).headers.location).toBe(
        "/admin/invites",
      );
    });

    it("can't be revoked by anyone but the Admin", async () => {
      const ctx = await withAdmin();
      const invite = await createInvite(ctx.admin, "for Marek");
      const revoke = await revokePath(ctx.admin, "for Marek");
      await createUser(ctx.db, {
        email: "you@example.com",
        password: PASSWORD,
      });
      const user = await login(ctx.app, "you@example.com", PASSWORD);

      expect((await user.get(revoke)).statusCode).toBe(404);
      expect((await user.submit("/", revoke)).statusCode).toBe(404);
      expect((await visitor(ctx).get(invite)).statusCode).toBe(200);
    });
  });
});
