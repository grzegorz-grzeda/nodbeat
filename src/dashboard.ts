import type { FastifyInstance } from "fastify";
import { requireUser, type Auth } from "./auth.js";
import { csrfField, html, page } from "./html.js";

export function registerDashboard(app: FastifyInstance, auth: Auth): void {
  app.get("/", { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    return reply.type("text/html").send(
      page({
        title: "Dashboard",
        header: html`<span
          >${user.email}
          <form class="inline" method="post" action="/logout">
            ${csrfField(auth.csrfToken(req, reply))}
            <button type="submit">Log out</button>
          </form></span
        >`,
        body: html`<h1>Dashboard</h1>
          <p>No Monitors yet.</p>`,
      }),
    );
  });
}
