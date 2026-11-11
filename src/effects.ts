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
import { endPeriod, startPeriod } from "./state-periods.js";

/** Carries out the effects a state transition asked for, in order. */
export async function applyEffects(
  db: Db,
  monitor: AlertedMonitor,
  effects: Effect[],
  now: Date,
  publicBaseUrl: string,
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
      case "start-period":
        await startPeriod(db, effect.state, monitor, now);
        break;
      case "end-period":
        await endPeriod(db, effect.state, monitor._id, now);
        break;
      case "enqueue-alert":
        if (incident) {
          await enqueueAlert(
            db,
            monitor,
            effect.alert,
            incident,
            now,
            publicBaseUrl,
          );
        }
        break;
    }
  }
}
