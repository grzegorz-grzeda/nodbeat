import type { FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import { requireUser, type Auth } from "./auth.js";
import type { Clock } from "./clock.js";
import { formatDateTime } from "./format.js";
import { csrfField, html, page, userHeader } from "./html.js";
import {
  createLinkCode,
  findActiveLinkCode,
  listLinkedChats,
  removeLinkedChat,
} from "./linked-chats.js";

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
    return reply.type("text/html").send(
      page({
        title: "Settings",
        header: userHeader(user.email, csrf),
        body: html`<h1>Settings</h1>
          <p>Time zone: ${user.timeZone}</p>
          <h2>Linked chats</h2>
          ${
            chats.length === 0
              ? html`<p>No Linked chats yet.</p>`
              : html`<ul>
                  ${chats.map(
                    (c) =>
                      html`<li>
                        ${c.title}
                        <small
                          >linked
                          ${formatDateTime(c.linkedAt, user.timeZone)}</small
                        >
                        <form
                          class="inline"
                          method="post"
                          action="/settings/linked-chats/${String(c._id)}/delete"
                        >
                          ${csrfField(csrf)}
                          <button type="submit">Remove</button>
                        </form>
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
      }),
    );
  });

  app.post(
    "/settings/link-code",
    { preHandler: requireUser },
    async (req, reply) => {
      await createLinkCode(db, req.user!._id, clock.now());
      return reply.redirect("/settings", 303);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/settings/linked-chats/:id/delete",
    { preHandler: requireUser },
    async (req, reply) => {
      await removeLinkedChat(db, req.user!._id, req.params.id);
      return reply.redirect("/settings", 303);
    },
  );
}
