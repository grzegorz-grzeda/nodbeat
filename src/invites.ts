import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db, ObjectId } from "mongodb";
import { requireAdmin, type Auth } from "./auth.js";
import type { Clock } from "./clock.js";
import type { Config } from "./config.js";
import { sendConfirmPage } from "./confirm.js";
import { setFlash } from "./flash.js";
import { formatDateTime } from "./format.js";
import { copyButton, csrfField, html, timeZoneOptions } from "./html.js";
import { SlidingWindowLimiter } from "./rate-limit.js";
import {
  createUser,
  DEFAULT_TIME_ZONE,
  emailsByUserId,
  UserError,
} from "./users.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NOTE_LENGTH = 200;
const ACCEPT_MAX_REQUESTS = 10;
const ACCEPT_WINDOW_MS = 15 * 60 * 1000;

export interface InviteDoc {
  /** sha256 of the code, so a database leak doesn't leak live Invite links. */
  _id: string;
  note: string;
  createdBy: ObjectId;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  /** When the Invite was claimed; set before the User exists, cleared again if creating the User fails. */
  usedAt: Date | null;
  usedBy: ObjectId | null;
}

const invites = (db: Db) => db.collection<InviteDoc>("invites");

export async function ensureInviteIndexes(db: Db): Promise<void> {
  await invites(db).createIndex({ createdAt: -1 });
}

const hashCode = (code: string) =>
  createHash("sha256").update(code).digest("hex");

/** Creates an Invite and returns its code: the only time the code exists outside the link. */
async function createInvite(
  db: Db,
  input: { note: string; createdBy: ObjectId; now: Date },
): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  await invites(db).insertOne({
    _id: hashCode(code),
    note: input.note,
    createdBy: input.createdBy,
    createdAt: input.now,
    expiresAt: new Date(input.now.getTime() + INVITE_TTL_MS),
    revokedAt: null,
    usedAt: null,
    usedBy: null,
  });
  return code;
}

/** Matches an Invite that can still be accepted at `now`. */
const pending = (now: Date) => ({
  usedAt: null,
  revokedAt: null,
  expiresAt: { $gt: now },
});

function findPendingInvite(
  db: Db,
  code: string,
  now: Date,
): Promise<InviteDoc | null> {
  return invites(db).findOne({ _id: hashCode(code), ...pending(now) });
}

/** Claims a pending Invite in one atomic step, so two parallel accepts can't both win. */
async function claimInvite(
  db: Db,
  code: string,
  now: Date,
): Promise<InviteDoc | null> {
  return invites(db).findOneAndUpdate(
    { _id: hashCode(code), ...pending(now) },
    { $set: { usedAt: now } },
  );
}

/** Makes a claimed Invite pending again after creating its User failed. */
async function releaseInvite(db: Db, id: string): Promise<void> {
  await invites(db).updateOne(
    { _id: id, usedBy: null },
    { $set: { usedAt: null } },
  );
}

async function markInviteUsed(
  db: Db,
  id: string,
  userId: ObjectId,
): Promise<void> {
  await invites(db).updateOne({ _id: id }, { $set: { usedBy: userId } });
}

/** Revokes the Invite if it's still pending; false when it was used, expired, revoked or doesn't exist. */
async function revokeInvite(db: Db, id: string, now: Date): Promise<boolean> {
  const res = await invites(db).updateOne(
    { _id: id, ...pending(now) },
    { $set: { revokedAt: now } },
  );
  return res.modifiedCount === 1;
}

function findPendingInviteById(
  db: Db,
  id: string,
  now: Date,
): Promise<InviteDoc | null> {
  return invites(db).findOne({ _id: id, ...pending(now) });
}

/** Every Invite, newest first. */
function listInvites(db: Db): Promise<InviteDoc[]> {
  return invites(db).find().sort({ createdAt: -1, _id: 1 }).toArray();
}

/** "pending", "expired", "revoked", or "used by <email> at <time>". */
function inviteStatus(
  invite: InviteDoc,
  now: Date,
  emails: Map<string, string>,
  timeZone: string,
): string {
  if (invite.usedBy && invite.usedAt) {
    const email = emails.get(String(invite.usedBy)) ?? "a deleted User";
    return `used by ${email} at ${formatDateTime(invite.usedAt, timeZone)}`;
  }
  if (invite.revokedAt) return "revoked";
  // Claimed by an accept still in progress: about to be used, or released again.
  if (invite.usedAt) return "pending";
  return invite.expiresAt > now ? "pending" : "expired";
}

const isInviteId = (id: string) => /^[0-9a-f]{64}$/.test(id);

export function registerInvites(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; config: Config; auth: Auth },
): void {
  const { db, clock, config, auth } = deps;
  const limiter = new SlidingWindowLimiter(
    clock,
    ACCEPT_MAX_REQUESTS,
    ACCEPT_WINDOW_MS,
  );

  const listPage = async (req: FastifyRequest, reply: FastifyReply) => {
    const now = clock.now();
    const timeZone = req.user!.timeZone;
    const list = await listInvites(db);
    const emails = await emailsByUserId(
      db,
      list.flatMap((i) => (i.usedBy ? [i.usedBy] : [])),
    );
    return reply.page({
      title: "Invites",
      body: html`<h1>Invites</h1>
        <p>
          An Invite is a link that lets one person create a User. It works once
          and expires after 7 days.
        </p>
        ${
          list.length === 0
            ? html`<p class="muted">No Invites yet.</p>`
            : html`<div class="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Note</th>
                      <th scope="col">Created</th>
                      <th scope="col">Expires</th>
                      <th scope="col">Status</th>
                      <th scope="col"></th>
                    </tr>
                  </thead>
                  <tbody>
                    ${list.map((i) => {
                      const status = inviteStatus(i, now, emails, timeZone);
                      return html`<tr>
                        <td>${i.note}</td>
                        <td>${formatDateTime(i.createdAt, timeZone)}</td>
                        <td>${formatDateTime(i.expiresAt, timeZone)}</td>
                        <td>${status}</td>
                        <td>
                          ${
                            status === "pending" && !i.usedAt
                              ? html`<a href="/admin/invites/${i._id}/revoke"
                                  >Revoke</a
                                >`
                              : ""
                          }
                        </td>
                      </tr>`;
                    })}
                  </tbody>
                </table>
              </div>`
        }
        <form method="post" action="/admin/invites" class="card narrow">
          ${csrfField(auth.csrfToken(req, reply))}
          <label
            >Note (optional, only you see it)
            <input
              type="text"
              name="note"
              maxlength="${String(MAX_NOTE_LENGTH)}"
              placeholder="for Marek"
          /></label>
          <button type="submit">Create Invite</button>
        </form>`,
    });
  };

  app.get("/admin/invites", { preHandler: requireAdmin }, listPage);

  app.get<{ Params: { id: string } }>(
    "/admin/invites/:id/revoke",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { id } = req.params;
      const invite = isInviteId(id)
        ? await findPendingInviteById(db, id, clock.now())
        : null;
      if (!invite) return reply.redirect("/admin/invites", 303);
      return sendConfirmPage(reply, auth.csrfToken(req, reply), {
        title: "Revoke Invite",
        question: invite.note
          ? `Revoke the Invite ${invite.note}?`
          : "Revoke this Invite?",
        explanation: html`Its link stops working. You can create a new Invite
        any time.`,
        action: `/admin/invites/${id}/revoke`,
        button: "Revoke Invite",
        cancel: "/admin/invites",
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/admin/invites/:id/revoke",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { id } = req.params;
      if (isInviteId(id) && (await revokeInvite(db, id, clock.now()))) {
        setFlash(reply, "Invite revoked.");
      }
      return reply.redirect("/admin/invites", 303);
    },
  );

  app.post(
    "/admin/invites",
    { preHandler: requireAdmin },
    async (req, reply) => {
      const raw = (req.body as Record<string, unknown> | undefined)?.note;
      const note = (typeof raw === "string" ? raw.trim() : "").slice(
        0,
        MAX_NOTE_LENGTH,
      );
      const code = await createInvite(db, {
        note,
        createdBy: req.user!._id,
        now: clock.now(),
      });
      const link = `${config.publicBaseUrl}/invite/${code}`;
      return reply.page({
        title: "Invite created",
        // Enhances the copy button; without JS it stays hidden and the link is still selectable.
        scripts: ["copy.js"],
        body: html`<div class="card narrow">
          <h1>Invite created</h1>
          <p>
            Send this link to the person you're inviting. It's shown only now:
            nodbeat keeps no copy of it.
          </p>
          <div class="copy-row">
            <input
              type="text"
              id="invite-link"
              readonly
              value="${link}"
              aria-label="Invite link"
            />
            ${copyButton("invite-link")}
          </div>
          <p><a href="/admin/invites">Back to Invites</a></p>
        </div>`,
      });
    },
  );

  const cantBeUsed = (reply: FastifyReply) =>
    reply.errorPage(404, {
      title: "This Invite can't be used",
      message:
        "This Invite can't be used: it was already used, has expired or was revoked. Ask for a new one.",
    });

  const acceptPage = (
    req: FastifyRequest<{ Params: { code: string } }>,
    reply: FastifyReply,
    options: { error?: string; email?: string; timeZone?: string } = {},
  ) =>
    reply.page({
      title: "Join nodbeat",
      body: html`<div class="card narrow">
        <h1>Join nodbeat</h1>
        <p>You've been invited. Choose how you'll log in.</p>
        ${options.error ? html`<p class="error">${options.error}</p>` : ""}
        <form method="post" action="/invite/${req.params.code}">
          ${csrfField(auth.csrfToken(req, reply))}
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
            >Password (at least 8 characters)
            <input
              type="password"
              name="password"
              autocomplete="new-password"
              minlength="8"
              required
          /></label>
          <label
            >Time zone
            <select name="timeZone">
              ${timeZoneOptions(options.timeZone ?? DEFAULT_TIME_ZONE)}
            </select></label
          >
          <button type="submit">Create my User</button>
        </form>
      </div>`,
    });

  const tooMany = (reply: FastifyReply) =>
    reply.errorPage(429, {
      message: "Too many attempts. Try again in 15 minutes.",
    });

  app.get<{ Params: { code: string } }>("/invite/:code", async (req, reply) => {
    if (!limiter.tryAcquire(req.ip)) return tooMany(reply);
    const invite = await findPendingInvite(db, req.params.code, clock.now());
    return invite ? acceptPage(req, reply) : cantBeUsed(reply);
  });

  app.post<{ Params: { code: string } }>(
    "/invite/:code",
    async (req, reply) => {
      if (!limiter.tryAcquire(req.ip)) return tooMany(reply);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const field = (name: string) =>
        typeof body[name] === "string" ? body[name] : "";
      const email = field("email");
      const timeZone = field("timeZone") || DEFAULT_TIME_ZONE;

      const invite = await claimInvite(db, req.params.code, clock.now());
      if (!invite) return cantBeUsed(reply);
      try {
        const user = await createUser(db, clock, {
          email,
          password: field("password"),
          timeZone,
          isAdmin: false,
        });
        await markInviteUsed(db, invite._id, user._id);
        await auth.startSession(req, reply, user._id);
        return reply.redirect("/", 303);
      } catch (err) {
        await releaseInvite(db, invite._id);
        if (!(err instanceof UserError)) throw err;
        reply.code(400);
        return acceptPage(req, reply, {
          error: `${err.message}.`,
          email,
          timeZone,
        });
      }
    },
  );
}
