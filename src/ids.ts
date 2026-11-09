import { ObjectId } from "mongodb";

/** The ObjectId this canonical 24-hex string spells, or null for anything else (malformed ids from URLs). */
export function parseObjectId(id: string): ObjectId | null {
  if (!ObjectId.isValid(id) || String(new ObjectId(id)) !== id) return null;
  return new ObjectId(id);
}
