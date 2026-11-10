import type { FastifyInstance } from "fastify";

/**
 * Sent on every response, HTML or not. No inline code anywhere, so `default-src 'self'`
 * covers scripts and styles; nodbeat is never framed and forms only post back to itself.
 */
const HEADERS = {
  // No includeSubDomains: other hosts under the same domain aren't ours to pin to HTTPS.
  "strict-transport-security": "max-age=31536000",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "content-security-policy":
    "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
} as const;

/** Adds the security headers to every response. Register before any route. */
export function registerSecurityHeaders(app: FastifyInstance): void {
  app.addHook("onSend", async (_req, reply, payload) => {
    reply.headers(HEADERS);
    return payload;
  });
}
