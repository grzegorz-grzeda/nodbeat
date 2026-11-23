import type { FastifyInstance } from "fastify";

/** Where the policy lives: the repo's SECURITY.md (GitHub private vulnerability reporting). */
export const SECURITY_POLICY_URL =
  "https://github.com/grzegorz-grzeda/nodbeat/blob/main/SECURITY.md";

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** The RFC 9116 file: valid for one year from `since`, the build time (renewed by every release). */
export function securityTxt(contact: string, since: Date): string {
  const expires = new Date(since.getTime() + YEAR_MS);
  return [
    `Contact: ${contact}`,
    `Expires: ${expires.toISOString().replace(/\.\d{3}Z$/, "Z")}`,
    "Preferred-Languages: en, pl",
    `Policy: ${SECURITY_POLICY_URL}`,
    "",
  ].join("\n");
}

/**
 * Serves `/.well-known/security.txt` when the Operator set `SECURITY_CONTACT`; otherwise nothing is registered and it
 * is a `404`, so a self-hosted instance doesn't publish someone else's address.
 */
export function registerSecurityTxt(
  app: FastifyInstance,
  deps: { contact: string | undefined; since: Date },
): void {
  const { contact, since } = deps;
  if (!contact) return;
  const body = securityTxt(contact, since);
  app.get("/.well-known/security.txt", (_req, reply) =>
    reply.type("text/plain; charset=utf-8").send(body),
  );
}
