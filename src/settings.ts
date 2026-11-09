import type { FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import { requireUser, type Auth } from "./auth.js";
import type { Clock } from "./clock.js";
import { sendConfirmPage } from "./confirm.js";
import { setFlash } from "./flash.js";
import { formatDateTime } from "./format.js";
import { csrfField, html, type SafeHtml } from "./html.js";
import {
  createLinkCode,
  findActiveLinkCode,
  findLinkedChat,
  listLinkedChats,
  removeLinkedChat,
} from "./linked-chats.js";
import { isTheme, setUserTheme, setUserTimeZone } from "./users.js";

/** Only same-site paths, so the switch can't be turned into an open redirect. */
function localPath(value: unknown): string {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : "/";
}

/** Every IANA time zone the runtime knows, plus `current` in case it's an alias missing from that list. */
function timeZoneOptions(current: string): SafeHtml[] {
  const zones = Intl.supportedValuesOf("timeZone");
  if (!zones.includes(current)) zones.unshift(current);
  return zones.map(
    (z) =>
      html`<option value="${z}" ${z === current && html`selected`}>
        ${z}
      </option>`,
  );
}

export function registerSettings(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Auth },
): void {
  const { db, clock, auth } = deps;

  app.get("/settings", { preHandler: requireUser }, async (req, reply) => {
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
        </form>`,
    });
  });

  app.post(
    "/settings/time-zone",
    { preHandler: requireUser },
    async (req, reply) => {
      const value = (req.body as Record<string, unknown> | undefined)?.timeZone;
      const ok =
        typeof value === "string" &&
        (await setUserTimeZone(db, req.user!._id, value));
      if (!ok) {
        return reply.code(400).type("text/plain").send("Unknown time zone");
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
        return reply.code(400).type("text/plain").send("Unknown theme");
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
