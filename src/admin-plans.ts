import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "mongodb";
import { requireAdmin, type Auth } from "./auth.js";
import type { Clock } from "./clock.js";
import { sendConfirmPage } from "./confirm.js";
import { setFlash } from "./flash.js";
import { formatDateTime, startOfDayIn } from "./format.js";
import { csrfField, html } from "./html.js";
import { parseObjectId } from "./ids.js";
import { endPro, giveComp, type Plans } from "./plans.js";
import { findUserById, type UserDoc } from "./users.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** What "Give Pro until…" suggests: a year from today. */
const DEFAULT_COMP_DAYS = 365;

/**
 * The Admin gives a User Pro until a date (a comp) or ends it, from the per-User table on /admin. Only with Plans on.
 * The date is the day Pro ends, in the User's time zone: Pro "until 2026-07-01" stops when that day starts.
 */
export function registerAdminPlans(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Auth; plans: Plans },
): void {
  const { db, clock, auth, plans } = deps;
  if (!plans.enabled) return;

  const userFrom = async (id: string): Promise<UserDoc | null> => {
    const userId = parseObjectId(id);
    return userId ? findUserById(db, userId) : null;
  };

  const givePage = (
    req: FastifyRequest,
    reply: FastifyReply,
    user: UserDoc,
    until: string,
    error = "",
  ) =>
    reply.code(error ? 400 : 200).page({
      title: "Give Pro",
      body: html`<div class="card narrow">
        <h1>Give ${user.email} Pro</h1>
        ${error && html`<p class="error" role="alert">${error}</p>`}
        <form method="post" action="/admin/users/${String(user._id)}/pro">
          ${csrfField(auth.csrfToken(req, reply))}
          <label
            >Until
            <input type="date" name="until" value="${until}" required />
          </label>
          <p class="hint">
            Pro ends when this day starts in their time zone (${user.timeZone}).
          </p>
          <div class="actions">
            <button type="submit">Give Pro</button>
            <a href="/admin">Cancel</a>
          </div>
        </form>
      </div>`,
    });

  app.get<{ Params: { id: string } }>(
    "/admin/users/:id/pro",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const user = await userFrom(req.params.id);
      if (!user) return reply.redirect("/admin", 303);
      const now = clock.now();
      const current = plans.planOf(user, now) === "pro" && user.plan?.proUntil;
      const suggested =
        current || new Date(now.getTime() + DEFAULT_COMP_DAYS * DAY_MS);
      const until = formatDateTime(suggested, user.timeZone).slice(0, 10);
      return givePage(req, reply, user, until);
    },
  );

  app.post<{ Params: { id: string }; Body: { until?: string } }>(
    "/admin/users/:id/pro",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const user = await userFrom(req.params.id);
      if (!user) return reply.redirect("/admin", 303);
      const until = (req.body?.until ?? "").trim();
      const proUntil = /^\d{4}-\d{2}-\d{2}$/.test(until)
        ? startOfDayIn(until, user.timeZone)
        : null;
      if (!proUntil || Number.isNaN(proUntil.getTime())) {
        return givePage(req, reply, user, until, "Choose a date.");
      }
      if (proUntil.getTime() <= clock.now().getTime()) {
        return givePage(req, reply, user, until, "Choose a date after today.");
      }
      await giveComp(db, user._id, proUntil);
      setFlash(reply, `${user.email} has Pro until ${until}.`);
      return reply.redirect("/admin", 303);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/admin/users/:id/end-pro",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const user = await userFrom(req.params.id);
      if (!user || plans.planOf(user, clock.now()) !== "pro") {
        return reply.redirect("/admin", 303);
      }
      return sendConfirmPage(reply, auth.csrfToken(req, reply), {
        title: "End Pro",
        question: `End Pro for ${user.email}?`,
        explanation: html`They are on Free from now on. Nothing they built is
        deleted.`,
        action: `/admin/users/${String(user._id)}/end-pro`,
        button: "End Pro",
        cancel: "/admin",
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/users/:id/end-pro",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const user = await userFrom(req.params.id);
      if (user && (await endPro(db, user._id, clock.now()))) {
        setFlash(reply, `${user.email} is on Free.`);
      }
      return reply.redirect("/admin", 303);
    },
  );
}
