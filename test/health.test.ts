import { describe, expect, it } from "vitest";
import { buildTestApp, testBuild } from "./helpers.js";

describe("GET /health", () => {
  it("answers 200 with status, version and commit when Mongo responds", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.json()).toEqual({
      status: "ok",
      version: testBuild.version,
      commit: testBuild.commit,
    });
  });

  it("answers 503 with the same shape when Mongo cannot be pinged", async () => {
    const { app, client } = await buildTestApp();
    await client.close();

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({
      status: "mongo unavailable",
      version: testBuild.version,
      commit: testBuild.commit,
    });
  });
});
