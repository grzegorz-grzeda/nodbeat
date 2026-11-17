import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId, type Db } from "mongodb";
import type { Auth } from "./auth.js";
import type { Clock } from "./clock.js";
import { setFlash } from "./flash.js";
import { formatDateTime } from "./format.js";
import { csrfField, html, type SafeHtml } from "./html.js";
import { SlidingWindowLimiter } from "./rate-limit.js";
import { normalizeEmail, userEmailExists } from "./users.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long an unhandled Invite request is kept. */
const RETENTION_MS = 30 * DAY_MS;
const MAX_EMAIL_LENGTH = 254;
const MAX_NOTE_LENGTH = 500;
const MAX_PENDING = 200;
const PER_IP_MAX = 3;
const PER_IP_WINDOW_MS = 60 * 60 * 1000;
/** Shown whatever happened to the request, so the form doesn't tell who already has an account. */
const THANKS =
  "Thanks! If there's room, an Invite will reach you by email soon.";

export interface InviteRequestDoc {
  _id: ObjectId;
  /** Normalized; one request per email. */
  email: string;
  note: string;
  createdAt: Date;
  expiresAt: Date;
}

const inviteRequests = (db: Db) =>
  db.collection<InviteRequestDoc>("inviteRequests");

export async function ensureInviteRequestIndexes(db: Db): Promise<void> {
  await Promise.all([
    inviteRequests(db).createIndex({ email: 1 }, { unique: true }),
    inviteRequests(db).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

/** The TTL index deletes expired requests within a minute or so; queries don't wait for it. */
const pendingAt = (now: Date) => ({ expiresAt: { $gt: now } });

/** Pending requests, oldest first. */
export function listInviteRequests(
  db: Db,
  now: Date,
): Promise<InviteRequestDoc[]> {
  return inviteRequests(db)
    .find(pendingAt(now))
    .sort({ createdAt: 1, _id: 1 })
    .toArray();
}

export function countInviteRequests(db: Db, now: Date): Promise<number> {
  return inviteRequests(db).countDocuments(pendingAt(now));
}

/** Deletes a pending request and returns it; null when it doesn't exist (or another tab handled it). */
export async function takeInviteRequest(
  db: Db,
  id: string,
  now: Date,
): Promise<InviteRequestDoc | null> {
  if (!ObjectId.isValid(id) || !/^[0-9a-f]{24}$/.test(id)) return null;
  return inviteRequests(db).findOneAndDelete({
    _id: new ObjectId(id),
    ...pendingAt(now),
  });
}

/** Stores the request, or updates the note of the email's pending one, keeping its original time. */
async function saveInviteRequest(
  db: Db,
  input: { email: string; note: string; now: Date },
): Promise<void> {
  const { email, note, now } = input;
  // An expired request the TTL monitor hasn't removed yet would block the unique email.
  await inviteRequests(db).deleteOne({ email, expiresAt: { $lte: now } });
  await inviteRequests(db).updateOne(
    { email },
    {
      $set: { note },
      $setOnInsert: {
        createdAt: now,
        expiresAt: new Date(now.getTime() + RETENTION_MS),
      },
    },
    { upsert: true },
  );
}

const isEmail = (email: string) =>
  email.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

interface FormState {
  error?: string;
  email?: string;
  note?: string;
}

/** Renders the request form for the landing page. */
export type InviteRequestForm = (
  req: FastifyRequest,
  reply: FastifyReply,
  state?: FormState,
) => SafeHtml;

/**
 * The landing page's "Request an Invite" form and its route, when `enabled` (`INVITE_REQUESTS=true`). Returns the
 * form renderer, or undefined when off. Stores the email and note only: no IP, no User Agent.
 */
export function registerInviteRequests(
  app: FastifyInstance,
  deps: {
    db: Db;
    clock: Clock;
    auth: Auth;
    enabled: boolean;
    /** Links the Privacy policy from the form when the Operator has one. */
    hasPrivacyPolicy: boolean;
    landingPage: (
      reply: FastifyReply,
      form: SafeHtml,
    ) => FastifyReply | Promise<FastifyReply>;
  },
): InviteRequestForm | undefined {
  const { db, clock, auth, enabled, hasPrivacyPolicy } = deps;
  if (!enabled) return undefined;
  const limiter = new SlidingWindowLimiter(clock, PER_IP_MAX, PER_IP_WINDOW_MS);

  const form: InviteRequestForm = (req, reply, state = {}) =>
    html`<form
      method="post"
      action="/invite-requests"
      class="card narrow invite-request"
      id="request-invite"
    >
      <h2>Request an Invite</h2>
      <p>
        nodbeat is invite-only for now. Leave your email and you'll get an
        Invite when there's room.
      </p>
      ${state.error ? html`<p class="error">${state.error}</p>` : ""}
      ${csrfField(auth.csrfToken(req, reply))}
      <label
        >Email
        <input
          type="email"
          name="email"
          value="${state.email ?? ""}"
          autocomplete="email"
          maxlength="${String(MAX_EMAIL_LENGTH)}"
          required
      /></label>
      <label
        >What would you watch? (optional)
        <textarea
          name="note"
          rows="2"
          maxlength="${String(MAX_NOTE_LENGTH)}"
          placeholder="backups on 3 servers, a few ESP32 sensors"
        >
${state.note ?? ""}</textarea>
      </label>
      <label class="honeypot" aria-hidden="true"
        >Leave this empty
        <input type="text" name="website" tabindex="-1" autocomplete="off"
      /></label>
      <button type="submit">Request an Invite</button>
      <p class="muted small">
        Your email is used only to send you an Invite, and is deleted once it's
        handled or after 30
        days.${
          hasPrivacyPolicy &&
          html` See the <a href="/privacy">Privacy policy</a>.`
        }
      </p>
    </form>`;

  app.post("/invite-requests", async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const field = (name: string) =>
      typeof body[name] === "string" ? body[name].trim() : "";
    const email = normalizeEmail(field("email"));
    const note = field("note");

    const invalid = (error: string) => {
      reply.code(400);
      return deps.landingPage(
        reply,
        form(req, reply, { error, email: field("email"), note }),
      );
    };
    if (!isEmail(email)) return invalid("Enter a valid email.");
    if (note.length > MAX_NOTE_LENGTH) {
      return invalid(`Keep the note to ${String(MAX_NOTE_LENGTH)} characters.`);
    }
    if (!limiter.tryAcquire(req.ip)) {
      return reply.errorPage(429, {
        message: "Too many requests. Try again in an hour.",
      });
    }
    const thanks = () => {
      setFlash(reply, THANKS);
      return reply.redirect("/", 303);
    };
    // A bot filled the field people can't see.
    if (field("website")) return thanks();
    if (await userEmailExists(db, email)) return thanks();

    const now = clock.now();
    const alreadyRequested = await inviteRequests(db).findOne({
      email,
      ...pendingAt(now),
    });
    if (
      !alreadyRequested &&
      (await countInviteRequests(db, now)) >= MAX_PENDING
    ) {
      return reply.errorPage(503, {
        message:
          "nodbeat is not taking Invite requests right now. Try again in a few days.",
      });
    }
    await saveInviteRequest(db, { email, note, now });
    return thanks();
  });

  return form;
}

/** The Admin's table of pending requests (at least one), each with Create Invite and Dismiss. */
export function inviteRequestsTable(
  list: InviteRequestDoc[],
  csrf: string,
  timeZone: string,
): SafeHtml {
  return html`<h2>Invite requests</h2>
    ${html`<p>
        Left on the landing page. Each is deleted once you create its Invite or
        dismiss it, or after 30 days.
      </p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Email</th>
              <th scope="col">Note</th>
              <th scope="col">Requested</th>
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>
            ${list.map(
              (r) =>
                html`<tr>
                  <td>${r.email}</td>
                  <td>${r.note}</td>
                  <td>${formatDateTime(r.createdAt, timeZone)}</td>
                  <td class="row-actions">
                    <form
                      method="post"
                      action="/admin/invite-requests/${String(r._id)}/invite"
                    >
                      ${csrfField(csrf)}
                      <button type="submit">Create Invite</button>
                    </form>
                    <form
                      method="post"
                      action="/admin/invite-requests/${String(r._id)}/dismiss"
                    >
                      ${csrfField(csrf)}
                      <button type="submit" class="button-link">Dismiss</button>
                    </form>
                  </td>
                </tr>`,
            )}
          </tbody>
        </table>
      </div>`}`;
}
