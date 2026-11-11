import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { loadLegalDocs } from "../src/legal.js";
import { acceptTerms, buildTestApp, createUser, login } from "./helpers.js";

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/${name}/`, import.meta.url));
const LEGAL_DIR = fixture("legal");

const OPERATOR = [
  "Fixture Operator Sp. z o.o.",
  "Tax ID 1234567890",
  "ul. Testowa 1, 00-001 Warszawa",
  '<a href="mailto:legal@example.com">legal@example.com</a>',
];

describe("Terms and Privacy pages", () => {
  it("/terms renders the Operator's terms.md", async () => {
    const { app } = await buildTestApp({ legalDir: LEGAL_DIR });

    const res = await app.inject({ method: "GET", url: "/terms" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<h1>Fixture Terms</h1>");
    expect(res.body).toContain(
      "<p>A fixture paragraph that wraps over two lines.</p>",
    );
    expect(res.body).toContain("<h2>Fixture section</h2>");
    expect(res.body).toMatch(
      /<ul>\s*<li>First fixture point<\/li>\s*<li>Second point with <a href="https:\/\/example.com\/more">a link<\/a><\/li>\s*<\/ul>/,
    );
    expect(res.body).toMatch(
      /<ol>\s*<li>Numbered one<\/li>\s*<li>Numbered two<\/li>\s*<\/ol>/,
    );
  });

  it("shows raw HTML in the Markdown as text", async () => {
    const { app } = await buildTestApp({ legalDir: LEGAL_DIR });

    const res = await app.inject({ method: "GET", url: "/terms" });

    expect(res.body).toContain(
      "<p>Raw &lt;script&gt;alert(1)&lt;/script&gt; stays text.</p>",
    );
  });

  it("shows a link to another host without a scheme (`//host`) as text", async () => {
    const { app } = await buildTestApp({ legalDir: LEGAL_DIR });

    const res = await app.inject({ method: "GET", url: "/terms" });

    expect(res.body).toContain("<p>An other host link stays text.</p>");
    expect(res.body).not.toContain("evil.example");
  });

  it("/terms starts with the Operator's details and the version", async () => {
    const { app } = await buildTestApp({ legalDir: LEGAL_DIR });

    const body = (await app.inject({ method: "GET", url: "/terms" })).body;

    const main = body.slice(body.indexOf("<main>"), body.indexOf("</main>"));
    for (const detail of OPERATOR) expect(main).toContain(detail);
    expect(main).toContain("Version 2026-12-01");
    expect(main.indexOf("Tax ID 1234567890")).toBeLessThan(
      main.indexOf("<h1>Fixture Terms</h1>"),
    );
  });

  it("the Operator's tax ID is optional", async () => {
    const { app } = await buildTestApp({
      legalDir: fixture("legal-no-tax-id"),
    });

    const body = (await app.inject({ method: "GET", url: "/terms" })).body;

    expect(body).toMatch(/Fixture Operator Sp. z o.o. ·\s+ul. Testowa 1/);
    expect(body).not.toContain("Tax ID");
  });

  it("/privacy renders the Operator's privacy.md", async () => {
    const { app } = await buildTestApp({ legalDir: LEGAL_DIR });

    const res = await app.inject({ method: "GET", url: "/privacy" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<h1>Fixture Privacy policy</h1>");
    expect(res.body).toContain(
      '<p>Fixture privacy text, contact <a href="mailto:privacy@example.com">us</a>.</p>',
    );
    expect(res.body).toContain("Version 2026-12-02");
  });
});

describe("footer", () => {
  it("links to both pages and names the Operator on public pages", async () => {
    const { app } = await buildTestApp({ legalDir: LEGAL_DIR });

    for (const url of ["/", "/login", "/terms", "/no-such-page"]) {
      const body = (await app.inject({ method: "GET", url })).body;
      const footer = body.slice(body.indexOf('<footer class="site-footer">'));
      expect(footer, url).toContain('<a href="/terms">Terms</a>');
      expect(footer, url).toContain('<a href="/privacy">Privacy policy</a>');
      for (const detail of OPERATOR) expect(footer, url).toContain(detail);
    }
  });

  it("links to both pages for a logged-in User too", async () => {
    const { app, db } = await buildTestApp({ legalDir: LEGAL_DIR });
    await createUser(db, { email: "me@example.com", password: "pw-123456" });
    const browser = await login(app, "me@example.com", "pw-123456");
    await acceptTerms(browser);

    for (const url of ["/", "/settings", "/terms"]) {
      const body = (await browser.get(url)).body;
      expect(body, url).toContain('<a href="/terms">Terms</a>');
      expect(body, url).toContain("Fixture Operator Sp. z o.o.");
    }
  });
});

describe("without the Operator's files", () => {
  it.each([
    ["LEGAL_DIR unset", undefined],
    ["LEGAL_DIR missing", fixture("no-such-dir")],
    ["privacy.md and operator.md missing", fixture("legal-partial")],
  ])("%s: both pages 404, no footer links, no Operator", async (_, dir) => {
    const { app } = await buildTestApp(dir ? { legalDir: dir } : {});

    for (const url of ["/terms", "/privacy"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(404);
    }
    const body = (await app.inject({ method: "GET", url: "/" })).body;
    expect(body).not.toContain('href="/terms"');
    expect(body).not.toContain('href="/privacy"');
    expect(body).not.toContain("Operator");
    expect(body).not.toContain("Tax ID");
  });
});

describe("loadLegalDocs", () => {
  it("warns, naming the missing files, when LEGAL_DIR is set but incomplete", () => {
    const warn = vi.fn();

    expect(loadLegalDocs(fixture("legal-partial"), warn)).toBeUndefined();

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/privacy\.md, operator\.md/);
  });

  it("doesn't warn when LEGAL_DIR is unset or complete", () => {
    const warn = vi.fn();

    loadLegalDocs(undefined, warn);
    loadLegalDocs(LEGAL_DIR, warn);

    expect(warn).not.toHaveBeenCalled();
  });
});

describe("malformed Operator's files", () => {
  it("stop startup, naming the file", async () => {
    await expect(
      buildTestApp({ legalDir: fixture("legal-bad-version") }),
    ).rejects.toThrow(/terms\.md needs a front-matter version date/);
  });
});
