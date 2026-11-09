import type { Db } from "mongodb";
import {
  dropPendingDownAlert,
  enqueueAlert,
  type AlertedMonitor,
} from "./alerts.js";
import {
  closeOpenIncident,
  openIncident,
  type IncidentDoc,
} from "./incidents.js";
import type { Effect } from "./monitor-state.js";
import { endPausePeriod, startPausePeriod } from "./pause-periods.js";

/** Carries out the effects a state transition asked for, in order. */
export async function applyEffects(
  db: Db,
  monitor: AlertedMonitor,
  effects: Effect[],
  now: Date,
): Promise<void> {
  // The Incident opened or closed by an earlier effect. The state machine always emits enqueue-alert after the
  // open-/close-incident effect it is about.
  let incident: IncidentDoc | null = null;
  for (const effect of effects) {
    switch (effect.kind) {
      case "open-incident":
        incident = await openIncident(db, monitor, effect.startedAt);
        break;
      case "close-incident":
        incident = await closeOpenIncident(db, monitor._id, now, effect.reason);
        if (incident) await dropPendingDownAlert(db, incident._id);
        break;
      case "start-pause-period":
        await startPausePeriod(db, monitor, now);
        break;
      case "end-pause-period":
        await endPausePeriod(db, monitor._id, now);
        break;
      case "enqueue-alert":
        if (incident) {
          await enqueueAlert(db, monitor, effect.alert, incident, now);
        }
        break;
    }
  }
}
