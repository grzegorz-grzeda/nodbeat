import { describe, expect, it } from "vitest";
import { buildTestApp, createUser, login } from "./helpers.js";

describe("create-user CLI", () => {
  it("creates a User who can log in, defaulting the time zone to Europe/Warsaw", async () => {
    const { app, db } = await buildTestApp();

    const result = await createUser(db, {
      email: "admin@example.com",
      password: "correct horse",
      admin: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("admin@example.com (Admin)");
    expect(result.output).toContain("Europe/Warsaw");
    const browser = await login(app, "admin@example.com", "correct horse");
    expect(browser.lastResponse.statusCode).toBe(303);
  });

  it("accepts another time zone", async () => {
    const { db } = await buildTestApp();

    const result = await createUser(db, {
      email: "me@example.com",
      password: "correct horse",
      timeZone: "America/New_York",
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("America/New_York");
    expect(result.output).not.toContain("(Admin)");
  });

  it("refuses a second User with the same email, in any case", async () => {
    const { db } = await buildTestApp();
    await createUser(db, {
      email: "me@example.com",
      password: "correct horse",
    });

    const result = await createUser(db, {
      email: "ME@example.com",
      password: "another horse",
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("already exists");
  });

  it("refuses an unknown time zone", async () => {
    const { db } = await buildTestApp();

    const result = await createUser(db, {
      email: "me@example.com",
      password: "correct horse",
      timeZone: "Mars/Olympus",
    });

    expect(result.exitCode).toBe(1);
    expect(result.output).toContain("Unknown time zone");
  });
});
