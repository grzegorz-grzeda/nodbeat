import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { html, SafeHtml } from "./html.js";

/** The documents a User accepts; each has its own version. */
export const LEGAL_KINDS = ["terms", "privacy"] as const;
export type LegalKind = (typeof LEGAL_KINDS)[number];

export interface LegalDocument {
  /** A date, `YYYY-MM-DD`; a later date is a newer version, so versions compare as strings. */
  version: string;
  /** The short "what changed" line shown when Users are asked to accept this version. */
  summary: string;
  /** The rendered Markdown body. */
  body: SafeHtml;
}

/** Who runs this instance: the seller in the Terms and the controller in the Privacy policy. */
export interface Operator {
  name: string;
  /** A tax identification number (NIP in Poland), when the Operator has one. */
  taxId?: string;
  address: string;
  email: string;
}

/** The Operator's Terms, Privacy policy and details, read from `LEGAL_DIR` at startup. */
export interface LegalDocs {
  operator: Operator;
  documents: Record<LegalKind, LegalDocument>;
}

export type LegalVersions = Record<LegalKind, string>;

/** The version of each document a User must have accepted. */
export function currentVersions(legal: LegalDocs): LegalVersions {
  return Object.fromEntries(
    LEGAL_KINDS.map((kind) => [kind, legal.documents[kind].version]),
  ) as LegalVersions;
}

/**
 * The documents the User must accept (again): never accepted, or accepted at an older version. A stored version
 * newer than the current one (the Operator went back) isn't due.
 */
export function dueDocuments(
  legal: LegalDocs,
  accepted: Partial<Record<LegalKind, { version: string }>> | undefined,
): LegalKind[] {
  return LEGAL_KINDS.filter((kind) => {
    const version = accepted?.[kind]?.version;
    return version === undefined || version < legal.documents[kind].version;
  });
}

export class LegalDocsError extends Error {
  constructor(file: string, problem: string) {
    super(`LEGAL_DIR: ${file} ${problem}`);
    this.name = "LegalDocsError";
  }
}

const FILES = ["terms.md", "privacy.md", "operator.md"] as const;
const OPERATOR_FIELDS = ["name", "address", "email"] as const;

/**
 * Reads and renders the Operator's files. `undefined` when `dir` is unset or any file is missing: the instance then
 * has no legal pages (a self-hoster who hasn't written any); with `dir` set, the missing files are passed to `warn`.
 * A file that's there but malformed throws, so the Operator finds out at startup rather than from a broken page.
 */
export function loadLegalDocs(
  dir: string | undefined,
  warn: (message: string) => void = () => {},
): LegalDocs | undefined {
  if (!dir) return undefined;
  const missing = FILES.filter((file) => !existsSync(join(dir, file)));
  if (missing.length > 0) {
    warn(
      `LEGAL_DIR ${dir} lacks ${missing.join(", ")}: no Terms or Privacy pages`,
    );
    return undefined;
  }
  const read = (file: string) => readFileSync(join(dir, file), "utf8");

  const document = (file: string): LegalDocument => {
    const { fields, body } = parseFrontMatter(file, read(file));
    const version = fields.get("version");
    if (!version || !isDate(version)) {
      throw new LegalDocsError(
        file,
        "needs a front-matter version date (YYYY-MM-DD)",
      );
    }
    const summary = fields.get("summary");
    if (!summary)
      throw new LegalDocsError(file, "needs a front-matter summary");
    return { version, summary, body: renderMarkdown(body) };
  };

  const { fields } = parseFrontMatter("operator.md", read("operator.md"));
  const required = Object.fromEntries(
    OPERATOR_FIELDS.map((field) => {
      const value = fields.get(field);
      if (!value)
        throw new LegalDocsError(
          "operator.md",
          `needs a front-matter ${field}`,
        );
      return [field, value];
    }),
  ) as Record<(typeof OPERATOR_FIELDS)[number], string>;
  // Front-matter keys are read lowercased.
  const taxId = fields.get("taxid");
  const operator: Operator = { ...required, ...(taxId && { taxId }) };

  return {
    operator,
    documents: Object.fromEntries(
      LEGAL_KINDS.map((kind) => [kind, document(`${kind}.md`)]),
    ) as Record<LegalKind, LegalDocument>,
  };
}

/** `---`-fenced `key: value` lines at the top of the file; quotes around a value are dropped. */
function parseFrontMatter(
  file: string,
  text: string,
): { fields: Map<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!match)
    throw new LegalDocsError(file, "must start with a --- front-matter block");
  const fields = new Map<string, string>();
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = /^([A-Za-z]+):\s*(.*?)\s*$/.exec(line);
    if (!field) continue;
    fields.set(
      field[1]!.toLowerCase(),
      field[2]!.replace(/^(["'])(.*)\1$/, "$2"),
    );
  }
  return { fields, body: text.slice(match[0].length) };
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "list"; ordered: boolean; items: string[] };

/**
 * A deliberately small Markdown subset: `#` headings, paragraphs, `-`/`*`/`1.` lists and `[text](url)` links.
 * Everything else, raw HTML included, is shown as text.
 */
export function renderMarkdown(source: string): SafeHtml {
  const blocks: Block[] = [];
  let current: Block | undefined;
  const close = () => {
    if (current) blocks.push(current);
    current = undefined;
  };

  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      close();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (heading) {
      close();
      blocks.push({
        type: "heading",
        level: heading[1]!.length,
        text: heading[2]!,
      });
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = Boolean(numbered);
      if (current?.type !== "list" || current.ordered !== ordered) {
        close();
        current = { type: "list", ordered, items: [] };
      }
      current.items.push(item[1]!);
      continue;
    }
    if (current?.type === "list" && raw !== line) {
      // An indented line continues the list item above it.
      current.items[current.items.length - 1] += ` ${line}`;
      continue;
    }
    if (current?.type !== "paragraph") {
      close();
      current = { type: "paragraph", lines: [] };
    }
    current.lines.push(line);
  }
  close();

  return html`${blocks.map(renderBlock)}`;
}

function renderBlock(block: Block): SafeHtml {
  switch (block.type) {
    case "heading":
      return new SafeHtml(
        `<h${block.level}>${inline(block.text).value}</h${block.level}>`,
      );
    case "paragraph":
      return html`<p>${inline(block.lines.join(" "))}</p>`;
    case "list": {
      const items = block.items.map((item) => html`<li>${inline(item)}</li>`);
      return block.ordered
        ? html`<ol>
            ${items}
          </ol>`
        : html`<ul>
            ${items}
          </ul>`;
    }
  }
}

/**
 * Links whose URL could run script or leave the usual schemes are shown as their text only, as is `//host` (and
 * `/\host`, which browsers read the same): another host without a scheme.
 */
const SAFE_URL = /^(https?:\/\/|mailto:|\/(?![/\\])|#)/i;

function inline(text: string): SafeHtml {
  const parts: SafeHtml[] = [];
  const link = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const match of text.matchAll(link)) {
    parts.push(html`${text.slice(last, match.index)}`);
    const [, label, url] = match;
    parts.push(
      SAFE_URL.test(url!)
        ? html`<a href="${url}">${label}</a>`
        : html`${label}`,
    );
    last = match.index + match[0].length;
  }
  parts.push(html`${text.slice(last)}`);
  return html`${parts}`;
}

export const LEGAL_TITLES: Record<LegalKind, string> = {
  terms: "Terms",
  privacy: "Privacy policy",
};

/** The Operator's details, as at the top of `/terms`. */
export function operatorDetails(operator: Operator): SafeHtml {
  return html`<address class="operator">
    ${operator.name} ·
    ${operator.taxId && html`Tax ID ${operator.taxId} · `}${operator.address} ·
    <a href="mailto:${operator.email}">${operator.email}</a>
  </address>`;
}

/** `/terms` and `/privacy`; without `legal` they don't exist (404). */
export function registerLegalPages(
  app: FastifyInstance,
  deps: { legal: LegalDocs | undefined },
): void {
  const { legal } = deps;
  if (!legal) return;
  for (const kind of LEGAL_KINDS) {
    const document = legal.documents[kind];
    app.get(
      `/${kind}`,
      { config: { acceptTerms: false } },
      async (_req, reply) =>
        reply.page({
          title: LEGAL_TITLES[kind],
          body: html`<article class="legal">
            ${kind === "terms" && operatorDetails(legal.operator)}
            <p class="muted">Version ${document.version}</p>
            ${document.body}
          </article>`,
        }),
    );
  }
}
