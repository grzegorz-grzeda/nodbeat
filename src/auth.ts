import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db, ObjectId } from "mongodb";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";
import { csrfField, html } from "./html.js";
import { SlidingWindowLimiter } from "./rate-limit.js";
import { authenticate, findUserById, type UserDoc } from "./users.js";

const SESSION_COOKIE = "nb_session";
const CSRF_COOKIE = "nb_csrf";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Sliding expiry is pushed forward at most this often, so polling pages don't write on every request. */
const SESSION_REFRESH_EVERY_MS = 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export interface SessionDoc {
  /** sha256 of the cookie value, so a database leak doesn't leak live sessions. */
  _id: string;
  userId: ObjectId;
  expiresAt: Date;
  createdAt: Date;
}

declare module "fastify" {
  interface FastifyRequest {
    user: UserDoc | null;
  }
  interface FastifyContextConfig {
    /** Set false on routes that take non-form POSTs (Heartbeats, Telegram webhook). */
    csrf?: boolean;
  }
}

export const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;

const sessions = (db: Db) => db.collection<SessionDoc>("sessions");

export async function ensureSessionIndexes(db: Db): Promise<void> {
  await sessions(db).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

const newToken = () => randomBytes(32).toString("base64url");
const sessionExpiry = (now: Date) => new Date(now.getTime() + SESSION_TTL_MS);

export const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Redirects anonymous visitors to the login page. Use as a route's preHandler. */
export async function requireUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  if (!req.user) return reply.redirect("/login", 303);
  return undefined;
}

/**
 * Answers 404 to everyone but the Admin, visitors included: the page doesn't exist for them, and a login redirect
 * would hint that it does. Use as a route's preHandler.
 */
export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply | undefined> {
  if (!req.user?.isAdmin) return reply.errorPage(404);
  return undefined;
}

export interface Auth {
  /** Returns the CSRF token for forms on the page being rendered, issuing its cookie if needed. */
  csrfToken(req: FastifyRequest, reply: FastifyReply): string;
  /** Logs this browser in as the User, like a successful login: a fresh session and CSRF secret. */
  startSession(
    req: FastifyRequest,
    reply: FastifyReply,
    userId: ObjectId,
  ): Promise<void>;
}

export function registerAuth(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; config: Config },
): Auth {
  const { db, clock, config } = deps;
  const loginLimiter = new SlidingWindowLimiter(
    clock,
    LOGIN_MAX_ATTEMPTS,
    LOGIN_WINDOW_MS,
  );

  const sign = (value: string) =>
    createHmac("sha256", config.sessionSecret)
      .update(`csrf:${value}`)
      .digest("base64url");

  const csrfToken = (req: FastifyRequest, reply: FastifyReply): string => {
    let secret = req.cookies[CSRF_COOKIE];
    if (!secret) {
      secret = newToken();
      req.cookies[CSRF_COOKIE] = secret;
      reply.setCookie(CSRF_COOKIE, secret, cookieOptions);
    }
    return sign(secret);
  };

  const csrfValid = (req: FastifyRequest): boolean => {
    const secret = req.cookies[CSRF_COOKIE];
    const body = req.body as Record<string, unknown> | undefined;
    const token = body?._csrf;
    if (!secret || typeof token !== "string") return false;
    const expected = Buffer.from(sign(secret));
    const given = Buffer.from(token);
    return expected.length === given.length && timingSafeEqual(expected, given);
  };

  const setSessionCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, {
      ...cookieOptions,
      maxAge: SESSION_TTL_MS / 1000,
    });

  const revokeSession = async (req: FastifyRequest): Promise<void> => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) await sessions(db).deleteOne({ _id: sha256(token) });
  };

  const startSession = async (
    req: FastifyRequest,
    reply: FastifyReply,
    userId: ObjectId,
  ): Promise<void> => {
    // Nothing set before authentication carries over.
    await revokeSession(req);
    reply.clearCookie(CSRF_COOKIE, cookieOptions);
    const token = newToken();
    const now = clock.now();
    await sessions(db).insertOne({
      _id: sha256(token),
      userId,
      createdAt: now,
      expiresAt: sessionExpiry(now),
    });
    setSessionCookie(reply, token);
  };

  app.decorateRequest("user", null);

  app.addHook("onRequest", async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) return;
    const id = sha256(token);
    const now = clock.now();
    const session = await sessions(db).findOne({ _id: id });
    const user =
      session && session.expiresAt > now
        ? await findUserById(db, session.userId)
        : null;
    if (!session || !user) {
      if (session) await sessions(db).deleteOne({ _id: id });
      reply.clearCookie(SESSION_COOKIE, cookieOptions);
      return;
    }
    req.user = user;
    const expiresAt = sessionExpiry(now);
    if (
      expiresAt.getTime() - session.expiresAt.getTime() >=
      SESSION_REFRESH_EVERY_MS
    ) {
      await sessions(db).updateOne({ _id: id }, { $set: { expiresAt } });
      setSessionCookie(reply, token);
    }
  });

  app.addHook("preHandler", async (req, reply) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
    if (req.routeOptions.config.csrf === false) return;
    // No route matched: the 404 answer changes nothing, so it needs no token.
    if (req.is404) return;
    if (!csrfValid(req)) {
      return reply.errorPage(403, {
        title: "Expired form",
        message:
          "This form has expired. Go back, reload the page and try again.",
      });
    }
    return undefined;
  });

  const loginPage = (
    req: FastifyRequest,
    reply: FastifyReply,
    options: { error?: string; email?: string } = {},
  ) =>
    reply.page({
      title: "Log in",
      body: html`<div class="card narrow">
        <h1>Log in</h1>
        ${options.error ? html`<p class="error">${options.error}</p>` : ""}
        <form method="post" action="/login">
          ${csrfField(csrfToken(req, reply))}
          <label
            >Email
            <input
              type="email"
              name="email"
              value="${options.email ?? ""}"
              autocomplete="username"
              required
          /></label>
          <label
            >Password
            <input
              type="password"
              name="password"
              autocomplete="current-password"
              required
          /></label>
          <button type="submit">Log in</button>
        </form>
      </div>`,
    });

  app.get("/login", async (req, reply) => {
    if (req.user) return reply.redirect("/", 303);
    return loginPage(req, reply);
  });

  app.post("/login", async (req, reply) => {
    const body = req.body as Record<string, unknown>;
    const email = typeof body.email === "string" ? body.email : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!loginLimiter.tryAcquire(req.ip)) {
      reply.code(429);
      return loginPage(req, reply, {
        email,
        error: "Too many login attempts. Try again in 15 minutes.",
      });
    }

    const user = await authenticate(db, email, password);
    if (!user) {
      reply.code(401);
      return loginPage(req, reply, {
        email,
        error: "Wrong email or password.",
      });
    }

    await startSession(req, reply, user._id);
    return reply.redirect("/", 303);
  });

  app.post("/logout", async (req, reply) => {
    await revokeSession(req);
    reply.clearCookie(SESSION_COOKIE, cookieOptions);
    return reply.redirect("/login", 303);
  });

  return { csrfToken, startSession };
}
