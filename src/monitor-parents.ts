import type { Db, ObjectId } from "mongodb";
import { STATE_LABELS } from "./monitor-state.js";
import { monitors, type MonitorDoc } from "./monitors.js";

/** One of the owner's Monitors as the Parent choice sees it. */
export type ParentOption = Pick<MonitorDoc, "_id" | "name"> & {
  parentId?: ObjectId | null;
};

/** The owner's Monitors, oldest first, for the "Depends on" choice. */
export function listParentOptions(
  db: Db,
  ownerId: ObjectId,
): Promise<ParentOption[]> {
  return monitors(db)
    .find({ ownerId }, { projection: { _id: 1, name: 1, parentId: 1 } })
    .sort({ createdAt: 1 })
    .toArray();
}

/**
 * Whether `candidate` (or a Parent above it) is `monitor`: then making `candidate` the Parent of `monitor` would close
 * a cycle. Stops at a cycle already stored rather than looping.
 */
function leadsTo(
  candidate: ObjectId,
  monitor: ObjectId,
  byId: Map<string, ParentOption>,
): boolean {
  const seen = new Set<string>();
  for (
    let id: ObjectId | null | undefined = candidate;
    id && !seen.has(String(id));
    id = byId.get(String(id))?.parentId
  ) {
    if (id.equals(monitor)) return true;
    seen.add(String(id));
  }
  return false;
}

/** The Monitors `editing` (null: a new one) may depend on: the owner's others, minus any that would close a cycle. */
export function parentChoices(
  own: ParentOption[],
  editing: ObjectId | null,
): ParentOption[] {
  if (!editing) return own;
  const byId = new Map(own.map((m) => [String(m._id), m]));
  return own.filter((m) => !leadsTo(m._id, editing, byId));
}

/** The chosen Parent ("" for none), checked against the owner's Monitors. */
export function checkParent(
  chosen: string,
  own: ParentOption[],
  editing: ObjectId | null,
): { parentId: ObjectId | null } | { error: string } {
  if (chosen === "") return { parentId: null };
  const parent = own.find((m) => String(m._id) === chosen);
  if (!parent)
    return { error: "Choose one of your own Monitors to depend on." };
  if (editing && parent._id.equals(editing)) {
    return { error: "A Monitor can't depend on itself." };
  }
  if (!parentChoices(own, editing).includes(parent)) {
    return {
      error: `${parent.name} depends on this Monitor, so this Monitor can't depend on it.`,
    };
  }
  return { parentId: parent._id };
}

/** Why an Unreachable Monitor is: "Router Down". Empty for other states or without the Parent at hand. */
export function unreachableNote(
  monitor: Pick<MonitorDoc, "state">,
  parent: Pick<MonitorDoc, "name" | "state"> | null | undefined,
): string {
  if (monitor.state !== "unreachable" || !parent) return "";
  return `${parent.name} ${STATE_LABELS[parent.state]}`;
}

/** A Monitor's Children, oldest first. */
export function listChildren(
  db: Db,
  monitor: Pick<MonitorDoc, "_id" | "ownerId">,
): Promise<MonitorDoc[]> {
  return monitors(db)
    .find({ ownerId: monitor.ownerId, parentId: monitor._id })
    .sort({ createdAt: 1 })
    .toArray();
}

/** Gives a deleted Monitor's Children no Parent. */
export async function detachChildren(
  db: Db,
  monitorId: ObjectId,
): Promise<void> {
  await monitors(db).updateMany(
    { parentId: monitorId },
    { $set: { parentId: null } },
  );
}
