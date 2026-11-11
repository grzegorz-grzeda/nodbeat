import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "mongodb";
import { requireUser, TOO_MANY_LOGINS, type Auth } from "./auth.js";
import type { Clock } from "./clock.js";
import { sendConfirmPage } from "./confirm.js";
import { setFlash } from "./flash.js";
import { formatDateTime } from "./format.js";
import { csrfField, html, timeZoneOptions } from "./html.js";
import {
  createLinkCode,
  findActiveLinkCode,
  findLinkedChat,
  listLinkedChats,
  removeLinkedChat,
} from "./linked-chats.js";
import {
  authenticate,
  isTheme,
  MIN_PASSWORD_LENGTH,
  setUserPassword,
  setUserTheme,
  setUserTimeZone,
  UserError,
} from "./users.js";

/** Only same-site paths, so the switch can't be turned into an open redirect. */
function localPath(value: unknown): string {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : "/";
}

export function registerSettings(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Auth },
): void {
  const { db, clock, auth } = deps;

  const settingsPage = async (
    req: FastifyRequest,
    reply: FastifyReply,
    options: { passwordError?: string } = {},
  ) => {
    const user = req.user!;
    const csrf = auth.csrfToken(req, reply);
    const [code, chats] = await Promise.all([
      findActiveLinkCode(db, user._id, clock.now()),
      listLinkedChats(db, user._id),
    ]);
    return reply.page({
      title: "Settings",
      body: html`<h1>Settings</h1>
        <h2>Time zone</h2>
        <form method="post" action="/settings/time-zone">
          ${csrfField(csrf)}
          <label
            >Times are shown in
            <select name="timeZone">
              ${timeZoneOptions(user.timeZone)}
            </select></label
          >
          <button type="submit">Save time zone</button>
        </form>
        <h2>Linked chats</h2>
        ${
          chats.length === 0
            ? html`<p>No Linked chats yet.</p>`
            : html`<ul class="plain">
                ${chats.map(
                  (c) =>
                    html`<li>
                      ${c.title}
                      <small
                        >linked
                        ${formatDateTime(c.linkedAt, user.timeZone)}</small
                      >
                      <a
                        href="/settings/linked-chats/${String(c._id)}/delete"
                        class="button secondary"
                        >Remove</a
                      >
                    </li>`,
                )}
              </ul>`
        }
        <h2>Link a Telegram chat</h2>
        ${
          code
            ? html`<p>
                Send
                <code>/start <code class="link-code">${code._id}</code></code>
                to the nodbeat bot in the chat you want to link (private or
                group). The code works once and expires at
                ${formatDateTime(code.expiresAt, user.timeZone)}.
              </p>`
            : ""
        }
        <form method="post" action="/settings/link-code">
          ${csrfField(csrf)}
          <button type="submit">Generate Link code</button>
        </form>
        <h2 id="password">Password</h2>
        ${
          options.passwordError
            ? html`<p class="error">${options.passwordError}</p>`
            : ""
        }
        <form method="post" action="/settings/password">
          ${csrfField(csrf)}
          <input
            type="text"
            name="username"
            value="${user.email}"
            autocomplete="username"
            hidden
          />
          <label
            >Current password
            <input
              type="password"
              name="current"
              autocomplete="current-password"
              required
          /></label>
          <label
            >New password (at least ${String(MIN_PASSWORD_LENGTH)} characters)
            <input
              type="password"
              name="password"
              autocomplete="new-password"
              minlength="${String(MIN_PASSWORD_LENGTH)}"
              required
          /></label>
          <label
            >New password again
            <input
              type="password"
              name="confirm"
              autocomplete="new-password"
              required
          /></label>
          <button type="submit">Change password</button>
        </form>
        <p>Changing your password logs you out everywhere else.</p>
        <h2>Sessions</h2>
        <form method="post" action="/logout-everywhere">
          ${csrfField(csrf)}
          <button type="submit" class="secondary">Log out everywhere</button>
        </form>
        <p>Ends every session, on every device, this one included.</p>`,
    });
  };

  app.get("/settings", { preHandler: requireUser }, (req, reply) =>
    settingsPage(req, reply),
  );

  app.post(
    "/settings/password",
    { preHandler: requireUser },
    async (req, reply) => {
      const user = req.user!;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const field = (name: string) =>
        typeof body[name] === "string" ? body[name] : "";
      const fail = (status: number, passwordError: string) => {
        reply.code(status);
        return settingsPage(req, reply, { passwordError });
      };

      const attempt = auth.takeLoginAttempt(req.ip, user.email);
      if (!attempt) return fail(429, TOO_MANY_LOGINS);
      if (!(await authenticate(db, user.email, field("current")))) {
        return fail(400, "Current password is wrong.");
      }
      attempt.succeeded();
      if (field("password") !== field("confirm")) {
        return fail(400, "The new passwords don't match.");
      }
      try {
        await setUserPassword(db, user._id, field("password"));
      } catch (err) {
        if (!(err instanceof UserError)) throw err;
        return fail(400, `${err.message}.`);
      }
      await auth.endOtherSessions(req, user._id);
      setFlash(reply, "Password changed.");
      return reply.redirect("/settings", 303);
    },
  );

  app.post(
    "/settings/time-zone",
    { preHandler: requireUser },
    async (req, reply) => {
      const value = (req.body as Record<string, unknown> | undefined)?.timeZone;
      const ok =
        typeof value === "string" &&
        (await setUserTimeZone(db, req.user!._id, value));
      if (!ok) {
        return reply.errorPage(400, { message: "Unknown time zone." });
      }
      setFlash(reply, "Time zone saved.");
      return reply.redirect("/settings", 303);
    },
  );

  app.post(
    "/settings/theme",
    { preHandler: requireUser },
    async (req, reply) => {
      const body = req.body as Record<string, unknown> | undefined;
      const theme = body?.theme;
      if (!isTheme(theme)) {
        return reply.errorPage(400, { message: "Unknown theme." });
      }
      await setUserTheme(db, req.user!._id, theme);
      // `assets/theme.js` asks for JSON and applies the theme without a reload.
      if (req.headers.accept?.includes("application/json")) {
        return reply.send({ theme });
      }
      return reply.redirect(localPath(body?.back), 303);
    },
  );

  app.post(
    "/settings/link-code",
    { preHandler: requireUser },
    async (req, reply) => {
      await createLinkCode(db, req.user!._id, clock.now());
      return reply.redirect("/settings", 303);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/settings/linked-chats/:id/delete",
    { preHandler: requireUser },
    async (req, reply) => {
      const chat = await findLinkedChat(db, req.user!._id, req.params.id);
      if (!chat) return reply.redirect("/settings", 303);
      return sendConfirmPage(reply, auth.csrfToken(req, reply), {
        title: "Remove Linked chat",
        question: `Remove ${chat.title}?`,
        explanation: html`Alerts stop arriving in this chat. You can link it
        again later with a new Link code.`,
        action: `/settings/linked-chats/${String(chat._id)}/delete`,
        button: "Remove chat",
        cancel: "/settings",
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/settings/linked-chats/:id/delete",
    { preHandler: requireUser },
    async (req, reply) => {
      const chat = await removeLinkedChat(db, req.user!._id, req.params.id);
      if (chat) setFlash(reply, `${chat.title} removed.`);
      return reply.redirect("/settings", 303);
    },
  );
}
