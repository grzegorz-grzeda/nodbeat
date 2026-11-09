import { describe, expect, it } from "vitest";
import { buildTestApp } from "./helpers.js";

/** Inline `<script>` (without src), `<style>`, `style="…"` and `on…="…"` handlers: all blocked by the CSP. */
function inlineCode(body: string): string[] {
  return [
    ...body.matchAll(/<script(?![^>]*\ssrc=)[^>]*>/g),
    ...body.matchAll(/<style[\s>]/g),
    ...body.matchAll(/\sstyle="/g),
    ...body.matchAll(/\son[a-z]+="/g),
  ].map((m) => m[0]);
}

/** Every same-origin `src`/`href` the page loads (links to other pages excluded). */
function assetUrls(body: string): string[] {
  return [
    ...body.matchAll(/<script[^>]*\ssrc="([^"]+)"/g),
    ...body.matchAll(/<link[^>]*\shref="([^"]+)"/g),
  ].map((m) => (m[1] as string).replaceAll("&amp;", "&"));
}

describe("GET /docs", () => {
  it("is a public HTML page under the strict CSP with no inline code", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: "/docs" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.headers["content-security-policy"]).toBe("default-src 'self'");
    expect(inlineCode(res.body)).toEqual([]);
  });

  it("loads only nodbeat's own assets, and every one answers 200", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: "/docs" });
    const urls = assetUrls(res.body);

    expect(urls.some((u) => u.includes("swagger-ui-bundle.js"))).toBe(true);
    expect(urls.some((u) => u.includes("swagger-ui.css"))).toBe(true);
    for (const url of urls) {
      expect(url, url).toMatch(/^\/[^/]/);
      const asset = await app.inject({ method: "GET", url });
      expect(asset.statusCode, url).toBe(200);
      expect(asset.body.length, url).toBeGreaterThan(0);
    }
  });

  it("boots Swagger UI on /openapi.yaml with Try it out enabled", async () => {
    const { app } = await buildTestApp();

    const page = await app.inject({ method: "GET", url: "/docs" });
    const init = assetUrls(page.body).find((u) => u.includes("docs.js"));
    const res = await app.inject({ method: "GET", url: init as string });

    expect(res.headers["content-type"]).toContain("text/javascript");
    expect(res.body).toContain('url: "/openapi.yaml"');
    expect(res.body).toContain("tryItOutEnabled: true");
    expect(res.body).toContain("validatorUrl: null");
  });

  it("links back to the app and has no app nav or theme", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: "/docs" });

    expect(res.body).toMatch(/<a [^>]*href="\/"[^>]*>← nodbeat<\/a>/);
    expect(res.body).not.toContain("site-footer");
    expect(res.body).not.toContain("data-theme");
  });

  it("serves Swagger UI's stylesheet with its icons as files, not data: URLs", async () => {
    const { app } = await buildTestApp();

    const page = await app.inject({ method: "GET", url: "/docs" });
    const css = assetUrls(page.body).find((u) => u.includes("swagger-ui.css"));
    const res = await app.inject({ method: "GET", url: css as string });
    const images = [...res.body.matchAll(/url\("?([^")]+)"?\)/g)].map(
      (m) => m[1] as string,
    );

    expect(res.body).not.toContain("data:");
    expect(res.body).not.toContain("sourceMappingURL");
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) {
      const img = await app.inject({ method: "GET", url: `/docs/${image}` });
      expect(img.statusCode, image).toBe(200);
      expect(img.headers["content-type"], image).toMatch(/^image\//);
    }
  });

  it("answers 404 for a file Swagger UI doesn't need", async () => {
    const { app } = await buildTestApp();

    const res = await app.inject({ method: "GET", url: "/docs/index.html" });

    expect(res.statusCode).toBe(404);
  });
});
