import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildTestApp, testBuild, testConfig } from "./helpers.js";

interface OpenApiDoc {
  openapi: string;
  info: { version: string };
  servers: { url: string }[];
  paths: Record<string, Record<string, unknown>>;
  webhooks?: Record<string, { post?: WebhookOperation }>;
  components: { schemas: Record<string, { required: string[] }> };
}

interface WebhookOperation {
  parameters?: { name: string; in: string }[];
  requestBody: { content: Record<string, { schema: { $ref: string } }> };
}

describe("GET /openapi.yaml", () => {
  it("serves the OpenAPI document as YAML, public", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: "/openapi.yaml" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^application\/yaml/);
    const doc = parse(res.body) as OpenApiDoc;
    expect(doc.openapi).toMatch(/^3\./);
  });

  it("describes the Heartbeat URL, Start signal and Fail signal operations and /health", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: "/openapi.yaml" });
    const doc = parse(res.body) as OpenApiDoc;

    for (const path of [
      "/hb/{token}",
      "/hb/{token}/start",
      "/hb/{token}/fail",
    ]) {
      expect(Object.keys(doc.paths[path] ?? {}).sort()).toEqual(
        expect.arrayContaining(["get", "post"]),
      );
    }
    expect(doc.paths["/health"]).toHaveProperty("get");
  });

  it("documents the Webhook Alert body and its signature header", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: "/openapi.yaml" });
    const doc = parse(res.body) as OpenApiDoc;

    const op = doc.webhooks?.alert?.post;
    expect(op).toBeDefined();
    expect(op!.parameters).toContainEqual(
      expect.objectContaining({ name: "X-Nodbeat-Signature", in: "header" }),
    );
    const ref = op!.requestBody.content["application/json"]!.schema.$ref;
    const schema = doc.components.schemas[ref.split("/").pop()!]!;
    expect(schema.required.sort()).toEqual(
      ["at", "incidentId", "kind", "message", "monitor"].sort(),
    );
  });

  it("is stamped with the running version and this instance's public URL", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: "/openapi.yaml" });
    const doc = parse(res.body) as OpenApiDoc;

    expect(doc.info.version).toBe(testBuild.version);
    expect(doc.servers).toEqual([{ url: testConfig.publicBaseUrl }]);
  });
});
