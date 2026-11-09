import { describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers.js";

describe("GET /health", () => {
  it("answers 200 ok when Mongo responds", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("ok");
  });

  it("answers 503 when Mongo cannot be pinged", async () => {
    const { app, client } = await buildTestApp();
    await client.close();

    const res = await app.inject({ method: "GET", url: "/health" });

    expect(res.statusCode).toBe(503);
  });
});
