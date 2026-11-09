import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { parseDocument } from "yaml";
import type { BuildInfo } from "./build-info.js";

/**
 * Serves the hand-written `api/openapi.yaml` at `/openapi.yaml`, public, stamped with
 * the running version and this instance's public URL. Built once at startup.
 */
export function registerOpenApi(
  app: FastifyInstance,
  deps: { build: BuildInfo; publicBaseUrl: string },
): void {
  // `api/` sits one level above both `src/` and `dist/`.
  const source = readFileSync(
    new URL("../api/openapi.yaml", import.meta.url),
    "utf8",
  );
  const doc = parseDocument(source);
  doc.setIn(["info", "version"], deps.build.version);
  doc.set("servers", [{ url: deps.publicBaseUrl }]);
  const body = doc.toString();

  app.get("/openapi.yaml", async (_req, reply) =>
    reply.type("application/yaml").send(body),
  );
}
