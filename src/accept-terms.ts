import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "mongodb";
import { requireUser, type Auth } from "./auth.js";
import type { Clock } from "./clock.js";
import { csrfField, html } from "./html.js";
import {
  dueDocuments,
  LEGAL_TITLES,
  type LegalDocs,
  type LegalKind,
} from "./legal.js";
import { recordAcceptance } from "./users.js";

declare module "fastify" {
  interface FastifyContextConfig {
    /** Set false on a page a User with Terms to accept must still see (the legal pages, `/accept-terms`). */
    acceptTerms?: boolean;
  }
}

/** Where `reply.page()` sends the User instead of rendering this page, or `undefined` to render it. */
export type PageGate = (req: FastifyRequest) => string | undefined;

const PATH = "/accept-terms";
const MAX_NEXT_LENGTH = 2048;

/**
 * A path on this site to go back to, or `/`. Anything that a browser could read as another host (`//host`, `/\host`,
 * a scheme, control characters it drops) falls back to `/`, so `next` is never an open redirect.
 */
export function returnPath(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_NEXT_LENGTH) return "/";
  // eslint-disable-next-line no-control-regex
  return /^\/(?![/\\])[^\\\u0000-\u001f\u007f]*$/.test(value) ? value : "/";
}

const acceptUrl = (next: string) =>
  next === "/" ? PATH : `${PATH}?next=${encodeURIComponent(next)}`;

/**
 * Sends a User to `/accept-terms` when a Terms or Privacy policy version they must accept is newer than the one they
 * accepted (or they accepted none), then back where they were. Only app pages loaded with GET are gated, through the
 * returned gate that `reply.page()` asks: anything that isn't a page (Heartbeats, JSON, assets, docs, redirects,
 * downloads), form posts, error pages and Alerts never wait on it. Without `legal`, nothing changes and there's no gate.
 */
export function registerTermsAcceptance(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Auth; legal: LegalDocs | undefined },
): PageGate | undefined {
  const { db, clock, auth, legal } = deps;
  if (!legal) return undefined;
  const versionOf = (kind: LegalKind) => legal.documents[kind].version;

  const page = (
    req: FastifyRequest,
    reply: FastifyReply,
    due: LegalKind[],
    next: string,
  ) =>
    reply.header("cache-control", "no-store").page({
      title: "Updated Terms",
      body: html`<div class="card narrow">
        <h1>Updated Terms</h1>
        <p>Please read and accept before you continue.</p>
        ${due.map(
          (kind) =>
            html`<section class="legal-change">
              <h2>
                <a href="/${kind}" target="_blank">${LEGAL_TITLES[kind]}</a>
              </h2>
              <p class="muted">Version ${versionOf(kind)}</p>
              <p>${legal.documents[kind].summary}</p>
            </section>`,
        )}
        <form method="post" action="${PATH}">
          ${csrfField(auth.csrfToken(req, reply))}
          ${due.map(
            (kind) =>
              html`<input
                type="hidden"
                name="${kind}"
                value="${versionOf(kind)}"
              />`,
          )}
          ${
            next !== "/" &&
            html`<input type="hidden" name="next" value="${next}" />`
          }
          <button type="submit">Accept and continue</button>
        </form>
      </div>`,
    });

  app.get<{ Querystring: { next?: unknown } }>(
    PATH,
    { preHandler: requireUser, config: { acceptTerms: false } },
    async (req, reply) => {
      const next = returnPath(req.query.next);
      const due = dueDocuments(legal, req.user!.accepted);
      if (due.length === 0) return reply.redirect(next, 303);
      return page(req, reply, due, next);
    },
  );

  app.post(PATH, { preHandler: requireUser }, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const next = returnPath(body.next);
    const user = req.user!;
    // Only the versions the User was shown: if the Operator changed a document since, it's asked for again.
    const due = dueDocuments(legal, user.accepted);
    const accepting = due.filter((kind) => body[kind] === versionOf(kind));
    await recordAcceptance(
      db,
      user._id,
      Object.fromEntries(accepting.map((kind) => [kind, versionOf(kind)])),
      clock.now(),
    );
    const stillDue = due.length > accepting.length;
    return reply.redirect(stillDue ? acceptUrl(next) : next, 303);
  });

  return (req) => {
    if (!req.user) return undefined;
    if (req.method !== "GET" && req.method !== "HEAD") return undefined;
    if (req.routeOptions.config.acceptTerms === false) return undefined;
    if (dueDocuments(legal, req.user.accepted).length === 0) return undefined;
    return acceptUrl(req.url);
  };
}
