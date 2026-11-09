import type { FastifyReply, FastifyRequest } from "fastify";
import { cookieOptions } from "./auth.js";

const FLASH_COOKIE = "nb_flash";
/** Long enough to survive the redirect, short enough not to pop up on some later visit. */
const FLASH_MAX_AGE_SEC = 60;

/** Leaves a one-time message for the next page this browser loads, e.g. before a redirect. */
export function setFlash(reply: FastifyReply, message: string): void {
  reply.setCookie(FLASH_COOKIE, message, {
    ...cookieOptions,
    signed: true,
    maxAge: FLASH_MAX_AGE_SEC,
  });
}

/** Reads and clears the flash message; a tampered cookie is dropped. */
export function takeFlash(
  req: FastifyRequest,
  reply: FastifyReply,
): string | undefined {
  const raw = req.cookies[FLASH_COOKIE];
  if (raw === undefined) return undefined;
  reply.clearCookie(FLASH_COOKIE, cookieOptions);
  const { valid, value } = req.unsignCookie(raw);
  return valid && value ? value : undefined;
}
