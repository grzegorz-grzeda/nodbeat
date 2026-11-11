import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeHttpClient } from "../src/outbound-http.js";

const servers: Array<ReturnType<typeof createServer>> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

describe("the real HTTP client", () => {
  it("refuses to connect when the name resolves to a private address at connect time", async () => {
    let hits = 0;
    const server = createServer((_req, res) => {
      hits++;
      res.end();
    });
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;

    await expect(
      createNodeHttpClient().post({
        url: `http://localhost:${port}/hook`,
        headers: {},
        body: "{}",
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(/private, loopback or link-local/);
    expect(hits).toBe(0);
  });
});
