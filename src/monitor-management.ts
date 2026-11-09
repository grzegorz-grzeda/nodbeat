import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "mongodb";
import { requireUser, type Auth } from "./auth.js";
import type { Clock } from "./clock.js";
import { deleteHeartbeatsOf } from "./heartbeats.js";
import { csrfField, html, page, userHeader } from "./html.js";
import { deleteIncidentsOf } from "./incidents.js";
import { limitsFor } from "./limits.js";
import { applyEffects } from "./effects.js";
import { deleteAlertsOf } from "./alerts.js";
import type { MonitorLock } from "./monitor-lock.js";
import { transition, type MonitorEvent } from "./monitor-state.js";
import {
  formFor,
  monitorFormBody,
  readForm,
  validate,
  type MonitorForm,
} from "./monitor-form.js";
import { deletePausePeriodsOf } from "./pause-periods.js";
import {
  findOwnMonitor,
  monitors,
  newHeartbeatToken,
  sendMonitorNotFound,
  type MonitorDoc,
} from "./monitors.js";

type IdRequest = FastifyRequest<{ Params: { id: string } }>;

/** Editing, pausing, unpausing, regenerating the Heartbeat URL, the Alerts switch and deleting a Monitor. */
export function registerMonitorManagement(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; auth: Auth; lock: MonitorLock },
): void {
  const { db, clock, auth, lock } = deps;

  /** Runs an event through the state machine under the Monitor's lock, also saving `extra` fields. */
  const runTransition = (
    monitor: MonitorDoc,
    event: MonitorEvent,
    extra: Partial<MonitorDoc> = {},
  ) =>
    lock.run(String(monitor._id), async () => {
      // Re-read under the lock: a Heartbeat or the Down checker may have changed the state.
      const current = await monitors(db).findOne({ _id: monitor._id });
      if (!current) return;
      const now = clock.now();
      const { fields, effects } = transition(current, event, now);
      await monitors(db).updateOne(
        { _id: current._id },
        { $set: { ...fields, ...extra } },
      );
      await applyEffects(db, current, effects, now);
    });

  /** A route on one of the logged-in User's Monitors; 404 for anyone else's. */
  const ownMonitorRoute = (
    handler: (
      monitor: MonitorDoc,
      req: IdRequest,
      reply: FastifyReply,
    ) => Promise<FastifyReply>,
  ) => ({
    preHandler: requireUser,
    handler: async (req: IdRequest, reply: FastifyReply) => {
      const monitor = await findOwnMonitor(db, req.user!._id, req.params.id);
      if (!monitor) return sendMonitorNotFound(req, reply, auth);
      return handler(monitor, req, reply);
    },
  });

  const editPage = (
    req: IdRequest,
    reply: FastifyReply,
    options: { form: MonitorForm; errors?: string[] },
  ) => {
    const csrf = auth.csrfToken(req, reply);
    return page({
      title: "Edit Monitor",
      header: userHeader(req.user!.email, csrf),
      body: monitorFormBody({
        csrf,
        limits: limitsFor(req.user!),
        editing: req.params.id,
        ...options,
      }),
    });
  };

  app.get<{ Params: { id: string } }>(
    "/monitors/:id/edit",
    ownMonitorRoute(async (monitor, req, reply) =>
      reply
        .type("text/html")
        .send(editPage(req, reply, { form: formFor(monitor) })),
    ),
  );

  app.post<{ Params: { id: string } }>(
    "/monitors/:id/edit",
    ownMonitorRoute(async (monitor, req, reply) => {
      const form = readForm(req.body);
      const result = validate(form, limitsFor(req.user!));
      if ("errors" in result) {
        return reply
          .code(400)
          .type("text/html")
          .send(editPage(req, reply, { form, errors: result.errors }));
      }
      const { intervalSec, graceSec } = result.settings;
      await runTransition(
        monitor,
        { kind: "edit", timing: { intervalSec, graceSec } },
        result.settings,
      );
      return reply.redirect(`/monitors/${monitor._id}`, 303);
    }),
  );

  app.post<{ Params: { id: string } }>(
    "/monitors/:id/regenerate-url",
    ownMonitorRoute(async (monitor, _req, reply) => {
      // Under the lock, so intake's re-check of the token sees either the old URL or the new one.
      await lock.run(String(monitor._id), () =>
        monitors(db).updateOne(
          { _id: monitor._id },
          { $set: { token: newHeartbeatToken() } },
        ),
      );
      return reply.redirect(`/monitors/${monitor._id}`, 303);
    }),
  );

  for (const kind of ["pause", "unpause"] as const) {
    app.post<{ Params: { id: string } }>(
      `/monitors/:id/${kind}`,
      ownMonitorRoute(async (monitor, _req, reply) => {
        await runTransition(monitor, { kind });
        return reply.redirect(`/monitors/${monitor._id}`, 303);
      }),
    );
  }

  app.post<{ Params: { id: string } }>(
    "/monitors/:id/alerts",
    ownMonitorRoute(async (monitor, req, reply) => {
      const value = (req.body as Record<string, unknown> | undefined)
        ?.alertsEnabled;
      if (value !== "true" && value !== "false") {
        return reply.code(400).type("text/plain").send("Bad Request");
      }
      await monitors(db).updateOne(
        { _id: monitor._id },
        { $set: { alertsEnabled: value === "true" } },
      );
      return reply.redirect(`/monitors/${monitor._id}`, 303);
    }),
  );

  app.get<{ Params: { id: string } }>(
    "/monitors/:id/delete",
    ownMonitorRoute(async (monitor, req, reply) => {
      const csrf = auth.csrfToken(req, reply);
      return reply.type("text/html").send(
        page({
          title: "Delete Monitor",
          header: userHeader(req.user!.email, csrf),
          body: html`<h1>Delete ${monitor.name}?</h1>
            <p>
              This removes the Monitor with all its Heartbeats and Incidents. It
              can't be undone.
            </p>
            <form
              method="post"
              action="/monitors/${String(monitor._id)}/delete"
            >
              ${csrfField(csrf)}
              <button type="submit">Delete Monitor</button>
              <a href="/monitors/${String(monitor._id)}">Cancel</a>
            </form>`,
        }),
      );
    }),
  );

  app.post<{ Params: { id: string } }>(
    "/monitors/:id/delete",
    ownMonitorRoute(async (monitor, _req, reply) => {
      await lock.run(String(monitor._id), async () => {
        // The Monitor goes first, so its Heartbeat URL stops answering before its history is removed.
        await monitors(db).deleteOne({ _id: monitor._id });
        await Promise.all([
          deleteHeartbeatsOf(db, monitor._id),
          deleteIncidentsOf(db, monitor._id),
          deletePausePeriodsOf(db, monitor._id),
          deleteAlertsOf(db, monitor._id),
        ]);
      });
      return reply.redirect("/", 303);
    }),
  );
}
