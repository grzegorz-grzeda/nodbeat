import { describe, expect, it } from "vitest";
import {
  buildTestApp,
  createUser,
  login,
  stateOf,
  type Browser,
  type TestContext,
} from "./helpers.js";

const SEC = 1000;
const DAY = 24 * 60 * 60 * SEC;
const EMAIL = "me@example.com";
const PASSWORD = "correct horse";

/** A User on an instance with Plans on: Pro for a day when `pro`, else Free. */
async function withPlan(pro: boolean) {
  const ctx = await buildTestApp({ plansEnabled: true });
  await createUser(ctx.db, { email: EMAIL, password: PASSWORD });
  if (pro) {
    const proUntil = new Date(ctx.clock.now().getTime() + DAY);
    await setProUntil(ctx, proUntil);
  }
  const browser = await login(ctx.app, EMAIL, PASSWORD);
  return { ...ctx, browser };
}

const setProUntil = (ctx: TestContext, proUntil: Date) =>
  ctx.db
    .collection("users")
    .updateOne(
      { email: EMAIL },
      { $set: { plan: { proUntil, source: "comp", proEndedAt: null } } },
    );

/** Pro ends now. */
const endPro = (ctx: TestContext) => setProUntil(ctx, ctx.clock.now());

const fields = (name: string, parentId: string) => ({
  name,
  interval: "60",
  intervalUnit: "s",
  grace: "30",
  graceUnit: "s",
  parentId,
});

async function createMonitor(browser: Browser, name: string, parentId = "") {
  const res = await browser.submit(
    "/monitors/new",
    "/monitors",
    fields(name, parentId),
  );
  expect(res.statusCode).toBe(303);
  const page = res.headers.location as string;
  const body = (await browser.get(page)).body;
  const hb = /https:\/\/nodbeat\.test(\/hb\/[A-Za-z0-9_-]+)/.exec(body)![1]!;
  return { page, id: page.split("/").pop()!, hb };
}

const beat = (ctx: TestContext, hb: string) =>
  ctx.app.inject({ method: "GET", url: hb });

describe("Parents on Free", () => {
  it("refuses a Parent with Needs Pro, and the form says so", async () => {
    const ctx = await withPlan(false);
    const router = await createMonitor(ctx.browser, "Router");
    expect((await ctx.browser.get("/monitors/new")).body).toContain(
      "Depends on needs Pro",
    );
    const res = await ctx.browser.submit(
      "/monitors/new",
      "/monitors",
      fields("Pi", router.id),
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("Depends on needs Pro.");
  });

  it("keeps a Parent set on Pro through edits that don't change it, but ignores it", async () => {
    const ctx = await withPlan(true);
    expect((await ctx.browser.get("/monitors/new")).body).not.toContain(
      "Depends on needs Pro",
    );
    const router = await createMonitor(ctx.browser, "Router");
    const nas = await createMonitor(ctx.browser, "NAS");
    const pi = await createMonitor(ctx.browser, "Pi", router.id);
    await endPro(ctx);

    const edit = `${pi.page}/edit`;
    const rename = await ctx.browser.submit(
      edit,
      edit,
      fields("Raspberry Pi", router.id),
    );
    expect(rename.statusCode).toBe(303);
    expect((await ctx.browser.get(pi.page)).body).toContain(
      "ignored: Depends on needs Pro",
    );
    const other = await ctx.browser.submit(
      edit,
      edit,
      fields("Raspberry Pi", nas.id),
    );
    expect(other.statusCode).toBe(400);
    expect(other.body).toContain("Depends on needs Pro.");
    expect(
      (await ctx.browser.submit(edit, edit, fields("Raspberry Pi", "")))
        .statusCode,
    ).toBe(303);

    // The kept Parent works again with Pro back.
    await setProUntil(ctx, new Date(ctx.clock.now().getTime() + DAY));
    expect(
      (await ctx.browser.submit(edit, edit, fields("Raspberry Pi", router.id)))
        .statusCode,
    ).toBe(303);
  });

  it("treats a kept Parent as none: the Child goes Down on its own", async () => {
    const ctx = await withPlan(true);
    const router = await createMonitor(ctx.browser, "Router");
    const pi = await createMonitor(ctx.browser, "Pi", router.id);
    await endPro(ctx);
    await beat(ctx, router.hb);
    await beat(ctx, pi.hb);
    ctx.clock.advance(91 * SEC);
    await ctx.app.tick();
    expect(await stateOf(ctx.browser, pi.page)).toBe("Down");
  });

  it("gives Unreachable Children a fresh deadline when Pro ends", async () => {
    const ctx = await withPlan(true);
    const router = await createMonitor(ctx.browser, "Router");
    const pi = await createMonitor(ctx.browser, "Pi", router.id);
    await beat(ctx, router.hb);
    await beat(ctx, pi.hb);
    ctx.clock.advance(91 * SEC);
    await ctx.app.tick();
    expect(await stateOf(ctx.browser, pi.page)).toBe("Unreachable");

    await endPro(ctx);
    await ctx.app.tick();
    expect(await stateOf(ctx.browser, pi.page)).toBe("Unreachable");
    ctx.clock.advance(91 * SEC);
    await ctx.app.tick();
    expect(await stateOf(ctx.browser, pi.page)).toBe("Down");
  });
});
