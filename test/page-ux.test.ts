import { describe, expect, it } from "vitest";
import { buildTestApp, createUser, login, type Browser } from "./helpers.js";

async function loggedIn(email = "me@example.com") {
  const ctx = await buildTestApp();
  await createUser(ctx.db, { email, password: "correct horse" });
  const browser = await login(ctx.app, email, "correct horse");
  return { ...ctx, browser };
}

async function createMonitor(browser: Browser): Promise<string> {
  const res = await browser.submit("/monitors/new", "/monitors", {
    name: "Garden sensor",
    interval: "60",
    intervalUnit: "s",
  });
  return res.headers.location as string;
}

const flashOf = (body: string) =>
  /<p class="flash"[^>]*>([^<]*)<\/p>/.exec(body)?.[1];

describe("flash messages", () => {
  it("shows once after an action and is gone on the next load", async () => {
    const { browser } = await loggedIn();
    const page = await createMonitor(browser);
    await browser.get(page);

    const res = await browser.submit(page, `${page}/pause`);
    expect(res.statusCode).toBe(303);

    expect(flashOf((await browser.get(page)).body)).toBe("Monitor paused.");
    expect(flashOf((await browser.get(page)).body)).toBeUndefined();
  });

  it("follows creating, saving, unpausing, regenerating and deleting", async () => {
    const { browser } = await loggedIn();
    const page = await createMonitor(browser);
    const next = async () => flashOf((await browser.get(page)).body);
    expect(await next()).toBe("Monitor created.");

    await browser.submit(`${page}/edit`, `${page}/edit`, {
      name: "Shed sensor",
      interval: "60",
      intervalUnit: "s",
    });
    expect(await next()).toBe("Monitor saved.");

    await browser.submit(page, `${page}/pause`);
    await browser.submit(page, `${page}/unpause`);
    expect(await next()).toBe("Monitor unpaused.");

    await browser.submit(page, `${page}/regenerate-url`);
    expect(await next()).toBe(
      "Heartbeat URL regenerated. The old one no longer works.",
    );

    const res = await browser.submit(`${page}/delete`, `${page}/delete`);
    expect(res.headers.location).toBe("/");
    expect(flashOf((await browser.get("/")).body)).toBe("Shed sensor deleted.");
  });

  it("is ignored when the cookie was tampered with", async () => {
    const { browser } = await loggedIn();
    const page = await createMonitor(browser);
    browser.cookies.set("nb_flash", "Hacked.");

    expect(flashOf((await browser.get(page)).body)).toBeUndefined();
  });
});

describe("confirmations", () => {
  it("asks before regenerating the Heartbeat URL", async () => {
    const { browser } = await loggedIn();
    const page = await createMonitor(browser);

    const body = (await browser.get(page)).body;
    expect(body).toContain(`href="${page}/regenerate-url"`);
    const confirm = await browser.get(`${page}/regenerate-url`);
    expect(confirm.statusCode).toBe(200);
    expect(confirm.body).toContain("Regenerate the Heartbeat URL?");
    expect(confirm.body).toContain(`action="${page}/regenerate-url"`);
  });

  it("asks before deleting", async () => {
    const { browser } = await loggedIn();
    const page = await createMonitor(browser);

    expect((await browser.get(page)).body).toContain(`href="${page}/delete"`);
    expect((await browser.get(`${page}/delete`)).body).toContain(
      "Delete Garden sensor?",
    );
  });
});

describe("Dashboard", () => {
  it("invites a User without Monitors to create the first one", async () => {
    const { browser } = await loggedIn();

    const body = (await browser.get("/")).body;
    expect(body).toMatch(
      /<a href="\/monitors\/new"[^>]*>Create your first Monitor<\/a>/,
    );
  });

  it("drops the empty state once there is a Monitor", async () => {
    const { browser } = await loggedIn();
    await createMonitor(browser);

    const body = (await browser.get("/")).body;
    expect(body).toMatch(/id="empty-state"[^>]*hidden/);
    expect(body).toContain("Garden sensor");
  });
});

describe("Monitor page", () => {
  it("has copy buttons for the Heartbeat URL and curl GET and POST examples", async () => {
    const { browser } = await loggedIn();
    const page = await createMonitor(browser);

    const body = (await browser.get(page)).body;
    const url = /value="(https:\/\/nodbeat\.test\/hb\/[^"]+)"/.exec(body)![1]!;
    const copyTargets = [...body.matchAll(/data-copy="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(copyTargets).toEqual(["hb-url", "curl-get", "curl-post"]);
    expect(body).toMatch(
      new RegExp(`id="curl-get"[^>]*>curl -fsS -m 10 --retry 3 ${url}<`),
    );
    expect(body).toMatch(
      new RegExp(
        `id="curl-post"[^>]*>curl -fsS -m 10 --retry 3 --data-raw &quot;battery 3.7V&quot; ${url}<`,
      ),
    );
    expect(body).toContain("/assets/copy.js");
  });
});
