import type { Db } from "mongodb";
import {
  dropPendingDownAlerts,
  enqueueAlert,
  enqueueChangeAlert,
  type AlertedMonitor,
} from "./alerts.js";
import {
  closeOpenIncident,
  findOpenIncident,
  openIncident,
  type IncidentDoc,
} from "./incidents.js";
import type { Effect } from "./monitor-state.js";
import { nextReminderFrom, type ReminderSettings } from "./reminders.js";
import { endPeriod, startPeriod } from "./state-periods.js";
import { listUnreachableChildren } from "./monitor-parents.js";

/**
 * Carries out the effects a state transition asked for, in order. With `deferDownAlert`, a Down Alert isn't enqueued:
 * its Incident is returned instead, for sendDeferredDownAlert() once the Monitor's Children have caught up.
 */
export async function applyEffects(
  db: Db,
  monitor: AlertedMonitor & ReminderSettings,
  effects: Effect[],
  now: Date,
  publicBaseUrl: string,
  options: { deferDownAlert?: boolean } = {},
): Promise<{ deferredDownAlert: IncidentDoc | null }> {
  let deferredDownAlert: IncidentDoc | null = null;
  // The Incident opened or closed by an earlier effect. The state machine always emits enqueue-alert after the
  // open-/close-incident effect it is about.
  let incident: IncidentDoc | null = null;
  for (const effect of effects) {
    switch (effect.kind) {
      case "open-incident":
        incident = await openIncident(
          db,
          monitor,
          effect.startedAt,
          {
            cause: effect.cause,
            ...(effect.maxRunTimeSec !== undefined && {
              maxRunTimeSec: effect.maxRunTimeSec,
            }),
          },
          // Reminders count from going Down.
          nextReminderFrom(monitor, effect.startedAt),
        );
        break;
      case "close-incident":
        incident = await closeOpenIncident(db, monitor._id, now, effect.reason);
        if (incident) await dropPendingDownAlerts(db, incident._id);
        break;
      case "start-period":
        await startPeriod(db, effect.state, monitor, now);
        break;
      case "end-period":
        await endPeriod(db, effect.state, monitor._id, now);
        break;
      case "enqueue-alert":
        if (!incident) break;
        if (effect.alert === "down" && options.deferDownAlert) {
          deferredDownAlert = incident;
          break;
        }
        await enqueueAlert(
          db,
          monitor,
          effect.alert,
          incident,
          now,
          publicBaseUrl,
          effect.alert === "down"
            ? await listUnreachableChildren(db, monitor)
            : [],
        );
        break;
      case "enqueue-change-alert":
        await enqueueChangeAlert(db, monitor, effect, now, publicBaseUrl);
        break;
    }
  }
  return { deferredDownAlert };
}

/**
 * Enqueues a Down Alert applyEffects() deferred, naming the Children Unreachable by now; nothing if the Incident has
 * ended meanwhile (a Heartbeat would have dropped a pending Down Alert too).
 */
export async function sendDeferredDownAlert(
  db: Db,
  monitor: AlertedMonitor,
  incidentId: IncidentDoc["_id"],
  now: Date,
  publicBaseUrl: string,
): Promise<void> {
  const incident = await findOpenIncident(db, monitor._id, incidentId);
  if (!incident) return;
  await enqueueAlert(
    db,
    monitor,
    "down",
    incident,
    now,
    publicBaseUrl,
    await listUnreachableChildren(db, monitor),
  );
}
