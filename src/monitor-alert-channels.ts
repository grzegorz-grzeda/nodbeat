import type { Db, ObjectId, PullOperator } from "mongodb";

/** A Monitor's Alert channels: all of its owner's (including ones added later) or the chosen few. */
export type MonitorAlertChannels = "all" | ObjectId[];

/** The part of a Monitor that says where its Alerts go. Missing on Monitors stored before the choice existed: "all". */
export interface AlertChannelChoice {
  alertChannels?: MonitorAlertChannels;
}

export const choiceOf = (monitor: AlertChannelChoice): MonitorAlertChannels =>
  monitor.alertChannels ?? "all";

/** The owner's channels the Monitor's Alerts go to, in the order given. */
export function channelsOfMonitor<C extends { _id: ObjectId }>(
  monitor: AlertChannelChoice,
  ownerChannels: C[],
): C[] {
  const choice = choiceOf(monitor);
  if (choice === "all") return ownerChannels;
  const chosen = new Set(choice.map(String));
  return ownerChannels.filter((c) => chosen.has(String(c._id)));
}

// By name: this module sits below `monitors.ts`, which shouldn't be imported by the Alert channel code. Typed as
// chosen lists only: the updates below match arrays, never "all".
type ChosenList = { alertChannels?: ObjectId[] };
const monitorChoices = (db: Db) => db.collection<ChosenList>("monitors");

/** Takes removed Alert channels out of every chosen list. An emptied list stays chosen: it never falls back to "all". */
export async function pullFromMonitors(
  db: Db,
  channelIds: ObjectId[],
): Promise<void> {
  if (channelIds.length === 0) return;
  await monitorChoices(db).updateMany(
    { alertChannels: { $in: channelIds } },
    {
      $pull: {
        alertChannels: { $in: channelIds },
      } as PullOperator<ChosenList>,
    },
  );
}

/** Points chosen lists at `to` instead of `from` (a Linked chat merged into another). */
export async function replaceInMonitors(
  db: Db,
  from: ObjectId,
  to: ObjectId,
): Promise<void> {
  await monitorChoices(db).updateMany(
    { alertChannels: from },
    { $addToSet: { alertChannels: to } },
  );
  await monitorChoices(db).updateMany(
    { alertChannels: from },
    { $pull: { alertChannels: from } },
  );
}
