import { HttpError } from "./http";
import { cols } from "./mongo";
import type { Guest } from "./types";
import { viewerId } from "./viewer";

/** Dumpsters are per-event sign-in (name + selfie). Changing anything requires it. */
export async function requireGuest(dumpsterId: string): Promise<Guest> {
  const { guests } = await cols();
  const g = await guests.findOne({ dumpsterId, viewerId: await viewerId() });
  if (!g?.name) throw new HttpError(401, "Sign in to this dumpster first.");
  return g;
}
