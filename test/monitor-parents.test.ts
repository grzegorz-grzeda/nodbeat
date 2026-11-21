import { describe, expect, it } from "vitest";
import { monitors } from "../src/monitors.js";
import { buildTestApp, createUser, login, type Browser } from "./helpers.js";

async function loggedIn(email = "me@example.com") {
  const ctx = await buildTestApp();
  await createUser(ctx.db, { email, password: "correct horse" });
  const browser = await login(ctx.app, email, "correct horse");
  return { ...ctx, browser };
}

const fields = (name: string, parentId = "") => ({
  name,
  interval: "60",
  intervalUnit: "s",
  parentId,
});

/** Creates a Monitor and returns its page path and id. */
async function createMonitor(
  browser: Browser,
  name: string,
  parentId = "",
): Promise<{ page: string; id: string }> {
  const res = await browser.submit(
    "/monitors/new",
    "/monitors",
    fields(name, parentId),
  );
  expect(res.statusCode).toBe(303);
  const page = res.headers.location as string;
  return { page, id: page.split("/").pop()! };
}

describe("Monitor Parents", () => {
  it("sets a Parent on create and shows it on both Monitor pages", async () => {
    const { browser } = await loggedIn();
    const router = await createMonitor(browser, "Router");
    const pi = await createMonitor(browser, "Pi", router.id);

    const piPage = (await browser.get(pi.page)).body;
    expect(piPage).toContain("Depends on:");
    expect(piPage).toMatch(new RegExp(`href="${router.page}"\\s*>\\s*Router`));

    const routerPage = (await browser.get(router.page)).body;
    expect(routerPage).toContain("Depended on by:");
    expect(routerPage).toMatch(new RegExp(`href="${pi.page}"\\s*>\\s*Pi`));
    expect(routerPage).not.toContain("Depends on:");
  });

  it("offers the owner's other Monitors and keeps the choice on edit", async () => {
    const { browser } = await loggedIn();
    const router = await createMonitor(browser, "Router");
    const pi = await createMonitor(browser, "Pi", router.id);

    const form = (await browser.get(`${pi.page}/edit`)).body;
    expect(form).toMatch(
      new RegExp(`value="${router.id}"\\s+selected\\s*>\\s*Router`),
    );
    expect(form).not.toContain(`value="${pi.id}"`);

    // Saving without a Parent clears it.
    await browser.submit(`${pi.page}/edit`, `${pi.page}/edit`, fields("Pi"));
    expect((await browser.get(pi.page)).body).not.toContain("Depends on:");
  });

  it("refuses a cycle and doesn't offer Monitors that would close one", async () => {
    const { browser, db } = await loggedIn();
    const fibre = await createMonitor(browser, "Fibre");
    const router = await createMonitor(browser, "Router", fibre.id);
    const pi = await createMonitor(browser, "Pi", router.id);

    const form = (await browser.get(`${fibre.page}/edit`)).body;
    expect(form).not.toContain(`value="${router.id}"`);
    expect(form).not.toContain(`value="${pi.id}"`);

    const res = await browser.submit(
      `${fibre.page}/edit`,
      `${fibre.page}/edit`,
      fields("Fibre", pi.id),
    );
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain(
      "Pi depends on this Monitor, so this Monitor can&#39;t depend on it.",
    );

    const self = await browser.submit(
      `${fibre.page}/edit`,
      `${fibre.page}/edit`,
      fields("Fibre", fibre.id),
    );
    expect(self.statusCode).toBe(400);
    expect(self.body).toContain("A Monitor can&#39;t depend on itself.");
    const saved = await monitors(db).findOne({ name: "Fibre" });
    expect(saved!.parentId).toBeNull();
  });

  it("refuses another User's Monitor or a malformed id", async () => {
    const { app, db, browser } = await loggedIn();
    await createUser(db, { email: "other@example.com", password: "pw pw pw" });
    const other = await login(app, "other@example.com", "pw pw pw");
    const theirs = await createMonitor(other, "Their router");

    for (const parentId of [theirs.id, "nope"]) {
      const res = await browser.submit(
        "/monitors/new",
        "/monitors",
        fields("Pi", parentId),
      );
      expect(res.statusCode).toBe(400);
      expect(res.body).toContain(
        "Choose one of your own Monitors to depend on.",
      );
    }
    expect(await monitors(db).countDocuments({ name: "Pi" })).toBe(0);
  });

  it("detaches Children when their Parent is deleted", async () => {
    const { browser, db } = await loggedIn();
    const router = await createMonitor(browser, "Router");
    const pi = await createMonitor(browser, "Pi", router.id);

    await browser.submit(`${router.page}/delete`, `${router.page}/delete`);

    expect((await monitors(db).findOne({ name: "Pi" }))!.parentId).toBeNull();
    expect((await browser.get(pi.page)).body).not.toContain("Depends on:");
  });
});
