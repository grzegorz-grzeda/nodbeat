import type { FastifyInstance } from "fastify";
import type { Db } from "mongodb";
import { requireUser, type Auth } from "./auth.js";
import type { Clock } from "./clock.js";
import { formatAgo } from "./format.js";
import { html, page, userHeader } from "./html.js";
import { STATE_LABELS } from "./monitor-state.js";
import { listMonitors } from "./monitors.js";

export function registerDashboard(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Auth },
): void {
  const { db, clock, auth } = deps;

  app.get("/", { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const now = clock.now();
    const list = await listMonitors(db, user._id);
    return reply.type("text/html").send(
      page({
        title: "Dashboard",
        header: userHeader(user.email, auth.csrfToken(req, reply)),
        body: html`<h1>Dashboard</h1>
          <p><a href="/monitors/new">New Monitor</a></p>
          ${
            list.length === 0
              ? html`<p>No Monitors yet.</p>`
              : html`<table>
                  <thead>
                    <tr>
                      <th>Monitor</th>
                      <th>State</th>
                      <th>Last Heartbeat</th>
                      <th>Last message</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${list.map(
                      (m) =>
                        html`<tr>
                          <td>
                            <a href="/monitors/${String(m._id)}">${m.name}</a>
                          </td>
                          <td class="state-${m.state}">
                            ${STATE_LABELS[m.state]}
                          </td>
                          <td>${formatAgo(m.lastHeartbeatAt, now)}</td>
                          <td>${m.lastMessage ?? ""}</td>
                        </tr>`,
                    )}
                  </tbody>
                </table>`
          }`,
      }),
    );
  });
}
